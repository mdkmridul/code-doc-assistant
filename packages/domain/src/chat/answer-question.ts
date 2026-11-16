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
import type { CitableSource } from '../tools/tool';
import type { ToolExecution, ToolRegistry } from '../tools/tool-registry';
import { resolveCitations } from './citations';
import { CITATIONS_OPEN, parseFinalAnswer, validateCitations } from './final-answer';
import { ContextBudget, type Admission, type ContextBudgetLimits } from './context-budget';
import { SessionNotFoundError } from './errors';
import type { LoopOutcome, LoopPolicy, LoopState } from './loop-policy';
import type { SystemPrompt } from './system-prompt';

export const ANSWER_QUESTION_PURPOSE = 'answer_question';

/** Appended before the final allowed call; the model then answers without tools. */
export const ITERATION_CAP_NOTE =
  'You have reached the tool-call limit for this question, so tools are now disabled. ' +
  'Answer now using only what you have already found. Say plainly what you could not verify.';

/** Appended before the final call when the context budget refused a tool result. */
export const CONTEXT_BUDGET_NOTE =
  'The context budget for tool results on this question is used up, so tools are now disabled. ' +
  'Answer now using only what you have already found. Say plainly what you could not verify.';

const TOKEN_BUDGET_ANSWER =
  'I ran out of my budget for this question before I could finish researching it. ' +
  'Try asking something narrower, for example about one feature or one directory.';

const REFUSAL_ANSWER = 'I can’t help with that request.';

/**
 * The answer when the repository doesn't support one: the model said so
 * (`found: false`), or it still cited nothing valid after one rewrite.
 */
export const NOT_FOUND_ANSWER =
  'I couldn’t find this in the repository, so I can’t answer it from the code. ' +
  'If you expected it to be here, try naming a file, function or feature, or ask about ' +
  'another part of the codebase.';

/** Sent before the one rewrite a final answer gets when its citations don't check out. */
export const rewriteNote = (problem: string): string =>
  `Your answer can't be accepted: ${problem}. Rewrite it now, without tools. Give the answer ` +
  `text, then end with the ${CITATIONS_OPEN} block, citing the sourceIds of tool results from ` +
  'this question that support it. If the repository does not contain the answer, set ' +
  '"found": false instead.';

type AnswerCheck =
  | { kind: 'ok'; text: string; citations: Citation[]; rejected: string[] }
  | { kind: 'not_found' }
  | { kind: 'rewrite'; problem: string };

/** Parses a final answer and validates its citations against this turn's sources. */
function checkAnswer(raw: string, sources: ReadonlyMap<string, CitableSource>): AnswerCheck {
  const parsed = parseFinalAnswer(raw);
  if (!parsed.ok) return { kind: 'rewrite', problem: parsed.problem };
  if (!parsed.meta.found) return { kind: 'not_found' };
  const { citations, rejected } = validateCitations(parsed.meta, sources);
  if (citations.length > 0) return { kind: 'ok', text: parsed.text, citations, rejected };
  return {
    kind: 'rewrite',
    problem:
      parsed.meta.citations.length === 0
        ? '"found" is true but it cites no sources'
        : `none of its citations matches a tool result from this question (${rejected.join('; ')})`,
  };
}

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
  /** Limits of the ContextBudget each question gets for its tool results. */
  contextBudget: ContextBudgetLimits;
  clock?: { now(): number };
}

/** A tool call's result after the context budget has had its say. */
interface ToolOutcome {
  result: ToolResult;
  trace: ToolCallTrace;
  citations: CitableSource[];
}

/** Keep only the locations whose file still appears in a truncated result. */
const visibleIn = <T extends { path: string }>(items: T[], content: string): T[] =>
  items.filter((item) => content.includes(item.path));

const roughTokens = (tokens: number) =>
  tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);

/**
 * What the model, the trace and the citation check get for one tool call:
 * a refused result shows nothing (no excerpts, nothing citable); a truncated
 * one keeps only the locations still visible in what the model saw.
 */
