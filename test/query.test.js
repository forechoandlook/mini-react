import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createQueryClient } from '../src/query.js';

describe('QueryClient', () => {
  it('deduplicates, exposes reactive state, invalidates, and garbage-collects queries', async () => {
    const client = createQueryClient({ staleTime: 60_000, gcTime: 5 });
    let calls = 0;
    const [query, controls] = client.query({ queryKey: ['user', 1], enabled: false, queryFn: async () => ++calls });
    assert.equal(query.status.value, 'idle');
    assert.deepEqual(await Promise.all([controls.refetch(), controls.refetch()]), [1, 1]);
    assert.equal(calls, 1);
    assert.equal(query.data.value, 1);
    await controls.invalidate();
    assert.equal(calls, 2);
    controls.dispose();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(client.getQueryState(['user', 1]), undefined);
    client.destroy();
  });

  it('rolls back optimistic mutations and supports tag invalidation', async () => {
    const client = createQueryClient();
    client.setQueryData(['todos'], [{ id: 1, done: false }], { tags: ['todos'] });
    await assert.rejects(client.mutate({
      mutationFn: async () => { throw new Error('nope'); },
      optimistic: { queryKey: ['todos'], updater: rows => rows.map(row => ({ ...row, done: true })) },
    }), /nope/);
    assert.equal(client.getQueryData(['todos'])[0].done, false);
    await client.invalidateQueries({ tags: ['todos'] });
    assert.equal(client.getQueryState(['todos']).isStale.value, true);
    client.destroy();
  });

  it('structurally shares equivalent JSON responses by default', async () => {
    const client = createQueryClient({ staleTime: 0 });
    const [query, controls] = client.query({ queryKey: ['stable'], enabled: false, queryFn: async () => ({ nested: { id: 1 } }) });
    await controls.refetch();
    const first = query.data.value;
    await controls.refetch();
    assert.equal(query.data.value, first);
    controls.dispose(); client.destroy();
  });

  it('hydrates persisted data and loads subsequent infinite pages', async () => {
    const client = createQueryClient({ staleTime: 60_000 });
    const [query, controls] = client.infiniteQuery({
      queryKey: ['feed'], enabled: false, initialPageParam: 0,
      queryFn: async ({ pageParam }) => [pageParam],
      getNextPageParam: page => page[0] < 1 ? page[0] + 1 : undefined,
    });
    await controls.refetch();
    await controls.fetchNextPage();
    assert.deepEqual(query.data.value.pages, [[0], [1]]);
    const storage = new Map();
    const persister = client.persist({ storage: { get: key => storage.get(key), set: (key, value) => storage.set(key, value) }, key: 'q', version: 7 });
    await persister.save();
    const restored = createQueryClient();
    assert.equal(restored.hydrate(JSON.parse(storage.get('q')), { version: 7 }), true);
    assert.deepEqual(restored.getQueryData(['feed']).pages, [[0], [1]]);
    controls.dispose(); persister.dispose(); client.destroy(); restored.destroy();
  });

  it('uses ETag and Cache-Control when fetchJSON revalidates a GET request', async () => {
    const client = createQueryClient();
    const originalFetch = globalThis.fetch;
    const headers = [];
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      headers.push(new Headers(init.headers).get('if-none-match'));
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ ok: true }), { headers: { ETag: 'v1', 'Cache-Control': 'max-age=60' } })
        : new Response(null, { status: 304 });
    };
    try {
      assert.deepEqual(await client.fetchJSON('/api/me'), { ok: true });
      await client.invalidateQueries({ queryKey: ['GET', '/api/me', null], exact: true });
      assert.deepEqual(await client.fetchJSON('/api/me'), { ok: true });
      assert.deepEqual(headers, [null, 'v1']);
    } finally {
      globalThis.fetch = originalFetch;
      client.destroy();
    }
  });
});
