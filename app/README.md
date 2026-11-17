# SOL Vault — frontend

React + Vite website for the `staking` Anchor program in `../staking`. It does two things:

- **Vault:** deposit and withdraw SOL from a per-wallet vault PDA (`["vault", owner]`).
- **Native staking:** create a stake account from vault funds, delegate it to a validator,
  unstake, and withdraw it back, with live status, rewards and epoch progress.

See the [root README](../README.md) for how the program works.

Stack: `@solana/kit` 8 plugin client, `@solana/kit-plugin-wallet` (Wallet Standard),
`@solana/react` hooks, and a Codama-generated program client in `src/generated`.

## Run

```bash
npm install
cp .env.example .env        # defaults to devnet
npm run dev
```

The program must be deployed on the cluster in `VITE_RPC_URL` — the app shows a
banner if it isn't.

### Local validator instead of devnet

Point `.env` at `http://127.0.0.1:8899` with `VITE_CHAIN=solana:localnet` (see `.env.example`).

Most wallets don't advertise `solana:localnet`, so no wallet shows up in the
connect menu. Set `VITE_WALLET_CHAIN=solana:devnet` in `.env`: the wallet only
signs, and the app sends the transaction to your local RPC itself. Fund your
wallet address locally with `solana airdrop 5 <ADDRESS> -u localhost`.

## Regenerate the client after changing the program

```bash
npm run idl       # anchor idl build in ../staking
npm run codegen   # IDL -> src/generated
```

## Smoke test (no wallet needed)

```bash
npm run smoke     # vault deposit/withdraw + error paths against a local validator on 127.0.0.1:8899
```
