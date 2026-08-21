import { signal, batch } from './core.js';

const _isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const _wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const _stable = value => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return `Date(${value.toJSON()})`;
  if (Array.isArray(value)) return `[${value.map(_stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_stable(value[key])}`).join(',')}}`;
};
const _keyPrefixMatch = (hash, prefix) => {
  if (hash === prefix) return true;
  if (prefix.startsWith('[') && prefix.endsWith(']')) {
    return hash.startsWith(prefix.slice(0, -1) + ',');
  }
  return hash.startsWith(prefix);
};
const _match = (record, filter) => {
  if (!filter) return true;
  if (typeof filter === 'function') return filter(record);
  if (filter.queryKey) {
    const prefix = _stable(filter.queryKey);
    if (filter.exact ? record.hash !== prefix : !_keyPrefixMatch(record.hash, prefix)) return false;
  }
  return !filter.tags || filter.tags.some(tag => record.tags.has(tag));
};
const _serializable = value => { try { JSON.stringify(value); return true; } catch { return false; } };
const _share = (oldValue, nextValue) => {
  if (Object.is(oldValue, nextValue)) return oldValue;
  if (!oldValue || !nextValue || typeof oldValue !== 'object' || typeof nextValue !== 'object') return nextValue;
  if (Array.isArray(oldValue) && Array.isArray(nextValue)) {
    if (oldValue.length !== nextValue.length) return nextValue;
    const out = nextValue.map((value, index) => _share(oldValue[index], value));
    return out.every((value, index) => value === oldValue[index]) ? oldValue : out;
  }
  if (Array.isArray(oldValue) || Array.isArray(nextValue) || Object.getPrototypeOf(oldValue) !== Object.prototype || Object.getPrototypeOf(nextValue) !== Object.prototype) return nextValue;
  const keys = Object.keys(nextValue);
  if (keys.length !== Object.keys(oldValue).length) return nextValue;
  const out = {};
  for (const key of keys) {
    if (!(key in oldValue)) return nextValue;
    out[key] = _share(oldValue[key], nextValue[key]);
  }
  return keys.every(key => out[key] === oldValue[key]) ? oldValue : out;
};

/**
 * Framework-agnostic query cache. Queries expose Signals so they can be read
 * directly in a mini-react mount/template without an adapter hook.
 */
export const createQueryClient = ({
  staleTime = 30_000,
  gcTime = 300_000,
  retry = 2,
  retryDelay = 1_000,
  refetchOnWindowFocus = false,
  refetchOnReconnect = true,
} = {}) => {
  const records = new Map();
  const listeners = new Set();
  const http = new Map();
  let channel = null;
  let destroyed = false;

  const emit = event => { for (const listener of listeners) listener(event); };
  const state = record => record.state;
  const fresh = record => !record.invalidated && Date.now() - record.state.updatedAt.peek() < record.options.staleTime;
  const markStale = record => { record.invalidated = true; record.state.isStale.value = true; };
  const clearGc = record => { if (record.gcTimer) clearTimeout(record.gcTimer); record.gcTimer = null; };
  const scheduleGc = record => {
    clearGc(record);
    if (!record.observers && Number.isFinite(record.options.gcTime)) record.gcTimer = setTimeout(() => {
      if (!record.observers && !record.promise) { records.delete(record.hash); emit({ type: 'gc', key: record.key }); }
    }, record.options.gcTime);
  };
  const clearPoll = record => { if (record.pollTimer) clearTimeout(record.pollTimer); record.pollTimer = null; };
  const schedulePoll = record => {
    clearPoll(record);
    const interval = typeof record.options.refetchInterval === 'function' ? record.options.refetchInterval(record) : record.options.refetchInterval;
    if (record.observers && Number.isFinite(interval) && interval > 0) record.pollTimer = setTimeout(async () => {
      if (_isOnline()) await fetchRecord(record, { force: true }).catch(() => {});
      schedulePoll(record);
    }, interval);
  };
  const createRecord = (input, hash = _stable(input.queryKey)) => {
    const options = { staleTime, gcTime, retry, retryDelay, ...input };
    const record = {
      hash, key: input.queryKey, queryFn: input.queryFn, options, tags: new Set(input.tags ?? []), observers: 0,
      invalidated: true, promise: null, ctrl: null, version: 0, gcTimer: null, pollTimer: null,
      state: {
        data: signal(input.initialData), error: signal(null), status: signal(input.initialData === undefined ? 'idle' : 'success'),
        fetchStatus: signal('idle'), updatedAt: signal(input.initialData === undefined ? 0 : Date.now()),
        isStale: signal(true),
      },
    };
    records.set(hash, record);
    return record;
  };
  const ensure = input => {
    if (!input?.queryKey) throw new TypeError('query: queryKey is required');
    const hash = _stable(input.queryKey);
    const record = records.get(hash) ?? createRecord(input, hash);
    if (input.queryFn) record.queryFn = input.queryFn;
    record.options = { ...record.options, ...input };
    for (const tag of input.tags ?? []) record.tags.add(tag);
    return record;
  };
  const fetchRecord = (record, { force = false } = {}) => {
    if (!record.queryFn) return Promise.reject(new TypeError(`query ${record.hash} has no queryFn`));
    if (!force && fresh(record)) return Promise.resolve(record.state.data.peek());
    if (record.promise) return record.promise;
    if (!_isOnline()) { record.state.fetchStatus.value = 'paused'; return Promise.reject(new Error('Query paused while offline')); }
    clearGc(record);
    const version = ++record.version;
    const ctrl = new AbortController();
    record.ctrl = ctrl;
    batch(() => {
      if (record.state.data.peek() === undefined) record.state.status.value = 'pending';
      record.state.fetchStatus.value = 'fetching';
      record.state.error.value = null;
    });
    emit({ type: 'fetch', key: record.key });
    const run = async (left, delay) => {
      try {
        return await record.queryFn({ queryKey: record.key, signal: ctrl.signal, meta: record.options.meta });
      } catch (error) {
        if (ctrl.signal.aborted || error?.name === 'AbortError' || left <= 0 || record.options.retry === false) throw error;
        await _wait(typeof delay === 'function' ? delay(left, error) : delay);
        return run(left - 1, typeof delay === 'number' ? delay * 2 : delay);
      }
    };
    const promise = run(record.options.retry ?? retry, record.options.retryDelay ?? retryDelay).then(data => {
      if (record.version === version && !ctrl.signal.aborted) batch(() => {
        record.state.data.value = record.options.structuralSharing === false ? data : _share(record.state.data.peek(), data);
        record.state.status.value = 'success';
        record.state.fetchStatus.value = 'idle';
        record.state.updatedAt.value = Date.now();
        record.state.isStale.value = false;
        record.invalidated = false;
      });
      emit({ type: 'success', key: record.key });
      return data;
    }).catch(error => {
      if (record.version === version && !ctrl.signal.aborted) batch(() => {
        record.state.error.value = error;
        record.state.status.value = record.state.data.peek() === undefined ? 'error' : 'success';
        record.state.fetchStatus.value = 'idle';
      });
      if (!ctrl.signal.aborted) emit({ type: 'error', key: record.key, error });
      throw error;
    }).finally(() => {
      if (record.promise === promise) { record.promise = null; record.ctrl = null; scheduleGc(record); }
    });
    record.promise = promise;
    return promise;
  };
  const refetchMatching = filter => Promise.all([...records.values()].filter(record => _match(record, filter) && record.observers).map(record => fetchRecord(record, { force: true }).catch(() => undefined)));

  const client = {
    query(input) {
      const record = ensure(input);
      record.observers++;
      clearGc(record); schedulePoll(record);
      if (input.enabled !== false && (!fresh(record) || input.refetchOnMount)) fetchRecord(record).catch(() => {});
      const dispose = () => { record.observers = Math.max(0, record.observers - 1); scheduleGc(record); schedulePoll(record); };
      return [state(record), {
        refetch: () => fetchRecord(record, { force: true }),
        invalidate: () => client.invalidateQueries({ queryKey: record.key, exact: true }),
        setData: updater => client.setQueryData(record.key, updater),
        cancel: () => client.cancelQueries({ queryKey: record.key, exact: true }),
        dispose,
      }];
    },
    prefetchQuery(input) { const record = ensure(input); return fetchRecord(record); },
    fetchQuery(input) { const record = ensure(input); return fetchRecord(record); },
    getQueryData(key) { return records.get(_stable(key))?.state.data.peek(); },
    getQueryState(key) { const record = records.get(_stable(key)); return record && state(record); },
    setQueryData(key, updater, { tags } = {}) {
      const record = records.get(_stable(key)) ?? ensure({ queryKey: key, tags });
      const next = typeof updater === 'function' ? updater(record.state.data.peek()) : updater;
      const data = record.options.structuralSharing === false ? next : _share(record.state.data.peek(), next);
      batch(() => { record.state.data.value = data; record.state.status.value = 'success'; record.state.error.value = null; record.state.updatedAt.value = Date.now(); record.state.isStale.value = false; });
      record.invalidated = false;
      for (const tag of tags ?? []) record.tags.add(tag);
      emit({ type: 'set', key: record.key });
      if (channel) channel.postMessage({ type: 'invalidate', hash: record.hash });
      return data;
    },
    invalidateQueries(filter) {
      for (const record of records.values()) if (_match(record, filter)) markStale(record);
      emit({ type: 'invalidate', filter });
      if (channel) channel.postMessage({ type: 'invalidate', filter });
      return refetchMatching(filter);
    },
    cancelQueries(filter) {
      for (const record of records.values()) if (_match(record, filter)) record.ctrl?.abort();
    },
    removeQueries(filter) {
      for (const record of [...records.values()]) if (_match(record, filter)) { record.ctrl?.abort(); clearGc(record); clearPoll(record); records.delete(record.hash); }
    },
    mutate({ mutationFn, variables, optimistic, invalidate, onMutate, onSuccess, onError, networkMode = 'online' } = {}) {
      if (typeof mutationFn !== 'function') return Promise.reject(new TypeError('mutate: mutationFn is required'));
      const snapshots = [];
      const apply = updates => (Array.isArray(updates) ? updates : [updates]).filter(Boolean).forEach(update => {
        const old = client.getQueryData(update.queryKey);
        snapshots.push([update.queryKey, old]);
        client.setQueryData(update.queryKey, data => update.updater(data));
      });
      const run = async () => {
        const context = await onMutate?.(variables, { client });
        if (optimistic) apply(typeof optimistic === 'function' ? optimistic(variables) : optimistic);
        try {
          const data = await mutationFn(variables);
          await onSuccess?.(data, variables, context);
          if (invalidate) await client.invalidateQueries(invalidate);
          emit({ type: 'mutation-success' });
          return data;
        } catch (error) {
          for (const [key, data] of snapshots) client.setQueryData(key, data);
          await onError?.(error, variables, context);
          emit({ type: 'mutation-error', error });
          throw error;
        }
      };
      if (!_isOnline() && networkMode === 'offlineFirst') { offlineQueue.push(run); emit({ type: 'mutation-queued' }); return Promise.resolve({ queued: true }); }
      return run();
    },
    infiniteQuery({ queryKey, queryFn, initialPageParam = 0, getNextPageParam, ...options }) {
      const [query, controls] = client.query({ queryKey, ...options, queryFn: async context => ({ pages: [await queryFn({ ...context, pageParam: initialPageParam })], pageParams: [initialPageParam] }) });
      return [query, {
        ...controls,
        fetchNextPage: async () => {
          const current = query.data.peek() ?? { pages: [], pageParams: [] };
          const pageParam = getNextPageParam?.(current.pages.at(-1), current.pages);
          if (pageParam === undefined || pageParam === null) return undefined;
          const page = await queryFn({ queryKey, pageParam, signal: new AbortController().signal });
          client.setQueryData(queryKey, { pages: [...current.pages, page], pageParams: [...current.pageParams, pageParam] });
          return page;
        },
      }];
    },
    dehydrate({ shouldDehydrate = record => record.state.status.peek() === 'success', version = 1 } = {}) {
      return { version, timestamp: Date.now(), queries: [...records.values()].filter(shouldDehydrate).filter(record => _serializable(record.state.data.peek())).map(record => ({ key: record.key, data: record.state.data.peek(), updatedAt: record.state.updatedAt.peek(), staleTime: record.options.staleTime, tags: [...record.tags] })) };
    },
    hydrate(snapshot, { version = 1 } = {}) {
      if (!snapshot || snapshot.version !== version || !Array.isArray(snapshot.queries)) return false;
      for (const item of snapshot.queries) {
        const record = records.get(_stable(item.key)) ?? ensure({ queryKey: item.key, staleTime: item.staleTime, tags: item.tags });
        batch(() => { record.state.data.value = item.data; record.state.status.value = 'success'; record.state.updatedAt.value = item.updatedAt; record.state.isStale.value = Date.now() - item.updatedAt >= record.options.staleTime; });
        record.invalidated = record.state.isStale.peek();
      }
      emit({ type: 'hydrate' }); return true;
    },
    persist({ storage = typeof localStorage === 'undefined' ? null : localStorage, key = 'mini-react-query', version = 1 } = {}) {
      if (!storage) throw new Error('persist: a storage adapter is required');
      let pending = false;
      const save = async () => {
        const value = JSON.stringify(client.dehydrate({ version }));
        return storage.set ? storage.set(key, value) : storage.setItem(key, value);
      };
      const unsubscribe = client.subscribe(() => { if (!pending) { pending = true; queueMicrotask(() => { pending = false; save().catch(() => {}); }); } });
      return { restore: async () => {
        const raw = await (storage.get ? storage.get(key) : storage.getItem(key));
        return raw ? client.hydrate(JSON.parse(raw), { version }) : false;
      }, save, dispose: unsubscribe };
    },
    sync(name = 'mini-react-query') {
      if (typeof BroadcastChannel === 'undefined') return () => {};
      channel?.close(); channel = new BroadcastChannel(name);
      channel.onmessage = event => {
        if (event.data?.type !== 'invalidate') return;
        const filter = event.data.hash ? record => record.hash === event.data.hash : event.data.filter;
        for (const record of records.values()) if (_match(record, filter)) markStale(record);
        refetchMatching(filter);
      };
      return () => { channel?.close(); channel = null; };
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getDebugSnapshot() { return [...records.values()].map(record => ({ key: record.key, observers: record.observers, status: record.state.status.peek(), fetchStatus: record.state.fetchStatus.peek(), updatedAt: record.state.updatedAt.peek(), stale: record.state.isStale.peek(), tags: [...record.tags] })); },
    async fetchJSON(url, init = {}, { queryKey = ['GET', url, init.body ?? null], ...options } = {}) {
      const hash = _stable(queryKey);
      return client.fetchQuery({ queryKey, ...options, queryFn: async ({ signal }) => {
        const headers = new Headers(init.headers);
        const prior = http.get(hash);
        if (prior?.etag) headers.set('If-None-Match', prior.etag);
        const response = await fetch(url, { ...init, headers, signal });
        if (response.status === 304 && prior) return client.getQueryData(queryKey);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const maxAge = response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1];
        if (maxAge) { const record = records.get(hash); if (record) record.options.staleTime = Number(maxAge) * 1000; }
        http.set(hash, { etag: response.headers.get('etag') });
        return response.json();
      }});
    },
    destroy() { destroyed = true; for (const record of records.values()) { record.ctrl?.abort(); clearGc(record); clearPoll(record); } channel?.close(); listeners.clear(); },
  };
  const offlineQueue = [];
  const onFocus = () => { if (refetchOnWindowFocus) refetchMatching(); };
  const onOnline = () => { if (refetchOnReconnect) refetchMatching(); while (offlineQueue.length) offlineQueue.shift()().catch(() => {}); };
  if (typeof window !== 'undefined') { window.addEventListener('focus', onFocus); window.addEventListener('online', onOnline); }
  const originalDestroy = client.destroy;
  client.destroy = () => { if (destroyed) return; if (typeof window !== 'undefined') { window.removeEventListener('focus', onFocus); window.removeEventListener('online', onOnline); } originalDestroy(); };
  return client;
};

export const defaultQueryClient = createQueryClient();
export const createQuery = options => defaultQueryClient.query(options);
