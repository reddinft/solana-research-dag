/**
 * wallets.ts — Keypair management for Research DAG agents
 */
import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

export const DEVNET_RPC = 'https://api.devnet.solana.com';
const KEYPAIR_FILE = path.join(__dirname, '../.orchestrator-keypair.json');

/** Load or create a persistent orchestrator keypair (saved to disk for reuse across runs) */
export function loadOrCreateOrchestrator(): Keypair {
  if (fs.existsSync(KEYPAIR_FILE)) {
    const secret = JSON.parse(fs.readFileSync(KEYPAIR_FILE, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  const kp = Keypair.generate();
  fs.writeFileSync(KEYPAIR_FILE, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`  Created new orchestrator keypair: ${kp.publicKey.toBase58()}`);
  console.log(`  Saved to: ${KEYPAIR_FILE}`);
  return kp;
}

/** Generate a fresh ephemeral keypair for a specialist agent */
export function makeSpecialistWallet(): Keypair {
  return Keypair.generate();
}

/** Get SOL balance in SOL (human-readable) */
export async function getBalance(
  connection: Connection,
  pubkey: PublicKey
): Promise<number> {
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

/** Airdrop SOL to a wallet (devnet only) */
export async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  solAmount: number
): Promise<string> {
  const sig = await connection.requestAirdrop(
    pubkey,
    solAmount * LAMPORTS_PER_SOL
  );
  const latest = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, ...latest },
    'confirmed'
  );
  return sig;
}

/** Try airdrop via CLI curl as fallback */
export async function airdropViaCurl(pubkey: PublicKey, solAmount: number): Promise<void> {
  const lamports = solAmount * LAMPORTS_PER_SOL;
  const { execSync } = require('child_process');
  execSync(
    `curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" ` +
    `-d '{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["${pubkey.toBase58()}",${lamports}]}'`,
    { stdio: 'inherit' }
  );
  // Wait a few seconds for finalization
  await new Promise(r => setTimeout(r, 5000));
}
