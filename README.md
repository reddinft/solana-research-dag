# ReddiOS Research Agent — Sovereign AI on Solana

> A research agent that pays for private AI inference using Solana micropayments.

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

```
Orchestrator (Solana Devnet)
       │
       ├─ pay 0.001 SOL ──► Specialist Wallet A
       │                         │
       │                    verify receipt
       │                         │
       │                    call Venice AI (TEE)
       │                         │
       │◄── insight + on-chain proof ──────────┘
       │
       ├─ pay 0.001 SOL ──► Specialist Wallet B
       │                    [same flow]
       │
       └─ aggregate report with tx signatures as proof
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

The orchestrator wallet is auto-created at `~/.solana/orchestrator.json` on first run. Fund it:

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

**3. Run the demo**
```bash
npm run demo
# or: npx ts-node src/research-dag.ts
```

The demo will:
- Check wallet balance (auto-airdrop if needed)
- Spawn 3 specialist agents with fresh keypairs
- Send 0.001 SOL micropayment to each
- Call Venice AI with payment receipts as credentials
- Print a research report with on-chain proof links

---

## Project Structure

```
src/
  research-dag.ts   — Orchestrator: spawns agents, pays, aggregates results
  specialist.ts     — Specialist: verifies payment, calls Venice AI, returns insight
  micropayment.ts   — SOL transfer + receipt generation (x402 pattern)
  wallets.ts        — Wallet management, balance checks, airdrop helpers
```

---

## Economics (Live)

- **Cost per query:** 0.001 SOL (~$0.00015 USD at $0.15/SOL)
- **3-query demo cost:** 0.003 SOL (~$0.0005 USD)
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
