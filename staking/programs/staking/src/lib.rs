use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::system_program::{create_account, transfer, CreateAccount, Transfer};

pub mod instructions;
use instructions::*;
pub mod error;
use error::*;
pub mod state;
use state::*;
declare_id!("86Vcd8NbVro8yoxixnGgmBC1B3fgC75Bhfx6QGPV4k3w");


pub const CLOCK_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarC1ock11111111111111111111111111111111");
pub const STAKE_HISTORY_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarStakeHistory1111111111111111111111111");
pub const STAKE_CONFIG_ID: Pubkey =
    Pubkey::from_str_const("StakeConfig11111111111111111111111111111111");
pub const STAKE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("Stake11111111111111111111111111111111111111");
pub const RENT_SYSVAR_ID: Pubkey =
    Pubkey::from_str_const("SysvarRent111111111111111111111111111111111");
pub const VOTE_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("Vote111111111111111111111111111111111111111");
pub const STAKE_ACCOUNT_SIZE: u64 = 200;

#[program]
pub mod staking {
    use super::*;

    pub fn deposit(ctx: Context<VaultStaking>, amount: u64) -> Result<()> {
    let rent = Rent::get()?.minimum_balance(0);
    let current = ctx.accounts.vault.lamports();
    if current == 0 {
        require!(amount >= rent, StakeError::BelowRentMinimum);
    }
    transfer(CpiContext::new(
                System::id(),
                Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
    ),
    amount)?;
        let state = &mut ctx.accounts.state;
        if state.owner == Pubkey::default() {
            state.owner = ctx.accounts.signer.key();
            state.bump = ctx.bumps.state;
        }
        Ok(())
    }
    
    pub fn withdraw(ctx: Context<VaultStaking>, amount: u64) -> Result<()> {
        require!(ctx.accounts.vault.lamports() > 0, StakeError::VaultIsEmpty);
        require!(amount <=ctx.accounts.vault.lamports(), StakeError::NotEnoughFunds);
        let remaining = ctx.accounts.vault.lamports() - amount;
        require!(
            remaining == 0 || remaining >= Rent::get()?.minimum_balance(0),
            StakeError::BelowRentMinimum
        );

        let signer_key = ctx.accounts.signer.key();
        let bump = ctx.bumps.vault;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", signer_key.as_ref(), &[bump]]];

        transfer(
            CpiContext::new_with_signer(
                System::id(), Transfer{
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.signer.to_account_info(),
        },
        signer_seeds
        ),
        amount,
        )?;

        let state = &mut ctx.accounts.state;
        if state.owner == Pubkey::default() {
            state.owner = signer_key;
            state.bump = ctx.bumps.state;
        }
        Ok(())
    }


    pub fn stake(ctx: Context<StakeFromVault>, amount: u64) -> Result<()> {
        require!(ctx.accounts.stake_account.lamports() == 0, StakeError::AlreadyStaked);
        let stake_rent = Rent::get()?.minimum_balance(STAKE_ACCOUNT_SIZE as usize);
        let total = amount.checked_add(stake_rent).ok_or(StakeError::Overflow)?;
        let vault_balance = ctx.accounts.vault.lamports();
        require!(total <= vault_balance, StakeError::NotEnoughFunds);
        let remaining = vault_balance - total;
        require!(
        remaining == 0 || remaining >= Rent::get()?.minimum_balance(0),
        StakeError::BelowRentMinimum
    );
        let signer_key = ctx.accounts.signer.key();
        let vault_bump = [ctx.bumps.vault];
        let vault_seeds: &[&[u8]] = &[b"vault", signer_key.as_ref(), &vault_bump];
        let stake_bump = [ctx.bumps.stake_account];
        let stake_seeds: &[&[u8]] = &[b"stake", signer_key.as_ref(), &stake_bump];
        create_account( CpiContext::new_with_signer(
            System::id(),
            CreateAccount {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.stake_account.to_account_info(),
            },
            &[vault_seeds, stake_seeds],
        ),
        total,
        STAKE_ACCOUNT_SIZE,
        &STAKE_PROGRAM_ID,
    )?;

     invoke(
        &ix_initialize(
            &ctx.accounts.stake_account.key(),
            &ctx.accounts.vault.key(),
        ),
        &[
            ctx.accounts.stake_account.to_account_info(),
            ctx.accounts.rent_sysvar.to_account_info(),
            ctx.accounts.stake_program.to_account_info(),
        ],
    )?;

        let epoch = Clock::get()?.epoch;
        let info = &mut ctx.accounts.stake_info;
        if info.owner == Pubkey::default() {
            info.owner = signer_key;
            info.bump = ctx.bumps.stake_info;
        }
        info.status = StakeStatus::Created;
        info.validator = Pubkey::default();
        info.staked_amount = amount;
        info.principal = total;
        info.created_epoch = epoch;
        info.delegated_epoch = 0;
        info.unstake_epoch = 0;
        info.stake_count = info.stake_count.checked_add(1).ok_or(StakeError::Overflow)?;
        Ok(())
    }

