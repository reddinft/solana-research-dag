/**
 * micropayment.ts — Trustless payment split via PaymentSplitter Anchor program
 *
 * Program ID: BpnKFaaXrktxFS3rC1LKrs9ELP53JDymBRV4mMd2umGL (Devnet)
 * One atomic instruction splits: 83.3% → specialist, 16.7% → protocol treasury
 * Split is enforced on-chain by Solana validators — cannot be bypassed.
 *
 * Fee model (total 0.0012 SOL per query):
 *   Specialist receives: ~0.001 SOL (83.3%)
 *   Protocol treasury:   ~0.0002 SOL (16.7% take rate)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
const PROTOCOL_TREASURY = new PublicKey('ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is');
const PAYMENT_SPLITTER_PROGRAM_ID = new PublicKey('BpnKFaaXrktxFS3rC1LKrs9ELP53JDymBRV4mMd2umGL');

// Anchor instruction discriminator for process_payment: [189, 81, 30, 198, 139, 186, 115, 23]
const PROCESS_PAYMENT_DISCRIMINATOR = Buffer.from([189, 81, 30, 198, 139, 186, 115, 23]);

export interface PaymentReceipt {
  txSignature: string;
  from: string;
  to: string;
  solAmount: number;
  lamports: number;
  slot: number;
  protocolFeeTx: string;
  protocolFeeLamports: number;
  programId?: string;
}

/**
 * Encode a u64 as little-endian 8 bytes (Borsh format).
 */
function encodeU64LE(value: number): Buffer {
  const buf = Buffer.alloc(8);
  // Use BigInt for safe u64 encoding
  const big = BigInt(value);
  buf.writeBigUInt64LE(big, 0);
  return buf;
}

/**
 * Build a raw TransactionInstruction for process_payment.
 * Uses the IDL-derived discriminator directly — no @coral-xyz/anchor dependency needed.
 */
function buildProcessPaymentInstruction(
  payer: PublicKey,
  specialist: PublicKey,
  amountLamports: number
): TransactionInstruction {
  // Instruction data = 8-byte discriminator + 8-byte u64 amount
  const amountBuf = encodeU64LE(amountLamports);
  const data = Buffer.concat([PROCESS_PAYMENT_DISCRIMINATOR, amountBuf]);

  return new TransactionInstruction({
    programId: PAYMENT_SPLITTER_PROGRAM_ID,
    keys: [
      { pubkey: payer,             isSigner: true,  isWritable: true  }, // payer
      { pubkey: specialist,        isSigner: false, isWritable: true  }, // specialist
      { pubkey: PROTOCOL_TREASURY, isSigner: false, isWritable: true  }, // treasury (hardcoded in program)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data,
  });
}

/**
 * Transfer SOL from payer to recipient via the PaymentSplitter program.
 * One atomic transaction: 83.3% → specialist, 16.7% → protocol treasury.
 * The split is enforced on-chain — not in TypeScript.
 */
export async function pay(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  solAmount: number
): Promise<PaymentReceipt> {
  // Total payment = specialist portion + protocol portion
  // We pass total and let the program split it
  const totalLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
  const specialistLamports = Math.floor(totalLamports * 833 / 1000);
  const protocolLamports = totalLamports - specialistLamports;

  const ix = buildProcessPaymentInstruction(payer.publicKey, recipient, totalLamports);
  const tx = new Transaction().add(ix);

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
    lamports: specialistLamports,
    slot: txInfo?.slot ?? 0,
    protocolFeeTx: sig, // Same transaction — atomic split
    protocolFeeLamports: protocolLamports,
    programId: PAYMENT_SPLITTER_PROGRAM_ID.toBase58(),
  };
}
