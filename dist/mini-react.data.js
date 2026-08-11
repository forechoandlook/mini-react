/* mini-react/data v0.1.11 | https://github.com/forechoandlook/mini-react */

// src/core.js
var _eff = null;
var _tracking = null;
var _batchDepth = 0;
var _currCleanups = null;
var _pendingComputed = /* @__PURE__ */ new Set();
var _pendingEffects = /* @__PURE__ */ new Set();
var _isFlushing = false;
var _maxFlushRuns = 1e4;
var _schedulerStats = { flushes: 0, runs: 0, lastFlushRuns: 0 };
var _mode = "sync";
var _microtaskFlushScheduled = false;
function _scheduleMicrotaskFlush() {
  if (_microtaskFlushScheduled) return;
  _microtaskFlushScheduled = true;
  queueMicrotask(() => {
    _microtaskFlushScheduled = false;
    flushSync();
  });
}
var flushSync = () => {
  if (_isFlushing) return;
  _isFlushing = true;
  let runs = 0;
  _schedulerStats.flushes++;
  try {
    while (_pendingComputed.size || _pendingEffects.size) {
      while (_pendingComputed.size) {
        const f = _pendingComputed.values().next().value;
        _pendingComputed.delete(f);
        if (++runs > _maxFlushRuns) throw new Error(`mini-react: reactive update loop exceeded ${_maxFlushRuns} runs`);
        f();
      }
      if (_pendingEffects.size) {
        const f = _pendingEffects.values().next().value;
        _pendingEffects.delete(f);
        if (++runs > _maxFlushRuns) throw new Error(`mini-react: reactive update loop exceeded ${_maxFlushRuns} runs`);
        f();
      }
    }
  } finally {
    _schedulerStats.runs += runs;
    _schedulerStats.lastFlushRuns = runs;
    if (runs > _maxFlushRuns) {
      _pendingComputed.clear();
      _pendingEffects.clear();
    }
    _isFlushing = false;
  }
};
function _notify(subs) {
  for (const f of subs) (f._isComputed ? _pendingComputed : _pendingEffects).add(f);
  if (_batchDepth > 0 || _isFlushing) return;
  if (_mode === "microtask") _scheduleMicrotaskFlush();
  else flushSync();
}
var Signal = class {
  constructor(v, eq) {
    this._v = v;
    this._subs = /* @__PURE__ */ new Set();
    this._eq = eq ?? ((a, b) => a === b);
  }
  get value() {
    if (_eff) {
      this._subs.add(_eff);
      _tracking?.add(this);
    }
    return this._v;
  }
  set value(v) {
    if (this._eq(v, this._v)) return;
    this._v = v;
    _notify(this._subs);
  }
  peek() {
    return this._v;
  }
};
var signal = (v, { equals } = {}) => new Signal(v, equals);
function _run(fn, runner, deps, cleanups) {
  const prevDeps = new Set(deps);
  for (const d of deps) d._subs.delete(runner);
  deps.clear();
  cleanups?.forEach((f) => f?.());
  cleanups?.splice(0);
  const prev = [_eff, _tracking, _currCleanups];
  [_eff, _tracking, _currCleanups] = [runner, deps, cleanups];
  try {
    return fn();
  } catch (e) {
    for (const d of prevDeps) {
      d._subs.add(runner);
      deps.add(d);
    }
    throw e;
  } finally {
    [_eff, _tracking, _currCleanups] = prev;
  }
}
var computed = (fn) => {
  const s = new Signal(void 0), deps = /* @__PURE__ */ new Set();
  let dirty = true, disposed = false;
  const recompute = (notify) => {
    if (!dirty || disposed) return s._v;
    dirty = false;
    try {
      const v = _run(fn, mark, deps, null);
      const changed = v !== s._v;
      if (changed) s._v = v;
      if (changed && notify) _notify(s._subs);
    } catch (e) {
      dirty = true;
      console.error("[computed]", e);
    }
    return s._v;
  };
  const mark = () => {
    if (dirty || disposed) return;
    dirty = true;
    if (s._subs.size) recompute(true);
  };
  mark._isComputed = true;
  const read = () => {
    return recompute(false);
  };
  Object.defineProperty(s, "value", {
    get() {
      if (_eff) {
        s._subs.add(_eff);
        _tracking?.add(s);
      }
      return read();
    },
    set() {
      throw new TypeError("Cannot assign to a computed signal");
    }
  });
  s.dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const d of deps) d._subs.delete(mark);
    deps.clear();
  };
  return s;
};
var effect = (fn) => {
  const deps = /* @__PURE__ */ new Set(), cleanups = [];
  const run = () => {
    try {
      const ret = _run(fn, run, deps, cleanups);
      if (typeof ret === "function") cleanups.push(ret);
    } catch (e) {
      console.error("[effect]", e);
    }
  };
  run();
  return () => {
    for (const d of deps) d._subs.delete(run);
    deps.clear();
    cleanups.forEach((f) => f?.());
    cleanups.splice(0);
  };
};
var batch = (fn) => {
  _batchDepth++;
  try {
    fn();
  } finally {
    if (--_batchDepth === 0) {
      flushSync();
    }
  }
};
var watch = (sig, cb) => {
  let old = sig.peek(), mounted = false;
  return effect(() => {
    const v = sig.value;
    if (mounted) {
      cb(v, old);
    }
    mounted = true;
    old = v;
  });
};
var onCleanup = (fn) => {
  if (_currCleanups) _currCleanups.push(fn);
};
var _escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => _escMap[c]);
var html = (s) => ({ __trusted: true, value: String(s ?? "") });

