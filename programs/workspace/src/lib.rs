use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("FWe29tk47GWzTXJDBQTNU85bHR3wg6wbQ1XbLuYPoyza");

#[program]
pub mod workspace {
    use super::*;

    // fee_bps: u16, Platform fee on delegations, 250 = 2.5%
    // min_stake_amount: u64, Minimum SOL to stake as vouch in lamports, 100000000 = 0.1 SOL
    // max_trust_score: u16, Maximum possible trust score, 10000 = 100.00
    // base_delegation_limit: u64, Base delegation limit per score point in lamports, 1000000000 = 1 SOL
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        min_stake_amount: u64,
        max_trust_score: u16,
        base_delegation_limit: u64,
    ) -> Result<()> {
        require!(fee_bps <= 10000, ErrorCode::InvalidFee);
        require!(min_stake_amount > 0, ErrorCode::InvalidAmount);
        require!(max_trust_score > 0 && max_trust_score <= 10000, ErrorCode::InvalidParameter);
        require!(base_delegation_limit > 0, ErrorCode::InvalidAmount);

        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.vault_bump = ctx.bumps.vault;
        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;
        config.authority = ctx.accounts.authority.key();
        config.is_active = true;
        config.is_paused = false;
        config.version = 1;
        config.fee_bps = fee_bps;
        config.min_stake_amount = min_stake_amount;
        config.max_trust_score = max_trust_score;
        config.base_delegation_limit = base_delegation_limit;
        config.total_agents = 0;
        config.total_staked = 0;
        Ok(())
    }

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        agent_name: String,
        agent_uri: String,
    ) -> Result<()> {
        require!(agent_name.len() > 0 && agent_name.len() <= 32, ErrorCode::InvalidParameter);
        require!(agent_uri.len() <= 128, ErrorCode::InvalidParameter);

        let config = &ctx.accounts.config;
        require!(config.is_active && !config.is_paused, ErrorCode::ConfigInactive);

        let agent = &mut ctx.accounts.agent;
        agent.bump = ctx.bumps.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.agent_name = agent_name;
        agent.agent_uri = agent_uri;
        agent.trust_score = 0;
        agent.total_trades = 0;
        agent.winning_trades = 0;
        agent.total_pnl = 0;
        agent.max_drawdown = 0;
        agent.recommendation_accuracy = 0;
        agent.total_vouched = 0;
        agent.voucher_count = 0;
        agent.total_delegated = 0;
        agent.is_flagged = false;
        agent.is_active = true;
        agent.registered_at = Clock::get()?.unix_timestamp;
        agent.last_updated = Clock::get()?.unix_timestamp;

        let config = &mut ctx.accounts.config;
        config.total_agents = config.total_agents.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn update_trust_score(
        ctx: Context<UpdateTrustScore>,
        total_trades: u64,
        winning_trades: u64,
        total_pnl: i64,
        max_drawdown: u16,
        recommendation_accuracy: u16,
        is_flagged: bool,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active && !config.is_paused, ErrorCode::ConfigInactive);
        require!(winning_trades <= total_trades, ErrorCode::InvalidParameter);
        require!(max_drawdown <= 10000, ErrorCode::InvalidParameter);
        require!(recommendation_accuracy <= 10000, ErrorCode::InvalidParameter);

        let win_rate: u64 = if total_trades > 0 {
            winning_trades
                .checked_mul(10000)
                .ok_or(ErrorCode::MathOverflow)?
                .checked_div(total_trades)
                .ok_or(ErrorCode::DivisionByZero)?
        } else {
            0
        };

        let pnl_component: u64 = if total_pnl > 0 {
            (total_pnl as u64).min(2500)
        } else {
            0
        };

        let drawdown_penalty: u64 = (max_drawdown as u64)
            .checked_mul(15)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::DivisionByZero)?;

        let vouch_bonus: u64 = {
            let vouched = ctx.accounts.agent.total_vouched;
            let sol_vouched = vouched.checked_div(1_000_000_000).unwrap_or(0);
            sol_vouched.min(500)
        };

        let positive_sum = (win_rate as u64)
            .checked_mul(30)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(100)
            .ok_or(ErrorCode::DivisionByZero)?
            .checked_add(pnl_component)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_add(
                (recommendation_accuracy as u64)
                    .checked_mul(20)
                    .ok_or(ErrorCode::MathOverflow)?
                    .checked_div(100)
                    .ok_or(ErrorCode::DivisionByZero)?,
            )
            .ok_or(ErrorCode::MathOverflow)?
            .checked_add(vouch_bonus)
            .ok_or(ErrorCode::MathOverflow)?;

        let raw_score = positive_sum
            .checked_sub(drawdown_penalty.min(positive_sum))
            .ok_or(ErrorCode::MathOverflow)?;

        let max_score = config.max_trust_score as u64;
        let final_score = if is_flagged {
            raw_score.checked_div(2).ok_or(ErrorCode::DivisionByZero)?
        } else {
            raw_score
        };
        let capped_score = final_score.min(max_score) as u16;

        let agent = &mut ctx.accounts.agent;
        agent.total_trades = total_trades;
        agent.winning_trades = winning_trades;
        agent.total_pnl = total_pnl;
        agent.max_drawdown = max_drawdown;
        agent.recommendation_accuracy = recommendation_accuracy;
        agent.is_flagged = is_flagged;
        agent.trust_score = capped_score;
        agent.last_updated = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn stake_vouch(ctx: Context<StakeVouch>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active && !config.is_paused, ErrorCode::ConfigInactive);
        require!(amount >= config.min_stake_amount, ErrorCode::InsufficientFunds);

        let agent = &ctx.accounts.agent;
        require!(agent.is_active, ErrorCode::InactiveAccount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.voucher.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let stake = &mut ctx.accounts.stake;
        stake.bump = ctx.bumps.stake;
        stake.voucher = ctx.accounts.voucher.key();
        stake.agent = ctx.accounts.agent.key();
        stake.amount = stake.amount.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        stake.staked_at = Clock::get()?.unix_timestamp;

        let agent = &mut ctx.accounts.agent;
        agent.total_vouched = agent.total_vouched.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        agent.voucher_count = agent.voucher_count.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.total_staked = config.total_staked.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn unstake_vouch(ctx: Context<UnstakeVouch>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active, ErrorCode::ConfigInactive);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let stake = &ctx.accounts.stake;
        require!(stake.amount >= amount, ErrorCode::InsufficientFunds);

        let authority_key = ctx.accounts.config.authority;
        let bump_arr = [ctx.accounts.config.vault_bump];
        let seeds = &[b"vault" as &[u8], authority_key.as_ref(), &bump_arr];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let vault_info = ctx.accounts.vault.to_account_info();
        let voucher_info = ctx.accounts.voucher.to_account_info();

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **voucher_info.try_borrow_mut_lamports()? += amount;

        let _ = signer_seeds;

        let stake = &mut ctx.accounts.stake;
        stake.amount = stake.amount.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        let agent = &mut ctx.accounts.agent;
        agent.total_vouched = agent.total_vouched.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.total_staked = config.total_staked.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn delegate_funds(ctx: Context<DelegateFunds>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active && !config.is_paused, ErrorCode::ConfigInactive);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let agent = &ctx.accounts.agent;
        require!(agent.is_active, ErrorCode::InactiveAccount);
        require!(!agent.is_flagged, ErrorCode::AgentFlagged);

        let max_delegation = (agent.trust_score as u64)
            .checked_mul(config.base_delegation_limit)
            .ok_or(ErrorCode::MathOverflow)?;
        let new_total = agent.total_delegated.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        require!(new_total <= max_delegation, ErrorCode::DelegationLimitExceeded);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.delegator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let delegation = &mut ctx.accounts.delegation;
        delegation.bump = ctx.bumps.delegation;
        delegation.delegator = ctx.accounts.delegator.key();
        delegation.agent = ctx.accounts.agent.key();
        delegation.amount = delegation.amount.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
        delegation.delegated_at = Clock::get()?.unix_timestamp;

        let agent = &mut ctx.accounts.agent;
        agent.total_delegated = agent.total_delegated.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn withdraw_delegation(ctx: Context<WithdrawDelegation>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(config.is_active, ErrorCode::ConfigInactive);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let delegation = &ctx.accounts.delegation;
        require!(delegation.amount >= amount, ErrorCode::InsufficientFunds);

        let fee = amount
            .checked_mul(config.fee_bps as u64)
            .ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000)
            .ok_or(ErrorCode::DivisionByZero)?;
        let net_amount = amount.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;

        let vault_info = ctx.accounts.vault.to_account_info();
        let delegator_info = ctx.accounts.delegator.to_account_info();
        let treasury_info = ctx.accounts.treasury.to_account_info();

        **vault_info.try_borrow_mut_lamports()? -= amount;
        **delegator_info.try_borrow_mut_lamports()? += net_amount;
        if fee > 0 {
            **treasury_info.try_borrow_mut_lamports()? += fee;
        }

        let delegation = &mut ctx.accounts.delegation;
        delegation.amount = delegation.amount.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        let agent = &mut ctx.accounts.agent;
        agent.total_delegated = agent.total_delegated.checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        Ok(())
    }

    pub fn toggle_pause(ctx: Context<AdminAction>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.is_paused = !config.is_paused;
        Ok(())
    }
}

