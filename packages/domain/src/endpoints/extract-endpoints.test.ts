import { describe, expect, it } from 'vitest';
import type { ApiEndpoint } from './api-endpoint';
import { extractEndpoints, joinRoute } from './extract-endpoints';

const ts = (content: string) => extractEndpoints({ path: 'src/x.ts', language: 'typescript', content });
const js = (content: string) => extractEndpoints({ path: 'src/x.js', language: 'javascript', content });
const py = (content: string) => extractEndpoints({ path: 'app/x.py', language: 'python', content });

/** method, path, line and handler: the facts most tests check. */
const brief = (endpoints: ApiEndpoint[]) =>
  endpoints.map((e) => `${e.method} ${e.path} @${String(e.line)} ${e.handler ?? '-'}`);

describe('joinRoute', () => {
  it('joins a prefix and a path with single slashes', () => {
    expect(joinRoute('repos', ':id')).toBe('/repos/:id');
    expect(joinRoute('/api/', '/users/')).toBe('/api/users');
    expect(joinRoute('', '')).toBe('/');
    expect(joinRoute('items', '')).toBe('/items');
  });
});

describe('extractEndpoints: what it skips', () => {
  const route = "app.get('/users', list);\n";

  it.each([
    'test/server.ts',
    'src/__tests__/api.js',
    'packages/x/tests/routes.ts',
    'e2e/app.ts',
    'src/users.controller.spec.ts',
    'src/users.test.js',
    'apps/api/test/app.e2e-spec.ts',
    'fixtures/server.mjs',
  ])('test file %s', (path) => {
    expect(extractEndpoints({ path, language: 'typescript', content: route })).toEqual([]);
  });

  it.each(['app/tests/test_api.py', 'app/test_api.py', 'app/api_test.py', 'conftest.py'])(
    'Python test file %s',
    (path) => {
      const content = 'from flask import Flask\napp = Flask(__name__)\n@app.route("/x")\ndef x(): ...\n';
      expect(extractEndpoints({ path, language: 'python', content })).toEqual([]);
    },
  );

  it('keeps source files whose names merely contain "test"', () => {
    expect(js(route)).toHaveLength(1);
    expect(extractEndpoints({ path: 'src/testing-utils/routes.js', language: 'javascript', content: route })).toHaveLength(1);
    expect(extractEndpoints({ path: 'src/latest/routes.js', language: 'javascript', content: route })).toHaveLength(1);
  });

  it('skips examples in comments', () => {
    expect(
      js(`/**
 * @example
 * server.get('/proxy', async (request, response) => {});
 */
// app.get('/old', legacy);
app.get('/new', current);`),
    ).toMatchObject([{ path: '/new', line: 6 }]);
  });

  it('skips examples in doc comments without leading asterisks', () => {
    expect(
      js(`\t/**
\tProxies requests.

\t@example
\t\`\`\`
\tserver.get('/proxy', async (request, response) => {});
\t\`\`\`
\t*/
\tapp.get('/real', handler);`),
    ).toMatchObject([{ path: '/real', line: 9 }]);
  });

  it('is not fooled by comment markers inside strings', () => {
    expect(
      brief(
        js(`const pattern = 'src/**/*.ts'; const url = "http://x";
app.get('/a', a);
const s = \`*/ not a comment end\`;
app.get('/b', b);`),
      ),
    ).toEqual(['GET /a @2 a', 'GET /b @4 b']);
  });
});

