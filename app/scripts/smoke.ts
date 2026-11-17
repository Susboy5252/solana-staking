// End-to-end check of the generated client against a running local validator.
// Usage: npx tsx scripts/smoke.ts   (needs surfpool / solana-test-validator on :8899
// with the program deployed)
import { createClient, lamports } from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { airdropSigner, generatedSigner } from '@solana/kit-plugin-signer';
import { findVaultPda, getDepositInstructionAsync, getWithdrawInstructionAsync } from '../src/generated';
import { describeError } from '../src/errors';

const SOL = 1_000_000_000n;

const client = await createClient()
  .use(generatedSigner())
  .use(solanaLocalRpc({ transactionConfig: { version: 1 } }))
  .use(airdropSigner(lamports(2n * SOL)));

const signer = client.payer;
const [vault] = await findVaultPda({ signer });
const bal = async (a: typeof vault) => (await client.rpc.getBalance(a, { commitment: 'confirmed' }).send()).value;

const expectFail = async (label: string, amount: bigint, kind: 'deposit' | 'withdraw') => {
  const ix = kind === 'deposit'
    ? await getDepositInstructionAsync({ signer, amount })
    : await getWithdrawInstructionAsync({ signer, amount });
  try {
    await client.sendTransaction([ix]);
    throw new Error(`${label}: expected failure but it succeeded`);
  } catch (e) {
    if (e instanceof Error && e.message.includes('expected failure')) throw e;
    console.log(`✓ ${label} rejected → "${describeError(e)}"`);
  }
};

console.log('signer', signer.address, '\nvault ', vault);

await expectFail('withdraw from empty vault', 1n, 'withdraw');
await expectFail('deposit below rent minimum', 1000n, 'deposit');

await client.sendTransaction([await getDepositInstructionAsync({ signer, amount: SOL / 2n })]);
console.log('✓ deposit 0.5 SOL → vault', await bal(vault));

await expectFail('withdraw more than vault', SOL, 'withdraw');

await client.sendTransaction([await getWithdrawInstructionAsync({ signer, amount: SOL / 5n })]);
console.log('✓ withdraw 0.2 SOL → vault', await bal(vault));

await client.sendTransaction([await getWithdrawInstructionAsync({ signer, amount: await bal(vault) })]);
console.log('✓ withdraw all → vault', await bal(vault));
