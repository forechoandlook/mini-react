export const version = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';

let _eff = null, _tracking = null, _batchDepth = 0, _currCleanups = null;
// Keep derived computations ahead of user effects.  A source update can fan
// out into a diamond (A -> B, A -> C, B + C -> D); running subscribers as a
// plain recursive push makes D observe B and C one at a time and rerun twice.
// These two Sets both dedupe and give computed values a stable "settle first"
// phase while preserving synchronous updates by default.
const _pendingComputed = new Set(), _pendingEffects = new Set();
let _isFlushing = false;

// ── Update mode ──────────────────────────────────────────────────────────────
// 'sync' (default): every write reruns its subscribers immediately, in the
// same synchronous call — reading the DOM right after `sig.value = x` sees
// the update. This is what the whole library (and every existing test)
// assumes.
// 'microtask': every write queues its subscribers and coalesces into a
// single flush on the next microtask — like React 18's automatic batching.
// Multiple signal writes anywhere in a synchronous stretch of code (not just
// inside an explicit event handler) collapse into one re-render. The
// tradeoff: `sig.value = x` no longer updates synchronously, so any code
// (including your own) that reads the DOM immediately after a write needs
// `await nextTick()` first — this is a global, app-wide switch, not
// something you mix per-signal, precisely so a given codebase only ever has
// to reason about one of the two timing models at once.
let _mode = 'sync';
let _microtaskFlushScheduled = false;

export const setUpdateMode = mode => {
  if (mode !== 'sync' && mode !== 'microtask') throw new TypeError(`setUpdateMode: expected 'sync' or 'microtask', got ${mode}`);
  _mode = mode;
};
export const getUpdateMode = () => _mode;

function _scheduleMicrotaskFlush() {
  if (_microtaskFlushScheduled) return;
  _microtaskFlushScheduled = true;
  queueMicrotask(() => {
    _microtaskFlushScheduled = false;
    flushSync();
  });
}

// Drains whatever's pending right now, synchronously — for 'microtask' mode
// call sites that need an immediate flush (e.g. tests, or an imperative
// "commit now" before reading the DOM) without switching modes.
export const flushSync = () => {
  if (_isFlushing) return;
  _isFlushing = true;
  try {
    // Take one effect at a time so a write from it can settle all affected
    // computeds before the next effect observes application state.
    while (_pendingComputed.size || _pendingEffects.size) {
      while (_pendingComputed.size) {
        const f = _pendingComputed.values().next().value;
        _pendingComputed.delete(f);
        f();
      }
      if (_pendingEffects.size) {
        const f = _pendingEffects.values().next().value;
        _pendingEffects.delete(f);
        f();
      }
    }
  } finally {
    _isFlushing = false;
  }
};

function _notify(subs) {
  for (const f of subs) (f._isComputed ? _pendingComputed : _pendingEffects).add(f);
  if (_batchDepth > 0 || _isFlushing) return;
  if (_mode === 'microtask') _scheduleMicrotaskFlush();
  else flushSync();
}

class Signal {
  constructor(v, eq) { this._v = v; this._subs = new Set(); this._eq = eq ?? ((a, b) => a === b); }
  get value() {
    if (_eff) { this._subs.add(_eff); _tracking?.add(this); }
    return this._v;
  }
  set value(v) {
    if (this._eq(v, this._v)) return;
    this._v = v;
    _notify(this._subs);
  }
  peek() { return this._v; }
}

export const signal = (v, { equals } = {}) => new Signal(v, equals);

function _run(fn, runner, deps, cleanups) {
  const prevDeps = new Set(deps);
  for (const d of deps) d._subs.delete(runner);
  deps.clear();
  cleanups?.forEach(f => f?.());
  cleanups?.splice(0);

  const prev = [_eff, _tracking, _currCleanups];
  [_eff, _tracking, _currCleanups] = [runner, deps, cleanups];
  try {
    return fn();
  } catch (e) {
    for (const d of prevDeps) { d._subs.add(runner); deps.add(d); }
    throw e;
  } finally {
    [_eff, _tracking, _currCleanups] = prev;
  }
}

export const computed = fn => {
  const s = new Signal(undefined), deps = new Set();
  const run = () => {
    try {
      const v = _run(fn, run, deps, null);
      if (v !== s._v) { s._v = v; _notify(s._subs); }
    } catch (e) { console.error('[computed]', e); }
  };
  run._isComputed = true;
  run();
  return s;
};

export const effect = fn => {
  const deps = new Set(), cleanups = [];
  const run = () => {
    try {
      const ret = _run(fn, run, deps, cleanups);
      if (typeof ret === 'function') cleanups.push(ret);
    } catch (e) { console.error('[effect]', e); }
  };
  run();
  return () => {
    for (const d of deps) d._subs.delete(run);
    deps.clear();
    cleanups.forEach(f => f?.());
    cleanups.splice(0);
  };
};