describe('extractEndpoints: Nest', () => {
  it('joins the controller prefix with each route decorator and names the handler', () => {
    const endpoints = ts(`import { Body, Controller, Get, HttpCode, Param, Post, Sse } from '@nestjs/common';

@Controller('sessions')
export class SessionsController {
  @Post()
  @HttpCode(201)
  async start(@Body() body: StartBody): Promise<Session> {}

  @Get(':id')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 1 } }),
  )
  get(@Param('id', ParseUUIDPipe) id: string) {}

  @Post(':id/messages/stream')
  @Sse()
  stream() {}
}
`);
    expect(brief(endpoints)).toEqual([
      'POST /sessions @5 start',
      'GET /sessions/:id @9 get',
      'POST /sessions/:id/messages/stream @15 stream',
    ]);
    expect(endpoints[0]).toMatchObject({ framework: 'nest', declaration: '@Post()' });
  });

  it('reads { path } and array arguments, and tracks several controllers in one file', () => {
    expect(
      brief(
        ts(`@Controller({ path: 'cats', version: '1' })
class Cats {
  @Get(['', 'all'])
  list() {}
}
@Controller()
class Health {
  @All('health')
  check() {}
}`),
      ),
    ).toEqual(['GET /cats @3 list', 'ALL /health @8 check']);
  });

  it('ignores decorators that only start like route decorators, and files without a controller', () => {
    expect(ts(`@Controller('x') class X { @GetUser() user() {} @Getter() g() {} }`)).toEqual([]);
    expect(ts(`class NotNest { @Get('/x') x() {} }`)).toEqual([]);
  });
});

describe('extractEndpoints: Express-style routers', () => {
  it('finds app/router calls with string paths and their named handlers', () => {
    expect(
      brief(
        js(`const app = express();
const userRouter = express.Router();
app.get('/', (req, res) => res.send('ok'));
userRouter.post("/users", auth, users.create);
app.delete(
  '/users/:id',
  users.remove,
);
module.exports = userRouter;`),
      ),
    ).toEqual(['GET / @3 -', 'POST /users @4 users.create', 'DELETE /users/:id @5 users.remove']);
  });

  it('follows app.route(path) chains, including handlers with nested parentheses', () => {
    expect(
      brief(
        js(`router.route('/books')
  .get((req, res) => { res.json(list(req.query)) })
  .post(validate(schema), books.create);`),
      ),
    ).toEqual(['GET /books @2 -', 'POST /books @3 books.create']);
  });

  it('skips non-router receivers, relative strings and run-time paths', () => {
    expect(
      js(`axios.get('/users');
cache.get('/key');
request(app).get('/users');
app.get('users');
app.get(\`/v\${version}/users\`, h);
map.get(key);`),
    ).toEqual([]);
  });

  it('does nothing for other languages', () => {
    expect(extractEndpoints({ path: 'a.go', language: 'go', content: `app.get('/x', h)` })).toEqual([]);
  });
});

describe('extractEndpoints: FastAPI', () => {
  it('reads method decorators and the APIRouter prefix declared in the file', () => {
    const endpoints = py(`from fastapi import APIRouter, Depends

router = APIRouter(prefix="/items", tags=["items"])

@router.get("/")
async def list_items():
    ...

@router.post("/{item_id}/tags", status_code=201)
@requires_auth
def add_tag(item_id: int):
    ...
`);
    expect(brief(endpoints)).toEqual([
      'GET /items @5 list_items',
      'POST /items/{item_id}/tags @9 add_tag',
    ]);
    expect(endpoints[0].framework).toBe('fastapi');
  });

  it('expands api_route methods', () => {
    expect(
      brief(py(`import fastapi\napp = fastapi.FastAPI()\n@app.api_route("/ping", methods=["GET", "HEAD"])\ndef ping(): ...`)),
    ).toEqual(['GET /ping @3 ping', 'HEAD /ping @3 ping']);
  });
});

describe('extractEndpoints: Flask', () => {
  it('reads route methods (GET by default) and the blueprint url_prefix', () => {
    const endpoints = py(`from flask import Blueprint, request

bp = Blueprint("auth", __name__, url_prefix="/auth")

@bp.route("/register", methods=("GET", "POST"))
def register():
    pass

@bp.route('/logout')
def logout():
    pass
`);
    expect(brief(endpoints)).toEqual([
      'GET /auth/register @5 register',
      'POST /auth/register @5 register',
      'GET /auth/logout @9 logout',
    ]);
    expect(endpoints.every((e) => e.framework === 'flask')).toBe(true);
  });

  it('ignores Python files that import neither framework', () => {
    expect(py(`@cache.get("/x")\ndef x(): ...`)).toEqual([]);
  });
});
