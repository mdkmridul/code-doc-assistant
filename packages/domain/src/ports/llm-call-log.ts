/** One model request, for cost and latency accounting (table `llm_calls`). */
export interface LlmCallRecord {
  sessionId: string | null;
  /** Why the call was made, e.g. `answer_question`. */
  purpose: string;
  model: string;
  /** e.g. `answer-question@v1`. */
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: 'succeeded' | 'failed';
}

export interface LlmCallLog {
  record(call: LlmCallRecord): Promise<void>;
}
