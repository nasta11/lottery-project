// Деплой в Sepolia: npm run deploy:sepolia
// Перед запуском заполните .env (см. .env.example).
const hre = require("hardhat");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная ${name} в .env`);
  return value;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Деплой с аккаунта:", deployer.address);

  const args = [
    required("VRF_COORDINATOR"),
    required("VRF_KEY_HASH"),
    BigInt(required("VRF_SUBSCRIPTION_ID")),
    500_000, // callbackGasLimit
    hre.ethers.parseEther(process.env.TICKET_PRICE_ETH || "0.01"),
    BigInt(process.env.FEE_PERCENT || "10"),
    BigInt(process.env.ROUND_DURATION_SECONDS || "86400"),
  ];

  const lottery = await hre.ethers.deployContract("Lottery", args);
  await lottery.waitForDeployment();
  const address = await lottery.getAddress();

  console.log("Lottery задеплоен:", address);
  console.log("Не забудьте добавить этот адрес как consumer в подписку на vrf.chain.link");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
