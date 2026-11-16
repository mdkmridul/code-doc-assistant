import type { SourceFile } from '../source-file';
import type { ApiEndpoint, EndpointFramework, HttpMethod } from './api-endpoint';

/**
 * Finds HTTP routes declared in a file with the common decorators and router
 * calls of Nest, Express (and Express-style routers), FastAPI and Flask.
 *
 * A lexical scan, not a parser (ADR 0016): it reads route declarations the way
 * people usually write them and ignores the rest. Paths built at run time
 * (variables, template strings with `${}`) are skipped rather than guessed.
 * Test files are skipped (their mock servers are not the service's API), and
 * so are declarations on comment lines (examples in docs).
 */
export function extractEndpoints(file: SourceFile): ApiEndpoint[] {
  if (isTestFile(file.path)) return [];
  let endpoints: ApiEndpoint[] = [];
  if (file.language === 'python') {
    endpoints = extractPython(file.content);
  } else if (JS_LANGUAGES.has(file.language)) {
    const comments = commentLines(file.content);
    endpoints = [...extractNest(file.content), ...extractExpress(file.content)].filter(
      (e) => !comments.has(e.line),
    );
  }
  return dedupe(endpoints)
    .filter((e) => !COMMENT_LINE.test(e.declaration))
    .sort((a, b) => a.line - b.line || a.method.localeCompare(b.method));
}

/**
 * Lines that start inside a JS comment (block or line). A small scanner that
 * skips string and template literals, so "src/**\/*.ts" doesn't open a comment.
 * Approximate around regex literals, which are rare where routes are declared.
 */
function commentLines(content: string): Set<number> {
  const lines = new Set<number>();
  let line = 1;
  let i = 0;
  const n = content.length;
  const skipTo = (end: number) => {
    for (; i < end && i < n; i++) if (content.charCodeAt(i) === 10) line++;
  };
  while (i < n) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === '\n') {
      line++;
      i++;
    } else if (ch === '/' && next === '*') {
      const close = content.indexOf('*/', i + 2);
      const end = close === -1 ? n : close + 2;
      const first = line;
      skipTo(end);
      for (let l = first; l <= line; l++) lines.add(l);
    } else if (ch === '/' && next === '/') {
      lines.add(line);
      const end = content.indexOf('\n', i);
      i = end === -1 ? n : end;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && content[j] !== ch) {
        if (content[j] === '\\') j++;
        else if (ch !== '`' && content[j] === '\n') break; // unterminated: stop at the line end
        j++;
      }
      skipTo(j + 1);
    } else {
      i++;
    }
  }
  return lines;
}

/** Test directories and test file names in the JS and Python ecosystems. */
const TEST_DIR = /(^|\/)(tests?|__tests__|specs?|e2e|fixtures?|__mocks__)\//i;
const TEST_FILE = /(\.(test|spec|e2e-spec|int-spec)\.[cm]?[jt]sx?$)|((^|\/)(test_[^/]*|[^/]*_test|conftest)\.py$)/i;

export const isTestFile = (path: string): boolean => TEST_DIR.test(path) || TEST_FILE.test(path);

/** JSDoc, block and line comments (a declaration line starting with one is an example). */
const COMMENT_LINE = /^(\*|\/\*|\/\/|#)/;

const JS_LANGUAGES = new Set(['typescript', 'javascript']);

/** Longest declaration line kept; minified code has very long lines. */
const DECLARATION_MAX_CHARS = 200;

/**
 * A single-line quoted string literal ('…', "…" or `…`). `quote` is the number
 * of its capture group for the quote character; the value is group `quote + 1`.
 */
const str = (quote: number) =>
  // Disjoint alternatives (plain char | escape | the other quotes), so no backtracking blow-up.
  String.raw`(['"\x60])((?:[^\\\n'"\x60]|\\.|(?!\Q)['"\x60])*)\Q`.replaceAll(
    '\\Q',
    `\\${String(quote)}`,
  );

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

class Lines {
  private readonly starts: number[] = [0];
  readonly all: string[];

  constructor(readonly content: string) {
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
    this.all = content.split('\n');
  }

  /** 1-based line containing character `index`. */
  lineAt(index: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.starts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  text(line: number): string {
    const text = (this.all[line - 1] ?? '').trim();
    return text.length > DECLARATION_MAX_CHARS ? `${text.slice(0, DECLARATION_MAX_CHARS)}…` : text;
  }

  /**
   * Group 1 of `pattern` on the first code line after the decorator at `line`
   * (within `window` lines), skipping other decorators, including multi-line ones.
   */
  findAfter(line: number, pattern: RegExp, window = 20): string | null {
    // Open parentheses of the decorator being skipped (the one at `line` included).
    let depth = parenDepth(this.all[line - 1] ?? '');
    for (let n = line + 1; n <= Math.min(line + window, this.all.length); n++) {
      const text = this.all[n - 1].trim();
      if (depth > 0 || text.startsWith('@')) {
        depth = Math.max(0, depth + parenDepth(text));
        continue;
      }
      if (text === '' || text.startsWith('//') || text.startsWith('#')) continue;
      return pattern.exec(text)?.[1] ?? null;
    }
    return null;
  }
}

/** "(" minus ")" on a line; a rough count, enough to skip decorator arguments. */
function parenDepth(text: string): number {
  let depth = 0;
  for (const ch of text) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
  }
  return depth;
}

/** Template literals with `${}` are built at run time: not a static path. */
const isStatic = (value: string) => !value.includes('${');

/** Joins a prefix and a sub-path into "/prefix/sub" (no trailing slash, "/" for empty). */
export function joinRoute(prefix: string, path: string): string {
  const parts = [prefix, path]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '');
  return `/${parts.join('/')}`;
}

