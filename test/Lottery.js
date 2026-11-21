const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const TICKET = ethers.parseEther("0.1");
const FEE_PERCENT = 10n;
const DURATION = 60 * 60; // 1 час
const KEY_HASH = "0x" + "11".repeat(32);
const CALLBACK_GAS = 500_000;

describe("Lottery", function () {
  async function deployFixture() {
    const [owner, alice, bob, carol] = await ethers.getSigners();

    // Мок координатора Chainlink VRF v2.5
    const Mock = await ethers.getContractFactory("VRFCoordinatorV2_5Mock");
    const vrf = await Mock.deploy(
      ethers.parseEther("0.1"), // baseFee
      1_000_000_000n, // gasPrice
      4_000_000_000_000_000n // weiPerUnitLink
    );

    const tx = await vrf.createSubscription();
    const receipt = await tx.wait();
    const created = receipt.logs
      .map((l) => {
        try {
          return vrf.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "SubscriptionCreated");
    const subId = created.args.subId;
    await vrf.fundSubscription(subId, ethers.parseEther("100"));

    const Lottery = await ethers.getContractFactory("Lottery");
    const lottery = await Lottery.deploy(
      await vrf.getAddress(),
      KEY_HASH,
      subId,
      CALLBACK_GAS,
      TICKET,
      FEE_PERCENT,
      DURATION
    );
    await vrf.addConsumer(subId, await lottery.getAddress());

    return { lottery, vrf, owner, alice, bob, carol };
  }

  async function requestIdFrom(lottery, tx) {
    const receipt = await tx.wait();
    const ev = receipt.logs
      .map((l) => {
        try {
          return lottery.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e) => e && e.name === "DrawRequested");
    return ev.args.requestId;
  }

  describe("Покупка билетов", function () {
    it("принимает билет по правильной цене", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await expect(lottery.connect(alice).enter({ value: TICKET }))
        .to.emit(lottery, "Entered")
        .withArgs(1n, alice.address);
      expect(await lottery.playersCount()).to.equal(1n);
      expect(await lottery.currentPot()).to.equal(TICKET);
    });

    it("отклоняет неправильную цену", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await expect(
        lottery.connect(alice).enter({ value: TICKET - 1n })
      ).to.be.revertedWithCustomError(lottery, "WrongTicketPrice");
    });

    it("не продаёт билеты после окончания раунда", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await time.increase(DURATION);
      await expect(
        lottery.connect(alice).enter({ value: TICKET })
      ).to.be.revertedWithCustomError(lottery, "RoundFinished");
    });

    it("не принимает некорректные настройки", async function () {
      const { vrf } = await loadFixture(deployFixture);
      const Lottery = await ethers.getContractFactory("Lottery");
      await expect(
        Lottery.deploy(await vrf.getAddress(), KEY_HASH, 1, CALLBACK_GAS, TICKET, 21, DURATION)
      ).to.be.revertedWithCustomError(Lottery, "InvalidConfig");
    });
  });

  describe("Розыгрыш", function () {
    it("нельзя запустить до окончания раунда", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await expect(lottery.draw()).to.be.revertedWithCustomError(lottery, "RoundNotFinished");
    });

    it("без игроков раунд продлевается", async function () {
      const { lottery } = await loadFixture(deployFixture);
      await time.increase(DURATION);
      await expect(lottery.draw()).to.emit(lottery, "RoundExtended");
      expect(await lottery.state()).to.equal(0n); // Open
      expect(await lottery.roundId()).to.equal(1n);
    });

    it("любой может запустить розыгрыш; приз и комиссия делятся верно", async function () {
      const { lottery, vrf, owner, alice, bob, carol } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await lottery.connect(bob).enter({ value: TICKET });
      await lottery.connect(carol).enter({ value: TICKET });
      await time.increase(DURATION);

      // Запускает не владелец, а обычный игрок
      const requestId = await requestIdFrom(lottery, await lottery.connect(bob).draw());
      expect(await lottery.state()).to.equal(1n); // Drawing

      // Во время розыгрыша билеты не продаются
      await expect(
        lottery.connect(alice).enter({ value: TICKET })
      ).to.be.revertedWithCustomError(lottery, "RoundNotOpen");

      await expect(vrf.fulfillRandomWords(requestId, await lottery.getAddress())).to.emit(
        lottery,
        "WinnerPicked"
      );

      const pot = TICKET * 3n;
      const fee = (pot * FEE_PERCENT) / 100n;
      const winner = await lottery.winnerOf(1);
      expect([alice.address, bob.address, carol.address]).to.include(winner);
      expect(await lottery.pendingWithdrawals(winner)).to.equal(pot - fee);
      expect(await lottery.pendingWithdrawals(owner.address)).to.equal(fee);

      // Начался новый раунд
      expect(await lottery.roundId()).to.equal(2n);
      expect(await lottery.state()).to.equal(0n);
      expect(await lottery.playersCount()).to.equal(0n);
    });

    it("победитель и владелец забирают деньги через withdraw()", async function () {
      const { lottery, vrf, owner, alice } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await time.increase(DURATION);
      const requestId = await requestIdFrom(lottery, await lottery.draw());
      await vrf.fulfillRandomWords(requestId, await lottery.getAddress());

      const fee = (TICKET * FEE_PERCENT) / 100n;
      await expect(lottery.connect(alice).withdraw()).to.changeEtherBalances(
        [alice, lottery],
        [TICKET - fee, -(TICKET - fee)]
      );
      await expect(lottery.connect(owner).withdraw()).to.changeEtherBalances(
        [owner, lottery],
        [fee, -fee]
      );
      await expect(lottery.connect(alice).withdraw()).to.be.revertedWithCustomError(
        lottery,
        "NothingToWithdraw"
      );
    });
  });

  describe("Возврат денег, если Chainlink не ответил", function () {
    it("раунд можно отменить только после REFUND_DELAY", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await time.increase(DURATION);
      await lottery.draw();

      await expect(lottery.cancelStuckRound()).to.be.revertedWithCustomError(
        lottery,
        "RefundNotAvailableYet"
      );
      await time.increase(24 * 60 * 60);
      await expect(lottery.cancelStuckRound()).to.emit(lottery, "RoundCancelled").withArgs(1n);
    });

    it("игроки возвращают билеты, а опоздавший ответ VRF игнорируется", async function () {
      const { lottery, vrf, alice, bob } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await lottery.connect(alice).enter({ value: TICKET });
      await lottery.connect(bob).enter({ value: TICKET });
      await time.increase(DURATION);
      const requestId = await requestIdFrom(lottery, await lottery.draw());

      await time.increase(24 * 60 * 60);
      await lottery.cancelStuckRound();

      // Ответ пришёл поздно — победитель не выбирается
      await vrf.fulfillRandomWords(requestId, await lottery.getAddress());
      expect(await lottery.winnerOf(1)).to.equal(ethers.ZeroAddress);

      await lottery.connect(alice).claimRefund(1);
      await lottery.connect(bob).claimRefund(1);
      expect(await lottery.pendingWithdrawals(alice.address)).to.equal(TICKET * 2n);
      expect(await lottery.pendingWithdrawals(bob.address)).to.equal(TICKET);

      // Повторно вернуть нельзя
      await expect(lottery.connect(alice).claimRefund(1)).to.be.revertedWithCustomError(
        lottery,
        "NothingToRefund"
      );

      await expect(lottery.connect(alice).withdraw()).to.changeEtherBalance(alice, TICKET * 2n);
    });

    it("нельзя вернуть деньги за раунд, который не отменён", async function () {
      const { lottery, alice } = await loadFixture(deployFixture);
      await lottery.connect(alice).enter({ value: TICKET });
      await expect(lottery.connect(alice).claimRefund(1)).to.be.revertedWithCustomError(
        lottery,
        "NothingToRefund"
      );
    });
  });
});
