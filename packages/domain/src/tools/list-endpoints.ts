import { z } from 'zod';
import { HTTP_METHODS, type EndpointFramework, type HttpMethod } from '../endpoints/api-endpoint';
import type { Excerpt } from '../events';
import type { EndpointCatalog } from '../ports/endpoint-catalog';
import { normalizePathPrefix } from './search-code';
import { sourceIdFor } from './source-id';
import type { CitableSource, Tool, ToolContext } from './tool';

export const LIST_ENDPOINTS_MAX = 100;

export const listEndpointsInputSchema = z
  .object({
    method: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.enum(HTTP_METHODS))
      .optional()
      .describe('Only this HTTP method, e.g. "GET" or "POST".'),
    pathContains: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe('Only routes whose path contains this text (case-insensitive), e.g. "users".'),
    pathPrefix: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Only routes declared in files under this repo-relative path, e.g. "src/admin/".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIST_ENDPOINTS_MAX)
      .default(50)
      .describe(`How many endpoints to return (1-${String(LIST_ENDPOINTS_MAX)}).`),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('How many matching endpoints to skip, to page through a long list.'),
  })
  .strict();

export type ListEndpointsInput = z.infer<typeof listEndpointsInputSchema>;

export interface ListedEndpoint {
  /** What a final answer cites for this declaration. */
  sourceId: string;
  method: HttpMethod;
  path: string;
  /** Repo-relative file that declares the route. */
  file: string;
  line: number;
  handler: string | null;
  framework: EndpointFramework;
  /** The declaration's source line, e.g. "@Get(':id')". */
  declaration: string;
}

export interface ListEndpointsOutput {
  endpoints: ListedEndpoint[];
  /** All matching endpoints; more than `endpoints.length` when the list continues. */
  total: number;
  /** Matches skipped before `endpoints` (the request's offset). */
  offset: number;
  /** How to read the result: what the scan covers, or how to see the rest. */
  note?: string;
}

const NONE_FOUND =
  'No HTTP routes were recorded for this repository. The ingest-time scan recognises ' +
  'Nest decorators, Express-style router calls (app.get, router.post, ...), FastAPI and Flask ' +
  'decorators. If the service declares routes another way, use search_code.';

const PARTIAL_PREFIXES =
  'Paths include prefixes declared in the same file (Nest @Controller, APIRouter prefix, ' +
  'Blueprint url_prefix) but not ones added elsewhere, such as app.use("/api", router) or a ' +
  'global prefix: check the app setup with search_code when the full URL matters.';

/** The HTTP API of the repository, from routes recorded at ingest. */
export class ListEndpointsTool implements Tool<ListEndpointsInput, ListEndpointsOutput> {
  readonly name = 'list_endpoints';
  readonly description =
    'List the HTTP endpoints (method, path, file, line, handler) declared in the current ' +
    'repository, recorded at ingest from Nest, Express-style, FastAPI and Flask route ' +
    'declarations. Use it for questions about the API a service exposes, then read_file the ' +
    'handlers you need to explain. Filter with method, pathContains or pathPrefix on large APIs.';
  readonly inputSchema = listEndpointsInputSchema;

  constructor(private readonly catalog: EndpointCatalog) {}

  async execute(input: ListEndpointsInput, context: ToolContext): Promise<ListEndpointsOutput> {
    const { endpoints, total } = await this.catalog.list({
      repoId: context.repoId,
      limit: input.limit,
      offset: input.offset,
      ...(input.method && { method: input.method }),
      ...(input.pathContains && { pathContains: input.pathContains }),
      ...(input.pathPrefix && { filePrefix: normalizePathPrefix(input.pathPrefix) }),
    });

    const filtered = Boolean(input.method ?? input.pathContains ?? input.pathPrefix);
    const note =
      total === 0
        ? filtered
          ? 'No recorded endpoints match these filters. Try without them.'
          : NONE_FOUND
        : input.offset + endpoints.length < total
          ? `Showing ${String(input.offset + 1)}-${String(input.offset + endpoints.length)} of ${String(total)}. Call again with offset ${String(input.offset + endpoints.length)} for the rest, or narrow with method, pathContains or pathPrefix. ${PARTIAL_PREFIXES}`
          : endpoints.length === 0
            ? `Offset ${String(input.offset)} is past the end: there are ${String(total)} matching endpoints.`
            : PARTIAL_PREFIXES;

    return {
      endpoints: endpoints.map((e) => ({
        sourceId: sourceIdFor('endpoint', `${e.filePath}:${String(e.line)}:${e.method}:${e.path}`),
        method: e.method,
        path: e.path,
        file: e.filePath,
        line: e.line,
        handler: e.handler,
        framework: e.framework,
        declaration: e.declaration,
      })),
      total,
      offset: input.offset,
      note,
    };
  }

  summarize(output: ListEndpointsOutput): string {
    const shown = output.endpoints.length;
    if (output.total === 0) return 'No endpoints found';
    if (shown === output.total) return `${String(shown)} endpoint${shown === 1 ? '' : 's'}`;
    return `${String(output.offset + 1)}-${String(output.offset + shown)} of ${String(output.total)} endpoints`;
  }

  citations(output: ListEndpointsOutput): CitableSource[] {
    return output.endpoints.map((e) => ({
      id: e.sourceId,
      path: e.file,
      startLine: e.line,
      endLine: e.line,
    }));
  }

  excerpts(output: ListEndpointsOutput): Excerpt[] {
    return output.endpoints.map((e) => ({
      path: e.file,
      startLine: e.line,
      endLine: e.line,
      text: e.declaration,
      source: 'endpoint',
    }));
  }
}
