import type { AnswerSummary, ChatStreamEvent } from '../events';
import type {
  ChatStore,
  Citation,
  StoredMessage,
  ToolCallTrace,
} from '../ports/chat-store';
import type {
  ConversationMessage,
  LanguageModel,
  ModelResponse,
  ToolDefinition,
  ToolResult,
} from '../ports/language-model';
import type { LlmCallLog } from '../ports/llm-call-log';
import type { ToolRegistry } from '../tools/tool-registry';
import { resolveCitations } from './citations';
import { SessionNotFoundError } from './errors';
import type { LoopOutcome, LoopPolicy, LoopState } from './loop-policy';
import type { SystemPrompt } from './system-prompt';

export const ANSWER_QUESTION_PURPOSE = 'answer_question';

/** Appended before the final allowed call; the model then answers without tools. */
export const ITERATION_CAP_NOTE =
  'You have reached the tool-call limit for this question, so tools are now disabled. ' +
  'Answer now using only what you have already found. Say plainly what you could not verify.';

const TOKEN_BUDGET_ANSWER =
  'I ran out of my budget for this question before I could finish researching it. ' +
  'Try asking something narrower, for example about one feature or one directory.';

const REFUSAL_ANSWER = 'I can’t help with that request.';

/** Stored when the client goes away mid-answer, so the transcript stays question/answer pairs. */
export const CANCELLED_ANSWER =
  '_This answer was cancelled because the connection closed before it finished._';

export interface AnswerQuestionInput {
  sessionId: string;
  question: string;
}

export interface AnswerQuestionOptions {
  /** Receives `token`, `tool_call`, `tool_result` and finally `done`, in order. */
  onEvent?: (event: ChatStreamEvent) => void;
  /** Abort to stop early (e.g. the client disconnected): no further model calls are made. */
  signal?: AbortSignal;
}

/** The finished answer; the same shape the stream sends in its `done` event. */
export type AnswerQuestionResult = AnswerSummary;

export interface AnswerQuestionDeps {
  chats: ChatStore;
  model: LanguageModel;
  tools: ToolRegistry;
  llmCalls: LlmCallLog;
  prompt: SystemPrompt;
  policy: LoopPolicy;
  clock?: { now(): number };
}

/** Prior turns are replayed as plain text: question and final answer, no tool traffic. */
function toConversation(message: StoredMessage): ConversationMessage {
  return message.role === 'user'
    ? { role: 'user', content: message.content }
    : { role: 'assistant', text: message.content, toolCalls: [] };
}

const roundUsd = (usd: number) => Math.round(usd * 1e6) / 1e6;

/**
 * Answers a question about the session's repository with an agent loop:
 * call the model with the tools, run the tool calls it asks for, feed the
 * results back, and repeat until it answers or a LoopPolicy limit is hit.
 * Every model call is logged; the question and the answer are stored, also
 * when the caller aborts (then the answer records the cancellation).
 */
export class AnswerQuestion {
  private readonly clock: { now(): number };

  constructor(private readonly deps: AnswerQuestionDeps) {
    this.clock = deps.clock ?? { now: () => Date.now() };
  }

