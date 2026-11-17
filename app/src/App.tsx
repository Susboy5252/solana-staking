import { useState } from 'react';
import { address, type Address, type Lamports, sol, solToLamports } from '@solana/kit';
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWallets,
  WalletReadyGate,
} from '@solana/kit-plugin-wallet/react';
import { useAction, useClient } from '@solana/react';
import { CHAIN, RPC_URL, WALLET_CHAIN, client, explorerTxUrl, legacyClient, type AppClient } from './client';
import { getDepositInstructionAsync, getWithdrawInstructionAsync, STAKING_PROGRAM_ADDRESS } from './generated';
import { useBalance, useProgramDeployed, useRentMinimum, useVaultAddress } from './hooks';
import { describeError } from './errors';
import { fmtPlain, fmtSol, short } from './format';
import { StakePanel } from './Stake';

// Leave a little SOL in the wallet for fees when the user hits "Max" on deposit.
const FEE_BUFFER = 10_000n;

export function App() {
  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="logo">◎</span>
          <span>SOL Vault</span>
        </div>
        <div className="top-right">
          <span className="pill" title={RPC_URL}>{CHAIN.split(':')[1]}</span>
          <WalletReadyGate client={client} fallback={<span className="muted">Loading wallets…</span>}>
            <WalletButton />
          </WalletReadyGate>
        </div>
      </header>
      <ProgramBanner />
      <main>
        <WalletReadyGate client={client} fallback={null}>
          <Body />
        </WalletReadyGate>
      </main>
      <footer className="muted small">
        Program <code>{STAKING_PROGRAM_ADDRESS}</code>
      </footer>
    </div>
  );
}

function ProgramBanner() {
  const deployed = useProgramDeployed();
  if (deployed !== 'no') return null;
  return (
    <div className="banner">
      The staking program isn’t deployed on <b>{CHAIN.split(':')[1]}</b> ({RPC_URL}). Deploy it with{' '}
      <code>anchor deploy</code> or point <code>VITE_RPC_URL</code> at the cluster where it lives.
    </div>
  );
}

