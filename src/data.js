export { signal, computed, effect, batch, watch, onCleanup, esc, html } from './core.js';
export { createQueryClient, defaultQueryClient, createQuery } from './query.js';
import { signal, effect, batch } from './core.js';

// ── createResource ────────────────────────────────────────────────────────────
export const createResource = (source, fetcher) => {
  if (!fetcher) { fetcher = source; source = null; }
  const data = signal(undefined), loading = signal(false), error = signal(null);
  let ctrl = null;
  const run = src => {
    ctrl?.abort(); ctrl = new AbortController();
    batch(() => { loading.value = true; error.value = null; });
    Promise.resolve(fetcher(src, ctrl.signal))
      .then(v => { if (!ctrl.signal.aborted) batch(() => { data.value = v; loading.value = false; }); })
      .catch(e => { if (!ctrl.signal.aborted && e?.name !== 'AbortError') batch(() => { error.value = e; loading.value = false; }); });
  };
  if (source) { effect(() => { const src = source.value; run(src); return () => ctrl?.abort(); }); }
  else        { run(undefined); }
  return [{ data, loading, error }, { refetch: () => run(source?.peek()), mutate: v => { data.value = v; } }];
};

// ── createFetch ───────────────────────────────────────────────────────────────
export const createFetch = ({ cache = true, ttl = 30_000, retry = 2, retryDelay = 1000, store = null, dedupe = true } = {}) => {
  const _mem = new Map();
  const _pending = new Map();
  const _versions = new Map();

  const cacheGet = (key, t) => {
    if (store) return store.get(key);
    const hit = _mem.get(key);
    return hit && Date.now() - hit.ts < t ? hit.data : undefined;
  };
  // Fix: await store.set so async stores aren't fire-and-forget
  const cacheSet = async (key, data, t) => {
    if (store) return store.set(key, data, { ttl: t });
    _mem.set(key, { data, ts: Date.now() });
  };

  const get = (key, fetcher, opts = {}) => {
    const t = opts.ttl ?? ttl;
    const shouldCache = cache && opts.cache !== false && t !== 0;
    const shouldDedupe = opts.dedupe ?? dedupe;
    if (shouldDedupe && _pending.has(key)) return _pending.get(key);

    const request = () => {
      const version = _versions.get(key) ?? 0;
      const attempt = (n, delay) =>
        Promise.resolve(fetcher()).then(async data => {
        // Do not restore data invalidated while this request was in flight.
          if (shouldCache && (_versions.get(key) ?? 0) === version) await cacheSet(key, data, t);
        return data;
        }).catch(e => {
        if (n > 0 && e?.name !== 'AbortError') return new Promise(r => setTimeout(r, delay)).then(() => attempt(n - 1, delay * 2));
        throw e;
        });
      return attempt(opts.retry ?? retry, retryDelay);
    };
    const track = promise => {
      if (!shouldDedupe) return promise;
      _pending.set(key, promise);
      promise.finally(() => { if (_pending.get(key) === promise) _pending.delete(key); }).catch(() => {});
      return promise;
    };

    if (!shouldCache) return track(request());
    // In-memory hits are synchronous; a persistent store is necessarily async.
    if (!store) {
      const hit = cacheGet(key, t);
      return hit !== undefined ? Promise.resolve(hit) : track(request());
    }
    return track(Promise.resolve(cacheGet(key, t)).then(hit => hit !== undefined ? hit : request()));
  };

  const invalidate = key => {
    if (key !== undefined) _versions.set(key, (_versions.get(key) ?? 0) + 1);
    else {
      for (const k of _mem.keys()) _versions.set(k, (_versions.get(k) ?? 0) + 1);
      for (const k of _pending.keys()) _versions.set(k, (_versions.get(k) ?? 0) + 1);
    }
    if (store) return key === undefined ? store.clear() : store.delete(key);
    key === undefined ? _mem.clear() : _mem.delete(key);
  };

  return { get, invalidate };
};

// ── createStore ───────────────────────────────────────────────────────────────
export const createStore = (init, { persist } = {}) => {
  const saved = persist && localStorage.getItem(persist);
  const base  = structuredClone(init);
  // structuredClone drops Symbol keys; restore them manually
  for (const sym of Object.getOwnPropertySymbols(init)) base[sym] = init[sym];
  const raw   = saved ? { ...base, ...JSON.parse(saved) } : base;
  const sigs  = {};
  const ensure = k => (sigs[k] ??= signal(raw[k]));
  // Debounce persist writes via microtask to avoid O(n*m) serialization on batched writes
  let _persistPending = false;
  const schedulePersist = () => {
    if (!_persistPending) {
      _persistPending = true;
      Promise.resolve().then(() => {
        // Exclude Symbol keys (JSON.stringify ignores them anyway)
        localStorage.setItem(persist, JSON.stringify(raw));
        _persistPending = false;
      });
    }
  };
  return new Proxy(raw, {
    get(_, k) { return typeof k === 'symbol' ? raw[k] : ensure(k).value; },
    set(_, k, v) {
      raw[k] = v; ensure(k).value = v;
      if (persist) schedulePersist();
      return true;
    },
  });
};

// ── localStorage wrapper ──────────────────────────────────────────────────────
const _enc = new TextEncoder(), _dec = new TextDecoder();
const _compress = async str => {
  const stream = new Blob([_enc.encode(str)]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
};
const _decompress = async b64 => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return _dec.decode(await new Response(stream).arrayBuffer());
};

export const ls = {
  async get(key, { compress: gz = false } = {}) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try { return JSON.parse(gz ? await _decompress(raw) : raw); } catch { return null; }
  },
  async set(key, val, { compress: gz = false } = {}) {
    const str = JSON.stringify(val);
    try {
      localStorage.setItem(key, gz ? await _compress(str) : str);
    } catch (e) {
      // Fix: removed random key eviction — caller decides what to evict on QuotaExceededError
      if (e?.name === 'QuotaExceededError') console.warn('[ls] storage full, write skipped:', key);
    }
  },
  remove: key => localStorage.removeItem(key),
  clear:  ()  => localStorage.clear(),
};

// ── IndexedDB wrapper ─────────────────────────────────────────────────────────
export const idb = (dbName, storeName = 'kv') => {
  let _db = null;
  const open = () => _db ? Promise.resolve(_db) : new Promise((res, rej) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(storeName);
    req.onsuccess = e => { _db = e.target.result; res(_db); };
    req.onerror   = e => rej(e.target.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  };
  return {
    async get(key) {
      const row = await tx('readonly', s => s.get(key));
      if (!row) return undefined;
      if (row.expires && Date.now() > row.expires) { this.delete(key); return undefined; }
      return row.val;
    },
    async set(key, val, { ttl } = {}) {
      await tx('readwrite', s => s.put({ val, expires: ttl ? Date.now() + ttl : null }, key));
    },
    delete: key => tx('readwrite', s => s.delete(key)),
    clear:  ()  => tx('readwrite', s => s.clear()),
    keys:   ()  => tx('readonly',  s => s.getAllKeys()),
  };
};
