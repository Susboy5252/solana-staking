# Solana Vault Staking

A learning project: an Anchor program that gives every wallet its own SOL vault and lets it
**natively stake** that SOL with a validator, plus a React website to use it on devnet.

- **Vault:** deposit and withdraw SOL at any time. Funds sit in a program-derived address (PDA) that
  only the owner can move.
- **Native staking:** the program creates a stake account, delegates it to a validator, deactivates
  it, and withdraws it back to the vault. It does this with cross-program invocations (CPIs) into
  Solana's built-in Stake program, signed by the vault PDA.
- **Website:** connect a wallet, manage the vault, pick a validator, and follow the stake through its
  lifecycle, with live balances and epoch progress.

> Devnet only. This is a study project and has not been audited; don't use it with real funds.

## Project layout

```
solanaStaking/
├── staking/                  Anchor workspace (on-chain program)
│   └── programs/staking/
│       ├── src/lib.rs        instructions + account validation
│       ├── src/state.rs      VaultState, StakeInfo, StakeStatus
│       ├── src/error.rs      custom errors
│       ├── src/instructions/ raw Stake program instruction builders
│       └── tests/            LiteSVM tests
└── app/                      React + Vite frontend
    ├── src/generated/        TypeScript client generated from the IDL (Codama)
    ├── src/App.tsx           wallet, vault deposit/withdraw
    └── src/Stake.tsx         staking panel
```

## How it works

### Accounts (all PDAs are per user)

| Seeds | Type | Purpose |
|---|---|---|
| `["vault", user]` | system account | Holds the user's SOL. Acts as staker **and** withdrawer authority of the stake account. |
| `["state", user]` | `VaultState` | Vault metadata (owner, bump). |
| `["stake", user]` | native stake account (200 bytes) | The real stake, owned by the Stake program. |
| `["stake_info", user]` | `StakeInfo` | Status, validator, amounts, epochs, lifetime rewards. |

### Instructions

| Instruction | What it does |
|---|---|
| `deposit(amount)` | Wallet → vault. The first deposit must cover the vault's rent-exempt minimum. |
| `withdraw(amount)` | Vault → wallet. The vault must end empty or stay rent-exempt. |
| `stake(amount)` | Creates the stake account from vault funds (amount + rent) and initializes it. Status: `Created`. |
| `delegate()` | Delegates the stake to a validator vote account. Status: `Delegated`. It becomes active at the next epoch. |
| `unstake()` | Deactivates the stake. Status: `Unstaking`. It cools down until the epoch ends. |
| `withdraw_stake()` | Returns everything (principal + rewards + rent) to the vault and closes the stake account. Status: `Empty`. |

Stake lifecycle: `Empty → Created → Delegated → Unstaking → Empty`. A `Created` stake can also go
straight back to `Empty`.

On devnet the minimum delegation is currently **1 SOL**, and an epoch lasts roughly 2 days.

## Running it

### Prerequisites

- Rust plus the [Solana CLI and Anchor](https://solana.com/docs/intro/installation) (Anchor 1.2)
- Node.js 20+
- A browser wallet (Phantom, Solflare or Backpack) switched to **devnet**, funded from
  https://faucet.solana.com

### 1. Program

```bash
cd staking
anchor build
cargo test -p staking --test test_vault          # LiteSVM tests

solana config set --url devnet
anchor deploy --provider.cluster devnet
```

`anchor deploy` uses the program keypair in `target/deploy/`, which is git-ignored. On a fresh
clone, Anchor generates a new keypair, so you deploy under a new program ID. Run `anchor keys sync`,
rebuild, then regenerate the frontend client (step 2).

### 2. Frontend

```bash
cd app
npm install
cp .env.example .env          # devnet by default
npm run idl && npm run codegen   # only after the program changes
npm run dev                   # http://localhost:5173
```

To publish the site, run `npm run build` and host `app/dist/` on any static host (Vercel, Netlify,
Cloudflare Pages). If you use repo integration, set the root directory to `app`.

## Tech stack

- **Program:** Anchor 1.2, raw CPIs to the native Stake program, LiteSVM for tests
- **Client:** `@solana/kit` 8 with plugin clients (v1 transactions, v0 fallback for older wallets),
  Wallet Standard via `@solana/kit-plugin-wallet`, `@solana/react` hooks, Codama-generated program
  client
- **UI:** React 19 + Vite
