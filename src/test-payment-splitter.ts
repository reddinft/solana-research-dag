/**
 * test-payment-splitter.ts
 * Quick smoke test: send one payment through the on-chain PaymentSplitter program.
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { pay } from './micropayment';

const RPC = 'https://api.devnet.solana.com';

function loadKeypair(filePath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');

  // Use blitz-dev as payer (has funds)
  const payer = loadKeypair(path.join(process.env.HOME!, '.config/solana/blitz-dev.json'));
  // Use a fresh random pubkey as "specialist" for testing
  const specialist = new PublicKey('3Vmcwra5tfxGwaX3jnpmYybCd7gH4fstJzi1Yci38f94'); // deployer as specialist

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Specialist:', specialist.toBase58());
  console.log('Treasury: ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is');
  console.log('Program: BpnKFaaXrktxFS3rC1LKrs9ELP53JDymBRV4mMd2umGL');
  console.log('');

  // Check balances before
  const payerBalanceBefore = await connection.getBalance(payer.publicKey);
  console.log(`Payer balance before: ${payerBalanceBefore / LAMPORTS_PER_SOL} SOL`);

  // Send 0.0012 SOL total (matching the economy test)
  const PAYMENT_SOL = 0.001; // specialist gets 83.3%
  const TOTAL_SOL = 0.001 + 0.0002; // 0.0012 total
  
  console.log(`\nSending ${TOTAL_SOL} SOL through PaymentSplitter program...`);

  const receipt = await pay(connection, payer, specialist, TOTAL_SOL);

  console.log('\n✅ Payment processed!');
  console.log('  TX Signature:', receipt.txSignature);
  console.log('  Program ID:', receipt.programId);
  console.log('  Specialist amount:', receipt.lamports, 'lamports', `(${receipt.lamports / LAMPORTS_PER_SOL} SOL)`);
  console.log('  Protocol fee:', receipt.protocolFeeLamports, 'lamports', `(${receipt.protocolFeeLamports / LAMPORTS_PER_SOL} SOL)`);
  console.log('  Slot:', receipt.slot);
  console.log('');
  console.log('Verify on Solana Explorer:');
  console.log(`  https://explorer.solana.com/tx/${receipt.txSignature}?cluster=devnet`);
}

main().catch(console.error);
