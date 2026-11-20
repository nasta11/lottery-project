require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } = process.env;

const networks = {};
// Сеть Sepolia подключается, только если заданы переменные в .env —
// иначе тесты падали бы без ключей.
if (SEPOLIA_RPC_URL && PRIVATE_KEY) {
  networks.sepolia = { url: SEPOLIA_RPC_URL, accounts: [PRIVATE_KEY] };
}

module.exports = {
  solidity: {
    compilers: [
      { version: "0.8.26", settings: { optimizer: { enabled: true, runs: 200 } } },
      { version: "0.8.19", settings: { optimizer: { enabled: true, runs: 200 } } },
    ],
  },
  networks,
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
};
