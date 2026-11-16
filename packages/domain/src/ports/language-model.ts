/** What the model sees of a tool: the name, when to use it, and a JSON Schema for its input. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12) of the tool's input object. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  /** Provider-issued id; the matching result must echo it. */
  id: string;
  name: string;
  /** Untrusted model output: validate before use (invokeTool does). */
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  /** What the model reads back, usually JSON. */
  content: string;
  isError: boolean;
}

/**
 * One entry of the conversation sent to the model. Provider-neutral: the
 * adapter maps it to the provider's wire format.
 */
export type ConversationMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /**
       * The provider's raw content for this turn (e.g. Anthropic content blocks
       * including thinking). When present, the adapter must replay it verbatim:
       * some providers reject altered reasoning blocks. Absent for turns
       * rebuilt from storage, which are replayed as plain text.
       */
      providerContent?: unknown;
    }
  | { role: 'tool_results'; results: ToolResult[] }
  /** An operator note appended mid-conversation, e.g. "answer now, tools are off". */
  | { role: 'system_note'; content: string };

export interface ModelRequest {
  system: string;
  messages: ConversationMessage[];
  /** Always the same list within a conversation, even when tools are disabled. */
  tools: ToolDefinition[];
  /** False forces a text answer (tools stay declared, but cannot be called). */
  allowToolCalls: boolean;
}

export type ModelStopReason =
  /** Finished its turn. */
  | 'end'
  /** Wants the returned tool calls executed. */
  | 'tool_use'
  /** Ran out of output tokens. */
  | 'max_tokens'
  /** Declined for safety reasons (after any provider-side fallback). */
  | 'refusal'
  | 'other';

export interface ModelUsage {
  /** All input tokens, including cache reads and writes. */
  inputTokens: number;
  outputTokens: number;
  /** Price of this call in US dollars. */
  costUsd: number;
}

export interface ModelResponse {
  /** The model that produced the response (may differ from the requested one after a fallback). */
  model: string;
  text: string;
  toolCalls: ToolCall[];
  stopReason: ModelStopReason;
  usage: ModelUsage;
  /** Opaque provider content to replay verbatim in the next request of this loop. */
  providerContent: unknown;
}

/** A chat model that can call tools. Implemented in infrastructure (Anthropic). */
export interface LanguageModel {
  /** The model requested by default, for logging failed calls. */
  readonly modelName: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}
