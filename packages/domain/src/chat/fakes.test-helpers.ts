import { z } from 'zod';
import type {
  ChatSession,
  ChatStore,
  Citation,
  StoredMessage,
  ToolCallTrace,
} from '../ports/chat-store';
import type {
  CompleteOptions,
  LanguageModel,
  ModelRequest,
  ModelResponse,
  ToolCall,
} from '../ports/language-model';
import type { LlmCallLog, LlmCallRecord } from '../ports/llm-call-log';
import type { DailySpend, QuestionAdmission, UsageGuard } from '../ports/usage-guard';
import type { CitableSource, Tool, ToolContext } from '../tools/tool';

/** A scripted step that never finishes on its own: it rejects only when aborted. */
export const HANG = 'hang' as const;

/**
 * A scripted model: returns (or throws) the next scripted step on each call.
 * A step's text is streamed word by word through `onTextDelta` first.
 */
export class FakeLanguageModel implements LanguageModel {
  readonly modelName = 'fake-model';
  /** Deep copies of every request, as the model received it. */
  readonly requests: ModelRequest[] = [];
  /** Called when a call starts, e.g. to abort mid-call in a test. */
  onCall?: (callNumber: number) => void;

  constructor(private readonly script: (Partial<ModelResponse> | Error | typeof HANG)[]) {}

  complete(request: ModelRequest, options: CompleteOptions = {}): Promise<ModelResponse> {
    this.requests.push(structuredClone(request));
    this.onCall?.(this.requests.length);
    const step = this.script.shift();
    if (step === undefined) {
      return Promise.reject(new Error('FakeLanguageModel: script exhausted'));
    }
    if (step === HANG) {
      return new Promise((_, reject) => {
        const { signal } = options;
        if (signal?.aborted) reject(new Error('aborted'));
        signal?.addEventListener('abort', () => { reject(new Error('aborted')); });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    for (const word of (step.text ?? '').split(/(?<= )/)) {
      if (word !== '') options.onTextDelta?.(word);
    }
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

/**
 * A scripted final answer: the text, then the `<citations>` block the loop
 * parses. `sourceIds` are what LookupTool returns (`lk-<key>`), or invented ones.
 */
export const final = (
  text: string,
  citations: (string | { sourceId: string; lines?: [number, number] })[] = [],
  found = true,
): string =>
  `${text}\n\n<citations>${JSON.stringify({
    found,
    citations: citations.map((c) => (typeof c === 'string' ? { sourceId: c } : c)),
  })}</citations>`;

interface LookupOutput {
  sourceId: string;
  path: string;
  value: string;
}

/**
 * Answers lookups from a fixed table; cites what it returns (src/<key>.ts
 * lines 1-10, sourceId `lk-<key>`). A key like `big-3000` returns a value of
 * 3000 × 3 characters (about 3000 estimated tokens).
 */
export class LookupTool implements Tool<{ key: string }, LookupOutput> {
  readonly name = 'lookup';
  readonly description = 'Looks a key up.';
  readonly inputSchema = z.object({ key: z.string().min(1).describe('The key') }).strict();
  readonly calls: { key: string; repoId: string; retrievalMode?: string }[] = [];

  execute(input: { key: string }, context: ToolContext) {
    this.calls.push({
      key: input.key,
      repoId: context.repoId,
      ...(context.retrievalMode && { retrievalMode: context.retrievalMode }),
    });
    if (input.key === 'explode') return Promise.reject(new Error('backend down'));
    const big = /^big-(\d+)$/.exec(input.key);
    const value = big ? 'v'.repeat(Number(big[1]) * 3) : `value-of-${input.key}`;
    return Promise.resolve({ sourceId: `lk-${input.key}`, path: `src/${input.key}.ts`, value });
  }

  citations(output: LookupOutput): CitableSource[] {
    return [{ id: output.sourceId, path: output.path, startLine: 1, endLine: 10 }];
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

/** A UsageGuard with settable limits that records every spend. */
export class FakeUsageGuard implements UsageGuard {
  readonly spends: number[] = [];
  readonly admitted: string[] = [];
  /** Questions each session may ask; Infinity = no limit. */
  questionLimit = Number.POSITIVE_INFINITY;
  capUsd = Number.POSITIVE_INFINITY;
  spentUsd = 0;
  readonly resetsAt = new Date('2026-11-17T00:00:00.000Z');

  admitQuestion(sessionId: string): Promise<QuestionAdmission> {
    if (this.admitted.filter((s) => s === sessionId).length >= this.questionLimit) {
      return Promise.resolve({ allowed: false, limit: this.questionLimit, windowSeconds: 60, retryAfterSeconds: 42 });
    }
    this.admitted.push(sessionId);
    return Promise.resolve({ allowed: true });
  }

  dailySpend(): Promise<DailySpend> {
    return Promise.resolve({ spentUsd: this.spentUsd, capUsd: this.capUsd, resetsAt: this.resetsAt });
  }

  recordSpend(costUsd: number): Promise<void> {
    this.spends.push(costUsd);
    this.spentUsd += costUsd;
    return Promise.resolve();
  }
}
