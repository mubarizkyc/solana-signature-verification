use crate::errors::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::clock::Clock;
use anchor_lang::solana_program::sysvar;
use std::str::FromStr;
use switchboard_solana::{AggregatorAccountData, SwitchboardDecimal};

pub fn withdraw_handler(ctx: Context<Withdraw>, params: WithdrawParams) -> Result<()> {
    // Load the data from the Switchboard feed aggregator
    let feed = &ctx.accounts.feed_aggregator.load()?;
    let escrow_state = &ctx.accounts.escrow_account;

    // Retrieve the latest feed result (current price value)
    let val: f64 = feed.get_result()?.try_into()?;
    let current_timestamp = Clock::get().unwrap().unix_timestamp;
    let mut valid_transfer: bool = false;

    msg!("Current feed result is {}!", val);
    msg!("Unlock price is {}", escrow_state.unlock_price);
    //  if the latest price update was more than 24 hours ago
    if (current_timestamp - feed.latest_confirmed_round.round_open_timestamp) > 86400 {
        valid_transfer = true;
    }
    // if the feed aggregator has zero lamports
    else if **ctx
        .accounts
        .feed_aggregator
        .to_account_info()
        .try_borrow_lamports()?
        == 0
    {
        valid_transfer = true;
    }
    // if the price feed value exceeds the unlock price->allow transfer
    else if val > escrow_state.unlock_price as f64 {
        // Normal Use Case

        // check feed does not exceed max_confidence_interval
        if let Some(max_confidence_interval) = params.max_confidence_interval {
            feed.check_confidence_interval(SwitchboardDecimal::from_f64(max_confidence_interval))
                .map_err(|_| error!(EscrowErrorCode::ConfidenceIntervalExceeded))?;
        }
        // if the price feed is stale
        feed.check_staleness(current_timestamp, 300)
            .map_err(|_| error!(EscrowErrorCode::StaleFeed))?;

        valid_transfer = true;
    }

    // If  valid transfer are met, proceed with the fund transfer
    if valid_transfer {
        // Subtract the escrow amount from the escrow account's lamports
        **escrow_state.to_account_info().try_borrow_mut_lamports()? = escrow_state
            .to_account_info()
            .lamports()
            .checked_sub(escrow_state.escrow_amount)
            .ok_or(ProgramError::InsufficientFunds)?;

        // Add the escrow amount to the user's account lamports
        **ctx
            .accounts
            .user
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .user
            .to_account_info()
            .lamports()
            .checked_add(escrow_state.escrow_amount)
            .ok_or(ProgramError::InvalidArgument)?;
    } else {
        return Err(error!(EscrowErrorCode::InvalidWithdrawalRequest));
    }

    Ok(())
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    // The escrow account that holds the SOL, initialized with a PDA
    #[account(
        mut,
        seeds = [ESCROW_SEED, user.key().as_ref()],
        bump,
        close = user
    )]
    pub escrow_account: Account<'info, EscrowState>,
    // Switchboard SOL feed aggregator
    #[account(
        address = Pubkey::from_str(SOL_USDC_FEED).unwrap()
    )]
    pub feed_aggregator: AccountLoader<'info, AggregatorAccountData>,
    pub system_program: Program<'info, System>,
    /// CHECK: Safe because it's a sysvar account
    #[account(address = sysvar::instructions::ID)]
    pub instructions: AccountInfo<'info>,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawParams {
    pub max_confidence_interval: Option<f64>,
}
