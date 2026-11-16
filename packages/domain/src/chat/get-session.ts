import type { ChatSession, ChatStore, StoredMessage } from '../ports/chat-store';
import { SessionNotFoundError } from './errors';

export interface SessionTranscript extends ChatSession {
  /** Oldest first. */
  messages: StoredMessage[];
}

/** A session with its conversation so far, for showing it again (e.g. after a page reload). */
export class GetSession {
  constructor(private readonly chats: ChatStore) {}

  async execute(sessionId: string): Promise<SessionTranscript> {
    const session = await this.chats.findSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    return { ...session, messages: await this.chats.listMessages(sessionId) };
  }
}
