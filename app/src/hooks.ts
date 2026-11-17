import { useCallback, useMemo } from 'react';
import { type Address, type Lamports } from '@solana/kit';
import { useClient, useRequest } from '@solana/react';
import { useTrackedDataSWR } from '@solana/react/swr';
import useSWR from 'swr';
import { findVaultPda, STAKING_PROGRAM_ADDRESS } from './generated';
import { CHAIN, type AppClient } from './client';

/** Live lamport balance of any account (initial fetch + websocket updates). */
export function useBalance(address: Address | null | undefined) {
  const { rpc, rpcSubscriptions } = useClient<AppClient>();

  const spec = useMemo(
    () =>
      address
        ? {
            initialValueSource: rpc.getBalance(address, { commitment: 'confirmed' }),
            initialValueMapper: (lamports: Lamports) => lamports,
            streamSource: rpcSubscriptions.accountNotifications(address, { commitment: 'confirmed' }),
            streamValueMapper: ({ lamports }: { lamports: Lamports }) => lamports,
          }
        : null,
    [rpc, rpcSubscriptions, address],
  );

  const { data, error } = useTrackedDataSWR(address ? ['balance', CHAIN, address] : null, spec);
  return {
    lamports: data?.value ?? null,
    isLoading: address != null && data == null && error == null,
    error,
  };
}

/** The vault PDA for a given owner: seeds = ["vault", owner]. */
export function useVaultAddress(owner: Address | null | undefined): Address | null {
  const { data } = useSWR<Address>(owner ? ['vault-pda', owner] : null, async () => {
    const [pda] = await findVaultPda({ signer: owner! });
    return pda;
  });
  return data ?? null;
}

/** Minimum lamports for a 0-byte system account to be rent-exempt. */
export function useRentMinimum() {
  const { rpc } = useClient<AppClient>();
  const fetcher = useCallback(
    (signal: AbortSignal) => rpc.getMinimumBalanceForRentExemption(0n).send({ abortSignal: signal }),
    [rpc],
  );
  return useRequest<Lamports>(fetcher).data ?? null;
}

/** Whether the staking program is deployed (and executable) on this cluster. */
export function useProgramDeployed(): 'checking' | 'unknown' | 'yes' | 'no' {
  const { rpc } = useClient<AppClient>();
  const fetcher = useCallback(
    async (signal: AbortSignal) => {
      const { value } = await rpc
        .getAccountInfo(STAKING_PROGRAM_ADDRESS, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } })
        .send({ abortSignal: signal });
      return value?.executable ?? false;
    },
    [rpc],
  );
  const { data, error } = useRequest<boolean>(fetcher);
  if (error) return 'unknown';
  if (data == null) return 'checking';
  return data ? 'yes' : 'no';
}
