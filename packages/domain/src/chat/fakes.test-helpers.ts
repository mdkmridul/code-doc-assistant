import { z } from 'zod';
import type {
  ChatSession,
  ChatStore,
  Citation,
  StoredMessage,
  ToolCallTrace,
} from '../ports/chat-store';
import type {
  LanguageModel,
  ModelRequest,
  ModelResponse,
  ToolCall,
} from '../ports/language-model';
import type { LlmCallLog, LlmCallRecord } from '../ports/llm-call-log';
import type { Tool } from '../tools/tool';

/** A scripted model: returns (or throws) the next scripted step on each call. */
export class FakeLanguageModel implements LanguageModel {
  readonly modelName = 'fake-model';
  /** Deep copies of every request, as the model received it. */
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: (Partial<ModelResponse> | Error)[]) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    const step = this.script.shift();
    if (step === undefined) {
      return Promise.reject(new Error('FakeLanguageModel: script exhausted'));
    }
    if (step instanceof Error) return Promise.reject(step);
    const toolCalls = step.toolCalls ?? [];
    return Promise.resolve({
      model: 'fake-model',
      text: '',
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end',
      usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.001 },
      providerContent: { raw: `turn-${String(this.requests.length)}` },
      ...step,
      toolCalls,
    });
  }
}

export const call = (id: string, name: string, input: unknown): ToolCall => ({
  id,
  name,
  input,
});

/** Answers lookups from a fixed table; cites what it returns. */
export class LookupTool implements Tool<{ key: string }, { value: string; path: string }> {
  readonly name = 'lookup';
  readonly description = 'Looks a key up.';
  readonly inputSchema = z.object({ key: z.string().min(1).describe('The key') }).strict();
  readonly calls: { key: string; repoId: string }[] = [];

  execute(input: { key: string }, context: { repoId: string }) {
    this.calls.push({ key: input.key, repoId: context.repoId });
    if (input.key === 'explode') return Promise.reject(new Error('backend down'));
    return Promise.resolve({ value: `value-of-${input.key}`, path: `src/${input.key}.ts` });
  }

  citations(output: { value: string; path: string }): Citation[] {
    return [{ path: output.path, startLine: 1, endLine: 10 }];
  }
}

export class FakeChatStore implements ChatStore {
  readonly sessions = new Map<string, ChatSession>();
  readonly messages = new Map<string, StoredMessage[]>();
  private nextId = 1;

  createSession(repoId: string): Promise<{ id: string }> {
    const id = `session-${String(this.nextId++)}`;
    this.sessions.set(id, { id, repoId, repoLabel: `label-of-${repoId}` });
    return Promise.resolve({ id });
  }

  findSession(id: string): Promise<ChatSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  listMessages(sessionId: string): Promise<StoredMessage[]> {
    return Promise.resolve([...(this.messages.get(sessionId) ?? [])]);
  }

  addUserMessage(sessionId: string, content: string): Promise<{ id: string }> {
    return Promise.resolve(
      this.push(sessionId, { role: 'user', content, id: '', createdAt: new Date(0) }),
    );
  }

  addAssistantMessage(
    sessionId: string,
    message: { content: string; toolCalls: ToolCallTrace[]; citations: Citation[] },
  ): Promise<{ id: string }> {
    return Promise.resolve(
      this.push(sessionId, { role: 'assistant', ...message, id: '', createdAt: new Date(0) }),
    );
  }

  private push(sessionId: string, message: StoredMessage): { id: string } {
    const id = `message-${String(this.nextId++)}`;
    const list = this.messages.get(sessionId) ?? [];
    list.push({ ...message, id });
    this.messages.set(sessionId, list);
    return { id };
  }
}

export class FakeLlmCallLog implements LlmCallLog {
  readonly calls: LlmCallRecord[] = [];
  record(call: LlmCallRecord): Promise<void> {
    this.calls.push(call);
    return Promise.resolve();
  }
}

/** Each now() is 25 ms after the previous one. */
export class SteppingClock {
  private t = 0;
  now(): number {
    this.t += 25;
    return this.t;
  }
}
