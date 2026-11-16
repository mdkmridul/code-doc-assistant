/**
 * Wire types shared by the API and the web app (`@cda/domain/events`).
 * This file has no imports and no Node dependencies, so the browser bundle can
 * use it. Every SSE `event:` name equals the `type` of its JSON `data`.
 */

export type RepoStatus = 'queued' | 'running' | 'ready' | 'failed';

/** Why answering ended. */
export type LoopOutcome =
  /** The model answered without asking for more tools. */
  | 'completed'
  /** The iteration cap forced a final answer. */
  | 'iteration_cap'
  /** The token budget ran out. */
  | 'token_budget'
  /** The model declined to answer. */
  | 'refused'
  /** The model ran out of output tokens mid-answer. */
  | 'truncated'
  /** The client went away (e.g. closed the stream) before the answer finished. */
  | 'cancelled';

/** A source location an answer relied on. */
export interface Citation {
  path: string;
  startLine: number;
  endLine: number;
}

/** Code the model actually saw: a search hit's snippet or lines it read. */
export interface Excerpt {
  path: string;
  /** 1-based, inclusive; `text` starts at this line. */
  startLine: number;
  endLine: number;
  text: string;
  source: 'search' | 'read';
}

/** A tool call made while answering, kept for transparency and debugging. */
export interface ToolCallTrace {
  name: string;
  input: unknown;
  isError: boolean;
  /** One line for the UI; absent on answers stored before it existed. */
  summary?: string;
  /** What the tool showed the model; absent on answers stored before it existed. */
  excerpts?: Excerpt[];
}

/** The finished answer to one question. */
export interface AnswerSummary {
  messageId: string;
  answer: string;
  outcome: LoopOutcome;
  /** Model calls made for this question. */
  iterations: number;
  toolCalls: ToolCallTrace[];
  /** Line references in the answer that overlap code the model actually retrieved. */
  citations: Citation[];
  /** Line references in the answer that no retrieved code backs (possible invention). */
  unverifiedReferences: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Events of `POST /sessions/:id/messages/stream`, in order: for each model call
 * (`iteration`, starting at 1) its `token`s, then any `tool_call`s with their
 * `tool_result`s; finally exactly one `done` or `error`.
 *
 * Text streamed in an iteration that ends in tool calls is a progress note,
 * not the answer. The answer is the text of the last iteration, and
 * `done.result.answer` is authoritative.
 */
export type ChatStreamEvent =
  | { type: 'token'; iteration: number; text: string }
  | { type: 'tool_call'; iteration: number; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      iteration: number;
      id: string;
      name: string;
      isError: boolean;
      /** One line for the UI, e.g. "8 results" or the error message. */
      summary: string;
      /** The code this result showed the model (empty on errors). */
      excerpts: Excerpt[];
    }
  | { type: 'done'; result: AnswerSummary }
  | { type: 'error'; message: string };

/** Where an ingest stands. Published as it changes; each event is a full snapshot. */
export interface RepoProgress {
  repoId: string;
  status: RepoStatus;
  /** Files and chunks stored so far. */
  fileCount: number;
  chunkCount: number;
  error: string | null;
}

/** Events of `GET /repos/:id/events`. The stream ends after a terminal status. */
export type RepoProgressEvent = { type: 'progress'; progress: RepoProgress };

export const isTerminalStatus = (status: RepoStatus): boolean =>
  status === 'ready' || status === 'failed';
