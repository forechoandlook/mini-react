/* mini-react/core v0.1.0 | https://github.com/forechoandlook/webui */

// src/core.js
var version = true ? "0.1.0" : "dev";
var _eff = null;
var _tracking = null;
var _batchDepth = 0;
var _currCleanups = null;
var _pending = /* @__PURE__ */ new Set();
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
    if (_batchDepth > 0) {
      for (const f of this._subs) _pending.add(f);
    } else {
      for (const f of [...this._subs]) f();
    }
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
  const run = () => {
    try {
      const v = _run(fn, run, deps, null);
      if (v !== s._v) {
        s._v = v;
        for (const f of [...s._subs]) f();
      }
    } catch (e) {
      console.error("[computed]", e);
    }
  };
  run();
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
      const q = [..._pending];
      _pending.clear();
      for (const f of q) f();
    }
  }
};
var watch = (sig, cb) => {
  let old = sig.peek();
  return effect(() => {
    const v = sig.value;
    if (v !== old) {
      cb(v, old);
      old = v;
    }
  });
};
var onCleanup = (fn) => {
  if (_currCleanups) _currCleanups.push(fn);
};
var esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
var html = (s) => ({ __trusted: true, value: String(s ?? "") });
export {
  batch,
  computed,
  effect,
  esc,
  html,
  onCleanup,
  signal,
  version,
  watch
};