export const batch = fn => {
  _batchDepth++;
  try { fn(); } finally {
    if (--_batchDepth === 0) {
      flushSync(); // explicit batch() always commits synchronously at its own close, even in 'microtask' mode
    }
  }
};

// Fix: use mounted flag instead of v !== old to respect signal's own equality
export const watch = (sig, cb) => {
  let old = sig.peek(), mounted = false;
  return effect(() => {
    const v = sig.value;
    if (mounted) { cb(v, old); }
    mounted = true;
    old = v;
  });
};

export const onCleanup = fn => { if (_currCleanups) _currCleanups.push(fn); };

// Fix: catch async errors so rejections aren't silently swallowed
export const asyncEffect = fn => effect(() => {
  const ctrl = new AbortController();
  Promise.resolve(fn(ctrl.signal)).catch(e => {
    if (e?.name !== 'AbortError') console.error('[asyncEffect]', e);
  });
  return () => ctrl.abort();
});

// ── store: per-field reactive array of objects ──────────────────────────────
// Plain `signal([...])` + immutable updates (`.map()`/`.filter()`) is the
// default pattern everywhere else in this lib, and stays that way — it's
// simple and each write is O(n) to rebuild the array, which is fine for
// occasional whole-list changes. `store()` exists for the opposite case: a
// large list where individual cells change often (e.g. a live-updating
// table). Reading `row.field` inside a render lazily creates a Signal for
// that one field; writing `row.field = x` notifies only whoever read that
// exact field — never touches the array-shape signal, so nothing that
// merely renders *other* rows/cells reruns. `For` (dom.js) gives each row
// its own effect scope specifically so it can pick these up directly,
// bypassing the O(n) key-diff entirely for pure field edits.
// Structural ops (push/splice/sort/assigning a new object at an index/
// length=) invalidate row identity and bump a separate `structural` signal —
// callers that only iterate (`.length`, `for..of`) depend on shape, not on
// any field, so they don't rerun for field-only writes either.
const _idxRe = /^\d+$/;
const _structuralMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'];

function _wrapRow(arr, index, rowCache) {
  let entry = rowCache.get(index);
  if (entry) return entry.proxy;
  const fields = new Map();
  const fieldSignal = prop => {
    let s = fields.get(prop);
    if (!s) { s = new Signal(arr[index]?.[prop]); fields.set(prop, s); }
    return s;
  };
  const proxy = new Proxy({}, {
    get(_, prop) {
      if (typeof prop === 'symbol') return arr[index]?.[prop];
      return fieldSignal(prop).value;
    },
    set(_, prop, value) {
      const target = arr[index];
      if (target) target[prop] = value;
      fieldSignal(prop).value = value;
      return true;
    },
    has(_, prop) { return arr[index] != null && prop in arr[index]; },
    ownKeys() { return arr[index] ? Reflect.ownKeys(arr[index]) : []; },
    getOwnPropertyDescriptor(_, prop) {
      const target = arr[index];
      if (!target || !(prop in target)) return undefined;
      return { enumerable: true, configurable: true, value: fieldSignal(prop).value };
    },
  });
  rowCache.set(index, { proxy });
  return proxy;
}

export const store = initial => {
  if (!Array.isArray(initial)) throw new TypeError('store() currently only supports arrays');
  const arr = initial;
  const structural = new Signal(0, () => false); // never equal → every bump notifies
  const rowCache = new Map();
  const bump = () => { structural.value = structural._v + 1; };

  return new Proxy(arr, {
    get(target, prop, receiver) {
      if (prop === 'length') { structural.value; return target.length; }
      if (typeof prop === 'string' && _idxRe.test(prop)) {
        structural.value;
        const idx = Number(prop);
        return idx < target.length ? _wrapRow(target, idx, rowCache) : undefined;
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
      if (typeof prop === 'string' && _idxRe.test(prop)) {
        target[Number(prop)] = value;
        rowCache.delete(Number(prop)); // new object identity at this slot
        bump();
        return true;
      }
      if (prop === 'length') { target.length = value; rowCache.clear(); bump(); return true; }
      return Reflect.set(target, prop, value);
    },
  });
};

// Single regex pass instead of 4 chained .replace() calls — esc() runs on
// every interpolated value in every h`` template and every keyedList/
// virtualList item render, so this is one of the hottest paths in the lib.
const _escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc  = s => String(s ?? '').replace(/[&<>"]/g, c => _escMap[c]);
export const html = s => ({ __trusted: true, value: String(s ?? '') });
