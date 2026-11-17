use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct VaultState {
    pub owner: Pubkey,
    pub solana_staked: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum StakeStatus {
    Empty,
    Created,
    Delegated,
    Unstaking,
}

#[account]
#[derive(InitSpace)]
pub struct StakeInfo {
    pub owner: Pubkey,
    pub bump: u8,
    pub status: StakeStatus,
    pub validator: Pubkey,
    pub staked_amount: u64,
    pub principal: u64,
    pub created_epoch: u64,
    pub delegated_epoch: u64,
    pub unstake_epoch: u64,
    pub total_rewards: u64,
    pub stake_count: u32,
}
