import { useState } from 'react';
import { type Address, type Instruction, isAddress, type Lamports, sol, solToLamports, type TransactionSigner } from '@solana/kit';
import { useConnectedWallet } from '@solana/kit-plugin-wallet/react';
import { useAction } from '@solana/react';
import { client, explorerTxUrl, legacyClient } from './client';
import { describeError } from './errors';
import { fmtPlain, fmtSol, fmtSolCompact, short } from './format';
import {
  getDelegateInstructionAsync,
  getStakeInstructionAsync,
  getUnstakeInstructionAsync,
  getWithdrawStakeInstructionAsync,
  StakeStatus,
  type StakeInfo,
} from './generated';
import { useBalance, useRentMinimum } from './hooks';
import { useEpoch, useStakeAddresses, useStakeInfo, useStakeLimits, useValidators } from './stakeHooks';

type Build = (signer: TransactionSigner) => Promise<Instruction>;

/** Sends one program instruction from the connected wallet (v1 if supported, else v0). */
function useSend() {
  const connected = useConnectedWallet(client);
  const sender = connected?.supportedTransactionVersions.has(1) ? client : legacyClient;
  return useAction(async (signal: AbortSignal, label: string, build: Build) => {
    const signer = connected?.signer;
    if (!signer) throw new Error('Wallet not connected');
    const result = await sender.sendTransaction([await build(signer)], { abortSignal: signal });
    return { label, signature: result.context.signature as string };
  });
}

export function StakePanel({ owner, vaultLamports }: { owner: Address; vaultLamports: Lamports | null }) {
  const addrs = useStakeAddresses(owner);
  const { loaded, info } = useStakeInfo(addrs?.info ?? null);
  const stakeBal = useBalance(addrs?.stake);
  const epoch = useEpoch();
  const send = useSend();

  const status = info?.status ?? StakeStatus.Empty;

  return (
    <section className="card stake">
      <div className="card-head">
        <h2>Native staking</h2>
        {epoch && <EpochBadge epoch={epoch.epoch} index={epoch.slotIndex} total={epoch.slotsInEpoch} />}
      </div>
      <p className="muted small">
        Moves SOL from your vault into a stake account your program controls, delegated to a validator. Rewards are
        paid into it every epoch (~2 days).
      </p>

      {!loaded ? (
        <div className="skeleton block" />
      ) : (
        <>
          <Steps status={status} />
          {status !== StakeStatus.Empty && info && (
            <StakeDetails info={info} balance={stakeBal.lamports} currentEpoch={epoch?.epoch ?? null} />
          )}
          {status === StakeStatus.Empty && (
            <StakeForm vaultLamports={vaultLamports} send={send} />
          )}
          {status === StakeStatus.Created && <DelegateForm send={send} />}
          {status === StakeStatus.Delegated && (
            <button className="btn danger wide" disabled={send.isRunning} onClick={() => send.dispatch('Unstake started', (signer) => getUnstakeInstructionAsync({ signer }))}>
              {send.isRunning ? 'Confirm in wallet…' : 'Unstake'}
            </button>
          )}
          {status === StakeStatus.Unstaking && info && (
            <CooldownAction info={info} currentEpoch={epoch?.epoch ?? null} send={send} />
          )}
        </>
      )}

      <SendResult send={send} />
    </section>
  );
}

// ---------------------------------------------------------------------------

function EpochBadge({ epoch, index, total }: { epoch: bigint; index: bigint; total: bigint }) {
  const pct = Number((index * 100n) / (total || 1n));
  // ~400ms per slot is the target; good enough for an estimate.
  const hoursLeft = (Number(total - index) * 0.4) / 3600;
  const left = hoursLeft >= 1 ? `${hoursLeft.toFixed(1)}h left` : `${Math.round(hoursLeft * 60)}m left`;
  return (
    <div className="epoch" title={`Slot ${index} of ${total}`}>
      <span className="small">Epoch {epoch.toString()}</span>
      <div className="bar"><div style={{ width: `${pct}%` }} /></div>
      <span className="muted small">{left}</span>
    </div>
  );
}

