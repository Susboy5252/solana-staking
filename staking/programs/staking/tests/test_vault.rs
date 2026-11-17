use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    staking::{state::StakeInfo, state::StakeStatus},
};

const SOL: u64 = 1_000_000_000;

struct Env {
    svm: LiteSVM,
    user: Keypair,
    vault: Pubkey,
    state: Pubkey,
    stake: Pubkey,
    stake_info: Pubkey,
}

fn setup() -> Env {
    let program_id = staking::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/staking.so"));
    svm.add_program(program_id, bytes).unwrap();
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10 * SOL).unwrap();
    let pda = |seed: &[u8]| Pubkey::find_program_address(&[seed, user.pubkey().as_ref()], &program_id).0;
    Env {
        vault: pda(b"vault"),
        state: pda(b"state"),
        stake: pda(b"stake"),
        stake_info: pda(b"stake_info"),
        svm,
        user,
    }
}

fn send(env: &mut Env, ix: Instruction) -> Result<(), String> {
    let msg = Message::new_with_blockhash(&[ix], Some(&env.user.pubkey()), &env.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&env.user]).unwrap();
    let res = env.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err));
    env.svm.expire_blockhash();
    res
}

fn vault_ix(env: &Env, deposit: bool, amount: u64) -> Instruction {
    let accounts = staking::accounts::VaultStaking {
        signer: env.user.pubkey(),
        vault: env.vault,
        system_program: system_program::ID,
        state: env.state,
    }
    .to_account_metas(None);
    let data = if deposit {
        staking::instruction::Deposit { amount }.data()
    } else {
        staking::instruction::Withdraw { amount }.data()
    };
    Instruction::new_with_bytes(staking::id(), &data, accounts)
}

fn stake_ix(env: &Env, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        staking::id(),
        &staking::instruction::Stake { amount }.data(),
        staking::accounts::StakeFromVault {
            signer: env.user.pubkey(),
            vault: env.vault,
            stake_account: env.stake,
            rent_sysvar: staking::RENT_SYSVAR_ID,
            stake_program: staking::STAKE_PROGRAM_ID,
            system_program: system_program::ID,
            stake_info: env.stake_info,
        }
        .to_account_metas(None),
    )
}

fn withdraw_stake_ix(env: &Env) -> Instruction {
    Instruction::new_with_bytes(
        staking::id(),
        &staking::instruction::WithdrawStake {}.data(),
        staking::accounts::WithdrawStake {
            signer: env.user.pubkey(),
            vault: env.vault,
            stake_account: env.stake,
            clock_sysvar: staking::CLOCK_SYSVAR_ID,
            stake_history_sysvar: staking::STAKE_HISTORY_SYSVAR_ID,
            stake_program: staking::STAKE_PROGRAM_ID,
            stake_info: env.stake_info,
        }
        .to_account_metas(None),
    )
}

fn lamports(env: &Env, key: &Pubkey) -> u64 {
    env.svm.get_account(key).map(|a| a.lamports).unwrap_or(0)
}

fn stake_info(env: &Env) -> StakeInfo {
    let acc = env.svm.get_account(&env.stake_info).unwrap();
    StakeInfo::try_deserialize(&mut acc.data.as_slice()).unwrap()
}

#[test]
fn deposit_and_withdraw() {
    let mut env = setup();
    { let ix = vault_ix(&env, true, 2 * SOL); send(&mut env, ix) }.unwrap();
    assert_eq!(lamports(&env, &env.vault), 2 * SOL);

    // Leaving a few lamports (below rent) in the vault is rejected.
    assert!({ let ix = vault_ix(&env, false, 2 * SOL - 10); send(&mut env, ix) }.is_err());

    { let ix = vault_ix(&env, false, SOL); send(&mut env, ix) }.unwrap();
    assert_eq!(lamports(&env, &env.vault), SOL);
    { let ix = vault_ix(&env, false, SOL); send(&mut env, ix) }.unwrap();
    assert_eq!(lamports(&env, &env.vault), 0);
}

#[test]
fn stake_then_withdraw_undelegated() {
    let mut env = setup();
    { let ix = vault_ix(&env, true, 3 * SOL); send(&mut env, ix) }.unwrap();

    { let ix = stake_ix(&env, SOL); send(&mut env, ix) }.unwrap();
    let stake_acc = env.svm.get_account(&env.stake).expect("stake account created");
    assert_eq!(stake_acc.owner, staking::STAKE_PROGRAM_ID);
    assert_eq!(stake_acc.data.len(), 200);
    let info = stake_info(&env);
    assert!(info.status == StakeStatus::Created);
    assert_eq!(info.staked_amount, SOL);

    // A second stake while one exists is rejected.
    assert!({ let ix = stake_ix(&env, SOL); send(&mut env, ix) }.is_err());

    // Undelegated stake can be withdrawn straight back to the vault.
    let vault_before = lamports(&env, &env.vault);
    let principal = info.principal;
    { let ix = withdraw_stake_ix(&env); send(&mut env, ix) }.unwrap();
    assert_eq!(lamports(&env, &env.stake), 0);
    assert_eq!(lamports(&env, &env.vault), vault_before + principal);
    assert!(stake_info(&env).status == StakeStatus::Empty);

    // ...and the user can stake again afterwards.
    { let ix = stake_ix(&env, SOL); send(&mut env, ix) }.unwrap();
}
