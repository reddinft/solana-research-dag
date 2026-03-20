/**
 * micropayment.ts — SOL transfer as x402-style micropayment
 * No programs, no Anchor — just web3.js SystemProgram transfer
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

export interface PaymentReceipt {
  txSignature: string;
  from: string;
  to: string;
  solAmount: number;
  lamports: number;
  slot: number;
}

/**
 * Transfer SOL from payer to recipient as a micropayment.
 * Returns a PaymentReceipt with the on-chain proof.
 */
export async function pay(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  solAmount: number
): Promise<PaymentReceipt> {
  const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

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

  return {
    txSignature: sig,
    from: payer.publicKey.toBase58(),
    to: recipient.toBase58(),
    solAmount,
    lamports,
    slot: txInfo?.slot ?? 0,
  };
}
