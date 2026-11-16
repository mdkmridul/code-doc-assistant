export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ALL'] as const;

/** `ALL` is a route that answers every method (Express `app.all`, Nest `@All`). */
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * How the route was declared. `express` covers Express-style router calls,
 * which Fastify, Koa Router and Hono share.
 */
export type EndpointFramework = 'nest' | 'express' | 'fastapi' | 'flask';

/** An HTTP route declared in one file, found by the ingest-time scan. */
export interface ApiEndpoint {
  method: HttpMethod;
  /**
   * The route path as declared, joined with a prefix declared in the same file
   * (Nest `@Controller`, FastAPI `APIRouter(prefix=)`, Flask `Blueprint(url_prefix=)`).
   * Prefixes added elsewhere (`app.use('/api', router)`, a global prefix) are not included.
   */
  path: string;
  framework: EndpointFramework;
  /** 1-based line of the declaration (decorator or router call). */
  line: number;
  /** The function or method that handles it, when it is named. */
  handler: string | null;
  /** The declaration's source line, trimmed. */
  declaration: string;
}

/** An endpoint and the repo-relative file that declares it. */
export interface StoredEndpoint extends ApiEndpoint {
  filePath: string;
}
