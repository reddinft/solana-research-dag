# Solana Research DAG — x402 Micropayments Demo

> **Research orchestration with SOL micropayments. No Anchor. No Rust. TypeScript only.**

## Concept

A Research DAG where:
1. **Orchestrator** agent generates research questions
2. Sends `0.001 SOL` to a **Specialist** wallet as payment (x402-style)
3. **Specialist** verifies the on-chain payment receipt, returns an insight
4. Orchestrator aggregates results into a report

Every research answer is purchased with a real on-chain SOL transfer. The blockchain is the auth layer.

## Architecture

```
Orchestrator Wallet
      │
      │ pay(0.001 SOL) ─────► Specialist Wallet #1 → Insight: Solana TPS
      │ pay(0.001 SOL) ─────► Specialist Wallet #2 → Insight: x402 Protocol
      │ pay(0.001 SOL) ─────► Specialist Wallet #3 → Insight: Research DAGs
      │
      ▼
  Aggregate Research Report
  (each answer has on-chain tx proof)
```

## Files

```
src/
  wallets.ts         — Keypair management, airdrop helpers
  micropayment.ts    — SOL transfer via SystemProgram (pure web3.js)
  specialist.ts      — Specialist agent: verifies payment, returns insight
  research-dag.ts    — Orchestrator: main demo loop
```

## Run

```bash
# Install deps
npm install

# Fund the orchestrator wallet FIRST (devnet rate-limited)
# Orchestrator address is saved to .orchestrator-keypair.json after first run
npx ts-node src/research-dag.ts   # First run generates keypair
cat .orchestrator-keypair.json    # Get address, then fund via:
solana airdrop 2 <address> --url devnet
# OR visit: https://faucet.solana.com

# Re-run after funding
npx ts-node src/research-dag.ts
```

## Key Design Choices

- **No Anchor, no Rust** — pure `@solana/web3.js` + TypeScript
- **No on-chain programs** — uses `SystemProgram.transfer` for payments
- **Specialist wallets are ephemeral** — new keypair per job (demonstrates agent spawning)
- **Orchestrator keypair is persistent** — saved to `.orchestrator-keypair.json` (gitignored)
- **Payment verification** — specialist checks `receipt.solAmount >= minThreshold` before responding

## Extending for Production

Replace the hardcoded knowledge base in `specialist.ts` with:
- Venice.ai API call (private inference)
- Perplexity API call
- Any LLM with a payment gate

The `PaymentReceipt` can be included as an HTTP header (x402 pattern) when specialist is a real API server.

## Network

- Devnet: `https://api.devnet.solana.com`
- Explorer: `https://explorer.solana.com/?cluster=devnet`