    pub fn delegate(ctx: Context<DelegateStake>) -> Result<()> {
    // A deactivating stake can't be re-delegated until its cooldown ends,
    // so only a fresh (Created) stake account may be delegated.
    require!(
    ctx.accounts.stake_info.status == StakeStatus::Created,
    StakeError::InvalidStakeStatus
    );
    let signer_key = ctx.accounts.signer.key();
    let vault_bump = [ctx.bumps.vault];
    let vault_seeds: &[&[u8]] = &[b"vault", signer_key.as_ref(), &vault_bump];

    invoke_signed(
        &ix_delegate(
            &ctx.accounts.stake_account.key(),
            &ctx.accounts.validator_vote.key(),
            &ctx.accounts.vault.key(),
        ),
        &[
            ctx.accounts.stake_account.to_account_info(),
            ctx.accounts.validator_vote.to_account_info(),
            ctx.accounts.clock_sysvar.to_account_info(),
            ctx.accounts.stake_history_sysvar.to_account_info(),
            ctx.accounts.stake_config.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.stake_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;

    let info = &mut ctx.accounts.stake_info;
    info.status = StakeStatus::Delegated;
    info.validator = ctx.accounts.validator_vote.key();
    info.delegated_epoch = Clock::get()?.epoch;
    info.unstake_epoch = 0;
    msg!("Delegated to validator {}", ctx.accounts.validator_vote.key());
    Ok(())
    }

    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
    require!(
    ctx.accounts.stake_info.status == StakeStatus::Delegated,
    StakeError::InvalidStakeStatus
    );
    let signer_key = ctx.accounts.signer.key();
    let vault_bump = [ctx.bumps.vault];
    let vault_seeds: &[&[u8]] = &[b"vault", signer_key.as_ref(), &vault_bump];

    invoke_signed(
        &ix_deactivate(
            &ctx.accounts.stake_account.key(),
            &ctx.accounts.vault.key(),
        ),
        &[
            ctx.accounts.stake_account.to_account_info(),
            ctx.accounts.clock_sysvar.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.stake_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;
    let info = &mut ctx.accounts.stake_info;
    info.status = StakeStatus::Unstaking;
    info.unstake_epoch = Clock::get()?.epoch;
    msg!("Unstaking started. SOL can be withdrawn after the epoch ends.");
    Ok(())
    }

    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
    let status = ctx.accounts.stake_info.status;
    require!(
    status == StakeStatus::Created || status == StakeStatus::Unstaking,
    StakeError::InvalidStakeStatus
    );
    let signer_key = ctx.accounts.signer.key();
    let vault_bump = [ctx.bumps.vault];
    let vault_seeds: &[&[u8]] = &[b"vault", signer_key.as_ref(), &vault_bump];

    let all_lamports = ctx.accounts.stake_account.lamports();

    invoke_signed(
        &ix_withdraw(
            &ctx.accounts.stake_account.key(),
            &ctx.accounts.vault.key(),
            &ctx.accounts.vault.key(),
            all_lamports,
        ),
        &[
            ctx.accounts.stake_account.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.clock_sysvar.to_account_info(),
            ctx.accounts.stake_history_sysvar.to_account_info(),
            ctx.accounts.stake_program.to_account_info(),
        ],
        &[vault_seeds],
    )?;
    let info = &mut ctx.accounts.stake_info;
    let rewards = all_lamports.saturating_sub(info.principal); // what came back minus what went in
    info.total_rewards = info.total_rewards.checked_add(rewards).ok_or(StakeError::Overflow)?;
    info.status = StakeStatus::Empty;
    info.validator = Pubkey::default();
    info.staked_amount = 0;
    info.principal = 0;
    msg!("Rewards this cycle: {} lamports", rewards);
    msg!("Withdrew {} lamports from stake account to vault", all_lamports);
    Ok(())
    }
}

#[derive(Accounts)]
pub struct VaultStaking<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", signer.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [b"state", signer.key().as_ref()],
        bump,
    )]
    pub state: Account<'info, VaultState>,
}

