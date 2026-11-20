// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Нужен только для тестов: Hardhat компилирует мок-координатор Chainlink,
// который имитирует ответ VRF в локальной сети.
import {VRFCoordinatorV2_5Mock} from "@chainlink/contracts/src/v0.8/vrf/mocks/VRFCoordinatorV2_5Mock.sol";
