/**
 * Specialist Server — x402 HTTP 402 Payment Protocol
 * 
 * Full trustless flow:
 * 1. GET /answer → 402 with payment details (nonce, amount, program)
 * 2. GET /answer + X-Payment-Tx header → verify escrow on-chain → deliver answer → release escrow
 */

import express from 'express';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN, setProvider } from '@coral-xyz/anchor';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const PAYMENT_ESCROW_PROGRAM_ID = new PublicKey(process.env.ESCROW_PROGRAM_ID || '9jLNHL4Ge6cksrp9ZnyYXszT5kK1A4Qa7GYUuvssYk8h');
const PAYMENT_AMOUNT_LAMPORTS = 1_200_000; // 0.0012 SOL
const TREASURY = new PublicKey('ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is');

// Load specialist keypair (use wallet keypair for demo)
const specialistKeypairPath = process.env.SPECIALIST_KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
const specialistKeypairData = JSON.parse(fs.readFileSync(specialistKeypairPath, 'utf-8'));
const SPECIALIST_KEYPAIR = Keypair.fromSecretKey(Uint8Array.from(specialistKeypairData));

console.log(`🔑 Specialist pubkey: ${SPECIALIST_KEYPAIR.publicKey.toBase58()}`);
console.log(`📋 Escrow Program: ${PAYMENT_ESCROW_PROGRAM_ID.toBase58()}`);

const connection = new Connection(DEVNET_URL, 'confirmed');

// Load IDL
const idlPath = path.join(__dirname, '..', 'target', 'idl', 'payment_escrow.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

// Pending escrow registry: nonce → { specialist, amount }
// In production this would be persistent storage
const pendingEscrows = new Map<string, { nonce: Uint8Array, amount: number, createdAt: number }>();

const app = express();
app.use(express.json());

/**
 * Derive escrow PDA
 */
function deriveEscrowPDA(payer: PublicKey, nonce: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), payer.toBuffer(), Buffer.from(nonce)],
    PAYMENT_ESCROW_PROGRAM_ID
  );
}

/**
 * Parse nonce from hex string → Uint8Array[16]
 */
