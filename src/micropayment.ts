/**
 * micropayment.ts — SOL transfer as x402-style micropayment
 * No programs, no Anchor — just web3.js SystemProgram transfer
 *
 * Fee model:
 *   Specialist receives: PAYMENT_SOL (0.001 SOL)
 *   Protocol treasury:   PROTOCOL_FEE_SOL (0.0002 SOL, 16.7% take rate)
 *   Total per query:     0.0012 SOL
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const PROTOCOL_TREASURY = new PublicKey('ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is');
const PROTOCOL_FEE_SOL = 0.0002; // 16.7% take rate

export interface PaymentReceipt {
  txSignature: string;
  from: string;
  to: string;
  solAmount: number;
  lamports: number;
  slot: number;
  protocolFeeTx: string;
  protocolFeeLamports: number;
}

/**
 * Transfer SOL from payer to recipient as a micropayment.
 * Also sends a protocol fee to the treasury wallet.
 * Returns a PaymentReceipt with on-chain proof for both transfers.
 */
export async function pay(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  solAmount: number
): Promise<PaymentReceipt> {
  const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
  const protocolFeeLamports = Math.floor(PROTOCOL_FEE_SOL * LAMPORTS_PER_SOL);

  // Transfer 1: specialist payment
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });

  const txInfo = await connection.getTransaction(sig, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });

  // Transfer 2: protocol fee to treasury
  const feeTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: PROTOCOL_TREASURY,
      lamports: protocolFeeLamports,
    })
  );

  const feeSig = await sendAndConfirmTransaction(connection, feeTx, [payer], {
    commitment: 'confirmed',
  });

  return {
    txSignature: sig,
    from: payer.publicKey.toBase58(),
    to: recipient.toBase58(),
    solAmount,
    lamports,
    slot: txInfo?.slot ?? 0,
    protocolFeeTx: feeSig,
    protocolFeeLamports,
  };
}
