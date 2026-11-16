import type { z } from 'zod';

/** Facts a tool gets from the conversation, never from the model's arguments. */
export interface ToolContext {
  /** The repository the conversation is about. */
  repoId: string;
}

/**
 * A capability the assistant can call. `inputSchema` validates the model's
 * arguments (and later becomes the JSON schema the model sees), so `execute`
 * only ever receives parsed, typed input.
 */
export interface Tool<TInput, TOutput> {
  /** snake_case, unique across tools; the name the model calls. */
  readonly name: string;
  /** Tells the model when and how to use the tool. */
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

/** The model (or a caller) sent arguments that do not match the tool's schema. */
export class ToolInputError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid input for ${toolName}: ${issues.join('; ')}`);
    this.name = 'ToolInputError';
  }
}

/** Validates untrusted arguments against the tool's schema, then runs it. */
export async function invokeTool<TInput, TOutput>(
  tool: Tool<TInput, TOutput>,
  rawInput: unknown,
  context: ToolContext,
): Promise<TOutput> {
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolInputError(
      tool.name,
      parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      ),
    );
  }
  return tool.execute(parsed.data, context);
}
