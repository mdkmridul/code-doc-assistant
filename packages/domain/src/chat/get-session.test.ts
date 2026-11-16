import { describe, expect, it } from 'vitest';
import { SessionNotFoundError } from './errors';
import { FakeChatStore } from './fakes.test-helpers';
import { GetSession } from './get-session';

describe('GetSession', () => {
  it('returns the session with its messages, oldest first', async () => {
    const chats = new FakeChatStore();
    const { id } = await chats.createSession('repo-1');
    await chats.addUserMessage(id, 'How are retries done?');
    await chats.addAssistantMessage(id, {
      content: 'See src/retry.ts:1-5.',
      toolCalls: [],
      citations: [{ path: 'src/retry.ts', startLine: 1, endLine: 5 }],
    });

    const transcript = await new GetSession(chats).execute(id);

    expect(transcript).toMatchObject({
      id,
      repoId: 'repo-1',
      repoLabel: 'label-of-repo-1',
      messages: [
        { role: 'user', content: 'How are retries done?' },
        {
          role: 'assistant',
          content: 'See src/retry.ts:1-5.',
          citations: [{ path: 'src/retry.ts', startLine: 1, endLine: 5 }],
        },
      ],
    });
  });

  it('rejects an unknown session', async () => {
    await expect(new GetSession(new FakeChatStore()).execute('nope')).rejects.toThrow(
      SessionNotFoundError,
    );
  });
});
