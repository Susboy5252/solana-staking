import { useCallback, useMemo } from 'react';
import { type Address, type Base64EncodedDataResponse, getBase64Encoder, type Lamports } from '@solana/kit';
import { useClient, useRequest } from '@solana/react';
import { useTrackedDataSWR } from '@solana/react/swr';
import useSWR from 'swr';
import { findStakeAccountPda, findStakeInfoPda, getStakeInfoDecoder, type StakeInfo } from './generated';
import { CHAIN, type AppClient } from './client';

/** Size of a native stake account, in bytes. */
export const STAKE_ACCOUNT_SIZE = 200n;

/** Stake PDA (["stake", owner]) and StakeInfo PDA (["stake_info", owner]). */
export function useStakeAddresses(owner: Address) {
  const { data } = useSWR(['stake-pdas', owner], async () => {
    const [[stake], [info]] = await Promise.all([
      findStakeAccountPda({ signer: owner }),
      findStakeInfoPda({ signer: owner }),
    ]);
    return { stake, info };
  });
  return data ?? null;
}

type RawAccount = { data: Base64EncodedDataResponse; owner: Address } | null;

/**
 * Live, decoded StakeInfo account. `null` while loading; `{ info: null }` when
 * the user has never staked (account doesn't exist yet).
 */
export function useStakeInfo(address: Address | null) {
  const { rpc, rpcSubscriptions } = useClient<AppClient>();
  const spec = useMemo(
    () =>
      address
        ? {
            initialValueSource: rpc.getAccountInfo(address, { encoding: 'base64', commitment: 'confirmed' }),
            initialValueMapper: (v: RawAccount) => v,
            streamSource: rpcSubscriptions.accountNotifications(address, {
              encoding: 'base64',
              commitment: 'confirmed',
            }),
            streamValueMapper: (v: RawAccount) => v,
          }
        : null,
    [rpc, rpcSubscriptions, address],
  );
  const { data, error } = useTrackedDataSWR(address ? ['stake-info', CHAIN, address] : null, spec);

  return useMemo(() => {
    if (data == null) return { loaded: false as const, info: null, error };
    const acc = data.value as RawAccount;
    // Account closed / never created, or (defensively) not a StakeInfo.
    if (!acc || acc.data[0].length === 0) return { loaded: true as const, info: null, error };
    try {
      const bytes = getBase64Encoder().encode(acc.data[0]);
      return { loaded: true as const, info: getStakeInfoDecoder().decode(bytes) as StakeInfo, error };
    } catch {
      return { loaded: true as const, info: null, error };
    }
  }, [data, error]);
}

/** Current epoch with progress, refreshed every 20s. */
export function useEpoch() {
  const { rpc } = useClient<AppClient>();
  const { data } = useSWR(
    ['epoch', CHAIN],
    () => rpc.getEpochInfo({ commitment: 'confirmed' }).send(),
    { refreshInterval: 20_000 },
  );
  return data ?? null;
}

/** Network-wide stake numbers we validate against. */
export function useStakeLimits() {
  const { rpc } = useClient<AppClient>();
  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const [minDelegation, stakeRent] = await Promise.all([
        rpc.getStakeMinimumDelegation().send({ abortSignal: signal }),
        rpc.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE).send({ abortSignal: signal }),
      ]);
      return { minDelegation: BigInt(minDelegation.value), stakeRent: BigInt(stakeRent) };
    },
    [rpc],
  );
  return useRequest<{ minDelegation: bigint; stakeRent: bigint }>(fetcher).data ?? null;
}

export type Validator = { vote: Address; stake: bigint; commission: number };

/** Active (non-delinquent) validators, biggest first. */
export function useValidators() {
  const { rpc } = useClient<AppClient>();
  const { data, error } = useSWR(['validators', CHAIN], async () => {
    const { current } = await rpc.getVoteAccounts({ commitment: 'confirmed' }).send();
    type VoteAccount = { votePubkey: Address; activatedStake: bigint | number; commission: number };
    return (current as readonly VoteAccount[])
      .map((v): Validator => ({ vote: v.votePubkey, stake: BigInt(v.activatedStake), commission: v.commission }))
      .sort((a, b) => (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
  });
  return { validators: data ?? null, error };
}

export type { Lamports };
