import { z } from 'zod';
import type { Citation } from '../ports/chat-store';
import type { CitableSource } from '../tools/tool';

/** Opening and closing tags of the block that ends every final answer. */
export const CITATIONS_OPEN = '<citations>';
export const CITATIONS_CLOSE = '</citations>';

/** Most citations one answer may list. */
const MAX_CITATIONS = 50;

/** The block the model writes after its answer text (prompt answer-question v4). */
export const answerMetaSchema = z
  .object({
    /** false when the repository does not contain the answer (or the question isn't about it). */
    found: z.boolean(),
    citations: z
      .array(
        z
          .object({
            /** A sourceId from a tool result of this turn: a chunk id, `r-…` or `e-…`. */
            sourceId: z.string().trim().min(1).max(100),
            /** Inclusive line range inside that source; the whole source when omitted. */
            lines: z
              .tuple([z.number().int().min(1), z.number().int().min(1)])
              .refine(([start, end]) => end >= start, 'lines must be [start, end] with end >= start')
              .optional(),
          })
          .strict(),
      )
      .max(MAX_CITATIONS),
  })
  .strict();

export type AnswerMeta = z.infer<typeof answerMetaSchema>;

/** A final answer split into its text and its parsed citation block. */
export type ParsedAnswer =
  | { ok: true; text: string; meta: AnswerMeta }
  | { ok: false; text: string; problem: string };

/** Accepts the JSON bare or inside a ```json fence. */
const unfence = (json: string) => json.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');

/**
 * Splits a final answer into the text the user sees and the `<citations>`
 * block that must end it, and validates the block with answerMetaSchema.
 * The text is everything before the block (or the whole answer when the
 * block is missing, so a failed parse still has something to show).
 */
export function parseFinalAnswer(raw: string): ParsedAnswer {
  const open = raw.lastIndexOf(CITATIONS_OPEN);
  if (open === -1) {
    return { ok: false, text: raw.trim(), problem: `the answer does not end with a ${CITATIONS_OPEN} block` };
  }
  const text = raw.slice(0, open).trim();
  const close = raw.indexOf(CITATIONS_CLOSE, open);
  if (close === -1) {
    return { ok: false, text, problem: `the ${CITATIONS_OPEN} block is not closed with ${CITATIONS_CLOSE}` };
  }
  if (raw.slice(close + CITATIONS_CLOSE.length).trim() !== '') {
    return { ok: false, text, problem: `nothing may follow ${CITATIONS_CLOSE}` };
  }

  let json: unknown;
  try {
    json = JSON.parse(unfence(raw.slice(open + CITATIONS_OPEN.length, close)));
  } catch {
    return { ok: false, text, problem: `the ${CITATIONS_OPEN} block is not valid JSON` };
  }
  const meta = answerMetaSchema.safeParse(json);
  if (!meta.success) {
    const issues = meta.error.issues.map((i) => `${i.path.join('.') || 'block'}: ${i.message}`);
    return { ok: false, text, problem: `the ${CITATIONS_OPEN} block is invalid (${issues.join('; ')})` };
  }
  return { ok: true, text, meta: meta.data };
}

export interface ValidatedCitations {
  /** Citations that name a source returned this turn, with lines inside it. Deduplicated. */
  citations: Citation[];
  /** Why each other citation was rejected, e.g. "unknown sourceId abc". */
  rejected: string[];
}

/**
 * Checks each citation against the sources the tools returned in this turn:
 * the sourceId must be one of them, and the cited lines must lie inside it.
 * Anything else (an invented id, a source from an earlier turn, lines the
 * model never saw) is rejected.
 */
export function validateCitations(
  meta: AnswerMeta,
  sources: ReadonlyMap<string, CitableSource>,
): ValidatedCitations {
  const citations: Citation[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const { sourceId, lines } of meta.citations) {
    const source = sources.get(sourceId);
    if (!source) {
      rejected.push(`unknown sourceId ${sourceId}`);
      continue;
    }
    const [startLine, endLine] = lines ?? [source.startLine, source.endLine];
    if (startLine < source.startLine || endLine > source.endLine) {
      rejected.push(
        `lines ${String(startLine)}-${String(endLine)} are outside ${sourceId} ` +
          `(${source.path}:${String(source.startLine)}-${String(source.endLine)})`,
      );
      continue;
    }
    const key = `${source.path}:${String(startLine)}-${String(endLine)}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ path: source.path, startLine, endLine });
    }
  }
  return { citations, rejected };
}
