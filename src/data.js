export { signal, computed, effect, batch, watch, onCleanup, esc, html } from './core.js';
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
export const createFetch = ({ cache = true, ttl = 30_000, retry = 2, retryDelay = 1000, store = null } = {}) => {
  const _mem = new Map();

  const cacheGet = async key => {
    if (store) return store.get(key);
    const hit = _mem.get(key);
    return hit && Date.now() - hit.ts < ttl ? hit.data : undefined;
  };
  const cacheSet = (key, data, t) => {
    if (store) return store.set(key, data, { ttl: t });
    _mem.set(key, { data, ts: Date.now() });
  };

  const get = async (key, fetcher, opts = {}) => {
    const t = opts.ttl ?? ttl;
    if (cache && opts.ttl !== 0) {
      const hit = await cacheGet(key);
      if (hit !== undefined) return hit;
    }
    const attempt = (n, delay) =>
      Promise.resolve(fetcher()).then(data => {
        if (cache) cacheSet(key, data, t);
        return data;
      }).catch(e => {
        if (n > 0 && e?.name !== 'AbortError') return new Promise(r => setTimeout(r, delay)).then(() => attempt(n - 1, delay * 2));
        throw e;
      });
    return attempt(opts.retry ?? retry, retryDelay);
  };

  const invalidate = key => {
    if (store) return key ? store.delete(key) : store.clear();
    key ? _mem.delete(key) : _mem.clear();
  };

  return { get, invalidate };
};

// ── createStore ───────────────────────────────────────────────────────────────
export const createStore = (init, { persist } = {}) => {
  const saved = persist && localStorage.getItem(persist);
  const base  = structuredClone(init);
  // structuredClone 不保留 Symbol key，手动补回
  for (const sym of Object.getOwnPropertySymbols(init)) base[sym] = init[sym];
  const raw   = saved ? { ...base, ...JSON.parse(saved) } : base;
  const sigs  = {};
  const ensure = k => (sigs[k] ??= signal(raw[k]));
  return new Proxy(raw, {
    get(_, k) { return typeof k === 'symbol' ? raw[k] : ensure(k).value; },
    set(_, k, v) {
      raw[k] = v; ensure(k).value = v;
      if (persist) localStorage.setItem(persist, JSON.stringify(raw));
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
      if (e?.name === 'QuotaExceededError') {
        const keys = Object.keys(localStorage);
        if (keys.length) localStorage.removeItem(keys[0]);
        try { localStorage.setItem(key, gz ? await _compress(str) : str); } catch {}
      }
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
