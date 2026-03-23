# Agent Economy Demos — Solana Micropayments

> Two production-ready demos showing agent-to-agent commerce using Solana x402-style micropayments.

Built for the **Solana Agent Economy Hackathon** (deadline: March 27, 2026).

---

## What It Does

This demo shows a multi-agent research pipeline where:

1. An **Orchestrator** generates research questions and spawns specialist agents
2. Each specialist is **funded via a SOL micropayment** (0.001 SOL) — the payment receipt acts as an x402-style access credential
3. The specialist **verifies the on-chain payment**, then calls **Venice AI** for private inference
4. Results are aggregated into a research report with **on-chain proof links**

This is the architecture for trustless AI compute markets: pay → prove → access.

---

## Architecture

**Demo 1 (Research):**
```
Orchestrator (Solana Devnet)
       │
       ├─ pay 0.001 SOL ──► Specialist Wallet A ──► Venice AI (TEE) ──► Insight
       ├─ pay 0.001 SOL ──► Specialist Wallet B ──► Venice AI (TEE) ──► Insight
       ├─ pay 0.001 SOL ──► Specialist Wallet C ──► Venice AI (TEE) ──► Insight
       │
       └─ aggregate report with 3 tx signatures as proof
```

**Demo 2 (Landing Pages — 50 orchestrations):**
```
50 concurrent clients
       │
       ├─ Orchestration 1: pay UX → pay Copy → pay Fee ──► Landing Page 1
       ├─ Orchestration 2: pay UX → pay Copy → pay Fee ──► Landing Page 2
       ├─ ...
       └─ Orchestration 50: pay UX → pay Copy → pay Fee ──► Landing Page 50

       Total: 150 on-chain transactions (3 per orchestration)
              50 UX specialist payouts (0.001 SOL each)
              50 Copy specialist payouts (0.001 SOL each)
              50 Protocol fees (0.0002 SOL each)
```

**Stack:**
- **Solana Devnet** — fast, cheap, deterministic finality (~800ms)
- **@solana/web3.js** — no Anchor, no Rust, pure TypeScript
- **Venice AI** (`mistral-31-24b`) — TEE-backed private inference (no logs, no training data use)
- **x402-style receipts** — on-chain tx signatures as payment credentials

---

## The ReddiOS Connection

This is the mobile inference layer for **ReddiOS**.

ReddiOS is a privacy-first mobile AI assistant that runs local models on-device. When your local model isn't powerful enough for a task, it **pays for cryptographically private cloud inference**, with the payment proof anchored on Solana.

```
User query → Local model (on-device)
                  │
             [complexity too high]
                  │
                  ▼
         SOL micropayment (x402)
                  │
                  ▼
         Venice AI (TEE inference)
                  │
                  ▼
         Answer + on-chain proof
```

**The three pillars of sovereign AI:**
- 🔒 **Private inference** — Venice AI runs in a Trusted Execution Environment. Your queries aren't logged or used for training.
- ⛓️ **On-chain payments** — Every inference is paid for with a Solana transaction. The tx signature IS the access credential.
- 📱 **Mobile-first** — The orchestrator pattern runs on ReddiOS. Local model handles simple tasks; cloud handles complex ones.

---

## Live Devnet Transactions (Latest Run — 2026-03-23)

These are real transactions on Solana Devnet showing live micropayments to specialist agents:

| Question | Tx Signature | Explorer |
|----------|-------------|----------|
| Privacy risks of Meta AI | `5XTK3ojuz...jt5C` | [View](https://explorer.solana.com/tx/5XTK3ojuzqGEoG274eVZw8g3CPjhuXDpagkMhxJe2GdzpZjpNGcGN85cubUdHEAok41q2ekBGQLRY9K5NqEVjt5C?cluster=devnet) |
| TEEs and private AI inference | `5oV4UAgVp...Ran` | [View](https://explorer.solana.com/tx/5oV4UAgVpw4re2FQ3vF1mM3Z6FLZJR6kcAzLgQ1XL6tE6RgDeQDEFvdZ1iyaJzVzcjqMBvsuV64XdhjEQDb19Ran?cluster=devnet) |
| Solana micropayment market for AI | `5MPv2DQJj...UFT` | [View](https://explorer.solana.com/tx/5MPv2DQJjCt6FhEdqv9u5LrEpVcXMHAkhmZcG93Zv1wqemTPCQuKQ4ZTCLi8seyHc1UMXtKiPx7JiQYUwrEd3UFT?cluster=devnet) |

**Orchestrator wallet:** [`5NCr4qnNxSymrwdDXFgU5P4MGV9xuRV4Aq5qPqVep3WV`](https://explorer.solana.com/address/5NCr4qnNxSymrwdDXFgU5P4MGV9xuRV4Aq5qPqVep3WV?cluster=devnet)

---

## How to Run

**1. Install dependencies**
```bash
npm install
```

**2. Fund the orchestrator wallet on Devnet**

The orchestrator wallet is auto-created at `.orchestrator-keypair.json` on first run. Fund it:

```bash
# Check balance
ORCH_ADDR="5NCr4qnNxSymrwdDXFgU5P4MGV9xuRV4Aq5qPqVep3WV"
curl -s https://api.devnet.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$ORCH_ADDR\"]}"

# Request airdrop (if needed)
curl -s https://api.devnet.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"requestAirdrop","params":["5NCr4qnNxSymrwdDXFgU5P4MGV9xuRV4Aq5qPqVep3WV",2000000000]}'
```

**3. Run Demo 1 (Research DAG — ~8 seconds)**
```bash
npm run demo
# or: npx ts-node src/research-dag.ts
```

Output:
- Spawns 3 specialist agents
- Sends 0.001 SOL micropayment to each
- Calls Venice AI with payment receipts as credentials
- Prints a research report with on-chain proof links

**4. Run Demo 2 (Landing Page Economy — ~5 minutes)**
```bash
npx ts-node src/landing-page-economy.ts
```

Output:
- Spawns 50 landing page generation orchestrations
- Batches of 10 with 2s inter-batch cooldown
- Each orchestration: pay UX specialist → pay Copy specialist → pay protocol fee
- 150 total on-chain transactions confirmed
- Full results in `results/landing-page-economy-results.json`
- Summary in `results/landing-page-economy-summary.md`

---

## Project Structure

```
src/
  research-dag.ts              — Demo 1: Research orchestrator (3 specialists)
  landing-page-economy.ts      — Demo 2: Landing page economy (50 orchestrations) ✨ NEW
  specialist.ts                — Specialist: verifies payment, calls Venice AI
  micropayment.ts              — SOL transfer + receipt generation (x402 pattern)
  wallets.ts                   — Wallet management, balance checks, airdrop

results/
  landing-page-economy-results.json    — Full results: 50 orchestrations, 150 txs
  landing-page-economy-summary.md      — Human-readable summary + sample outputs
```

---

## Economics (Live)

**Demo 1 (Research):**
- **Cost per query:** 0.001 SOL (~$0.00015 USD at $0.15/SOL)
- **3-query demo cost:** 0.003 SOL total (~$0.0005 USD)
- **Inference time:** ~1.7s per query (Venice AI)
- **Payment confirmation:** ~800ms (Solana Devnet)
- **Total demo time:** ~8 seconds end-to-end

**Demo 2 (Landing Pages):**
- **Cost per orchestration:** 0.0022 SOL (UX 0.001 + Copy 0.001 + Fee 0.0002)
- **50-orchestration stress test:** 0.11 SOL total
- **Specialist payments:** 0.10 SOL (100 specialist payouts @ 0.001 each)
- **Protocol fees:** 0.01 SOL (50 × 0.0002)
- **Orchestration time:** ~5.5s avg (UX 1.5s + Copy 1.5s + Fee 0.5s + devnet confirmation 1.5s each)
- **Total demo time:** ~289 seconds (5 batches × 10 orchestrations × 5.5s + inter-batch cooldown)
- **Throughput:** 0.17 orchestrations/sec, 0.52 txs/sec

---

## Why This Matters

AI inference is moving toward a market model. Today it's centralized (OpenAI, Anthropic, Meta). Tomorrow it's:

- **Any model** running in a TEE
- **Any client** paying with a SOL micropayment
- **On-chain proof** that inference happened correctly
- **No trusted intermediary** required

Venice AI is already TEE-backed. Solana already has sub-cent micropayments. This demo wires them together with a clean agent protocol.

**ReddiOS is the first app that ships this to consumers.**

---

## Hackathon Notes

- **Track:** Solana Agent Economy
- **Deadline:** March 27, 2026
- **Demo:** Run `npm run demo` — produces 3 live devnet transactions in ~8 seconds
- **No smart contracts needed** — pure `SystemProgram.transfer` + tx signature as credential

---

## License

MIT
st:** 0.003 SOL (~$0.0005 USD)
- **Inference time:** ~1.7s per query (Venice AI)
- **Payment confirmation:** ~800ms (Solana Devnet)
- **Total demo time:** ~8 seconds end-to-end

---

## Why This Matters

AI inference is moving toward a market model. Today it's centralized (OpenAI, Anthropic, Meta). Tomorrow it's:

- **Any model** running in a TEE
- **Any client** paying with a SOL micropayment
- **On-chain proof** that inference happened correctly
- **No trusted intermediary** required

Venice AI is already TEE-backed. Solana already has sub-cent micropayments. This demo wires them together with a clean agent protocol.

**ReddiOS is the first app that ships this to consumers.**

---

## Hackathon Notes

- **Track:** Solana Agent Economy
- **Deadline:** March 27, 2026
- **Demo:** Run `npm run demo` — produces 3 live devnet transactions in ~8 seconds
- **No smart contracts needed** — pure `SystemProgram.transfer` + tx signature as credential

---

## License

MIT
