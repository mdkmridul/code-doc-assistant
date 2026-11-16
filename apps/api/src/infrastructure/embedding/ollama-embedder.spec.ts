import { EmbeddingError } from '@cda/domain';
import { OllamaEmbedder } from './ollama-embedder';

type FetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

/** The URL a fetch call was made to, whatever form the input took. */
const urlOf = (input: Parameters<typeof fetch>[0]) =>
  input instanceof Request ? input.url : input.toString();

const respond = (status: number, body: unknown): FetchMock =>
  jest.fn<Promise<Response>, Parameters<typeof fetch>>(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    ),
  );

const embedder = (fetchFn: typeof fetch, inputType?: 'document' | 'query') =>
  new OllamaEmbedder({
    baseUrl: 'http://ollama:11434/',
    inputType,
    fetchFn,
  });

describe('OllamaEmbedder', () => {
  it('sends prefixed inputs to /api/embed and returns the vectors', async () => {
    const fetchFn = respond(200, { embeddings: [[0.1], [0.2]] });

    const vectors = await embedder(fetchFn).embed(['a', 'b']);

    expect(vectors).toEqual([[0.1], [0.2]]);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://ollama:11434/api/embed');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: 'nomic-embed-text',
      input: ['search_document: a', 'search_document: b'],
      truncate: true,
    });
  });

  it('uses the query prefix for search queries', async () => {
    const fetchFn = respond(200, { embeddings: [[0.1]] });

    await embedder(fetchFn, 'query').embed(['how is auth done?']);

    const body = JSON.parse(fetchFn.mock.calls[0][1]?.body as string) as {
      input: string[];
    };
    expect(body.input).toEqual(['search_query: how is auth done?']);
  });

  it('makes no request for an empty input', async () => {
    const fetchFn = respond(200, { embeddings: [] });
    expect(await embedder(fetchFn).embed([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('marks connection failures and server errors retryable', async () => {
    const down = jest.fn(() => Promise.reject(new TypeError('fetch failed')));
    for (const fetchFn of [down, respond(500, 'oom'), respond(503, 'busy')]) {
      const error = await embedder(fetchFn)
        .embed(['a'])
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EmbeddingError);
      expect(error).toMatchObject({ retryable: true });
    }
  });

  it('marks a missing model or bad request permanent', async () => {
    for (const status of [400, 404]) {
      const error = await embedder(respond(status, 'model not found'))
        .embed(['a'])
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ retryable: false });
    }
  });

  describe('onModuleInit', () => {
    it('passes when Ollama is up and the model is pulled', async () => {
      const fetchFn: FetchMock = jest.fn((url) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              urlOf(url).endsWith('/api/version') ? { version: '0.40.16' } : {},
            ),
          ),
        ),
      );
      await expect(embedder(fetchFn).onModuleInit()).resolves.toBeUndefined();
    });

    it('fails fast with a fix when Ollama is unreachable', async () => {
      const fetchFn = jest.fn(() =>
        Promise.reject(new TypeError('ECONNREFUSED')),
      );
      await expect(embedder(fetchFn).onModuleInit()).rejects.toThrow(
        /Cannot reach Ollama.*docker compose up -d/,
      );
    });

    it('fails fast with a fix when the model is not pulled', async () => {
      const fetchFn: FetchMock = jest.fn((url) =>
        Promise.resolve(
          urlOf(url).endsWith('/api/version')
            ? new Response(JSON.stringify({ version: '0.40.16' }))
            : new Response('not found', { status: 404 }),
        ),
      );
      await expect(embedder(fetchFn).onModuleInit()).rejects.toThrow(
        /does not have nomic-embed-text.*ollama-pull/,
      );
    });
  });
});
