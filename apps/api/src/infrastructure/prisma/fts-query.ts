/**
 * Words that carry no meaning in a question about code. The `simple` text
 * search configuration keeps every word (ADR 0005), so questions drop them
 * here; otherwise "how does the …" would match nearly every chunk.
 */
const STOP_WORDS = new Set(
  `a about above after again all also am an and any are as at be been before being below between both
  but by can could did do does doing done down during each else ever every few for from further get gets
  got had has have having he her here hers him his how however i if in into is it its itself just let me
  more most much my no nor not now of off on once only or other our ours out over own same she should so
  some such than that the their theirs them then there these they this those through to too under until
  up use used uses using very via was we were what when where which while who whom why will with would
  you your yours explain describe show tell work works working happen happens code repo repository
  function functions file files method methods`.split(/\s+/),
);

/** Longest query we build; more terms only add noise to the ranking. */
const MAX_TERMS = 12;

/**
 * Turns a natural-language question into an OR tsquery for the `simple`
 * configuration, e.g. "How does retryOnTimeout work with afterStatusCodes?"
 * → `retryontimeout | afterstatuscodes`. Words are split the way the
 * Postgres parser splits them (letters and digits; `_`, `-`, `.` separate),
 * lower-cased, deduplicated, stripped of stop words and very short words.
 * Returns null when nothing is left to search for.
 */
export function toOrTsQuery(text: string): string | null {
  const terms: string[] = [];
  for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3 || STOP_WORDS.has(word) || terms.includes(word))
      continue;
    terms.push(word);
    if (terms.length === MAX_TERMS) break;
  }
  // Only letters and digits remain, so no tsquery operator can be injected.
  return terms.length === 0 ? null : terms.join(' | ');
}
