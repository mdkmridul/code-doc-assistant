export interface ChatSession {
  id: string;
  repoId: string;
  /** e.g. "https://github.com/sindresorhus/ky" or "my-project.zip". */
  repoLabel: string;
}

/** A source location an answer relied on. */
export interface Citation {
  path: string;
  startLine: number;
  endLine: number;
}

/** A tool call made while answering, kept for transparency and debugging. */
export interface ToolCallTrace {
  name: string;
  input: unknown;
  isError: boolean;
}

export type StoredMessage =
  | { id: string; role: 'user'; content: string; createdAt: Date }
  | {
      id: string;
      role: 'assistant';
      content: string;
      toolCalls: ToolCallTrace[];
      citations: Citation[];
      createdAt: Date;
    };

export interface ChatStore {
  createSession(repoId: string): Promise<{ id: string }>;
  /** Null when the session does not exist. */
  findSession(id: string): Promise<ChatSession | null>;
  /** Oldest first. */
  listMessages(sessionId: string): Promise<StoredMessage[]>;
  addUserMessage(sessionId: string, content: string): Promise<{ id: string }>;
  addAssistantMessage(
    sessionId: string,
    message: { content: string; toolCalls: ToolCallTrace[]; citations: Citation[] },
  ): Promise<{ id: string }>;
}