const STEP_LABELS = ['Stake', 'Delegate', 'Earning', 'Cooldown'];

function Steps({ status }: { status: StakeStatus }) {
  // Empty → step 0, Created → 1, Delegated → 2, Unstaking → 3
  const current = status === StakeStatus.Empty ? 0 : status;
  return (
    <ol className="steps">
      {STEP_LABELS.map((l, i) => (
        <li key={l} className={i < current ? 'done' : i === current ? 'now' : ''}>
          <span className="dot">{i < current ? '✓' : i + 1}</span>
          {l}
        </li>
      ))}
    </ol>
  );
}

function StakeDetails({ info, balance, currentEpoch }: { info: StakeInfo; balance: Lamports | null; currentEpoch: bigint | null }) {
  const bal = balance != null ? BigInt(balance) : null;
  const earned = bal != null && bal > info.principal ? bal - info.principal : 0n;
  let state = '';
  if (info.status === StakeStatus.Created) state = 'Not delegated yet';
  else if (info.status === StakeStatus.Delegated)
    state = currentEpoch != null && currentEpoch > info.delegatedEpoch
      ? 'Active — earning rewards'
      : `Activating — active from epoch ${(info.delegatedEpoch + 1n).toString()}`;
  else if (info.status === StakeStatus.Unstaking) state = 'Deactivating';

  return (
    <dl className="details">
      <div><dt>Status</dt><dd>{state}</dd></div>
      <div><dt>Staked</dt><dd>{fmtSol(info.stakedAmount)} SOL</dd></div>
      <div><dt>Stake account balance</dt><dd>{fmtSol(bal)} SOL</dd></div>
      <div><dt>Rewards so far</dt><dd className="good-text">+{fmtSol(earned)} SOL</dd></div>
      {info.status !== StakeStatus.Created && (
        <div><dt>Validator</dt><dd><code title={info.validator}>{short(info.validator)}</code></dd></div>
      )}
      {info.totalRewards > 0n && (
        <div><dt>Lifetime rewards</dt><dd>{fmtSol(info.totalRewards)} SOL</dd></div>
      )}
    </dl>
  );
}

type Send = ReturnType<typeof useSend>;

function StakeForm({ vaultLamports, send }: { vaultLamports: Lamports | null; send: Send }) {
  const [input, setInput] = useState('');
  const limits = useStakeLimits();
  const vaultRent = useRentMinimum();
  const vault = vaultLamports != null ? BigInt(vaultLamports) : null;

  let amount: bigint | null = null;
  let problem: string | null = null;
  if (input.trim()) {
    try {
      amount = solToLamports(sol(input.trim()));
      if (amount <= 0n) problem = 'Enter an amount above zero.';
    } catch {
      problem = 'Enter a valid SOL amount.';
    }
  }
  if (amount != null && !problem && limits && vault != null) {
    const total = amount + limits.stakeRent;
    const remaining = vault - total;
    if (amount < limits.minDelegation)
      problem = `Minimum stake on this network is ${fmtSol(limits.minDelegation)} SOL.`;
    else if (total > vault)
      problem = `Your vault needs ${fmtSol(total)} SOL (stake + ${fmtSol(limits.stakeRent)} account rent). Deposit more first.`;
    else if (vaultRent != null && remaining > 0n && remaining < BigInt(vaultRent))
      problem = `Leave at least ${fmtSol(vaultRent)} SOL in the vault, or stake everything (Max).`;
  }

  const max = () => {
    if (vault != null && limits && vault > limits.stakeRent) setInput(fmtPlain(vault - limits.stakeRent));
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (amount != null && !problem) send.dispatch('Stake account created', (signer) => getStakeInstructionAsync({ signer, amount: amount! }));
      }}
    >
      <label className="field">
        <span className="muted small">Amount to stake (taken from your vault)</span>
        <div className="input-row">
          <input inputMode="decimal" placeholder="0.0" value={input} disabled={send.isRunning}
            onChange={(e) => setInput(e.target.value.replace(',', '.'))} />
          <span className="unit">SOL</span>
          <button type="button" className="btn tiny ghost" onClick={max} disabled={send.isRunning}>Max</button>
        </div>
      </label>
      <div className="hint small">
        {problem ? <span className="err">{problem}</span>
          : limits ? <span className="muted">Plus {fmtSol(limits.stakeRent)} SOL rent for the stake account (returned when you withdraw).</span>
          : <span>&nbsp;</span>}
      </div>
      <button className="btn primary wide" disabled={send.isRunning || amount == null || !!problem}>
        {send.isRunning ? 'Confirm in wallet…' : 'Create stake account'}
      </button>
    </form>
  );
}