function toolOutcome(
  id: string,
  name: string,
  input: unknown,
  execution: ToolExecution,
  admission: Admission,
): ToolOutcome {
  const base = { name, input };
  if (!admission.admitted) {
    return {
      result: { toolCallId: id, content: admission.content, isError: true },
      trace: {
        ...base,
        isError: true,
        summary: `Not added: over the context budget (~${roughTokens(admission.tokens)} tokens, ${roughTokens(admission.remaining)} left)`,
        excerpts: [],
        tokens: 0,
      },
      citations: [],
    };
  }
  if (!execution.ok) {
    return {
      result: { toolCallId: id, content: admission.content, isError: true },
      trace: { ...base, isError: true, summary: execution.error, excerpts: [], tokens: admission.tokens },
      citations: [],
    };
  }
  const shown = admission.content;
  return {
    result: { toolCallId: id, content: shown, isError: false },
    trace: {
      ...base,
      isError: false,
      summary: admission.truncated
        ? `${execution.summary} · truncated to ~${roughTokens(admission.tokens)} tokens`
        : execution.summary,
      excerpts: admission.truncated ? visibleIn(execution.excerpts, shown) : execution.excerpts,
      tokens: admission.tokens,
    },
    citations: admission.truncated ? visibleIn(execution.citations, shown) : execution.citations,
  };
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

    const state: LoopState = { iterations: 0, tokensUsed: 0, contextExhausted: false };
    const budget = new ContextBudget(this.deps.contextBudget);
    const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const traces: ToolCallTrace[] = [];
    /** Everything the tools showed the model this turn, by sourceId: what an answer may cite. */
    const retrieved: CitableSource[] = [];
    let answer: string;
    let outcome: LoopOutcome;
    let last: ModelResponse | undefined;

    /** One model call, counted against the limits. Null when the caller aborted it. */
    const call = async (allowToolCalls: boolean): Promise<ModelResponse | null> => {
      const iteration = state.iterations + 1;
      let response: ModelResponse;
      try {
        response = await this.callModel(
          sessionId,
          { system, messages, tools: toolDefinitions, allowToolCalls },
          { signal, onTextDelta: (text) => emit({ type: 'token', iteration, text }) },
        );
      } catch (error) {
        // An abort surfaces as whatever error the provider throws; the signal says why.
        if (!signal?.aborted) throw error;
        state.iterations = iteration;
        return null;
      }
      state.iterations = iteration;
      state.tokensUsed += response.usage.inputTokens + response.usage.outputTokens;
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      // llm_calls.cost_usd keeps 6 decimals; round so sums carry no float noise.
      usage.costUsd = roundUsd(usage.costUsd + response.usage.costUsd);
      last = response;
      return response;
    };

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
        messages.push({
          role: 'system_note',
          content: budget.exhausted ? CONTEXT_BUDGET_NOTE : ITERATION_CAP_NOTE,
        });
      }

      const iteration = state.iterations + 1;
      const response = await call(step === 'call');
      if (!response) {
        outcome = 'cancelled';
        answer = CANCELLED_ANSWER;
        break;
      }
      answer = response.text;

      if (response.stopReason === 'refusal') {
        outcome = 'refused';
        answer = answer.trim() === '' ? REFUSAL_ANSWER : answer;
        break;
      }
      if (step === 'final_call') {
        outcome = budget.exhausted ? 'context_budget' : 'iteration_cap';
        break;
      }
      if (response.stopReason === 'max_tokens') {
        // Tool calls cut off mid-input must not run. The text is kept as is,
        // minus any half-written citation block.
        outcome = 'truncated';
        answer = parseFinalAnswer(answer).text;
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
      const outcomes = await this.runTools(response, iteration, session.repoId, budget, emit);
      for (const { trace, citations } of outcomes) {
        traces.push(trace);
        retrieved.push(...citations);
      }
      messages.push({ role: 'tool_results', results: outcomes.map((o) => o.result) });
      state.contextExhausted = budget.exhausted;
    }

    // A final answer must parse and cite this turn's sources. One rewrite, then not found.
    let citations: Citation[] = [];
    let rejected: string[] = [];
    if (outcome === 'completed' || outcome === 'iteration_cap' || outcome === 'context_budget') {
      const sources = new Map(retrieved.map((source) => [source.id, source]));
      let check = checkAnswer(answer, sources);
      if (check.kind === 'rewrite' && last) {
        messages.push({ role: 'assistant', text: last.text, toolCalls: [], providerContent: last.providerContent });
        messages.push({ role: 'system_note', content: rewriteNote(check.problem) });
        const rewrite = signal?.aborted ? null : await call(false);
        if (!rewrite) {
          outcome = 'cancelled';
          answer = CANCELLED_ANSWER;
        } else if (rewrite.stopReason === 'refusal') {
          outcome = 'refused';
          answer = rewrite.text.trim() === '' ? REFUSAL_ANSWER : parseFinalAnswer(rewrite.text).text;
        } else {
          check = checkAnswer(rewrite.text, sources);
        }
      }
      if (outcome !== 'cancelled' && outcome !== 'refused') {
        if (check.kind === 'ok') {
          answer = check.text;
          citations = check.citations;
          rejected = check.rejected;
        } else {
          outcome = 'not_found';
          answer = NOT_FOUND_ANSWER;
        }
      }
    }

    // Inline path:line references the answer text makes but no retrieved code backs.
    const unverifiedReferences =
      outcome === 'not_found'
        ? []
        : [...resolveCitations(answer, retrieved).unverifiedReferences, ...rejected];
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
      usage: { ...usage, contextTokens: budget.spent },
    };
    emit({ type: 'done', result });
    return result;
  }

  /**
   * Runs one turn's tool calls in parallel; every call gets exactly one result,
   * returned in call order. All `tool_call` events go out before the tools
   * start, each `tool_result` as its tool finishes. Every result passes through
   * the context budget as it arrives: it may be truncated, or refused whole.
   */
  private async runTools(
    response: ModelResponse,
    iteration: number,
    repoId: string,
    budget: ContextBudget,
    emit: (event: ChatStreamEvent) => void,
  ): Promise<ToolOutcome[]> {
    for (const call of response.toolCalls) {
      emit({ type: 'tool_call', iteration, id: call.id, name: call.name, input: call.input });
    }
    return Promise.all(
      response.toolCalls.map(async (call) => {
        const execution = await this.deps.tools.execute(call.name, call.input, { repoId });
        const admission = budget.admit(
          execution.ok ? JSON.stringify(execution.output) : execution.error,
        );
        const outcome = toolOutcome(call.id, call.name, call.input, execution, admission);
        emit({
          type: 'tool_result',
          iteration,
          id: call.id,
          name: call.name,
          isError: outcome.trace.isError,
          summary: outcome.trace.summary ?? '',
          excerpts: outcome.trace.excerpts ?? [],
        });
        return outcome;
      }),
    );
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
