use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("9jLNHL4Ge6cksrp9ZnyYXszT5kK1A4Qa7GYUuvssYk8h");

pub const PROTOCOL_TREASURY: &str = "ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is";

#[program]
pub mod payment_escrow {
    use super::*;

    pub fn deposit(ctx: Context<Deposit>, amount_lamports: u64, nonce: [u8; 16]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_account;
        escrow.payer = ctx.accounts.payer.key();
        escrow.specialist = ctx.accounts.specialist.key();
        escrow.amount = amount_lamports;
        escrow.nonce = nonce;
        escrow.fulfilled = false;

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.escrow_account.to_account_info(),
                },
            ),
            amount_lamports,
        )?;

        emit!(EscrowDeposited {
            payer: ctx.accounts.payer.key(),
            specialist: ctx.accounts.specialist.key(),
            amount: amount_lamports,
            nonce,
        });
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let escrow = &ctx.accounts.escrow_account;
        require!(!escrow.fulfilled, EscrowError::AlreadyFulfilled);

        let specialist_amount = escrow.amount * 833 / 1000;
        let protocol_amount = escrow.amount - specialist_amount;
        let nonce = escrow.nonce;
        let payer_key = escrow.payer;

        // Direct lamport manipulation — required when transferring FROM a PDA with data.
        // system_program::transfer cannot be used from accounts that carry data.
        // The `close = payer` constraint will return the remaining rent lamports to payer.
        **ctx.accounts.escrow_account.to_account_info().try_borrow_mut_lamports()? -= specialist_amount;
        **ctx.accounts.specialist.to_account_info().try_borrow_mut_lamports()? += specialist_amount;

        **ctx.accounts.escrow_account.to_account_info().try_borrow_mut_lamports()? -= protocol_amount;
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += protocol_amount;

        emit!(EscrowReleased {
            payer: payer_key,
            specialist: ctx.accounts.specialist.key(),
            specialist_amount,
            protocol_amount,
            nonce,
        });
        Ok(())
    }
}

#[account]
pub struct EscrowState {
    pub payer: Pubkey,      // 32
    pub specialist: Pubkey, // 32
    pub amount: u64,        // 8
    pub nonce: [u8; 16],    // 16
    pub fulfilled: bool,    // 1
}

impl EscrowState {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 16 + 1; // 97 bytes
}

#[derive(Accounts)]
#[instruction(amount_lamports: u64, nonce: [u8; 16])]
pub struct Deposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: specialist wallet — stored in escrow state, verified on release
    pub specialist: AccountInfo<'info>,
    #[account(
        init,
        payer = payer,
        space = EscrowState::LEN,
        seeds = [b"escrow", payer.key().as_ref(), &nonce],
        bump
    )]
    pub escrow_account: Account<'info, EscrowState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(
        mut,
        constraint = specialist.key() == escrow_account.specialist @ EscrowError::UnauthorizedRelease
    )]
    pub specialist: Signer<'info>,
    /// CHECK: protocol treasury — hardcoded address enforced by constraint
    #[account(
        mut,
        constraint = treasury.key() == PROTOCOL_TREASURY.parse::<Pubkey>().unwrap() @ EscrowError::InvalidTreasury
    )]
    pub treasury: AccountInfo<'info>,
    #[account(
        mut,
        close = payer,
        seeds = [b"escrow", escrow_account.payer.as_ref(), &escrow_account.nonce],
        bump
    )]
    pub escrow_account: Account<'info, EscrowState>,
    /// CHECK: original payer gets rent back on close
    #[account(mut, constraint = payer.key() == escrow_account.payer @ EscrowError::UnauthorizedRelease)]
    pub payer: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct EscrowDeposited {
    pub payer: Pubkey,
    pub specialist: Pubkey,
    pub amount: u64,
    pub nonce: [u8; 16],
}

#[event]
pub struct EscrowReleased {
    pub payer: Pubkey,
    pub specialist: Pubkey,
    pub specialist_amount: u64,
    pub protocol_amount: u64,
    pub nonce: [u8; 16],
}

#[error_code]
pub enum EscrowError {
    #[msg("Escrow already fulfilled")]
    AlreadyFulfilled,
    #[msg("Only the specialist can release the escrow")]
    UnauthorizedRelease,
    #[msg("Treasury address must be the protocol treasury")]
    InvalidTreasury,
}
