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

const PAYMENT_SOL = 0.001; // per research question (specialist)
// Total cost per query: 0.0012 SOL (0.001 specialist + 0.0002 protocol fee)
const PROTOCOL_FEE_SOL = 0.0002;
const PROTOCOL_TREASURY_SHORT = 'ArCugaYbH...9is';

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
  console.log('\n🔬 ReddiOS Research Agent — Sovereign AI on Solana');
  console.log('===================================================');
  console.log('Network: Solana Devnet | Privacy: Venice AI (TEE-backed inference)');
  console.log('Protocol: x402-style SOL micropayments for knowledge access\n');

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const orchestrator = loadOrCreateOrchestrator();
  console.log(`Orchestrator: ${orchestrator.publicKey.toBase58()}`);

  await ensureFunded(connection, orchestrator);

  const questions = [
    'What are the key privacy risks of cloud AI assistants like Meta AI?',
    'How do Trusted Execution Environments enable verifiable private AI inference?',
    'How can Solana micropayments create a trustless market for private AI compute?',
  ];

  const jobs: ResearchJob[] = questions.map((q, i) => ({ id: i + 1, question: q }));

  console.log(`🧠 Orchestrator dispatching ${jobs.length} research questions\n`);

  const startTime = Date.now();
  let totalTokens = 0;
  let successCount = 0;

  for (const job of jobs) {
    const jobStart = Date.now();
    console.log(`\n[Job ${job.id}/${jobs.length}] "${job.question}"`);

    const specialist = makeSpecialistWallet();
    console.log(`  📍 Specialist spawned: ${specialist.publicKey.toBase58()}`);
    
    const payStart = Date.now();
    console.log(`  💳 Sending ${PAYMENT_SOL} SOL to specialist + ${PROTOCOL_FEE_SOL} SOL protocol fee...`);

    const receipt = await pay(connection, orchestrator, specialist.publicKey, PAYMENT_SOL);
    const payTime = Date.now() - payStart;
    
    console.log(`  ✅ Payments confirmed (${payTime}ms)`);
    console.log(`     Specialist Tx: ${receipt.txSignature}`);
    console.log(`     Protocol Fee Tx: ${receipt.protocolFeeTx}`);
    console.log(`     Slot: ${receipt.slot} | ${receipt.lamports} lamports + ${receipt.protocolFeeLamports} fee lamports`);

    const insightStart = Date.now();
    const insight = await processRequest({ question: job.question, receipt });
    const insightTime = Date.now() - insightStart;

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

    successCount++;
    const tokenCount = insight.sources[0]?.match(/(\d+)\s*tokens/)?.[1] || '0';
    totalTokens += parseInt(tokenCount);

    const jobTime = Date.now() - jobStart;
    console.log(`  📚 Insight received (${insightTime}ms)`);
    console.log(`     Confidence: ${(insight.confidence * 100).toFixed(0)}%`);
    console.log(`     Sources: ${insight.sources.join(', ')}`);
    console.log(`     Job time: ${jobTime}ms (payment: ${payTime}ms, insight: ${insightTime}ms)`);
    console.log(`     "${insight.insight.substring(0, 100)}..."`);
  }

  // Aggregate report
  const totalTime = Date.now() - startTime;
  
  console.log('\n\n╔════════════════════════════════════════════╗');
  console.log('║      📊 RESEARCH REPORT — AGGREGATED      ║');
  console.log('╚════════════════════════════════════════════╝\n');

  for (const job of jobs) {
    if (!job.result) { console.log(`Q${job.id}: No result\n`); continue; }
    console.log(`Q${job.id}: ${job.question}`);
    console.log(`   Answer: ${job.result.insight}`);
    console.log(`   Confidence: ${(job.result.confidence * 100).toFixed(0)}%`);
    console.log(`   Sources: ${job.result.sources.join(', ')}`);
    console.log(`   Proof: https://explorer.solana.com/tx/${job.result.txSignature}?cluster=devnet\n`);
  }

  console.log('╔════════════════════════════════════════════╗');
  console.log('║         💰 ECONOMICS & PERFORMANCE        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const finalBal = await getBalance(connection, orchestrator.publicKey);
  const specialistCostSol = jobs.length * PAYMENT_SOL;
  const protocolCostSol = jobs.length * PROTOCOL_FEE_SOL;
  const totalCostSol = specialistCostSol + protocolCostSol;
  const costPerQuery = PAYMENT_SOL + PROTOCOL_FEE_SOL;
  
  console.log(`✅ Successful queries: ${successCount}/${jobs.length}`);
  console.log(`⏱️  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
  console.log(`🤖 AI tokens consumed: ${totalTokens}`);
  console.log(`💳 Specialist payments: ${specialistCostSol.toFixed(4)} SOL (${PAYMENT_SOL} × ${jobs.length} queries)`);
  console.log(`💰 Protocol fee:    ${protocolCostSol.toFixed(4)} SOL total (${PROTOCOL_FEE_SOL} × ${jobs.length} queries)`);
  console.log(`📊 Take rate:       16.7% of gross payments`);
  console.log(`🏦 Treasury:        ${PROTOCOL_TREASURY_SHORT}`);
  console.log(`📈 Total cost per query: ${costPerQuery.toFixed(4)} SOL`);
  console.log(`⚡ Speed: ${((jobs.length / (totalTime / 1000)).toFixed(1))} queries/sec`);
  console.log(`\n💰 Wallet status:`);
  console.log(`   Initial: ${(finalBal + totalCostSol).toFixed(6)} SOL`);
  console.log(`   Final:   ${finalBal.toFixed(6)} SOL`);
  console.log(`   Spent:   ${totalCostSol.toFixed(6)} SOL (${specialistCostSol.toFixed(4)} specialist + ${protocolCostSol.toFixed(4)} protocol)`);

  console.log('\n✅ Research DAG demo complete.');
}

run().catch((err) => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
