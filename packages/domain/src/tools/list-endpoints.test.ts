import { describe, expect, it } from 'vitest';
import type { StoredEndpoint } from '../endpoints/api-endpoint';
import type { EndpointCatalog, EndpointQuery } from '../ports/endpoint-catalog';
import { ListEndpointsTool } from './list-endpoints';
import { sourceIdFor } from './source-id';
import { invokeTool, ToolInputError } from './tool';

const endpoint = (overrides: Partial<StoredEndpoint>): StoredEndpoint => ({
  method: 'GET',
  path: '/repos/:id',
  framework: 'nest',
  line: 89,
  handler: 'findOne',
  declaration: "@Get(':id')",
  filePath: 'apps/api/src/ingestion/repos.controller.ts',
  ...overrides,
});

class FakeCatalog implements EndpointCatalog {
  readonly queries: EndpointQuery[] = [];
  constructor(private readonly all: StoredEndpoint[]) {}

  list(query: EndpointQuery) {
    this.queries.push(query);
    const matches = this.all.filter((e) => !query.method || e.method === query.method);
    return Promise.resolve({
      endpoints: matches.slice(query.offset, query.offset + query.limit),
      total: matches.length,
    });
  }
}

const context = { repoId: 'repo-1' };

describe('ListEndpointsTool', () => {
  it('lists the recorded endpoints of the context repo with file, line and handler', async () => {
    const catalog = new FakeCatalog([endpoint({}), endpoint({ method: 'POST', path: '/repos', line: 54, handler: 'create', declaration: '@Post()' })]);
    const tool = new ListEndpointsTool(catalog);

    const output = await invokeTool(tool, {}, context);

    expect(catalog.queries).toEqual([{ repoId: 'repo-1', limit: 50, offset: 0 }]);
    expect(output.total).toBe(2);
    expect(output.endpoints[0]).toEqual({
      sourceId: sourceIdFor('endpoint', 'apps/api/src/ingestion/repos.controller.ts:89:GET:/repos/:id'),
      method: 'GET',
      path: '/repos/:id',
      file: 'apps/api/src/ingestion/repos.controller.ts',
      line: 89,
      handler: 'findOne',
      framework: 'nest',
      declaration: "@Get(':id')",
    });
    expect(output.note).toMatch(/not ones added elsewhere/);
    expect(tool.summarize(output)).toBe('2 endpoints');
  });

  it('passes filters through, upper-casing the method and normalising the file prefix', async () => {
    const catalog = new FakeCatalog([endpoint({})]);
    await invokeTool(new ListEndpointsTool(catalog), { method: 'get', pathContains: 'repo', pathPrefix: './apps\\api/', limit: 5 }, context);
    expect(catalog.queries[0]).toEqual({ repoId: 'repo-1', limit: 5, offset: 0, method: 'GET', pathContains: 'repo', filePrefix: 'apps/api/' });
  });

  it('pages through a long list with offset, saying where to continue', async () => {
    const tool = new ListEndpointsTool(new FakeCatalog(Array.from({ length: 7 }, (_, i) => endpoint({ line: i + 1 }))));

    const first = await invokeTool(tool, { limit: 3 }, context);
    expect(first.endpoints.map((e) => e.line)).toEqual([1, 2, 3]);
    expect(first.note).toMatch(/^Showing 1-3 of 7\. Call again with offset 3 for the rest/);
    expect(tool.summarize(first)).toBe('1-3 of 7 endpoints');

    const last = await invokeTool(tool, { limit: 3, offset: 6 }, context);
    expect(last.endpoints.map((e) => e.line)).toEqual([7]);
    expect(last.note).not.toMatch(/Call again/);
    expect(tool.summarize(last)).toBe('7-7 of 7 endpoints');

    const past = await invokeTool(tool, { offset: 10 }, context);
    expect(past.note).toMatch(/past the end: there are 7/);
  });

  it('explains an empty result: what the scan covers, or that the filters matched nothing', async () => {
    const tool = new ListEndpointsTool(new FakeCatalog([]));
    expect((await invokeTool(tool, {}, context)).note).toMatch(/No HTTP routes were recorded.*use search_code/);
    expect((await invokeTool(tool, { method: 'DELETE' }, context)).note).toMatch(/match these filters/);
  });

  it('cites each declaration line and shows it as an endpoint excerpt', async () => {
    const tool = new ListEndpointsTool(new FakeCatalog([endpoint({})]));
    const output = await invokeTool(tool, {}, context);
    expect(tool.citations(output)).toEqual([
      { id: output.endpoints[0].sourceId, path: 'apps/api/src/ingestion/repos.controller.ts', startLine: 89, endLine: 89 },
    ]);
    expect(output.endpoints[0].sourceId).toMatch(/^e-[0-9a-f]{8}$/);
    expect(tool.excerpts(output)).toEqual([
      { path: 'apps/api/src/ingestion/repos.controller.ts', startLine: 89, endLine: 89, text: "@Get(':id')", source: 'endpoint' },
    ]);
  });

  it('rejects unknown methods and limits over the cap', async () => {
    const tool = new ListEndpointsTool(new FakeCatalog([]));
    await expect(invokeTool(tool, { method: 'FETCH' }, context)).rejects.toThrow(ToolInputError);
    await expect(invokeTool(tool, { limit: 500 }, context)).rejects.toThrow(ToolInputError);
  });
});
