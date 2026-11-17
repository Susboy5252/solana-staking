use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::{CLOCK_SYSVAR_ID, STAKE_HISTORY_SYSVAR_ID, STAKE_PROGRAM_ID};

pub fn ix_withdraw(stake: &Pubkey, to: &Pubkey, withdrawer: &Pubkey, lamports: u64) -> Instruction {
    let mut data = Vec::with_capacity(12);
    data.extend_from_slice(&4u32.to_le_bytes());   // instruction #4
    data.extend_from_slice(&lamports.to_le_bytes()); // how much to withdraw

    Instruction {
        program_id: STAKE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*stake, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(CLOCK_SYSVAR_ID, false),
            AccountMeta::new_readonly(STAKE_HISTORY_SYSVAR_ID, false),
            AccountMeta::new_readonly(*withdrawer, true),
        ],
        data,
    }
}
