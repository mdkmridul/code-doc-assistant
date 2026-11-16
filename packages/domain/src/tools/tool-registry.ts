import { z } from 'zod';
import type { Citation } from '../ports/chat-store';
import type { ToolDefinition } from '../ports/language-model';
import { invokeTool, ToolInputError, type Tool, type ToolContext } from './tool';

/**
 * Any tool, whatever its input and output types. Parameters are `never` so
 * every concrete Tool<I, O> is assignable; calls go through invokeTool, which
 * parses input with the tool's own schema first.
 */
export interface AnyTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  execute(input: never, context: ToolContext): Promise<unknown>;
  citations?(output: never): Citation[];
}

export type ToolExecution =
  | { ok: true; output: unknown; citations: Citation[] }
  | { ok: false; error: string };

/**
 * The tools available to the assistant. Turns them into model-facing
 * definitions and runs the model's calls, converting every failure into an
 * error result the model can read and recover from.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown, unknown>>();

  constructor(tools: readonly AnyTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}`);
      }
      // Sound: invokeTool parses input with this tool's own schema before execute.
      this.tools.set(tool.name, tool);
    }
  }

  /** Deterministic order (by name), so the request prefix stays byte-identical. */
  definitions(): ToolDefinition[] {
    return [...this.tools.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        // `input` describes what callers may send (defaults make fields optional).
        inputSchema: z.toJSONSchema(tool.inputSchema, { io: 'input' }),
      }));
  }

  async execute(name: string, rawInput: unknown, context: ToolContext): Promise<ToolExecution> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        error: `Unknown tool "${name}". Available: ${[...this.tools.keys()].join(', ')}`,
      };
    }
    try {
      const output = await invokeTool(tool, rawInput, context);
      return { ok: true, output, citations: tool.citations?.(output) ?? [] };
    } catch (error) {
      if (error instanceof ToolInputError) return { ok: false, error: error.message };
      return {
        ok: false,
        error: `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
