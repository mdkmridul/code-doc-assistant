/**
 * A versioned system prompt loaded from `prompts/<name>/<version>.md`.
 * The text may contain `{{placeholders}}` filled per session.
 */
export class SystemPrompt {
  constructor(
    readonly name: string,
    readonly version: string,
    private readonly template: string,
  ) {}

  /** Recorded on every LLM call, e.g. `answer-question@v1`. */
  get id(): string {
    return `${this.name}@${this.version}`;
  }

  /** Fills every `{{key}}`. Throws on a missing value so no prompt ships half-rendered. */
  render(values: Readonly<Partial<Record<string, string>>>): string {
    return this.template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`System prompt ${this.id} needs a value for {{${key}}}`);
      }
      return value;
    });
  }
}