#[derive(Accounts)]
pub struct StakeFromVault<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(mut, seeds = [b"vault", signer.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: PDA ["stake", signer]; created in this instruction and owned by the Stake program.
    #[account(mut, seeds = [b"stake", signer.key().as_ref()], bump)]
    pub stake_account: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Rent sysvar.
    #[account(address = RENT_SYSVAR_ID)]
    pub rent_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Stake program.
    #[account(address = STAKE_PROGRAM_ID)]
    pub stake_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    #[account(
        init_if_needed,
        payer = signer,
        space = 8 + StakeInfo::INIT_SPACE,
        seeds = [b"stake_info", signer.key().as_ref()],
        bump,
    )]
    pub stake_info: Account<'info, StakeInfo>,
}

#[derive(Accounts)]
pub struct DelegateStake<'info> {
    pub signer: Signer<'info>,

    #[account(seeds = [b"vault", signer.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake", signer.key().as_ref()],
        bump,
        owner = STAKE_PROGRAM_ID,
    )]
    /// CHECK: PDA ["stake", signer], owned by the Stake program, which validates its data.
    pub stake_account: UncheckedAccount<'info>,
    /// CHECK: must be owned by the Vote program; the Stake program validates it as a vote account.
    #[account(owner = VOTE_PROGRAM_ID)]
    pub validator_vote: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Clock sysvar.
    #[account(address = CLOCK_SYSVAR_ID)]
    pub clock_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the StakeHistory sysvar.
    #[account(address = STAKE_HISTORY_SYSVAR_ID)]
    pub stake_history_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the stake config account.
    #[account(address = STAKE_CONFIG_ID)]
    pub stake_config: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Stake program.
    #[account(address = STAKE_PROGRAM_ID)]
    pub stake_program: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"stake_info", signer.key().as_ref()],
        bump = stake_info.bump,
    )]
    pub stake_info: Account<'info, StakeInfo>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    pub signer: Signer<'info>,

    #[account(seeds = [b"vault", signer.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake", signer.key().as_ref()],
        bump,
        owner = STAKE_PROGRAM_ID,
    )]
    /// CHECK: PDA ["stake", signer], owned by the Stake program, which validates its data.
    pub stake_account: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the Clock sysvar.
    #[account(address = CLOCK_SYSVAR_ID)]
    pub clock_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Stake program.
    #[account(address = STAKE_PROGRAM_ID)]
    pub stake_program: UncheckedAccount<'info>,

    #[account(
    mut,
    seeds = [b"stake_info", signer.key().as_ref()],
    bump = stake_info.bump,
    )]
    pub stake_info: Account<'info, StakeInfo>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    pub signer: Signer<'info>,

    #[account(mut, seeds = [b"vault", signer.key().as_ref()], bump)]
    pub vault: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake", signer.key().as_ref()],
        bump,
        owner = STAKE_PROGRAM_ID,
    )]
    /// CHECK: PDA ["stake", signer], owned by the Stake program, which validates its data.
    pub stake_account: UncheckedAccount<'info>,

    /// CHECK: address-constrained to the Clock sysvar.
    #[account(address = CLOCK_SYSVAR_ID)]
    pub clock_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the StakeHistory sysvar.
    #[account(address = STAKE_HISTORY_SYSVAR_ID)]
    pub stake_history_sysvar: UncheckedAccount<'info>,
    /// CHECK: address-constrained to the Stake program.
    #[account(address = STAKE_PROGRAM_ID)]
    pub stake_program: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"stake_info", signer.key().as_ref()],
        bump = stake_info.bump,
    )]
    pub stake_info: Account<'info, StakeInfo>,
}
