# Lottery — смарт-контракт лотереи с честной случайностью

![Tests](https://github.com/nasta11/lottery-project/actions/workflows/test.yml/badge.svg)

[Русский](#русский) · [English](#english)

> ⚠️ **Учебный проект.** Контракт не проходил аудит и работает только в тестовой сети Sepolia. Не используйте его с настоящими деньгами. Для проведения настоящей лотереи нужна лицензия.

---

## Русский

Децентрализованная лотерея на Solidity. Игроки покупают билеты в течение раунда, после его окончания случайного победителя выбирает **Chainlink VRF v2.5**, а результат может проверить любой.

### Что умеет контракт

- **Честная случайность.** Число приходит от Chainlink VRF вместе с криптографическим доказательством. Ни владелец, ни майнеры не могут подстроить результат.
- **Розыгрыш без владельца.** Функцию `draw()` может вызвать любой после окончания раунда, поэтому владелец не выбирает «удобный» момент.
- **Безопасные выплаты (pull payments).** Выигрыш, комиссия и возвраты начисляются на баланс, а пользователь сам забирает их через `withdraw()`. Это работает и для смарт-кошельков вроде Safe.
- **Защита от зависания.** Если Chainlink не ответил за 24 часа, раунд отменяется через `cancelStuckRound()`, и игроки возвращают деньги через `claimRefund()`.
- **Ограничения.** Комиссия не больше 20%, не больше 500 игроков в раунде. Если игроков нет, раунд продлевается.
- **События** для сайта: `Entered`, `DrawRequested`, `WinnerPicked`, `RoundCancelled`, `Refunded`, `Withdrawn`.

### Как устроен раунд

```
enter() × N  →  время вышло  →  draw()  →  Chainlink VRF  →  WinnerPicked  →  новый раунд
                                              │
                                              └─ нет ответа 24 ч → cancelStuckRound() → claimRefund()
```

### Запуск

```bash
git clone https://github.com/nasta11/lottery-project.git
cd lottery-project
npm install
npx hardhat test
```

### Деплой в Sepolia

1. Создайте подписку на [vrf.chain.link](https://vrf.chain.link) и пополните её тестовыми LINK ([faucets.chain.link](https://faucets.chain.link)).
2. Скопируйте `.env.example` в `.env` и заполните. Адрес координатора и key hash возьмите [из документации Chainlink](https://docs.chain.link/vrf/v2-5/supported-networks).
3. `npm run deploy:sepolia`
4. Добавьте адрес задеплоенного контракта как **consumer** в своей подписке.

### Технологии

Solidity 0.8.26 · Hardhat · Chainlink VRF v2.5 · ethers v6 · Mocha/Chai · GitHub Actions

---

## English

A decentralized lottery written in Solidity. Players buy tickets during a round; when it ends, a random winner is chosen with **Chainlink VRF v2.5**, and anyone can verify the result.

### Features

- **Verifiable randomness** from Chainlink VRF, so neither the owner nor validators can bias the result.
- **Permissionless draw:** anyone can call `draw()` once the round ends, so the owner cannot time it.
- **Pull payments:** prizes, fees and refunds are credited and claimed via `withdraw()`, which also works with smart-contract wallets.
- **Stuck-round recovery:** if VRF doesn't respond within 24 hours, `cancelStuckRound()` lets players get their money back through `claimRefund()`.
- **Limits:** fee capped at 20%, max 500 players per round, and an empty round is extended.
- **Events** for a frontend.

### Run locally

```bash
npm install
npx hardhat test
```

Deployment steps are the same as in the Russian section above.

**Tech:** Solidity 0.8.26, Hardhat, Chainlink VRF v2.5, ethers v6, Mocha/Chai, GitHub Actions.

---

Автор / Author: [nasta11](https://github.com/nasta11) · License: MIT
