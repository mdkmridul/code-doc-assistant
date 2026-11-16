/**
 * US dollars per million tokens, from Anthropic's price list (Nov 2026).
 * 5-minute cache writes cost 1.25x input; cache reads are listed per model.
 * Fallback targets are included so a turn rescued by another model is priced
 * at that model's rates.
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const ANTHROPIC_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheWrite: 2.5,
    cacheRead: 0.1,
  },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheWrite: 0.125,
    cacheRead: 0.01,
  },
};

export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
}

/** Price of one usage entry; null when the model is not in the table. */
export function costOf(model: string, usage: TokenCounts): number | null {
  const price = ANTHROPIC_PRICES[model];
  if (!price) return null;
  return (
    (usage.input_tokens * price.input +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000
  );
}
