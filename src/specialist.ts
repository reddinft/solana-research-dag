/**
 * specialist.ts — Specialist agent that returns insights on request
 * Simulates an AI oracle that sells knowledge for micropayments
 */
import { PaymentReceipt } from './micropayment';

export interface ResearchRequest {
  question: string;
  receipt: PaymentReceipt;
}

export interface ResearchInsight {
  question: string;
  insight: string;
  confidence: number;
  sources: string[];
  paymentVerified: boolean;
}

// Knowledge base — hardcoded for demo (would call LLM API in production)
const KNOWLEDGE_BASE: Record<string, ResearchInsight> = {
  default: {
    question: '',
    insight: 'Insufficient context to provide a specific insight.',
    confidence: 0.3,
    sources: ['internal'],
    paymentVerified: false,
  },
};

const INSIGHTS: Array<{ keywords: string[]; insight: string; sources: string[] }> = [
  {
    keywords: ['solana', 'throughput', 'tps', 'performance'],
    insight:
      'Solana achieves ~65,000 TPS via Proof of History (PoH) — a cryptographic clock that timestamps transactions before consensus. Combined with Tower BFT, validators agree on time-ordering without round-trip coordination, reducing latency to ~400ms finality.',
    sources: ['Anatoly Yakovenko (2017)', 'Solana whitepaper §3', 'Solana Beach metrics'],
  },
  {
    keywords: ['x402', 'micropayment', 'payment', 'protocol', 'http'],
    insight:
      'x402 is an HTTP 402 Payment Required revival: agents include a payment receipt header, the server verifies on-chain proof, and responds with the resource. It turns every HTTP endpoint into a paywall without OAuth — the blockchain IS the auth layer.',
    sources: ['Coinbase x402 spec (2025)', 'HTTP RFC 7235 §3.1'],
  },
  {
    keywords: ['dag', 'research', 'knowledge', 'graph', 'agent'],
    insight:
      'Research DAGs let orchestrators decompose complex questions into sub-questions, route them to specialist agents, and aggregate answers. Each node is paid independently, creating a market for knowledge where quality → higher demand → higher compensation.',
    sources: ['AutoGPT research (2023)', 'Multi-agent coordination literature'],
  },
  {
    keywords: ['defi', 'yield', 'liquidity', 'amm'],
    insight:
      'Automated Market Makers price assets via constant-product formula (x*y=k). Concentrated liquidity (Uniswap v3) lets LPs focus capital in price ranges, increasing capital efficiency 4000x for stable pairs — but introduces impermanent loss risk at range boundaries.',
    sources: ['Uniswap v3 whitepaper', 'Hayden Adams (2021)'],
  },
];

/** Verify payment is sufficient (≥ minimum threshold) */
function verifyPayment(receipt: PaymentReceipt, minSol: number): boolean {
  return receipt.solAmount >= minSol;
}

/** Find the most relevant insight for a question */
function findInsight(question: string): typeof INSIGHTS[0] | null {
  const q = question.toLowerCase();
  for (const entry of INSIGHTS) {
    if (entry.keywords.some((kw) => q.includes(kw))) {
      return entry;
    }
  }
  return null;
}

/**
 * Process a paid research request.
 * Returns insight if payment is verified, error if not.
 */
export function processRequest(req: ResearchRequest): ResearchInsight {
  const MIN_PAYMENT = 0.0005; // 0.0005 SOL minimum

  const paid = verifyPayment(req.receipt, MIN_PAYMENT);
  if (!paid) {
    return {
      question: req.question,
      insight: `Payment insufficient. Minimum: ${MIN_PAYMENT} SOL. Received: ${req.receipt.solAmount} SOL.`,
      confidence: 0,
      sources: [],
      paymentVerified: false,
    };
  }

  const match = findInsight(req.question);
  if (!match) {
    return {
      question: req.question,
      insight:
        'No specialist knowledge found for this query. Try: Solana throughput, x402 protocol, research DAGs, or DeFi yield strategies.',
      confidence: 0.4,
      sources: ['knowledge-base-miss'],
      paymentVerified: true,
    };
  }

  return {
    question: req.question,
    insight: match.insight,
    confidence: 0.92,
    sources: match.sources,
    paymentVerified: true,
  };
}