// ── Context Structs ──

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        seeds = [b"config", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + Config::LEN
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
        payer = authority,
        space = 8 + Vault::LEN
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterAgent<'info> {
    #[account(
        mut,
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        init,
        seeds = [b"agent", owner.key().as_ref()],
        bump,
        payer = owner,
        space = 8 + Agent::LEN
    )]
    pub agent: Account<'info, Agent>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateTrustScore<'info> {
    #[account(
        seeds = [b"config", authority.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"agent", agent.owner.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        constraint = authority.key() == config.authority @ ErrorCode::Unauthorized
    )]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct StakeVouch<'info> {
    #[account(
        mut,
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"agent", agent.owner.as_ref()],
        bump = agent.bump,
        constraint = agent.is_active @ ErrorCode::InactiveAccount,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        init_if_needed,
        seeds = [b"stake", voucher.key().as_ref(), agent.key().as_ref()],
        bump,
        payer = voucher,
        space = 8 + Stake::LEN
    )]
    pub stake: Account<'info, Stake>,
    #[account(
        mut,
        seeds = [b"vault", config.authority.as_ref()],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub voucher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeVouch<'info> {
    #[account(
        mut,
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"agent", agent.owner.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        seeds = [b"stake", voucher.key().as_ref(), agent.key().as_ref()],
        bump = stake.bump,
        constraint = stake.voucher == voucher.key() @ ErrorCode::Unauthorized,
    )]
    pub stake: Account<'info, Stake>,
    #[account(
        mut,
        seeds = [b"vault", config.authority.as_ref()],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub voucher: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DelegateFunds<'info> {
    #[account(
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"agent", agent.owner.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        init_if_needed,
        seeds = [b"delegation", delegator.key().as_ref(), agent.key().as_ref()],
        bump,
        payer = delegator,
        space = 8 + Delegation::LEN
    )]
    pub delegation: Account<'info, Delegation>,
    #[account(
        mut,
        seeds = [b"vault", config.authority.as_ref()],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub delegator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawDelegation<'info> {
    #[account(
        seeds = [b"config", config.authority.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"agent", agent.owner.as_ref()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,
    #[account(
        mut,
        seeds = [b"delegation", delegator.key().as_ref(), agent.key().as_ref()],
        bump = delegation.bump,
        constraint = delegation.delegator == delegator.key() @ ErrorCode::Unauthorized,
    )]
    pub delegation: Account<'info, Delegation>,
    #[account(
        mut,
        seeds = [b"vault", config.authority.as_ref()],
        bump = config.vault_bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub delegator: Signer<'info>,
    /// CHECK: Treasury address for fee collection
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"config", authority.key().as_ref()],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

