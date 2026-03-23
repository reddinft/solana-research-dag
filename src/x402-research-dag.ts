/**
 * x402 Orchestrator — Trustless payment flow for Solana Agent Economy
 *
 * Protocol flow:
 * 1. GET /answer → 402 { amount, nonce, program, specialist }
 * 2. deposit(specialist, amount, nonce) → escrow PDA holds funds
 * 3. GET /answer + X-Payment-Tx + X-Payment-Nonce → verify + deliver + release
 */

import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const SPECIALIST_URL = process.env.SPECIALIST_URL || 'http://localhost:3333';
const ESCROW_PROGRAM_ID = new PublicKey(
  process.env.ESCROW_PROGRAM_ID || '9jLNHL4Ge6cksrp9ZnyYXszT5kK1A4Qa7GYUuvssYk8h'
);

// Load orchestrator keypair
const keypairPath = process.env.ORCHESTRATOR_KEYPAIR || path.join(process.env.HOME!, '.config/solana/id.json');
const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
const ORCHESTRATOR_KEYPAIR = Keypair.fromSecretKey(Uint8Array.from(keypairData));

const connection = new Connection(DEVNET_URL, 'confirmed');

// Load IDL
const idlPath = path.join(__dirname, '..', 'target', 'idl', 'payment_escrow.json');
const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));

export interface SpecialistResult {
  answer: string;
  deposit_tx: string;
  release_tx: string | null;
  escrow_pda: string;
  nonce: string;
  amounts?: {
    specialist_lamports: number;
    protocol_lamports: number;
  };
}

/**
 * Parse hex nonce string → Uint8Array[16]
 */
function hexToNonce(hex: string): Uint8Array {
  const clean = hex.replace(/-/g, '');
  if (clean.length !== 32) throw new Error(`Nonce must be 32 hex chars, got ${clean.length}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Derive escrow PDA
 */
function deriveEscrowPDA(payer: PublicKey, nonce: Uint8Array): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), payer.toBuffer(), Buffer.from(nonce)],
    ESCROW_PROGRAM_ID
  );
}

/**
 * Deposit into escrow PDA via PaymentEscrow program
 */
async function depositEscrow(
  payer: Keypair,
  specialist: PublicKey,
  amountLamports: number,
  nonce: Uint8Array
): Promise<{ txSig: string; escrowPDA: PublicKey }> {
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(idl, provider);

  const [escrowPDA] = deriveEscrowPDA(payer.publicKey, nonce);

  const txSig = await (program.methods as any)
    .deposit(new BN(amountLamports), Array.from(nonce))
    .accounts({
      payer: payer.publicKey,
      specialist,
      escrowAccount: escrowPDA,
      systemProgram: SystemProgram.programId,
    })
    .signers([payer])
    .rpc({ commitment: 'confirmed' });

  return { txSig, escrowPDA };
}

/**
 * Full x402 flow — query a specialist endpoint
 */
export async function querySpecialist(
  query: string,
  specialistUrl: string = SPECIALIST_URL
): Promise<SpecialistResult> {
  console.log(`\n🔐 x402 Flow — Query: "${query}"`);
  console.log(`   Specialist: ${specialistUrl}`);
  console.log(`   Orchestrator: ${ORCHESTRATOR_KEYPAIR.publicKey.toBase58()}\n`);

  // ── Step 1: Initial request → expect 402 ─────────────────────────────
  console.log(`  → GET /answer (no payment)`);
  const probe = await fetch(`${specialistUrl}/answer?q=${encodeURIComponent(query)}`);

  if (probe.status !== 402) {
    const body = await probe.text();
    throw new Error(`Expected 402, got ${probe.status}: ${body}`);
  }

  const probeData = await probe.json() as any;
  const { payment } = probeData;

  console.log(`  ← 402 { amount: ${payment.amount_lamports}, nonce: "${payment.nonce.slice(0, 8)}...", program: "${payment.program.slice(0, 8)}..." }`);

  // ── Step 2: Deposit into escrow ───────────────────────────────────────
  const specialist = new PublicKey(payment.specialist);
  const nonceBytes = hexToNonce(payment.nonce);
  const [escrowPDA] = deriveEscrowPDA(ORCHESTRATOR_KEYPAIR.publicKey, nonceBytes);

  // Check orchestrator balance first
  const balance = await connection.getBalance(ORCHESTRATOR_KEYPAIR.publicKey);
  console.log(`  💳 Orchestrator balance: ${balance} lamports (need ${payment.amount_lamports})`);

  if (balance < payment.amount_lamports + 10000) {
    throw new Error(`Insufficient balance: ${balance} lamports, need ${payment.amount_lamports + 10000}`);
  }

  console.log(`  → Depositing ${payment.amount_lamports} lamports into escrow...`);
  const { txSig: depositTx } = await depositEscrow(
    ORCHESTRATOR_KEYPAIR,
    specialist,
    payment.amount_lamports,
    nonceBytes
  );

  console.log(`  → deposit tx: ${depositTx}`);
  console.log(`     escrow PDA: ${escrowPDA.toBase58()}`);

  // ── Step 3: Retry with payment proof ──────────────────────────────────
  console.log(`  → GET /answer (X-Payment-Tx: ${depositTx.slice(0, 8)}...)`);
  const result = await fetch(`${specialistUrl}/answer?q=${encodeURIComponent(query)}`, {
    headers: {
      'X-Payment-Tx': depositTx,
      'X-Payment-Nonce': payment.nonce,
    },
  });

  if (!result.ok) {
    const errBody = await result.json() as any;
    throw new Error(`Specialist error ${result.status}: ${errBody.error} — ${errBody.reason || ''}`);
  }

  const resultData = await result.json() as any;
  console.log(`  ← 200 { answer: "${resultData.answer?.slice(0, 60)}...", release_tx: "${resultData.release_tx?.slice(0, 8)}..." }`);

  return {
    answer: resultData.answer,
    deposit_tx: depositTx,
    release_tx: resultData.release_tx,
    escrow_pda: escrowPDA.toBase58(),
    nonce: payment.nonce,
    amounts: resultData.amounts,
  };
}

// ─────────────────────────────────────────────
// CLI entrypoint — single x402 test
// ─────────────────────────────────────────────
async function main() {
  const query = process.argv[2] || 'What is the capital of France?';

  console.log('═══════════════════════════════════════════════════════');
  console.log('  x402 Trustless Payment Flow — Solana Devnet');
  console.log('═══════════════════════════════════════════════════════');

  try {
    const result = await querySpecialist(query);

    const specialistSOL = (result.amounts?.specialist_lamports ?? 0) / 1e9;
    const protocolSOL = (result.amounts?.protocol_lamports ?? 0) / 1e9;

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  ✅ x402 Flow Complete');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`\n  📝 Answer: ${result.answer.slice(0, 200)}`);
    console.log(`\n  ✅ deposit_tx:  https://explorer.solana.com/tx/${result.deposit_tx}?cluster=devnet`);
    if (result.release_tx) {
      console.log(`  ✅ release_tx:  https://explorer.solana.com/tx/${result.release_tx}?cluster=devnet`);
    }
    console.log(`  🏦 escrow PDA:  ${result.escrow_pda}`);
    console.log(`  💰 Specialist received: ${specialistSOL.toFixed(6)} SOL | Treasury: ${protocolSOL.toFixed(6)} SOL`);
    console.log('');
  } catch (err: any) {
    console.error(`\n❌ x402 flow failed: ${err.message}`);
    process.exit(1);
  }
}

main().catch(console.error);
