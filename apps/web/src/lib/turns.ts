/**
 * Client-side model of a conversation: one Turn per question, built either
 * from the live answer stream or from a stored transcript. Pure functions only.
 */
import type {
  AnswerSummary,
  ChatStreamEvent,
  Citation,
  Excerpt,
  ToolCallTrace,
} from "@cda/domain/events";
import type { Message } from "./api";

export interface ToolStep {
  id: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  /** Result line ("8 results") or the error message. */
  summary?: string;
  excerpts: Excerpt[];
}

export interface Turn {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  steps: ToolStep[];
  /** Streamed text per model call (iteration). */
  textByIteration: Record<number, string>;
  /** Iterations that ended in tool calls: their text is a progress note. */
  toolIterations: number[];
  /** Final answer text, once known. */
  answer?: string;
  outcome?: AnswerSummary["outcome"];
  citations: Citation[];
  unverifiedReferences: string[];
  error?: string;
}

export function newTurn(id: string, question: string): Turn {
  return {
    id,
    question,
    status: "streaming",
    steps: [],
    textByIteration: {},
    toolIterations: [],
    citations: [],
    unverifiedReferences: [],
  };
}

/** Folds one stream event into a turn. */
export function applyEvent(turn: Turn, event: ChatStreamEvent): Turn {
  switch (event.type) {
    case "token":
      return {
        ...turn,
        textByIteration: {
          ...turn.textByIteration,
          [event.iteration]: (turn.textByIteration[event.iteration] ?? "") + event.text,
        },
      };
    case "tool_call":
      return {
        ...turn,
        toolIterations: turn.toolIterations.includes(event.iteration)
          ? turn.toolIterations
          : [...turn.toolIterations, event.iteration],
        steps: [
          ...turn.steps,
          { id: event.id, name: event.name, input: event.input, status: "running", excerpts: [] },
        ],
      };
    case "tool_result":
      return {
        ...turn,
        steps: turn.steps.map((step) =>
          step.id === event.id
            ? {
                ...step,
                status: event.isError ? "error" : "done",
                summary: event.summary,
                excerpts: event.excerpts,
              }
            : step,
        ),
      };
    case "done":
      return {
        ...turn,
        status: "done",
        answer: event.result.answer,
        outcome: event.result.outcome,
        citations: event.result.citations,
        unverifiedReferences: event.result.unverifiedReferences,
      };
    case "error":
      return { ...turn, status: "error", error: event.message };
  }
}

/** The answer text to show: final if known, else the text of the latest non-tool iteration. */
export function visibleAnswer(turn: Turn): string {
  if (turn.answer !== undefined) return turn.answer;
  const iterations = Object.keys(turn.textByIteration)
    .map(Number)
    .filter((i) => !turn.toolIterations.includes(i))
    .sort((a, b) => a - b);
  const last = iterations.at(-1);
  return last === undefined ? "" : turn.textByIteration[last];
}

function stepFromTrace(trace: ToolCallTrace, index: number): ToolStep {
  return {
    id: `stored-${index}`,
    name: trace.name,
    input: trace.input,
    status: trace.isError ? "error" : "done",
    summary: trace.summary,
    excerpts: trace.excerpts ?? [],
  };
}

/** Pairs a stored transcript into turns (a question may lack an answer if it failed). */
export function turnsFromMessages(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ ...newTurn(message.id, message.content), status: "done" });
      continue;
    }
    const turn = turns.at(-1);
    if (!turn || turn.answer !== undefined) continue;
    turns[turns.length - 1] = {
      ...turn,
      answer: message.content,
      steps: (message.toolCalls ?? []).map(stepFromTrace),
      citations: message.citations,
    };
  }
  return turns;
}

export interface Source extends Excerpt {
  /** Stable key: path:start-end. */
  key: string;
}

/** Every distinct excerpt the model saw while answering, in the order it saw them. */
export function sourcesOf(turn: Turn): Source[] {
  const seen = new Map<string, Source>();
  for (const step of turn.steps) {
    for (const excerpt of step.excerpts) {
      const key = `${excerpt.path}:${excerpt.startLine}-${excerpt.endLine}`;
      const existing = seen.get(key);
      // A read of the same lines beats a search snippet or a route's declaration line.
      if (!existing || (existing.source !== "read" && excerpt.source === "read")) {
        seen.set(key, { ...excerpt, key });
      }
    }
  }
  return [...seen.values()];
}

/** `path:12` or `path:12-30` (hyphen or en dash), as answers write citations. */
const REFERENCE = /^((?:[\w.-]+\/)*[\w.-]*\.[A-Za-z0-9]+):(\d+)(?:\s*[-–]\s*(\d+))?$/;

/** Parses a citation as written in an answer, or returns null for other text. */
export function parseReference(text: string): Citation | null {
  const match = REFERENCE.exec(text.trim());
  if (!match) return null;
  const startLine = Number(match[2]);
  const endLine = match[3] === undefined ? startLine : Number(match[3]);
  return endLine < startLine ? null : { path: match[1], startLine, endLine };
}

/** Resolves a written path ("Ky.ts", "core/Ky.ts") against the paths an answer saw. */
export function resolvePath(written: string, paths: readonly string[]): string | null {
  if (paths.includes(written)) return written;
  const matches = [...new Set(paths)].filter((p) => p.endsWith(`/${written}`));
  return matches.length === 1 ? matches[0] : null;
}

export const overlaps = (a: Citation, b: Citation) =>
  a.path === b.path && a.startLine <= b.endLine && b.startLine <= a.endLine;
