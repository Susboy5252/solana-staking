import { isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM } from '@solana/kit';
import {
  STAKING_ERROR__ALREADY_STAKED,
  STAKING_ERROR__BELOW_RENT_MINIMUM,
  STAKING_ERROR__INVALID_STAKE_STATUS,
  STAKING_ERROR__NOT_ENOUGH_FUNDS,
  STAKING_ERROR__OVERFLOW,
  STAKING_ERROR__VAULT_IS_EMPTY,
} from './generated';

const PROGRAM_MESSAGES: Record<number, string> = {
  [STAKING_ERROR__BELOW_RENT_MINIMUM]: 'That would leave the vault below its rent-exempt minimum. Use the full amount, or leave more behind.',
  [STAKING_ERROR__NOT_ENOUGH_FUNDS]: 'The vault doesn’t hold enough SOL for that.',
  [STAKING_ERROR__VAULT_IS_EMPTY]: 'Your vault is empty.',
  [STAKING_ERROR__ALREADY_STAKED]: 'You already have a stake account. Withdraw it before staking again.',
  [STAKING_ERROR__OVERFLOW]: 'Amount is too large.',
  [STAKING_ERROR__INVALID_STAKE_STATUS]: 'Your stake isn’t in the right state for that action. Refresh and try again.',
  // Errors raised by the native Stake program during our CPIs.
  2: 'This stake is already deactivated.',
  3: 'Too soon to re-delegate; wait for the cooldown to finish.',
  12: 'Below the network’s minimum delegation.',
};

/** Walk an error and its `cause` chain, yielding every link. */
function* chain(err: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    yield cur;
    cur = (cur as { cause?: unknown }).cause;
  }
}

/** Turn whatever a send threw into one sentence a user can act on. */
export function describeError(err: unknown): string {
  for (const e of chain(err)) {
    if (isSolanaError(e, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      const msg = PROGRAM_MESSAGES[e.context.code];
      if (msg) return msg;
      return `Program error ${e.context.code}.`;
    }
  }
  const text = Array.from(chain(err))
    .map((e) => (e instanceof Error ? e.message : String(e)))
    .join(' | ');
  if (/reject|denied|cancel/i.test(text)) return 'You rejected the request in your wallet.';
  if (/insufficient funds for rent|InsufficientFundsForRent/i.test(text))
    return 'That would leave the vault below its rent-exempt minimum. Withdraw everything, or leave more behind.';
  if (/insufficient (funds|lamports)/i.test(text)) return 'Not enough SOL in your wallet to cover this and the fee.';
  if (/blockhash/i.test(text)) return 'The transaction expired before it landed. Try again.';
  return err instanceof Error ? err.message : 'Something went wrong.';
}