function hexToNonce(hex: string): Uint8Array {
  // Remove dashes if UUID format
  const clean = hex.replace(/-/g, '');
  if (clean.length !== 32) throw new Error(`Nonce hex must be 32 chars, got ${clean.length}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Call local Ollama for an answer
 */
async function callOllama(query: string): Promise<string> {
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || 'llama3.2',
        prompt: query,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
    const data = await res.json() as any;
    return data.response || 'No response from model';
  } catch (err: any) {
    // Fallback for demo when Ollama not available
    console.warn(`⚠️  Ollama unavailable: ${err.message} — using mock response`);
    return `[MOCK ANSWER] Trustless x402 escrow payment received and verified on-chain. Query: "${query}" — specialist delivered this answer after verifying escrow PDA on Solana devnet.`;
  }
}

/**
 * Verify that a deposit tx created the correct escrow PDA with sufficient funds
 */
async function verifyEscrowDeposit(
  depositTxSig: string,
  nonce: Uint8Array,
  expectedAmount: number
): Promise<{ valid: boolean; payerKey?: PublicKey; escrowPDA?: PublicKey; error?: string }> {
  try {
    // Get the transaction
    const tx = await connection.getTransaction(depositTxSig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { valid: false, error: 'Transaction not found on-chain' };
    }
    if (tx.meta?.err) {
      return { valid: false, error: `Transaction failed: ${JSON.stringify(tx.meta.err)}` };
    }

    // The payer is the first account in the transaction
    const accountKeys = tx.transaction.message.staticAccountKeys || 
      (tx.transaction.message as any).accountKeys;
    
    if (!accountKeys || accountKeys.length === 0) {
      return { valid: false, error: 'No account keys in transaction' };
    }

    const payerKey = accountKeys[0];

    // Derive expected escrow PDA
    const [escrowPDA] = deriveEscrowPDA(payerKey, nonce);
    console.log(`  🔍 Derived escrow PDA: ${escrowPDA.toBase58()} (payer: ${payerKey.toBase58()})`);

    // Check escrow PDA balance
    const balance = await connection.getBalance(escrowPDA, 'confirmed');
    console.log(`  💰 Escrow PDA balance: ${balance} lamports (expected ≥ ${expectedAmount})`);

    if (balance < expectedAmount) {
      return { 
        valid: false, 
        error: `Insufficient escrow balance: ${balance} < ${expectedAmount}` 
      };
    }

    // Verify escrow account data matches
    const escrowAccountInfo = await connection.getAccountInfo(escrowPDA, 'confirmed');
    if (!escrowAccountInfo) {
      return { valid: false, error: 'Escrow PDA account not found' };
    }
    if (!escrowAccountInfo.owner.equals(PAYMENT_ESCROW_PROGRAM_ID)) {
      return { valid: false, error: 'Escrow PDA not owned by escrow program' };
    }

    // Parse EscrowState: discriminator(8) + payer(32) + specialist(32) + amount(8) + nonce(16) + fulfilled(1)
    const data = escrowAccountInfo.data;
    if (data.length < 97) {
      return { valid: false, error: `Escrow data too short: ${data.length}` };
    }

    // Offset 8: payer pubkey
    const storedPayer = new PublicKey(data.slice(8, 40));
    // Offset 40: specialist pubkey
    const storedSpecialist = new PublicKey(data.slice(40, 72));
    // Offset 72: amount (little-endian u64)
    const storedAmount = data.readBigUInt64LE(72);
    // Offset 88: fulfilled bool
    const fulfilled = data[96] !== 0;

    console.log(`  📊 Escrow state: payer=${storedPayer.toBase58().slice(0,8)}... specialist=${storedSpecialist.toBase58().slice(0,8)}... amount=${storedAmount} fulfilled=${fulfilled}`);

    if (fulfilled) {
      return { valid: false, error: 'Escrow already fulfilled' };
    }
    if (!storedSpecialist.equals(SPECIALIST_KEYPAIR.publicKey)) {
      return { valid: false, error: `Wrong specialist in escrow: ${storedSpecialist.toBase58()}` };
    }
    if (storedAmount < BigInt(expectedAmount)) {
      return { valid: false, error: `Escrow amount ${storedAmount} < expected ${expectedAmount}` };
    }

    return { valid: true, payerKey, escrowPDA };
  } catch (err: any) {
    return { valid: false, error: `Verification error: ${err.message}` };
  }
}

/**
 * Release escrow — specialist signs to unlock funds
 */
async function releaseEscrow(
  payerKey: PublicKey,
  nonce: Uint8Array
): Promise<string> {
  const wallet = new Wallet(SPECIALIST_KEYPAIR);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl, provider);

  const [escrowPDA, bump] = deriveEscrowPDA(payerKey, nonce);
  console.log(`  🔓 Releasing escrow PDA: ${escrowPDA.toBase58()}`);

  const tx = await (program.methods as any)
    .release()
    .accounts({
      specialist: SPECIALIST_KEYPAIR.publicKey,
      treasury: TREASURY,
      escrowAccount: escrowPDA,
      payer: payerKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([SPECIALIST_KEYPAIR])
    .rpc({ commitment: 'confirmed' });

  return tx;
}

// ─────────────────────────────────────────────
// GET /answer
// ─────────────────────────────────────────────
app.get('/answer', async (req: express.Request, res: express.Response) => {
  const paymentTx = req.headers['x-payment-tx'] as string | undefined;
  const paymentNonce = req.headers['x-payment-nonce'] as string | undefined;
  const query = (req.query.q as string) || 'Tell me about Solana';

  // ── Step 1: No payment → return 402 ──────────────────────────────────
  if (!paymentTx) {
    const nonceHex = uuidv4().replace(/-/g, '');
    const nonceBytes = hexToNonce(nonceHex);

    // Store pending escrow expectation
    pendingEscrows.set(nonceHex, {
      nonce: nonceBytes,
      amount: PAYMENT_AMOUNT_LAMPORTS,
      createdAt: Date.now(),
    });

    console.log(`\n← 402 Payment Required`);
    console.log(`  nonce: ${nonceHex}`);
    console.log(`  amount: ${PAYMENT_AMOUNT_LAMPORTS} lamports`);
    console.log(`  specialist: ${SPECIALIST_KEYPAIR.publicKey.toBase58()}`);

    return res.status(402).json({
      error: 'Payment Required',
      payment: {
        amount_lamports: PAYMENT_AMOUNT_LAMPORTS,
        specialist: SPECIALIST_KEYPAIR.publicKey.toBase58(),
        program: PAYMENT_ESCROW_PROGRAM_ID.toBase58(),
        nonce: nonceHex,
        chain: 'solana-devnet',
        description: 'Payment required before AI inference',
      },
    });
  }

  // ── Step 2: Payment header present → verify on-chain ─────────────────
  if (!paymentNonce) {
    return res.status(400).json({ error: 'X-Payment-Nonce header required alongside X-Payment-Tx' });
  }

  console.log(`\n→ Received payment tx: ${paymentTx}`);
  console.log(`  nonce: ${paymentNonce}`);
  console.log(`  ← Verifying escrow on-chain...`);

  let nonceBytes: Uint8Array;
  try {
    nonceBytes = hexToNonce(paymentNonce);
  } catch (err: any) {
    return res.status(400).json({ error: `Invalid nonce format: ${err.message}` });
  }

  const verification = await verifyEscrowDeposit(paymentTx, nonceBytes, PAYMENT_AMOUNT_LAMPORTS);

  if (!verification.valid) {
    console.log(`  ✗ Verification failed: ${verification.error}`);
    return res.status(402).json({ error: 'Payment verification failed', reason: verification.error });
  }

  console.log(`  ✓ Escrow verified — PDA: ${verification.escrowPDA!.toBase58()}`);

  // ── Step 3: Generate answer ───────────────────────────────────────────
  console.log(`  🤖 Calling Ollama for: "${query}"`);
  const answer = await callOllama(query);

  // ── Step 4: Release escrow ────────────────────────────────────────────
  console.log(`  💸 Releasing escrow...`);
  let releaseTx: string;
  try {
    releaseTx = await releaseEscrow(verification.payerKey!, nonceBytes);
    console.log(`  ✓ Release tx: ${releaseTx}`);
  } catch (err: any) {
    console.error(`  ✗ Release failed: ${err.message}`);
    // Return answer even if release fails (specialist has delivered)
    return res.status(200).json({
      answer,
      error_release: err.message,
      deposit_tx: paymentTx,
      release_tx: null,
      specialist: SPECIALIST_KEYPAIR.publicKey.toBase58(),
    });
  }

  // Clean up pending escrow
  pendingEscrows.delete(paymentNonce);

  const specialistAmount = Math.floor(PAYMENT_AMOUNT_LAMPORTS * 833 / 1000);
  const protocolAmount = PAYMENT_AMOUNT_LAMPORTS - specialistAmount;

  console.log(`  ✅ Complete! specialist: ${specialistAmount} lamports | treasury: ${protocolAmount} lamports`);

  return res.status(200).json({
    answer,
    deposit_tx: paymentTx,
    release_tx: releaseTx,
    specialist: SPECIALIST_KEYPAIR.publicKey.toBase58(),
    escrow_pda: verification.escrowPDA!.toBase58(),
    amounts: {
      specialist_lamports: specialistAmount,
      protocol_lamports: protocolAmount,
    },
  });
});

// Health check
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.json({
    status: 'ok',
    specialist: SPECIALIST_KEYPAIR.publicKey.toBase58(),
    program: PAYMENT_ESCROW_PROGRAM_ID.toBase58(),
    price_lamports: PAYMENT_AMOUNT_LAMPORTS,
  });
});

const PORT = parseInt(process.env.PORT || '3333', 10);
app.listen(PORT, () => {
  console.log(`\n🚀 Specialist server on :${PORT}`);
  console.log(`   GET /answer — x402 protected endpoint`);
  console.log(`   GET /health — status check\n`);
});
