// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/// @title Lottery — учебная лотерея с честной случайностью Chainlink VRF v2.5
/// @notice Educational project. Not audited. Do not use with real money.
/// @dev Основные идеи:
///  - случайное число приходит от Chainlink VRF и проверяется криптографически;
///  - розыгрыш может запустить любой участник после окончания раунда,
///    поэтому владелец не может выбрать «удобный» момент;
///  - выплаты по схеме pull: деньги начисляются на баланс, а пользователь
///    сам забирает их через withdraw(). Это работает и со смарт-кошельками;
///  - если VRF не ответил за REFUND_DELAY, раунд отменяется и игроки
///    возвращают свои билеты через claimRefund().
contract Lottery is VRFConsumerBaseV2Plus {
    enum State {
        Open,
        Drawing
    }

    // --- Ошибки ---
    error WrongTicketPrice();
    error RoundNotOpen();
    error RoundFinished();
    error RoundNotFinished();
    error TooManyPlayers();
    error NotDrawing();
    error RefundNotAvailableYet();
    error NothingToRefund();
    error NothingToWithdraw();
    error TransferFailed();
    error InvalidConfig();

    // --- События ---
    event Entered(uint256 indexed roundId, address indexed player);
    event RoundExtended(uint256 indexed roundId, uint256 newEndTime);
    event DrawRequested(uint256 indexed roundId, uint256 indexed requestId);
    event WinnerPicked(uint256 indexed roundId, address indexed winner, uint256 prize, uint256 fee);
    event RoundCancelled(uint256 indexed roundId);
    event Refunded(uint256 indexed roundId, address indexed player, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    // --- Настройки (не меняются после деплоя) ---
    uint256 public constant MAX_FEE_PERCENT = 20;
    uint256 public constant MAX_PLAYERS = 500;
    uint256 public constant REFUND_DELAY = 1 days;

    uint256 public immutable ticketPrice;
    uint256 public immutable feePercent;
    uint256 public immutable roundDuration;

    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint32 public immutable callbackGasLimit;
    uint16 public constant REQUEST_CONFIRMATIONS = 3;

    // --- Состояние ---
    State public state;
    uint256 public roundId;
    uint256 public roundEnd;
    uint256 public drawRequestedAt;
    uint256 public lastRequestId;

    mapping(uint256 => address[]) private _players;
    mapping(uint256 => mapping(address => uint256)) public ticketsOf;
    mapping(uint256 => bool) public cancelled;
    mapping(uint256 => address) public winnerOf;
    mapping(address => uint256) public pendingWithdrawals;

    constructor(
        address vrfCoordinator,
        bytes32 _keyHash,
        uint256 _subscriptionId,
        uint32 _callbackGasLimit,
        uint256 _ticketPrice,
        uint256 _feePercent,
        uint256 _roundDuration
    ) VRFConsumerBaseV2Plus(vrfCoordinator) {
        if (_ticketPrice == 0 || _feePercent > MAX_FEE_PERCENT || _roundDuration == 0) {
            revert InvalidConfig();
        }
        keyHash = _keyHash;
        subscriptionId = _subscriptionId;
        callbackGasLimit = _callbackGasLimit;
        ticketPrice = _ticketPrice;
        feePercent = _feePercent;
        roundDuration = _roundDuration;

        roundId = 1;
        roundEnd = block.timestamp + _roundDuration;
        state = State.Open;
    }

    // ------------------------------------------------------------------
    // Игра
    // ------------------------------------------------------------------

    /// @notice Купить один билет в текущем раунде.
    function enter() external payable {
        if (state != State.Open) revert RoundNotOpen();
        if (block.timestamp >= roundEnd) revert RoundFinished();
        if (msg.value != ticketPrice) revert WrongTicketPrice();
        if (_players[roundId].length >= MAX_PLAYERS) revert TooManyPlayers();

        _players[roundId].push(msg.sender);
        ticketsOf[roundId][msg.sender] += 1;
        emit Entered(roundId, msg.sender);
    }

    /// @notice Запустить розыгрыш. Может вызвать кто угодно после окончания раунда.
    /// @dev Если игроков нет, раунд просто продлевается.
    function draw() external returns (uint256 requestId) {
        if (state != State.Open) revert RoundNotOpen();
        if (block.timestamp < roundEnd) revert RoundNotFinished();

        if (_players[roundId].length == 0) {
            roundEnd = block.timestamp + roundDuration;
            emit RoundExtended(roundId, roundEnd);
            return 0;
        }

        state = State.Drawing;
        drawRequestedAt = block.timestamp;

        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: false}))
            })
        );
        lastRequestId = requestId;
        emit DrawRequested(roundId, requestId);
    }

    /// @dev Вызывается координатором Chainlink VRF.
    function fulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) internal override {
        // Опоздавший ответ (раунд уже отменён) просто игнорируем.
        if (state != State.Drawing || requestId != lastRequestId) return;

        uint256 id = roundId;
        address[] storage players = _players[id];
        address winner = players[randomWords[0] % players.length];

        uint256 pot = players.length * ticketPrice;
        uint256 fee = (pot * feePercent) / 100;
        uint256 prize = pot - fee;

        winnerOf[id] = winner;
        pendingWithdrawals[winner] += prize;
        pendingWithdrawals[owner()] += fee;

        emit WinnerPicked(id, winner, prize, fee);
        _startNextRound();
    }

    /// @notice Отменить раунд, если Chainlink не прислал число за REFUND_DELAY.
    function cancelStuckRound() external {
        if (state != State.Drawing) revert NotDrawing();
        if (block.timestamp < drawRequestedAt + REFUND_DELAY) revert RefundNotAvailableYet();

        cancelled[roundId] = true;
        emit RoundCancelled(roundId);
        _startNextRound();
    }

    /// @notice Вернуть деньги за билеты отменённого раунда.
    function claimRefund(uint256 id) external {
        uint256 tickets = ticketsOf[id][msg.sender];
        if (!cancelled[id] || tickets == 0) revert NothingToRefund();

        ticketsOf[id][msg.sender] = 0;
        uint256 amount = tickets * ticketPrice;
        pendingWithdrawals[msg.sender] += amount;
        emit Refunded(id, msg.sender, amount);
    }

    /// @notice Забрать выигрыш, комиссию или возврат.
    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0; // сначала обнуляем — защита от повторного входа
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Чтение
    // ------------------------------------------------------------------

    function getPlayers(uint256 id) external view returns (address[] memory) {
        return _players[id];
    }

    function playersCount() external view returns (uint256) {
        return _players[roundId].length;
    }

    function currentPot() external view returns (uint256) {
        return _players[roundId].length * ticketPrice;
    }

    // ------------------------------------------------------------------

    function _startNextRound() private {
        roundId += 1;
        roundEnd = block.timestamp + roundDuration;
        state = State.Open;
    }
}