function dedupe(endpoints: ApiEndpoint[]): ApiEndpoint[] {
  const seen = new Set<string>();
  return endpoints.filter((e) => {
    const key = `${e.method} ${e.path} ${String(e.line)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const upper = (method: string) => method.toUpperCase() as HttpMethod;

// ---------------------------------------------------------------------------
// Nest: @Controller('prefix') + @Get(':id') / @Post() / ...
// ---------------------------------------------------------------------------

const NEST_DECORATOR = new RegExp(
  String.raw`@(Controller|Get|Post|Put|Patch|Delete|Head|Options|All)\(\s*(?:${str(2)}|\{[^}]*?\bpath\s*:\s*${str(4)}[^}]*\}|\[\s*${str(6)})?`,
  'g',
);
const TS_METHOD_NAME = /^(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/;

function extractNest(content: string): ApiEndpoint[] {
  if (!content.includes('@Controller')) return [];
  const lines = new Lines(content);
  const endpoints: ApiEndpoint[] = [];
  let prefix = '';

  for (const match of content.matchAll(NEST_DECORATOR)) {
    const [, decorator] = match;
    // The first argument: a string, { path: string } or [string, ...]. Groups
    // that did not take part are undefined at run time (the type says string).
    const groups: (string | undefined)[] = [match[3], match[5], match[7]];
    const raw = groups.find((group) => group !== undefined);
    if (raw !== undefined && !isStatic(raw)) continue;
    const value = raw ?? '';
    if (decorator === 'Controller') {
      prefix = value;
      continue;
    }
    const line = lines.lineAt(match.index);
    endpoints.push({
      method: upper(decorator),
      path: joinRoute(prefix, value),
      framework: 'nest',
      line,
      handler: lines.findAfter(line, TS_METHOD_NAME),
      declaration: lines.text(line),
    });
  }
  return endpoints;
}

// ---------------------------------------------------------------------------
// Express-style: app.get('/x', ...), router.post('/x', ...), app.route('/x').get(...)
// ---------------------------------------------------------------------------

/** Receivers that are routers in practice; `axios.get('/x')` or `cache.get('/x')` are not. */
const ROUTER_RECEIVER = String.raw`(?:app|router|server|api|routes?|fastify|[A-Za-z_$][\w$]*Router)`;
const EXPRESS_METHODS = 'get|post|put|patch|delete|options|head|all';

const EXPRESS_CALL = new RegExp(
  String.raw`(?<![\w$])${ROUTER_RECEIVER}\s*\.\s*(${EXPRESS_METHODS})\s*\(\s*${str(2)}`,
  'g',
);
const EXPRESS_ROUTE = new RegExp(
  String.raw`(?<![\w$])${ROUTER_RECEIVER}\s*\.\s*route\s*\(\s*${str(1)}\s*\)`,
  'g',
);
const CHAINED_METHOD = new RegExp(String.raw`^\s*\.\s*(${EXPRESS_METHODS})\s*\(`);
/** A named handler as the last argument: `, controller.list)` or `, auth, list)`. */
const NAMED_HANDLER = /^\s*(?:,\s*[\w$.]+\s*)*,\s*([\w$]+(?:\.[\w$]+)*)\s*,?\s*\)/;

const isRoutePath = (path: string) => path.startsWith('/') || path === '*';

function extractExpress(content: string): ApiEndpoint[] {
  const lines = new Lines(content);
  const endpoints: ApiEndpoint[] = [];
  const at = (method: string, path: string, index: number, handler: string | null) => {
    const line = lines.lineAt(index);
    endpoints.push({
      method: upper(method),
      path,
      framework: 'express' satisfies EndpointFramework,
      line,
      handler,
      declaration: lines.text(line),
    });
  };

  for (const match of content.matchAll(EXPRESS_CALL)) {
    const [whole, method, , path] = match;
    if (!isStatic(path) || !isRoutePath(path)) continue;
    const rest = content.slice(match.index + whole.length, match.index + whole.length + 300);
    at(method, path, match.index, NAMED_HANDLER.exec(rest)?.[1] ?? null);
  }

  for (const match of content.matchAll(EXPRESS_ROUTE)) {
    const [whole, , path] = match;
    if (!isStatic(path) || !isRoutePath(path)) continue;
    // Follow the chain: .get(...).post(...); arguments may hold nested parentheses.
    let index = match.index + whole.length;
    for (;;) {
      const method = CHAINED_METHOD.exec(content.slice(index, index + 200));
      if (!method) break;
      const open = content.indexOf('(', index);
      const close = matchingParen(content, open);
      if (close === -1) break;
      const args = content.slice(open + 1, close);
      const handler = /(?:^|,)\s*([\w$]+(?:\.[\w$]+)*)\s*,?\s*$/.exec(args)?.[1] ?? null;
      at(method[1], path, index + method[0].indexOf('.'), handler);
      index = close + 1;
    }
  }
  return endpoints;
}

/** Index of the parenthesis closing the one at `open`, skipping strings. -1 if none. */
function matchingParen(content: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// FastAPI and Flask: @app.get("/x"), @router.post("/x"), @bp.route("/x", methods=[...])
// ---------------------------------------------------------------------------

const PY_DECORATOR = new RegExp(
  String.raw`^[ \t]*@[ \t]*([A-Za-z_]\w*)\.(get|post|put|patch|delete|head|options|route|api_route)\(\s*${str(3)}([^)]*)\)`,
  'gm',
);
/** `router = APIRouter(prefix="/items")`, `bp = Blueprint("x", __name__, url_prefix="/x")`. */
const PY_ROUTER = new RegExp(
  String.raw`^[ \t]*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=\s*(?:\w+\.)?(APIRouter|Blueprint)\(([^)]*)\)`,
  'gm',
);
const PY_PREFIX = new RegExp(String.raw`\b(?:url_)?prefix\s*=\s*${str(1)}`);
/** The decorator match stops at the first ")", so a tuple's closing paren may be cut off. */
const PY_METHODS = /\bmethods\s*=\s*[[({]([^\])}]*)/;
const PY_DEF = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/;

function pythonFramework(content: string): EndpointFramework | null {
  if (/^\s*(?:from|import)\s+fastapi\b/m.test(content)) return 'fastapi';
  if (/^\s*(?:from|import)\s+flask\b/m.test(content)) return 'flask';
  return null;
}

function extractPython(content: string): ApiEndpoint[] {
  const framework = pythonFramework(content);
  if (!framework) return [];
  const lines = new Lines(content);

  const prefixes = new Map<string, string>();
  for (const [, name, , args] of content.matchAll(PY_ROUTER)) {
    const prefix = PY_PREFIX.exec(args)?.[2];
    if (prefix !== undefined) prefixes.set(name, prefix);
  }

  const endpoints: ApiEndpoint[] = [];
  for (const match of content.matchAll(PY_DECORATOR)) {
    const [, receiver, kind, , path, rest] = match;
    if (!path.startsWith('/') && path !== '') continue;
    const methods =
      kind === 'route' || kind === 'api_route'
        ? (PY_METHODS.exec(rest)?.[1]
            .match(/['"]([A-Za-z]+)['"]/g)
            ?.map((m) => m.slice(1, -1).toUpperCase()) ?? ['GET'])
        : [kind.toUpperCase()];
    const line = lines.lineAt(match.index + match[0].indexOf('@'));
    for (const method of methods) {
      endpoints.push({
        method: upper(method),
        path: joinRoute(prefixes.get(receiver) ?? '', path),
        framework,
        line,
        handler: lines.findAfter(line, PY_DEF),
        declaration: lines.text(line),
      });
    }
  }
  return endpoints;
}
