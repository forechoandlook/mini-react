/* mini-react/core v0.1.11 | https://github.com/forechoandlook/mini-react */

// src/core.js
var version = true ? "0.1.11" : "dev";
var _eff = null;
var _tracking = null;
var _batchDepth = 0;
var _currCleanups = null;
var _pendingComputed = /* @__PURE__ */ new Set();
var _pendingEffects = /* @__PURE__ */ new Set();
var _isFlushing = false;
var _maxFlushRuns = 1e4;
var _schedulerStats = { flushes: 0, runs: 0, lastFlushRuns: 0 };
var setSchedulerMaxRuns = (n) => {
  if (!Number.isInteger(n) || n < 1) throw new TypeError("setSchedulerMaxRuns: expected a positive integer");
  _maxFlushRuns = n;
};
var getSchedulerStats = () => ({ ..._schedulerStats, maxRuns: _maxFlushRuns });
var _mode = "sync";
var _microtaskFlushScheduled = false;
var setUpdateMode = (mode) => {
  if (mode !== "sync" && mode !== "microtask") throw new TypeError(`setUpdateMode: expected 'sync' or 'microtask', got ${mode}`);
  _mode = mode;
};
var getUpdateMode = () => _mode;
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
var asyncEffect = (fn) => effect(() => {
  const ctrl = new AbortController();
  Promise.resolve(fn(ctrl.signal)).catch((e) => {
    if (e?.name !== "AbortError") console.error("[asyncEffect]", e);
  });
  return () => ctrl.abort();
});
var _idxRe = /^\d+$/;
var _structuralMethods = ["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"];
function _wrapRow(arr, index, rowCache) {
  let entry = rowCache.get(index);
  if (entry) return entry.proxy;
  const fields = /* @__PURE__ */ new Map();
  const fieldSignal = (prop) => {
    let s = fields.get(prop);
    if (!s) {
      s = new Signal(arr[index]?.[prop]);
      fields.set(prop, s);
    }
    return s;
  };
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (typeof prop === "symbol") return arr[index]?.[prop];
      return fieldSignal(prop).value;
    },
    set(_, prop, value) {
      const target = arr[index];
      if (target) target[prop] = value;
      fieldSignal(prop).value = value;
      return true;
    },
    has(_, prop) {
      return arr[index] != null && prop in arr[index];
    },
    ownKeys() {
      return arr[index] ? Reflect.ownKeys(arr[index]) : [];
    },
    getOwnPropertyDescriptor(_, prop) {
      const target = arr[index];
      if (!target || !(prop in target)) return void 0;
      return { enumerable: true, configurable: true, value: fieldSignal(prop).value };
    }
  });
  rowCache.set(index, { proxy });
  return proxy;
}
var store = (initial) => {
  if (!Array.isArray(initial)) throw new TypeError("store() currently only supports arrays");
  const arr = initial;
  const structural = new Signal(0, () => false);
  const rowCache = /* @__PURE__ */ new Map();
  const bump = () => {
    structural.value = structural._v + 1;
  };
  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === "length") {
        structural.value;
        return target.length;
      }
      if (typeof prop === "string" && _idxRe.test(prop)) {
        structural.value;
        const idx = Number(prop);
        return idx < target.length ? _wrapRow(target, idx, rowCache) : void 0;
      }
      if (prop === Symbol.iterator) {
        return function* () {
          structural.value;
          for (let i = 0; i < target.length; i++) yield _wrapRow(target, i, rowCache);
        };
      }
      if (_structuralMethods.includes(prop)) {
        return (...args) => {
          rowCache.clear();
          const res = Array.prototype[prop].apply(target, args);
          bump();
          return res;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      if (typeof prop === "string" && _idxRe.test(prop)) {
        target[Number(prop)] = value;
        rowCache.delete(Number(prop));
        bump();
        return true;
      }
      if (prop === "length") {
        target.length = value;
        rowCache.clear();
        bump();
        return true;
      }
      return Reflect.set(target, prop, value);
    }
  });
};
var _escMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
var esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => _escMap[c]);
var html = (s) => ({ __trusted: true, value: String(s ?? "") });
export {
  asyncEffect,
  batch,
  computed,
  effect,
  esc,
  flushSync,
  getSchedulerStats,
  getUpdateMode,
  html,
  onCleanup,
  setSchedulerMaxRuns,
  setUpdateMode,
  signal,
  store,
  version,
  watch
};
