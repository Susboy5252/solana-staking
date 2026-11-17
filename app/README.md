# SOL Vault — frontend

React + Vite UI for the `staking` Anchor program (deposit / withdraw SOL into a
per-wallet vault PDA, seeds `["vault", owner]`).

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

### Local validator + browser wallet

Most wallets don't advertise `solana:localnet`, so no wallet shows up in the
connect menu. Set `VITE_WALLET_CHAIN=solana:devnet` in `.env`: the wallet only
signs, and the app sends the transaction to your local RPC itself. Fund your
wallet address locally with `solana airdrop 5 <ADDRESS> -u localhost`.

## Regenerate the client after changing the program

```bash
npm run idl       # anchor idl build (lib only, skips the stale integration test)
npm run codegen   # IDL -> src/generated
```

## Smoke test (no wallet needed)

```bash
npm run smoke     # deposit/withdraw + error paths against 127.0.0.1:8899
```
