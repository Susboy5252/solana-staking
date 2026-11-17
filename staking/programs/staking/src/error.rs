use anchor_lang::prelude::*;

#[error_code]
pub enum StakeError{
    #[msg("Not enough sol to rent the vault")]
    BelowRentMinimum,
    #[msg("Not enough funds")]
    NotEnoughFunds,
    #[msg("Vault is empty")]
    VaultIsEmpty,
    #[msg("It is already staked")]
    AlreadyStaked,
    #[msg("Overflow")]
    Overflow,
    #[msg("Stake account is not in the right state for this action")]
    InvalidStakeStatus,
}
