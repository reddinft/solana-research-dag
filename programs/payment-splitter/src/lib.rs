use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("BpnKFaaXrktxFS3rC1LKrs9ELP53JDymBRV4mMd2umGL");

#[program]
pub mod payment_splitter {
    use super::*;

    pub fn process_payment(ctx: Context<ProcessPayment>, amount_lamports: u64) -> Result<()> {
        let specialist_amount = amount_lamports * 833 / 1000;
        let protocol_amount = amount_lamports - specialist_amount;

        // Transfer to specialist
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.specialist.to_account_info(),
                },
            ),
            specialist_amount,
        )?;

        // Transfer to treasury (enforced by constraint)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
            ),
            protocol_amount,
        )?;

        emit!(PaymentProcessed {
            payer: ctx.accounts.payer.key(),
            specialist: ctx.accounts.specialist.key(),
            treasury: ctx.accounts.treasury.key(),
            specialist_amount,
            protocol_amount,
            take_rate_bps: 1670, // 16.7% in basis points
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct ProcessPayment<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: specialist wallet — any valid account
    #[account(mut)]
    pub specialist: AccountInfo<'info>,

    /// CHECK: protocol treasury — hardcoded address enforced by constraint
    #[account(
        mut,
        constraint = treasury.key() == pubkey!("ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is")
            @ ErrorCode::InvalidTreasury
    )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct PaymentProcessed {
    pub payer: Pubkey,
    pub specialist: Pubkey,
    pub treasury: Pubkey,
    pub specialist_amount: u64,
    pub protocol_amount: u64,
    pub take_rate_bps: u16,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Treasury address must be the protocol treasury")]
    InvalidTreasury,
}