function DelegateForm({ send }: { send: Send }) {
  const { validators, error } = useValidators();
  const [choice, setChoice] = useState('');
  const [custom, setCustom] = useState('');
  const list = validators?.slice(0, 30) ?? [];
  const selected = choice === 'custom' ? custom.trim() : choice || list[0]?.vote || '';
  const valid = isAddress(selected);

  return (
    <div className="delegate">
      <label className="field">
        <span className="muted small">Validator</span>
        <select value={choice || list[0]?.vote || ''} onChange={(e) => setChoice(e.target.value)} disabled={send.isRunning || !validators}>
          {!validators && <option>{error ? 'Couldn’t load validators' : 'Loading validators…'}</option>}
          {list.map((v) => (
            <option key={v.vote} value={v.vote}>
              {short(v.vote)} · {fmtSolCompact(v.stake)} SOL staked · {v.commission}% fee
            </option>
          ))}
          <option value="custom">Other vote account…</option>
        </select>
      </label>
      {choice === 'custom' && (
        <input className="text-input" placeholder="Vote account address" value={custom} onChange={(e) => setCustom(e.target.value)} />
      )}
      {choice === 'custom' && custom && !valid && <p className="err small">Not a valid address.</p>}
      <div className="row">
        <button
          className="btn ghost"
          disabled={send.isRunning}
          onClick={() => send.dispatch('Returned to vault', (signer) => getWithdrawStakeInstructionAsync({ signer }))}
        >
          Cancel & return to vault
        </button>
        <button
          className="btn primary grow"
          disabled={send.isRunning || !valid}
          onClick={() => send.dispatch('Delegated', (signer) => getDelegateInstructionAsync({ signer, validatorVote: selected as Address }))}
        >
          {send.isRunning ? 'Confirm in wallet…' : 'Delegate'}
        </button>
      </div>
    </div>
  );
}

function CooldownAction({ info, currentEpoch, send }: { info: StakeInfo; currentEpoch: bigint | null; send: Send }) {
  const ready = currentEpoch != null && currentEpoch > info.unstakeEpoch;
  return (
    <>
      {!ready && (
        <p className="muted small">
          Cooling down. You can withdraw once epoch {info.unstakeEpoch.toString()} ends.
        </p>
      )}
      <button
        className="btn primary wide"
        disabled={!ready || send.isRunning}
        onClick={() => send.dispatch('Withdrawn to vault', (signer) => getWithdrawStakeInstructionAsync({ signer }))}
      >
        {send.isRunning ? 'Confirm in wallet…' : ready ? 'Withdraw to vault' : 'Waiting for epoch to end'}
      </button>
    </>
  );
}

function SendResult({ send }: { send: Send }) {
  if (send.isRunning) return null;
  if (send.error != null) return <div className="result bad">{describeError(send.error)}</div>;
  if (send.data)
    return (
      <div className="result good">
        {send.data.label}.{' '}
        <a href={explorerTxUrl(send.data.signature)} target="_blank" rel="noreferrer">View transaction ↗</a>
      </div>
    );
  return null;
}
