/**
 * landing-page-economy.ts — Agent Economy Stress Test
 *
 * Demonstrates agent-to-agent commerce at throughput:
 *   50 parallel landing page orchestrations (batches of 10)
 *   Each orchestration: pay UX specialist + pay copy specialist + protocol fee
 *   = 150 on-chain Solana Devnet transactions total
 *
 * Orchestrator model: Ollama qwen3:1.7b (free, local)
 * Payment infrastructure: reuses micropayment.ts (x402-style SOL transfers)
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { DEVNET_RPC, loadOrCreateOrchestrator, makeSpecialistWallet, getBalance, airdropViaCurl } from './wallets';

// ─── Config ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 2000;
const PAYMENT_SOL = 0.001;       // per specialist
const PROTOCOL_FEE_SOL = 0.0002; // once per orchestration
const TOTAL_ORCHESTRATIONS = 50;
const OLLAMA_MODEL = 'qwen3:1.7b';
const PROTOCOL_TREASURY = new PublicKey('ArCugaYbHumHTiwP9ArA5L2vHNgWrcVPuGSchYXhh9is');

const PRODUCT_BRIEFS = [
  'ReddiOS: privacy-first AI chief of staff that runs local models on iPhone',
  'SandSync: real-time offline-first sync engine for mobile apps using PowerSync',
  'OpenClaw Playbooks: reusable multi-agent pipeline specs that teams can fork and run',
  'Barry Starr Coffee: specialty coffee subscription with AI-powered taste matching',
  'SandmanTales: AI-powered Caribbean folklore storytelling app for children',
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface OrchestrationResult {
  id: number;
  product: string;
  ux_tx: string;
  copy_tx: string;
  fee_tx: string;
  ux_output: string;
  copy_output: string;
  time_ms: number;
  error?: string;
}

interface RunResults {
  run_timestamp: string;
  total_orchestrations: number;
  successful: number;
  failed: number;
  total_transactions: number;
  total_time_seconds: number;
  specialist_sol_paid: number;
  protocol_fees_sol: number;
  orchestrations: OrchestrationResult[];
}

// ─── Ollama ─────────────────────────────────────────────────────────────────

async function callOllama(prompt: string): Promise<string> {
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        think: false,
        options: { num_predict: 200 },
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json() as { response?: string; thinking?: string };
    return (data.response ?? data.thinking ?? '').trim();
  } catch (err) {
    throw new Error(`Ollama call failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Payments ───────────────────────────────────────────────────────────────

async function transferSol(
  connection: Connection,
  payer: Keypair,
  recipient: PublicKey,
  solAmount: number
): Promise<string> {
  const lamports = Math.floor(solAmount * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    })
  );

  return sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
}

// ─── Single orchestration ───────────────────────────────────────────────────

async function runOrchestration(
  connection: Connection,
  orchestrator: Keypair,
  id: number,
  brief: string
): Promise<OrchestrationResult> {
  const start = Date.now();

  const uxSpecialist = makeSpecialistWallet();
  const copySpecialist = makeSpecialistWallet();

  const uxPrompt = `You are a UX specialist. Given this product brief, return the optimal landing page sections and layout structure. The sections array must contain 5 to 7 concrete section names and must never be empty. Use practical landing page section names like Hero, Problem, Features, How It Works, Social Proof, Pricing, FAQ, CTA. Brief: ${brief}. Return JSON only in this exact shape: {"sections": ["Hero", "Problem", "How It Works", "Features", "CTA"], "hero_layout": "split-screen"}`;
  const copyPrompt = `You are a web copywriter. Given this product brief, write landing page copy. Brief: ${brief}. Return JSON only: {"headline": "string", "subheadline": "string", "cta": "string", "hero_body": "string"}`;

  const uxTx = await transferSol(connection, orchestrator, uxSpecialist.publicKey, PAYMENT_SOL);
  const uxOutput = await callOllama(uxPrompt);

  const copyTx = await transferSol(connection, orchestrator, copySpecialist.publicKey, PAYMENT_SOL);
  const copyOutput = await callOllama(copyPrompt);

  const feeTx = await transferSol(connection, orchestrator, PROTOCOL_TREASURY, PROTOCOL_FEE_SOL);

  const time_ms = Date.now() - start;

  return {
    id,
    product: brief,
    ux_tx: uxTx,
    copy_tx: copyTx,
    fee_tx: feeTx,
    ux_output: uxOutput,
    copy_output: copyOutput,
    time_ms,
  };
}

// ─── Balance check / airdrop ────────────────────────────────────────────────

async function ensureBalance(connection: Connection, orchestrator: Keypair): Promise<void> {
  const bal = await getBalance(connection, orchestrator.publicKey);
  console.log(`  Orchestrator: ${orchestrator.publicKey.toBase58()}`);
  console.log(`  Balance: ${bal.toFixed(4)} SOL`);

  const MIN_NEEDED = TOTAL_ORCHESTRATIONS * (PAYMENT_SOL * 2 + PROTOCOL_FEE_SOL) + 0.05;

  if (bal >= MIN_NEEDED) {
    console.log(`  ✅ Sufficient balance (need ~${MIN_NEEDED.toFixed(4)} SOL)\n`);
    return;
  }

  console.log(`  ⚠️  Low balance — requesting airdrop...`);
  await airdropViaCurl(orchestrator.publicKey, 2);
  const newBal = await getBalance(connection, orchestrator.publicKey);
  console.log(`  ✅ Balance after airdrop: ${newBal.toFixed(4)} SOL\n`);
}

// ─── Batch runner ───────────────────────────────────────────────────────────

async function runBatch(
  connection: Connection,
  orchestrator: Keypair,
  batchItems: Array<{ id: number; brief: string }>,
  batchNum: number,
  totalBatches: number
): Promise<OrchestrationResult[]> {
  console.log(`\nBatch ${batchNum}/${totalBatches} [${batchItems.length} orchestrations]`);

  const batchStart = Date.now();
  const settled: OrchestrationResult[] = [];
  let successCount = 0;
  let totalMs = 0;

  // Run sequentially within each batch to avoid devnet RPC rate limits
  // (10 parallel sendAndConfirmTransaction calls triggers 429s)
  for (let i = 0; i < batchItems.length; i++) {
    const item = batchItems[i];
    const productShort = item.brief.split(':')[0];

    try {
      const res = await runOrchestration(connection, orchestrator, item.id, item.brief);
      successCount++;
      totalMs += res.time_ms;
      settled.push(res);
      const secStr = (res.time_ms / 1000).toFixed(1) + 's';
      const uxShort = res.ux_tx.slice(0, 6) + '...';
      const copyShort = res.copy_tx.slice(0, 6) + '...';
      const feeShort = res.fee_tx.slice(0, 6) + '...';
      console.log(`  ✅ [${i + 1}/${batchItems.length}] ${productShort} — UX tx: ${uxShort} | Copy tx: ${copyShort} | Fee tx: ${feeShort} | ${secStr}`);
    } catch (err) {
      const errRes: OrchestrationResult = {
        id: item.id,
        product: item.brief,
        ux_tx: '',
        copy_tx: '',
        fee_tx: '',
        ux_output: '',
        copy_output: '',
        time_ms: 0,
        error: err instanceof Error ? err.message : String(err),
      };
      settled.push(errRes);
      console.log(`  ❌ [${i + 1}/${batchItems.length}] ${productShort} — ${errRes.error}`);
    }

    // Small inter-tx delay to be polite to devnet RPC
    if (i < batchItems.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const avgTime = successCount > 0 ? (totalMs / successCount / 1000).toFixed(1) : '0';
  const txsSettled = successCount * 3;
  console.log(`Batch ${batchNum} complete: ${successCount}/${batchItems.length} ✅  avg ${avgTime}s  ${txsSettled} txs settled`);

  return settled;
}

// ─── Sample output extraction ───────────────────────────────────────────────

function extractSamples(results: OrchestrationResult[]): string[] {
  const samples: string[] = [];
  const products = new Set<string>();

  for (const r of results) {
    if (r.error || products.size >= 3) continue;
    const productName = r.product.split(':')[0];
    if (products.has(productName)) continue;
    products.add(productName);

    // Try to extract sections from UX JSON
    let uxSummary = '';
    try {
      const jsonMatch = r.ux_output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const uxData = JSON.parse(jsonMatch[0]) as { sections?: string[]; hero_layout?: string };
        if (uxData.sections && uxData.sections.length > 0) {
          uxSummary = `  [${productName} UX] Sections: ${uxData.sections.slice(0, 5).join(', ')}`;
        }
      }
    } catch {
      // Not valid JSON, extract raw
      const firstLine = r.ux_output.split('\n').find(l => l.trim().length > 10) || '';
      uxSummary = `  [${productName} UX] ${firstLine.slice(0, 80)}`;
    }

    // Try to extract headline from copy JSON
    let copySummary = '';
    try {
      const jsonMatch = r.copy_output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const copyData = JSON.parse(jsonMatch[0]) as { headline?: string };
        if (copyData.headline) {
          copySummary = `  [${productName} Copy] Headline: "${copyData.headline}"`;
        }
      }
    } catch {
      const firstLine = r.copy_output.split('\n').find(l => l.trim().length > 10) || '';
      copySummary = `  [${productName} Copy] ${firstLine.slice(0, 80)}`;
    }

    if (uxSummary) samples.push(uxSummary);
    if (copySummary) samples.push(copySummary);
  }

  return samples;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🚀 Landing Page Agent Economy — 50 orchestrations, batches of 10');
  console.log('💼 Products: 5 briefs × 10 orchestrations each\n');

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const orchestrator = loadOrCreateOrchestrator();

  await ensureBalance(connection, orchestrator);

  // Build work queue: 10 orchestrations per product
  const workItems: Array<{ id: number; brief: string }> = [];
  for (let i = 0; i < TOTAL_ORCHESTRATIONS; i++) {
    workItems.push({
      id: i + 1,
      brief: PRODUCT_BRIEFS[Math.floor(i / 10) % PRODUCT_BRIEFS.length],
    });
  }

  const allResults: OrchestrationResult[] = [];
  const totalBatches = Math.ceil(TOTAL_ORCHESTRATIONS / BATCH_SIZE);
  const globalStart = Date.now();

  for (let b = 0; b < totalBatches; b++) {
    const batchItems = workItems.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
    const batchResults = await runBatch(connection, orchestrator, batchItems, b + 1, totalBatches);
    allResults.push(...batchResults);

    if (b < totalBatches - 1) {
      process.stdout.write(`  ⏳ Cooling down ${BATCH_DELAY_MS / 1000}s before next batch...\n`);
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  const totalTimeMs = Date.now() - globalStart;
  const totalTimeSec = totalTimeMs / 1000;

  // Tally results
  const successful = allResults.filter(r => !r.error).length;
  const failed = allResults.filter(r => r.error).length;
  const totalTxs = successful * 3;
  const specialistSolPaid = successful * PAYMENT_SOL * 2;
  const protocolFeesSol = successful * PROTOCOL_FEE_SOL;
  const throughputOrch = successful / totalTimeSec;
  const throughputTx = totalTxs / totalTimeSec;

  // Sample outputs
  const samples = extractSamples(allResults);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('AGENT ECONOMY STRESS TEST — RESULTS');
  console.log('════════════════════════════════════════════');
  console.log(`✅ Successful orchestrations: ${successful}/${TOTAL_ORCHESTRATIONS}`);
  if (failed > 0) console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Total time: ${totalTimeSec.toFixed(0)}s`);
  console.log(`🔗 Total on-chain transactions: ${totalTxs}`);
  console.log(`💳 Specialist payments: ${specialistSolPaid.toFixed(4)} SOL (${successful} × 0.001 × 2 specialists)`);
  console.log(`💰 Protocol fees collected: ${protocolFeesSol.toFixed(4)} SOL (${successful} × 0.0002)`);
  console.log(`📊 Protocol take rate: 16.7%`);
  console.log(`⚡ Throughput: ${throughputOrch.toFixed(2)} orchestrations/sec | ${throughputTx.toFixed(2)} txs/sec`);
  console.log(`🌐 Network: Solana Devnet`);

  if (samples.length > 0) {
    console.log('\nSample outputs:');
    samples.forEach(s => console.log(s));
  }
  console.log('════════════════════════════════════════════\n');

  // ─── Save JSON results ────────────────────────────────────────────────────
  const resultsDir = path.join(__dirname, '../results');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

  const runResults: RunResults = {
    run_timestamp: new Date().toISOString(),
    total_orchestrations: TOTAL_ORCHESTRATIONS,
    successful,
    failed,
    total_transactions: totalTxs,
    total_time_seconds: parseFloat(totalTimeSec.toFixed(2)),
    specialist_sol_paid: parseFloat(specialistSolPaid.toFixed(4)),
    protocol_fees_sol: parseFloat(protocolFeesSol.toFixed(4)),
    orchestrations: allResults,
  };

  const jsonPath = path.join(resultsDir, 'landing-page-economy-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(runResults, null, 2));
  console.log(`📁 Full results saved to: ${jsonPath}`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message || err);
  process.exit(1);
});
