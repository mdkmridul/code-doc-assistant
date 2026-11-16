import type { Citation } from '../ports/chat-store';

export interface ResolvedCitations {
  /** References in the answer backed by lines the model actually saw, in order of appearance. */
  citations: Citation[];
  /** References the evidence does not back: unseen files or lines, or ambiguous names. */
  unverifiedReferences: string[];
}

/**
 * `path:line` or `path:start-end` (hyphen or en dash), where path is a full
 * repo path ("source/core/Ky.ts") or a bare file name ("Ky.ts"). The path
 * must contain a dot-extension so prose like "step:1" is not a reference.
 */
const REFERENCE =
  /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]*\.[A-Za-z0-9]+):(\d+)(?:\s*[-–]\s*(\d+))?\b/g;

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const overlaps = (a: Citation, b: Citation) =>
  a.startLine <= b.endLine && b.startLine <= a.endLine;

/**
 * Turns the line references an answer makes into citations, keeping only those
 * that overlap code the model retrieved (search hits or file reads). A bare
 * file name is resolved when exactly one retrieved file has that name.
 */
export function resolveCitations(answer: string, evidence: readonly Citation[]): ResolvedCitations {
  const seenPaths = [...new Set(evidence.map((e) => e.path))];
  const citations: Citation[] = [];
  const unverified: string[] = [];
  const cited = new Set<string>();

  for (const match of answer.matchAll(REFERENCE)) {
    const [reference, written, start] = match;
    // Optional group: undefined when the reference names a single line.
    const end = match[3] as string | undefined;
    const startLine = Number(start);
    const endLine = end === undefined ? startLine : Number(end);
    if (endLine < startLine) {
      unverified.push(reference);
      continue;
    }

    const candidates = written.includes('/')
      ? seenPaths.filter((p) => p === written || p.endsWith(`/${written}`))
      : seenPaths.filter((p) => basename(p) === written);
    if (candidates.length !== 1) {
      unverified.push(reference);
      continue;
    }

    const citation = { path: candidates[0], startLine, endLine };
    if (!evidence.some((e) => e.path === citation.path && overlaps(e, citation))) {
      unverified.push(reference);
      continue;
    }

    const key = `${citation.path}:${String(startLine)}-${String(endLine)}`;
    if (!cited.has(key)) {
      cited.add(key);
      citations.push(citation);
    }
  }

  return { citations, unverifiedReferences: [...new Set(unverified)] };
}