  async execute(
    { sessionId, question }: AnswerQuestionInput,
    { onEvent, signal }: AnswerQuestionOptions = {},
  ): Promise<AnswerQuestionResult> {
    const { chats, tools, policy, prompt } = this.deps;
    const emit = (event: ChatStreamEvent) => onEvent?.(event);

    const session = await chats.findSession(sessionId);
    if (!session) throw new SessionNotFoundError(sessionId);
    const history = await chats.listMessages(sessionId);
    await chats.addUserMessage(sessionId, question);

    // Fixed for the whole loop: the system prompt and tools must not change
    // between calls (providers bind cached reasoning to this prefix).
    const system = prompt.render({ repository: session.repoLabel });
    const toolDefinitions = tools.definitions();
    const messages: ConversationMessage[] = [
      ...history.map(toConversation),
      { role: 'user', content: question },
    ];

    const state: LoopState = { iterations: 0, tokensUsed: 0 };
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const traces: ToolCallTrace[] = [];
    const retrieved: Citation[] = [];
    let answer: string;
    let outcome: LoopOutcome;

    for (;;) {
      if (signal?.aborted) {
        outcome = 'cancelled';
        answer = CANCELLED_ANSWER;
        break;
      }
      const step = policy.nextStep(state);
      if (step === 'stop') {
        // The last response asked for tools, so its text is a progress note, not an answer.
        outcome = 'token_budget';
        answer = TOKEN_BUDGET_ANSWER;
        break;
      }
      if (step === 'final_call') {
        messages.push({ role: 'system_note', content: ITERATION_CAP_NOTE });
      }

      const iteration = state.iterations + 1;
      let response: ModelResponse;
      try {
        response = await this.callModel(
          sessionId,
          { system, messages, tools: toolDefinitions, allowToolCalls: step === 'call' },
          {
            signal,
            onTextDelta: (text) => emit({ type: 'token', iteration, text }),
          },
        );
      } catch (error) {
        // An abort surfaces as whatever error the provider throws; the signal says why.
        if (!signal?.aborted) throw error;
        state.iterations = iteration;
        outcome = 'cancelled';
        answer = CANCELLED_ANSWER;
        break;
      }
      state.iterations = iteration;
      state.tokensUsed += response.usage.inputTokens + response.usage.outputTokens;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      // llm_calls.cost_usd keeps 6 decimals; round so sums carry no float noise.
      usage.costUsd = roundUsd(usage.costUsd + response.usage.costUsd);
      answer = response.text;

      if (response.stopReason === 'refusal') {
        outcome = 'refused';
        answer = answer.trim() === '' ? REFUSAL_ANSWER : answer;
        break;
      }
      if (step === 'final_call') {
        outcome = 'iteration_cap';
        break;
      }
      if (response.stopReason === 'max_tokens') {
        // Tool calls cut off mid-input must not run.
        outcome = 'truncated';
        break;
      }
      if (policy.isDone(response)) {
        outcome = 'completed';
        break;
      }

      messages.push({
        role: 'assistant',
        text: response.text,
        toolCalls: response.toolCalls,
        providerContent: response.providerContent,
      });
      messages.push({
        role: 'tool_results',
        results: await this.runTools(response, iteration, session.repoId, traces, retrieved, emit),
      });
    }

    const { citations, unverifiedReferences } = resolveCitations(answer, retrieved);
    const stored = await chats.addAssistantMessage(sessionId, {
      content: answer,
      toolCalls: traces,
      citations,
    });

    const result: AnswerQuestionResult = {
      messageId: stored.id,
      answer,
      outcome,
      iterations: state.iterations,
      toolCalls: traces,
      citations,
      unverifiedReferences,
      usage,
    };
    emit({ type: 'done', result });
    return result;
  }

  /**
   * Runs one turn's tool calls in parallel; every call gets exactly one result.
   * All `tool_call` events go out before the tools start, each `tool_result`
   * as its tool finishes.
   */
  private async runTools(
    response: ModelResponse,
    iteration: number,
    repoId: string,
    traces: ToolCallTrace[],
    retrieved: Citation[],
    emit: (event: ChatStreamEvent) => void,
  ): Promise<ToolResult[]> {
    for (const call of response.toolCalls) {
      emit({ type: 'tool_call', iteration, id: call.id, name: call.name, input: call.input });
    }
    const executions = await Promise.all(
      response.toolCalls.map(async (call) => {
        const execution = await this.deps.tools.execute(call.name, call.input, { repoId });
        emit({
          type: 'tool_result',
          iteration,
          id: call.id,
          name: call.name,
          isError: !execution.ok,
          summary: execution.ok ? execution.summary : execution.error,
          excerpts: execution.ok ? execution.excerpts : [],
        });
        return execution;
      }),
    );
    return response.toolCalls.map((call, i) => {
      const execution = executions[i];
      traces.push({
        name: call.name,
        input: call.input,
        isError: !execution.ok,
        summary: execution.ok ? execution.summary : execution.error,
        excerpts: execution.ok ? execution.excerpts : [],
      });
      if (!execution.ok) {
        return { toolCallId: call.id, content: execution.error, isError: true };
      }
      retrieved.push(...execution.citations);
      return { toolCallId: call.id, content: JSON.stringify(execution.output), isError: false };
    });
  }

  /** One model call, logged whether it succeeds, fails or is aborted. */
  private async callModel(
    sessionId: string,
    request: {
      system: string;
      messages: ConversationMessage[];
      tools: ToolDefinition[];
      allowToolCalls: boolean;
    },
    options: { signal?: AbortSignal; onTextDelta: (text: string) => void },
  ): Promise<ModelResponse> {
    const { model, llmCalls, prompt } = this.deps;
    const started = this.clock.now();
    const base = {
      sessionId,
      purpose: ANSWER_QUESTION_PURPOSE,
      promptVersion: prompt.id,
    };
    try {
      // A copy: the loop keeps appending to `messages` after this call.
      const response = await model.complete(
        { ...request, messages: [...request.messages] },
        options,
      );
      await llmCalls.record({
        ...base,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.usage.costUsd,
        latencyMs: this.clock.now() - started,
        status: 'succeeded',
      });
      return response;
    } catch (error) {
      // Tokens of a failed or aborted call are not reported by the provider: logged as 0.
      await llmCalls.record({
        ...base,
        model: model.modelName,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: this.clock.now() - started,
        status: 'failed',
      });
      throw error;
    }
  }
}
