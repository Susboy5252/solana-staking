use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::{RENT_SYSVAR_ID, STAKE_PROGRAM_ID};

/// Stake Program instruction #0: Initialize(authorized, lockup)
pub fn ix_initialize(stake: &Pubkey, authority: &Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(116);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(authority.as_ref());
    data.extend_from_slice(&0i64.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes());
    data.extend_from_slice(Pubkey::default().as_ref());

    Instruction {
        program_id: STAKE_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*stake, false),
            AccountMeta::new_readonly(RENT_SYSVAR_ID, false),
        ],
        data,
    }
}
