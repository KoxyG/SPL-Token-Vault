use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer, Mint};

declare_id!("FDBF2QBZgTtpDXG77hmQPZzdDCkrSHtfgykj7SuxdRye");

#[program]
mod secure_vault {
    use super::*;

    pub fn initialize(ctx: Context<InitializeVault>) -> Result<()> {
        msg!("Initializing vault"); // Message will show up in the tx logs
        let vault = &mut ctx.accounts.vault_pda;
        vault.manager = ctx.accounts.initializer.key();
        vault.token_mint = ctx.accounts.token_mint.key();
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        // Check if the token mint matches the vault's token mint
        if ctx.accounts.token_mint.key() != ctx.accounts.vault_pda.token_mint {
            return Err(ErrorCode::InvalidTokenMint.into());
        }

        // deposit logic
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        if ctx.accounts.withdrawer.key() == ctx.accounts.vault_pda.manager {
            return Err(ErrorCode::ManagerCannotWithdraw.into());
        }

        // Check if the token mint matches the vault's token mint
        if ctx.accounts.token_mint.key() != ctx.accounts.vault_pda.token_mint {
            return Err(ErrorCode::InvalidTokenMint.into());
        }

        let vault_bump = ctx.bumps.vault_pda;
        let manager_key = ctx.accounts.vault_pda.manager.key();
        let seeds = &[b"vault", manager_key.as_ref(), &[vault_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.vault_pda.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;
        Ok(())
    }

}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(
        init,
        payer = initializer,
        seeds = [b"vault", initializer.key().as_ref()],
        bump,
        space = 8 + 32 + 32 
    )]
    pub vault_pda: Account<'info, VaultState>,
    pub token_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_mint: Account<'info, Mint>,
    pub vault_pda: Account<'info, VaultState>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"vault", vault_pda.manager.key().as_ref()],
        bump,
    )]
    pub vault_pda: Account<'info, VaultState>,
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub token_mint: Account<'info, Mint>,
    pub withdrawer: Signer<'info>,
}

#[account]
pub struct VaultState {
    pub manager: Pubkey,
    pub token_mint: Pubkey,
}

#[error_code]
pub enum ErrorCode {
    #[msg("The manager cannot withdraw funds")]
    ManagerCannotWithdraw,
    #[msg("Invalid token mint")]
    InvalidTokenMint,
}
