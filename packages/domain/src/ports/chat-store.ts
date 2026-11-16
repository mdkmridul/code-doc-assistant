import type { Citation, ToolCallTrace } from '../events';

export type { Citation, ToolCallTrace } from '../events';

export interface ChatSession {
  id: string;
  repoId: string;
  /** e.g. "https://github.com/sindresorhus/ky" or "my-project.zip". */
  repoLabel: string;
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
