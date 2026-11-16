/**
 * Runs the endpoint store and catalog SQL against the Compose Postgres
 * (database `cda_test`). Run with `npm run test:integration`.
 */
import type { ApiEndpoint, SourceFile } from '@cda/domain';
import { testPrismaClient } from '../../../test/int-database';
import type { PrismaClient } from '../../generated/prisma/client';
import { PrismaChunkStore } from './prisma-chunk-store';
import { PrismaEndpointCatalog } from './prisma-endpoint-catalog';
import type { PrismaService } from './prisma.service';

const KEY_PREFIX = 'int-test:endpoint-catalog:';

let prisma: PrismaClient;
let store: PrismaChunkStore;
let catalog: PrismaEndpointCatalog;

beforeAll(() => {
  prisma = testPrismaClient();
  // Both only use the PrismaClient API of PrismaService.
  const service = prisma as unknown as PrismaService;
  store = new PrismaChunkStore(service);
  catalog = new PrismaEndpointCatalog(service);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Cascades to files and endpoints.
  await prisma.repo.deleteMany({
    where: { ingestKey: { startsWith: KEY_PREFIX } },
  });
});

async function createRepo(name: string): Promise<string> {
  const repo = await prisma.repo.create({
    data: {
      sourceType: 'local',
      localPath: `/int/${name}`,
      ingestKey: `${KEY_PREFIX}${name}`,
      status: 'ready',
    },
  });
  return repo.id;
}

const file = (path: string): SourceFile => ({
  path,
  language: 'typescript',
  content: '// routes',
});

const route = (
  method: ApiEndpoint['method'],
  path: string,
  line: number,
): ApiEndpoint => ({
  method,
  path,
  line,
  framework: 'nest',
  handler: `h${String(line)}`,
  declaration: `@${method}('${path}')`,
});

describe('PrismaEndpointCatalog', () => {
  it('lists a repo’s endpoints by file and line, with the declaring file path', async () => {
    const repoId = await createRepo('a');
    const other = await createRepo('b');
    await store.saveFile(
      repoId,
      file('src/users.controller.ts'),
      [],
      [route('POST', '/users', 20), route('GET', '/users/:id', 10)],
    );
    await store.saveFile(
      repoId,
      file('src/admin/stats.controller.ts'),
      [],
      [route('GET', '/admin/stats', 5)],
    );
    await store.saveFile(other, file('src/x.ts'), [], [route('GET', '/x', 1)]);

    const { endpoints, total } = await catalog.list({
      repoId,
      limit: 10,
      offset: 0,
    });

    expect(total).toBe(3);
    expect(
      endpoints.map(
        (e) => `${e.filePath}:${String(e.line)} ${e.method} ${e.path}`,
      ),
    ).toEqual([
      'src/admin/stats.controller.ts:5 GET /admin/stats',
      'src/users.controller.ts:10 GET /users/:id',
      'src/users.controller.ts:20 POST /users',
    ]);
    expect(endpoints[1]).toEqual({
      method: 'GET',
      path: '/users/:id',
      framework: 'nest',
      line: 10,
      handler: 'h10',
      declaration: "@GET('/users/:id')",
      filePath: 'src/users.controller.ts',
    });
  });

  it('filters by method, path text (case-insensitive) and file prefix, and counts beyond the limit', async () => {
    const repoId = await createRepo('filters');
    await store.saveFile(
      repoId,
      file('src/users.controller.ts'),
      [],
      [
        route('GET', '/Users', 1),
        route('POST', '/users', 2),
        route('DELETE', '/users/:id', 3),
      ],
    );
    await store.saveFile(
      repoId,
      file('src/admin/users.controller.ts'),
      [],
      [route('GET', '/admin/users', 1)],
    );

    const byMethod = await catalog.list({
      repoId,
      method: 'GET',
      limit: 10,
      offset: 0,
    });
    expect(byMethod.endpoints.map((e) => e.path)).toEqual([
      '/admin/users',
      '/Users',
    ]);

    const byText = await catalog.list({
      repoId,
      pathContains: 'USERS',
      limit: 2,
      offset: 0,
    });
    expect(byText.total).toBe(4);
    expect(byText.endpoints).toHaveLength(2);

    const nextPage = await catalog.list({
      repoId,
      pathContains: 'USERS',
      limit: 2,
      offset: 2,
    });
    expect(nextPage.total).toBe(4);
    expect(
      [...byText.endpoints, ...nextPage.endpoints].map((e) => e.path),
    ).toEqual(['/admin/users', '/Users', '/users', '/users/:id']);

    const byFile = await catalog.list({
      repoId,
      filePrefix: 'src/admin/',
      limit: 10,
      offset: 0,
    });
    expect(byFile.endpoints.map((e) => e.path)).toEqual(['/admin/users']);
  });

  it('replaces a file’s endpoints when the file is saved again', async () => {
    const repoId = await createRepo('replace');
    await store.saveFile(
      repoId,
      file('src/a.ts'),
      [],
      [route('GET', '/old', 1)],
    );
    await store.saveFile(
      repoId,
      file('src/a.ts'),
      [],
      [route('GET', '/new', 2)],
    );

    const { endpoints, total } = await catalog.list({
      repoId,
      limit: 10,
      offset: 0,
    });

    expect(total).toBe(1);
    expect(endpoints[0].path).toBe('/new');
  });
});
