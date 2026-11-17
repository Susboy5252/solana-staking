import { createClient } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';

type Chain = 'solana:mainnet' | 'solana:devnet' | 'solana:testnet' | 'solana:localnet';

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
export const CHAIN = (import.meta.env.VITE_CHAIN ?? 'solana:devnet') as Chain;
// Chain the wallet is asked to sign for. Many wallets don't advertise
// `solana:localnet`, so for local testing you can set this to `solana:devnet`:
// the wallet only signs, and the app itself sends the transaction to RPC_URL.
export const WALLET_CHAIN = (import.meta.env.VITE_WALLET_CHAIN ?? CHAIN) as Chain;

// One wallet connection shared by both clients below. Kit copies property
// descriptors when composing, so `client.wallet` and `legacyClient.wallet`
// point at the same store and the same connected signer.
const base = createClient().use(walletSigner({ chain: WALLET_CHAIN }));

// Default: transaction v1. Resource limits are estimated by simulation.
export const client = base.use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 1 } }));

// Fallback for wallets that cannot sign v1 yet. Our instructions are tiny,
// so they fit comfortably in a v0 transaction.
export const legacyClient = base.use(solanaRpc({ rpcUrl: RPC_URL, transactionConfig: { version: 0 } }));

export type AppClient = typeof client;

export function explorerTxUrl(signature: string): string {
  const cluster =
    CHAIN === 'solana:mainnet'
      ? ''
      : CHAIN === 'solana:localnet'
        ? `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`
        : `?cluster=${CHAIN.split(':')[1]}`;
  return `https://explorer.solana.com/tx/${signature}${cluster}`;
}
