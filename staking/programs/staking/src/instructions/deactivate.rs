use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::{CLOCK_SYSVAR_ID, STAKE_PROGRAM_ID};

/// Stake Program instruction #5: Deactivate
pub fn ix_deactivate(stake: &Pubkey, staker: &Pubkey) -> Instruction {
    Instruction {
        program_id: STAKE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*stake, false),
            AccountMeta::new_readonly(CLOCK_SYSVAR_ID, false),
            AccountMeta::new_readonly(*staker, true),
        ],
        data: 5u32.to_le_bytes().to_vec(),
    }
}
