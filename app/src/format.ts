import { formatDecimalFixedPoint, lamports, lamportsToSol, type Lamports } from '@solana/kit';

const solFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const compactFmt = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Lamports → "1.234567" (grouped, for display). */
export const fmtSol = (l: Lamports | bigint | null | undefined) =>
  l == null ? '—' : formatDecimalFixedPoint(solFmt, lamportsToSol(lamports(BigInt(l))));

/** Lamports → "1.2M" (for big validator stakes). */
export const fmtSolCompact = (l: bigint) => compactFmt.format(Number(l / 1_000_000_000n));

/** Lamports → plain decimal string for an input box (no grouping). */
export function fmtPlain(l: bigint): string {
  const whole = l / 1_000_000_000n;
  const frac = (l % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
