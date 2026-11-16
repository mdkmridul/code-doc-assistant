import { Logger, OnModuleInit } from '@nestjs/common';
import { EmbeddingError, type Embedder } from '@cda/domain';
import { z } from 'zod';

export const NOMIC_MODEL = 'nomic-embed-text';
/** nomic-embed-text v1.5 output size. Must match `vector(768)` (ADR 0009). */
export const NOMIC_DIMENSIONS = 768;

/** nomic-embed-text is trained with these task prefixes; omitting them hurts retrieval. */
const TASK_PREFIX = {
  document: 'search_document: ',
  query: 'search_query: ',
} as const;

const embedResponse = z.object({ embeddings: z.array(z.array(z.number())) });
const versionResponse = z.object({ version: z.string() });

export interface OllamaEmbedderOptions {
  /** e.g. http://localhost:11434 */
  baseUrl: string;
  /** `document` when indexing chunks, `query` when embedding a question. */
  inputType?: keyof typeof TASK_PREFIX;
  /** Inputs per request. Small, because a CPU embeds a batch in one go. */
  maxBatchSize?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Embeds text with nomic-embed-text served by a local Ollama. On boot it
 * checks that Ollama is reachable and the model is pulled, so a missing model
 * fails the API at startup instead of every ingest later.
 */
export class OllamaEmbedder implements Embedder, OnModuleInit {
  readonly dimensions = NOMIC_DIMENSIONS;
  readonly maxBatchSize: number;
  private readonly logger = new Logger(OllamaEmbedder.name);
  private readonly baseUrl: string;
  private readonly prefix: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: OllamaEmbedderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.prefix = TASK_PREFIX[options.inputType ?? 'document'];
    this.maxBatchSize = options.maxBatchSize ?? 32;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async onModuleInit(): Promise<void> {
    let version: string;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/version`, {
        signal: AbortSignal.timeout(5_000),
      });
      version = versionResponse.parse(await res.json()).version;
    } catch (error) {
      throw new Error(
        `Cannot reach Ollama at ${this.baseUrl}. Start it with \`docker compose up -d\`.`,
        { cause: error },
      );
    }

    const show = await this.fetchFn(`${this.baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: NOMIC_MODEL }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!show.ok) {
      throw new Error(
        `Ollama at ${this.baseUrl} does not have ${NOMIC_MODEL}. ` +
          'Pull it with `docker compose up ollama-pull`.',
      );
    }
    this.logger.log(`Connected to Ollama ${version} (${NOMIC_MODEL})`);
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: NOMIC_MODEL,
          input: texts.map((text) => this.prefix + text),
          // Ollama's nomic-embed-text build has a 2048-token context. Longer
          // inputs are cut rather than rejected; 60-line chunks rarely get close.
          truncate: true,
          keep_alive: '10m',
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Connection refused (Ollama restarting) or timeout: worth retrying.
      throw new EmbeddingError(
        `Ollama request failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => '')).slice(0, 500);
      // 404 = model not pulled, 400 = bad request: retrying will not help.
      const retryable = response.status === 429 || response.status >= 500;
      throw new EmbeddingError(
        `Ollama returned HTTP ${response.status}: ${body}`,
        retryable,
      );
    }

    const parsed = embedResponse.safeParse(await response.json());
    if (!parsed.success) {
      throw new EmbeddingError(
        `Unexpected Ollama response: ${parsed.error.message}`,
        false,
      );
    }
    return parsed.data.embeddings;
  }
}
