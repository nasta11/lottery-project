// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract Lottery {
    address public owner;
    address[] public players;
    uint256 public ticketPrice;
    uint256 public ownerFee = 10; // 10% комиссия

    constructor(uint256 _ticketPrice) {
        owner = msg.sender;
        ticketPrice = _ticketPrice;
    }

    function enter() public payable {
        require(msg.value == ticketPrice, "Incorrect ticket price");
        players.push(msg.sender);
    }

    function pickWinner() public {
        require(msg.sender == owner, "Only owner can pick winner");
        require(players.length > 0, "No players in the lottery");

        uint256 random = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender)));
        uint256 winnerIndex = random % players.length;  // Генерация случайного индекса

        address winner = players[winnerIndex];

        uint256 contractBalance = address(this).balance;
        uint256 ownerCut = (contractBalance * ownerFee) / 100;
        uint256 winnerPrize = contractBalance - ownerCut;

        payable(owner).transfer(ownerCut); // Владелец забирает свою комиссию
        payable(winner).transfer(winnerPrize); // Победитель получает оставшиеся средства

        // Сбрасываем список игроков после каждого розыгрыша
        delete players;
    }
}