// src/data.js
var createResource = (source, fetcher) => {
  if (!fetcher) {
    fetcher = source;
    source = null;
  }
  const data = signal(void 0), loading = signal(false), error = signal(null);
  let ctrl = null;
  const run = (src) => {
    ctrl?.abort();
    ctrl = new AbortController();
    batch(() => {
      loading.value = true;
      error.value = null;
    });
    Promise.resolve(fetcher(src, ctrl.signal)).then((v) => {
      if (!ctrl.signal.aborted) batch(() => {
        data.value = v;
        loading.value = false;
      });
    }).catch((e) => {
      if (!ctrl.signal.aborted && e?.name !== "AbortError") batch(() => {
        error.value = e;
        loading.value = false;
      });
    });
  };
  if (source) {
    effect(() => {
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
var createFetch = ({ cache = true, ttl = 3e4, retry = 2, retryDelay = 1e3, store = null } = {}) => {
  const _mem = /* @__PURE__ */ new Map();
  const cacheGet = async (key) => {
    if (store) return store.get(key);
    const hit = _mem.get(key);
    return hit && Date.now() - hit.ts < ttl ? hit.data : void 0;
  };
  const cacheSet = async (key, data, t) => {
    if (store) return store.set(key, data, { ttl: t });
    _mem.set(key, { data, ts: Date.now() });
  };
  const get = async (key, fetcher, opts = {}) => {
    const t = opts.ttl ?? ttl;
    if (cache && opts.ttl !== 0) {
      const hit = await cacheGet(key);
      if (hit !== void 0) return hit;
    }
    const attempt = (n, delay) => Promise.resolve(fetcher()).then(async (data) => {
      if (cache) await cacheSet(key, data, t);
      return data;
    }).catch((e) => {
      if (n > 0 && e?.name !== "AbortError") return new Promise((r) => setTimeout(r, delay)).then(() => attempt(n - 1, delay * 2));
      throw e;
    });
    return attempt(opts.retry ?? retry, retryDelay);
  };
  const invalidate = (key) => {
    if (store) return key ? store.delete(key) : store.clear();
    key ? _mem.delete(key) : _mem.clear();
  };
  return { get, invalidate };
};
var createStore = (init, { persist } = {}) => {
  const saved = persist && localStorage.getItem(persist);
  const base = structuredClone(init);
  for (const sym of Object.getOwnPropertySymbols(init)) base[sym] = init[sym];
  const raw = saved ? { ...base, ...JSON.parse(saved) } : base;
  const sigs = {};
  const ensure = (k) => sigs[k] ??= signal(raw[k]);
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
  createResource,
  createStore,
  effect,
  esc,
  html,
  idb,
  ls,
  onCleanup,
  signal,
  watch
};