function WalletButton() {
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect, isRunning: connecting } = useConnect(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [open, setOpen] = useState(false);

  if (connected) {
    return (
      <button className="btn ghost" onClick={() => disconnect()} title="Disconnect">
        {connected.wallet.icon && <img src={connected.wallet.icon} alt="" className="wicon" />}
        {short(connected.account.address)}
      </button>
    );
  }

  return (
    <div className="menu-wrap">
      <button className="btn" disabled={connecting} onClick={() => setOpen((o) => !o)}>
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
      {open && (
        <div className="menu">
          {wallets.length === 0 && (
            <p className="muted small pad">No Solana wallets found for {WALLET_CHAIN}. Install Phantom, Solflare or Backpack.</p>
          )}
          {wallets.map((w) => (
            <button
              key={w.name}
              className="menu-item"
              onClick={() => {
                setOpen(false);
                connect(w);
              }}
            >
              {w.icon && <img src={w.icon} alt="" className="wicon" />}
              {w.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Body() {
  const connected = useConnectedWallet(client);
  if (!connected) {
    return (
      <section className="card hero">
        <h1>Park SOL in your own vault</h1>
        <p className="muted">
          Each wallet gets a program-owned vault (a PDA seeded with <code>"vault"</code> + your address). Deposit any
          time, withdraw any time — only you can sign for it.
        </p>
        <p className="muted small">Connect a wallet to get started.</p>
      </section>
    );
  }
  return <Dashboard owner={address(connected.account.address)} />;
}

function Dashboard({ owner }: { owner: Address }) {
  const vault = useVaultAddress(owner);
  const wallet = useBalance(owner);
  const vaultBal = useBalance(vault);
  const rent = useRentMinimum();

  return (
    <>
      <section className="stats">
        <Stat label="Wallet balance" value={fmtSol(wallet.lamports)} loading={wallet.isLoading} />
        <Stat label="In vault" value={fmtSol(vaultBal.lamports)} loading={vaultBal.isLoading} accent />
      </section>
      <ActionCard
        owner={owner}
        walletLamports={wallet.lamports}
        vaultLamports={vaultBal.lamports}
        rent={rent}
      />
      <StakePanel owner={owner} vaultLamports={vaultBal.lamports} />
      {vault && (
        <p className="muted small center">
          Vault address <code>{vault}</code>
        </p>
      )}
    </>
  );
}

function Stat({ label, value, loading, accent }: { label: string; value: string; loading?: boolean; accent?: boolean }) {
  return (
    <div className={`card stat ${accent ? 'accent' : ''}`}>
      <div className="muted small">{label}</div>
      <div className="big">{loading ? <span className="skeleton" /> : <>{value} <span className="unit">SOL</span></>}</div>
    </div>
  );
}

type Mode = 'deposit' | 'withdraw';

function ActionCard({
  owner,
  walletLamports,
  vaultLamports,
  rent,
}: {
  owner: Address;
  walletLamports: Lamports | null;
  vaultLamports: Lamports | null;
  rent: Lamports | null;
}) {
  const appClient = useClient<AppClient>();
  const connected = useConnectedWallet(appClient);
  const [mode, setMode] = useState<Mode>('deposit');
  const [input, setInput] = useState('');

  // Route through the v1 client when the wallet can sign v1, otherwise v0.
  const sender = connected?.supportedTransactionVersions.has(1) ? client : legacyClient;
  const canSign = connected ? connected.supportedTransactionVersions.has(1) || connected.supportedTransactionVersions.has(0) : false;

  const send = useAction(async (signal: AbortSignal, m: Mode, amount: bigint) => {
    const signer = connected?.signer;
    if (!signer) throw new Error('Wallet not connected');
    const ix =
      m === 'deposit'
        ? await getDepositInstructionAsync({ signer, amount })
        : await getWithdrawInstructionAsync({ signer, amount });
    const result = await sender.sendTransaction([ix], { abortSignal: signal });
    return { mode: m, amount, signature: result.context.signature as string };
  });

  // ---- input parsing + client-side validation (mirrors the program's rules) ----
  let amount: bigint | null = null;
  let problem: string | null = null;
  if (input.trim() !== '') {
    try {
      amount = solToLamports(sol(input.trim()));
      if (amount <= 0n) problem = 'Enter an amount above zero.';
    } catch {
      problem = 'Enter a valid SOL amount.';
    }
  }
  const vaultL = vaultLamports != null ? BigInt(vaultLamports) : null;
  const walletL = walletLamports != null ? BigInt(walletLamports) : null;
  const rentL = rent != null ? BigInt(rent) : null;

  if (amount != null && !problem) {
    if (mode === 'deposit') {
      if (walletL != null && amount + FEE_BUFFER > walletL) problem = 'Not enough SOL in your wallet (keep a little for fees).';
      else if (vaultL === 0n && rentL != null && amount < rentL)
        problem = `First deposit must be at least ${fmtSol(rentL)} SOL (rent-exempt minimum).`;
    } else {
      if (vaultL === 0n) problem = 'Your vault is empty.';
      else if (vaultL != null && amount > vaultL) problem = 'The vault doesn’t hold that much.';
      else if (vaultL != null && rentL != null && amount < vaultL && vaultL - amount < rentL)
        problem = `Leave at least ${fmtSol(rentL)} SOL behind, or withdraw everything.`;
    }
  }

  const max = () => {
    if (mode === 'deposit' && walletL != null) {
      const m = walletL > FEE_BUFFER ? walletL - FEE_BUFFER : 0n;
      setInput(fmtPlain(m));
    } else if (mode === 'withdraw' && vaultL != null) {
      setInput(fmtPlain(vaultL));
    }
  };

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (amount == null || problem) return;
    send.dispatch(mode, amount);
  };

  const last = send.data;
  return (
    <section className="card action">
      <div className="tabs" role="tablist">
        {(['deposit', 'withdraw'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`tab ${mode === m ? 'on' : ''}`}
            onClick={() => {
              setMode(m);
              setInput('');
              send.reset();
            }}
          >
            {m === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        <label className="field">
          <span className="muted small">Amount</span>
          <div className="input-row">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={input}
              onChange={(e) => setInput(e.target.value.replace(',', '.'))}
              disabled={send.isRunning}
            />
            <span className="unit">SOL</span>
            <button type="button" className="btn tiny ghost" onClick={max} disabled={send.isRunning}>
              Max
            </button>
          </div>
        </label>
        <div className="hint small">
          {problem ? (
            <span className="err">{problem}</span>
          ) : mode === 'deposit' && vaultL === 0n && rentL != null ? (
            <span className="muted">First deposit opens your vault — minimum {fmtSol(rentL)} SOL.</span>
          ) : (
            <span className="muted">&nbsp;</span>
          )}
        </div>
        <button className="btn primary wide" disabled={!canSign || send.isRunning || amount == null || !!problem}>
          {send.isRunning ? 'Confirm in wallet…' : mode === 'deposit' ? 'Deposit SOL' : 'Withdraw SOL'}
        </button>
        {!canSign && <p className="err small">This wallet can’t sign versioned transactions.</p>}
      </form>

      {send.error != null && !send.isRunning && <div className="result bad">{describeError(send.error)}</div>}
      {last && !send.isRunning && send.error == null && (
        <div className="result good">
          {last.mode === 'deposit' ? 'Deposited' : 'Withdrew'} {fmtSol(last.amount)} SOL.{' '}
          <a href={explorerTxUrl(last.signature)} target="_blank" rel="noreferrer">
            View transaction ↗
          </a>
        </div>
      )}
      <p className="muted small center owner">Signing as {short(owner)}</p>
    </section>
  );
}
