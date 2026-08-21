/* mini-react/data v0.1.18 | https://github.com/forechoandlook/mini-react */

// src/data.js
import { signal, computed, effect, batch, watch, onCleanup, esc, html } from "./mini-react.core.js";
import { createQueryClient, defaultQueryClient, createQuery } from "./mini-react.query.js";
import { signal as signal2, effect as effect2, batch as batch2 } from "./mini-react.core.js";
var createResource = (source, fetcher) => {
  if (!fetcher) {
    fetcher = source;
    source = null;
  }
  const data = signal2(void 0), loading = signal2(false), error = signal2(null);
  let ctrl = null;
  const run = (src) => {
    ctrl?.abort();
    ctrl = new AbortController();
    batch2(() => {
      loading.value = true;
      error.value = null;
    });
    Promise.resolve(fetcher(src, ctrl.signal)).then((v) => {
      if (!ctrl.signal.aborted) batch2(() => {
        data.value = v;
        loading.value = false;
      });
    }).catch((e) => {
      if (!ctrl.signal.aborted && e?.name !== "AbortError") batch2(() => {
        error.value = e;
        loading.value = false;
      });
    });
  };
  if (source) {
    effect2(() => {
      const src = source.value;
      run(src);
      return () => ctrl?.abort();
    });
  } else {
    run(void 0);
  }
  return [{ data, loading, error }, { refetch: () => run(source?.peek()), mutate: (v) => {
    data.value = v;
  } }];
};
var createFetch = ({ cache = true, ttl = 3e4, retry = 2, retryDelay = 1e3, store = null, dedupe = true } = {}) => {
  const _mem = /* @__PURE__ */ new Map();
  const _pending = /* @__PURE__ */ new Map();
  const _versions = /* @__PURE__ */ new Map();
  const cacheGet = (key, t) => {
    if (store) return store.get(key);
    const hit = _mem.get(key);
    return hit && Date.now() - hit.ts < t ? hit.data : void 0;
  };
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
      const attempt = (n, delay) => Promise.resolve(fetcher()).then(async (data) => {
        if (shouldCache && (_versions.get(key) ?? 0) === version) await cacheSet(key, data, t);
        return data;
      }).catch((e) => {
        if (n > 0 && e?.name !== "AbortError") return new Promise((r) => setTimeout(r, delay)).then(() => attempt(n - 1, delay * 2));
        throw e;
      });
      return attempt(opts.retry ?? retry, retryDelay);
    };
    const track = (promise) => {
      if (!shouldDedupe) return promise;
      _pending.set(key, promise);
      promise.finally(() => {
        if (_pending.get(key) === promise) _pending.delete(key);
      }).catch(() => {
      });
      return promise;
    };
    if (!shouldCache) return track(request());
    if (!store) {
      const hit = cacheGet(key, t);
      return hit !== void 0 ? Promise.resolve(hit) : track(request());
    }
    return track(Promise.resolve(cacheGet(key, t)).then((hit) => hit !== void 0 ? hit : request()));
  };
  const invalidate = (key) => {
    if (key !== void 0) _versions.set(key, (_versions.get(key) ?? 0) + 1);
    else {
      for (const k of _mem.keys()) _versions.set(k, (_versions.get(k) ?? 0) + 1);
      for (const k of _pending.keys()) _versions.set(k, (_versions.get(k) ?? 0) + 1);
    }
    if (store) return key === void 0 ? store.clear() : store.delete(key);
    key === void 0 ? _mem.clear() : _mem.delete(key);
  };
  return { get, invalidate };
};
var createStore = (init, { persist } = {}) => {
  const saved = persist && localStorage.getItem(persist);
  const base = structuredClone(init);
  for (const sym of Object.getOwnPropertySymbols(init)) base[sym] = init[sym];
  const raw = saved ? { ...base, ...JSON.parse(saved) } : base;
  const sigs = {};
  const ensure = (k) => sigs[k] ??= signal2(raw[k]);
  let _persistPending = false;
  const schedulePersist = () => {
    if (!_persistPending) {
      _persistPending = true;
      Promise.resolve().then(() => {
        localStorage.setItem(persist, JSON.stringify(raw));
        _persistPending = false;
      });
    }
  };
  return new Proxy(raw, {
    get(_, k) {
      return typeof k === "symbol" ? raw[k] : ensure(k).value;
    },
    set(_, k, v) {
      raw[k] = v;
      ensure(k).value = v;
      if (persist) schedulePersist();
      return true;
    }
  });
};
var _enc = new TextEncoder();
var _dec = new TextDecoder();
var _compress = async (str) => {
  const stream = new Blob([_enc.encode(str)]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
};
var _decompress = async (b64) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return _dec.decode(await new Response(stream).arrayBuffer());
};
var ls = {
  async get(key, { compress: gz = false } = {}) {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(gz ? await _decompress(raw) : raw);
    } catch {
      return null;
    }
  },
  async set(key, val, { compress: gz = false } = {}) {
    const str = JSON.stringify(val);
    try {
      localStorage.setItem(key, gz ? await _compress(str) : str);
    } catch (e) {
      if (e?.name === "QuotaExceededError") console.warn("[ls] storage full, write skipped:", key);
    }
  },
  remove: (key) => localStorage.removeItem(key),
  clear: () => localStorage.clear()
};
var idb = (dbName, storeName = "kv") => {
  let _db = null;
  const open = () => _db ? Promise.resolve(_db) : new Promise((res, rej) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName);
    req.onsuccess = (e) => {
      _db = e.target.result;
      res(_db);
    };
    req.onerror = (e) => rej(e.target.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  };
  return {
    async get(key) {
      const row = await tx("readonly", (s) => s.get(key));
      if (!row) return void 0;
      if (row.expires && Date.now() > row.expires) {
        this.delete(key);
        return void 0;
      }
      return row.val;
    },
    async set(key, val, { ttl } = {}) {
      await tx("readwrite", (s) => s.put({ val, expires: ttl ? Date.now() + ttl : null }, key));
    },
    delete: (key) => tx("readwrite", (s) => s.delete(key)),
    clear: () => tx("readwrite", (s) => s.clear()),
    keys: () => tx("readonly", (s) => s.getAllKeys())
  };
};
export {
  batch,
  computed,
  createFetch,
  createQuery,
  createQueryClient,
  createResource,
  createStore,
  defaultQueryClient,
  effect,
  esc,
  html,
  idb,
  ls,
  onCleanup,
  signal,
  watch
};
