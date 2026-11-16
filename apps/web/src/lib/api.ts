/**
 * Browser client for the API (apps/api). The browser calls the API directly;
 * the API allows this origin through CORS (WEB_ORIGIN). Wire types shared with
 * the API come from @cda/domain/events (type-only: nothing of the domain
 * package is bundled).
 */
import type {
  AnswerSummary,
  ChatStreamEvent,
  Citation,
  RepoStatus,
  ToolCallTrace,
} from "@cda/domain/events";
import { readSse } from "./sse";

export type {
  AnswerSummary,
  ChatStreamEvent,
  Citation,
  Excerpt,
  RepoProgress,
  RepoProgressEvent,
  RepoStatus,
  ToolCallTrace,
} from "@cda/domain/events";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/** Ingestion has finished, one way or the other. */
export const isTerminal = (status: RepoStatus) => status === "ready" || status === "failed";

export interface Repo {
  id: string;
  status: RepoStatus;
  source: { type: "git"; url: string } | { type: "local"; fileName: string };
  commitSha: string | null;
  error: string | null;
  fileCount: number;
  chunkCount: number;
}

export interface RegisterRepoResponse {
  id: string;
  status: RepoStatus;
  /** True when this exact source version was already queued, running or ready. */
  deduplicated: boolean;
}

export type Message =
  | { id: string; role: "user"; content: string }
  | {
      id: string;
      role: "assistant";
      content: string;
      citations: Citation[];
      toolCalls?: ToolCallTrace[];
    };

export interface Session {
  id: string;
  repoId: string;
  repoLabel: string;
  messages: Message[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Nest error bodies carry `message` as a string or a list of strings. */
function errorMessage(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join("; ");
  if (typeof message === "string") return message;
  return `Request failed with HTTP ${status}`;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError(0, `Cannot reach the API at ${API_URL}. Is it running?`);
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(body, response.status));
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await send(path, init)).json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  registerGitHubRepo: (url: string) => request<RegisterRepoResponse>("/repos", json({ url })),

  registerZip: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<RegisterRepoResponse>("/repos", { method: "POST", body: form });
  },

  getRepo: (id: string) => request<Repo>(`/repos/${id}`),

  /** SSE URL for EventSource: RepoProgressEvent until ready or failed. */
  repoEventsUrl: (id: string) => `${API_URL}/repos/${id}/events`,

  startSession: (repoId: string) =>
    request<{ id: string; repoId: string }>("/sessions", json({ repoId })),

  getSession: (id: string) => request<Session>(`/sessions/${id}`),

  ask: (sessionId: string, content: string) =>
    request<AnswerSummary>(`/sessions/${sessionId}/messages`, json({ content })),

  /**
   * Asks a question and streams the answer: `onEvent` receives every
   * ChatStreamEvent. Aborting `signal` closes the stream; the API then cancels
   * the answer.
   */
  askStream: async (
    sessionId: string,
    content: string,
    onEvent: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const response = await send(`/sessions/${sessionId}/messages/stream`, {
      ...json({ content }),
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      signal,
    });
    await readSse(response, (data) => onEvent(data as ChatStreamEvent));
  },
};
