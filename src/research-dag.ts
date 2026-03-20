/**
 * research-dag.ts — Research DAG orchestrator with Solana micropayments
 *
 * Flow:
 *   1. Orchestrator generates research questions
 *   2. Funds specialist wallets via SOL transfer (x402-style micropayment)
 *   3. Specialist returns insights after verifying on-chain payment receipt
 *   4. Orchestrator aggregates results into a research report
 *
 * TypeScript + @solana/web3.js only. No Anchor, no Rust, no on-chain programs.
 */
import { Connection } from '@solana/web3.js';
import {
  DEVNET_RPC,
  loadOrCreateOrchestrator,
  makeSpecialistWallet,
  getBalance,
  airdrop,
  airdropViaCurl,
} from './wallets';
import { pay } from './micropayment';
import { processRequest } from './specialist';

const PAYMENT_SOL = 0.001; // per research question

interface ResearchJob {
  id: number;
  question: string;
  result?: {
    insight: string;
    confidence: number;
    sources: string[];
    txSignature: string;
    slot: number;
  };
}

async function ensureFunded(connection: Connection, orchestrator: ReturnType<typeof loadOrCreateOrchestrator>): Promise<void> {
  const bal = await getBalance(connection, orchestrator.publicKey);
  console.log(`  Current balance: ${bal.toFixed(4)} SOL`);

  if (bal >= 0.01) {
    console.log('  ✅ Sufficient funds\n');
    return;
  }

  console.log('  Balance low — requesting airdrop...');
  try {
    await airdrop(connection, orchestrator.publicKey, 2);
    const newBal = await getBalance(connection, orchestrator.publicKey);
    console.log(`  ✅ Balance after airdrop: ${newBal.toFixed(4)} SOL\n`);
  } catch {
    console.log('  SDK airdrop failed, trying curl fallback...');
    await airdropViaCurl(orchestrator.publicKey, 2);
    const newBal = await getBalance(connection, orchestrator.publicKey);
    if (newBal < 0.005) {
      throw new Error(`Orchestrator wallet underfunded (${newBal} SOL). Run: curl -s https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["${orchestrator.publicKey.toBase58()}",2000000000]}'`);
    }
    console.log(`  ✅ Balance after curl airdrop: ${newBal.toFixed(4)} SOL\n`);
  }
}

async function run(): Promise<void> {
  console.log('\n🔬 Research DAG — Solana Micropayment Demo');
  console.log('==========================================');
  console.log('Network: Solana Devnet | Protocol: x402-style SOL micropayments');
  console.log('No Anchor | No Rust | TypeScript + @solana/web3.js only\n');

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const orchestrator = loadOrCreateOrchestrator();
  console.log(`Orchestrator: ${orchestrator.publicKey.toBase58()}`);

  await ensureFunded(connection, orchestrator);

  const questions = [
    'How does Solana achieve high throughput and TPS?',
    'What is the x402 micropayment protocol for agents?',
    'How do research DAG agents coordinate knowledge sharing?',
  ];

  const jobs: ResearchJob[] = questions.map((q, i) => ({ id: i + 1, question: q }));

  console.log(`🧠 Orchestrator dispatching ${jobs.length} research questions\n`);

  for (const job of jobs) {
    console.log(`\n[Job ${job.id}/${jobs.length}] "${job.question}"`);

    const specialist = makeSpecialistWallet();
    console.log(`  Specialist spawned: ${specialist.publicKey.toBase58()}`);
    console.log(`  Paying ${PAYMENT_SOL} SOL as research fee...`);

    const receipt = await pay(connection, orchestrator, specialist.publicKey, PAYMENT_SOL);
    console.log(`  ✅ Payment confirmed`);
    console.log(`     Tx: ${receipt.txSignature}`);
    console.log(`     Slot: ${receipt.slot} | ${receipt.lamports} lamports transferred`);
    console.log(`     Explorer: https://explorer.solana.com/tx/${receipt.txSignature}?cluster=devnet`);

    const insight = processRequest({ question: job.question, receipt });

    if (!insight.paymentVerified) {
      console.log(`  ❌ Insight rejected: ${insight.insight}`);
      continue;
    }

    job.result = {
      insight: insight.insight,
      confidence: insight.confidence,
      sources: insight.sources,
      txSignature: receipt.txSignature,
      slot: receipt.slot,
    };

    console.log(`  📚 Insight received (confidence: ${(insight.confidence * 100).toFixed(0)}%)`);
    console.log(`     "${insight.insight.substring(0, 100)}..."`);
  }

  // Aggregate report
  console.log('\n\n╔══════════════════════════════════════════╗');
  console.log('║         RESEARCH REPORT — AGGREGATED     ║');
  console.log('╚══════════════════════════════════════════╝\n');

  for (const job of jobs) {
    if (!job.result) { console.log(`Q${job.id}: No result\n`); continue; }
    console.log(`Q${job.id}: ${job.question}`);
    console.log(`Answer: ${job.result.insight}`);
    console.log(`Confidence: ${(job.result.confidence * 100).toFixed(0)}%`);
    console.log(`Sources: ${job.result.sources.join(', ')}`);
    console.log(`Proof: https://explorer.solana.com/tx/${job.result.txSignature}?cluster=devnet`);
    console.log();
  }

  const finalBal = await getBalance(connection, orchestrator.publicKey);
  console.log(`💰 Final balance: ${finalBal.toFixed(6)} SOL`);
  console.log(`   Research fees paid: ${(jobs.length * PAYMENT_SOL).toFixed(4)} SOL`);
  console.log('\n✅ Research DAG demo complete.');
}

run().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