// ── Account State ──

#[account]
pub struct Config {
    pub bump: u8,
    pub vault_bump: u8,
    pub authority: Pubkey,
    pub is_active: bool,
    pub is_paused: bool,
    pub version: u8,
    pub fee_bps: u16,
    pub min_stake_amount: u64,
    pub max_trust_score: u16,
    pub base_delegation_limit: u64,
    pub total_agents: u64,
    pub total_staked: u64,
}

impl Config {
    pub const LEN: usize = 1 + 1 + 32 + 1 + 1 + 1 + 2 + 8 + 2 + 8 + 8 + 8;
}

#[account]
pub struct Vault {
    pub bump: u8,
}

impl Vault {
    pub const LEN: usize = 1;
}

#[account]
pub struct Agent {
    pub bump: u8,
    pub owner: Pubkey,
    pub agent_name: String,
    pub agent_uri: String,
    pub trust_score: u16,
    pub total_trades: u64,
    pub winning_trades: u64,
    pub total_pnl: i64,
    pub max_drawdown: u16,
    pub recommendation_accuracy: u16,
    pub total_vouched: u64,
    pub voucher_count: u64,
    pub total_delegated: u64,
    pub is_flagged: bool,
    pub is_active: bool,
    pub registered_at: i64,
    pub last_updated: i64,
}

impl Agent {
    pub const LEN: usize = 1 + 32 + (4 + 32) + (4 + 128) + 2 + 8 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 8 + 8;
}

#[account]
pub struct Stake {
    pub bump: u8,
    pub voucher: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
}

impl Stake {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 8;
}

#[account]
pub struct Delegation {
    pub bump: u8,
    pub delegator: Pubkey,
    pub agent: Pubkey,
    pub amount: u64,
    pub delegated_at: i64,
}

impl Delegation {
    pub const LEN: usize = 1 + 32 + 32 + 8 + 8;
}

// ── Error Codes ──

#[error_code]
pub enum ErrorCode {
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Insufficient funds")]
    InsufficientFunds,
    #[msg("Unauthorized access")]
    Unauthorized,
    #[msg("Account is inactive")]
    InactiveAccount,
    #[msg("Config is inactive or paused")]
    ConfigInactive,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid parameter")]
    InvalidParameter,
    #[msg("Invalid fee")]
    InvalidFee,
    #[msg("Agent is flagged")]
    AgentFlagged,
    #[msg("Delegation limit exceeded")]
    DelegationLimitExceeded,
}