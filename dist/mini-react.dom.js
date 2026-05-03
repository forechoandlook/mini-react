/* mini-react/dom v0.1.0 | https://github.com/forechoandlook/webui */

// src/core.js
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

// src/dom.js
var text = (sig) => ({ __bind: "text", sig, render: (el) => el.textContent = esc(sig.value) });
var cls = (mapSig) => ({ __bind: "class", sig: mapSig, render: (el) => el.className = Object.entries(mapSig.value).filter(([, v]) => v).map(([k]) => k).join(" ") });
var attr = (name, sig) => ({ __bind: "attr", name, sig, render: (el) => el.setAttribute(name, sig.value) });
var mount = (el, component, { escape = true } = {}) => {
  let _teardown = null;
  const stop = effect(() => {
    try {
      const r = typeof component === "function" ? component() : component;
      if (typeof r === "string") {
        el.innerHTML = escape ? esc(r) : r;
      } else if (r?.__trusted) {
        el.innerHTML = r.value;
      } else if (r?.__bind) {
        r.render(el);
      } else if (r && typeof r === "object") {
        const rawHtml = typeof r.html === "function" ? r.html() : r.html ?? r.render?.() ?? "";
        el.innerHTML = rawHtml;
        if ((r.setup || r.children) && !_teardown) {
          const stops = [];
          if (r.children) {
            for (const [key, child] of Object.entries(r.children)) {
              const sel = /^[.#[]/.test(key) ? key : `[data-r="${key}"]`;
              const slot = el.querySelector(sel);
              if (slot) stops.push(mount(slot, child));
            }
          }
          if (r.setup) {
            const cleanup = r.setup(el);
            if (typeof cleanup === "function") stops.push(cleanup);
          }
          _teardown = () => stops.forEach((f) => f?.());
        }
      }
    } catch (e) {
      console.error("[mount]", e);
      el.innerHTML = `<div style="color:#f85149">Render error</div>`;
    }
  });
  return () => {
    stop();
    _teardown?.();
  };
};
var show = (cond, yes, no = () => "") => () => cond.value ? yes() : no();
var bind = (el, sig) => {
  const stop = effect(() => {
    el.value = sig.value ?? "";
  });
  const onInput = () => {
    sig.value = el.value;
  };
  el.addEventListener("input", onInput);
  return () => {
    stop();
    el.removeEventListener("input", onInput);
  };
};
var delegate = /* @__PURE__ */ (() => {
  const reg = /* @__PURE__ */ new Map();
  const ensure = (evt) => {
    if (reg.has(evt)) return;
    reg.set(evt, []);
    document.addEventListener(evt, (e) => {
      for (const [sel, fn] of reg.get(evt)) {
        const t = e.target.closest(sel);
        if (t) fn(e, t);
      }
    }, { capture: true });
  };
  return {
    on: (evt, sel, fn) => {
      ensure(evt);
      reg.get(evt).push([sel, fn]);
    },
    off: (evt, sel) => {
      if (reg.has(evt)) reg.set(evt, reg.get(evt).filter(([s]) => s !== sel));
    }
  };
})();
var animate = (el, kf, opts = { duration: 300 }) => el.animate(kf, opts);
var transitions = {
  fadeIn: (el) => animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 }),
  fadeOut: (el) => animate(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 }),
  slideDown: (el) => animate(el, [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 220 })
};
var keyedList = (itemsSig, renderItem, getKey = (i) => i.id ?? i.key, { escape = true } = {}) => {
  const domMap = /* @__PURE__ */ new Map();
  return (parentEl) => effect(() => {
    try {
      const items = itemsSig.value;
      const live = new Set(items.map(getKey));
      for (const [key, el] of [...domMap]) {
        if (!live.has(key)) {
          transitions.fadeOut(el).finished?.then(() => el.remove()) ?? el.remove();
          domMap.delete(key);
        }
      }
      let prev = null;
      for (const item of items) {
        const key = getKey(item);
        const raw = renderItem(item);
        const h2 = escape && typeof raw === "string" && !raw?.__trusted ? esc(raw) : raw?.value ?? raw;
        let el = domMap.get(key);
        if (!el) {
          el = document.createElement("div");
          el.dataset.key = key;
          el.innerHTML = h2;
          domMap.set(key, el);
          parentEl.appendChild(el);
          transitions.slideDown(el);
        } else if (el.innerHTML !== h2) {
          el.innerHTML = h2;
        }
        if (prev) {
          const next = prev.nextSibling;
          if (next !== el) parentEl.insertBefore(el, next);
        } else if (parentEl.firstChild !== el) parentEl.insertBefore(el, parentEl.firstChild);
        prev = el;
      }
    } catch (e) {
      console.error("[keyedList]", e);
    }
  });
};
var virtualList = (itemsSig, renderItem, itemHeight = 50, overscan = 5, { escape = true } = {}) => {
  const wrap = document.createElement("div");
  Object.assign(wrap.style, { position: "relative", overflow: "auto", height: "100%" });
  const inner = document.createElement("div");
  inner.style.position = "relative";
  wrap.appendChild(inner);
  const rendered = /* @__PURE__ */ new Map();
  const update = () => {
    const items = itemsSig.value;
    const start = Math.max(0, Math.floor(wrap.scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((wrap.scrollTop + wrap.clientHeight) / itemHeight) + overscan);
    const vis = /* @__PURE__ */ new Set();
    for (let i = start; i < end; i++) {
      const item = items[i], key = item.id ?? item.key ?? i;
      vis.add(key);
      if (!rendered.has(key)) {
        const el = document.createElement("div");
        Object.assign(el.style, { position: "absolute", top: `${i * itemHeight}px`, height: `${itemHeight}px`, width: "100%" });
        const raw = renderItem(item);
        el.innerHTML = escape && typeof raw === "string" && !raw?.__trusted ? esc(raw) : raw?.value ?? raw;
        inner.appendChild(el);
        rendered.set(key, el);
      }
    }
    for (const [k, el] of rendered) if (!vis.has(k)) {
      el.remove();
      rendered.delete(k);
    }
    inner.style.height = `${items.length * itemHeight}px`;
  };
  wrap.addEventListener("scroll", update, { passive: true });
  effect(() => {
    itemsSig.value;
    update();
  });
  return { el: wrap, dispose: () => rendered.clear() };
};
var createRouter = (routes) => {
  const current = signal(location.hash.slice(1) || "/");
  const cache = /* @__PURE__ */ new Map();
  window.addEventListener("hashchange", () => {
    current.value = location.hash.slice(1) || "/";
  });
  const route = (() => {
    const s = signal(void 0), deps = /* @__PURE__ */ new Set();
    const run = () => {
      const path = current.value;
      if (cache.has(path)) {
        s.value = cache.get(path);
        return;
      }
      for (const [pat, comp] of Object.entries(routes)) {
        if (pat === path || pat === "*") {
          const r = typeof comp === "function" ? comp() : comp;
          cache.set(path, r);
          s.value = r;
          return;
        }
      }
      s.value = null;
    };
    effect(run);
    return s;
  })();
  return {
    current,
    route,
    navigate: (path) => {
      location.hash = path;
    },
    match: (pat) => {
      const m = current.value.match(new RegExp("^" + pat.replace(/:\w+/g, "([^/]+)") + "$"));
      return m ? m.slice(1) : null;
    }
  };
};
var h = (strings, ...values) => {
  let htmlStr = "";
  const children = {};
  let idx = 0;
  strings.forEach((str, i) => {
    htmlStr += str;
    if (i < values.length) {
      const val = values[i];
      const isComp = val !== null && val !== void 0 && (typeof val === "function" || val?.__isComponent || typeof val === "object" && (val.html != null || val.setup || val.children));
      if (isComp) {
        const id = `__s${idx++}`;
        htmlStr += `<span data-slot="${id}"></span>`;
        children[`[data-slot="${id}"]`] = val;
      } else {
        htmlStr += esc(String(val ?? ""));
      }
    }
  });
  return Object.keys(children).length ? { html: htmlStr, children } : htmlStr;
};
var $ = (id) => document.getElementById(id);
var $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
var on = (el, evt, fn, opts) => {
  el.addEventListener(evt, fn, opts);
  return () => el.removeEventListener(evt, fn, opts);
};
var once = (el, evt, fn) => on(el, evt, fn, { once: true });
var nextTick = (fn) => Promise.resolve().then(fn);
var defineComponent = (fn, { name } = {}) => {
  const component = (props = {}) => fn(props);
  component.displayName = name ?? fn.name ?? "Component";
  component.__isComponent = true;
  return component;
};
var debounce = (fn, ms) => {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  d.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return d;
};
var throttle = (fn, ms) => {
  let last = 0, t;
  const d = (...args) => {
    const now = Date.now(), remaining = ms - (now - last);
    if (remaining <= 0) {
      clearTimeout(t);
      last = now;
      fn(...args);
    } else {
      clearTimeout(t);
      t = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
  d.cancel = () => clearTimeout(t);
  return d;
};
var debouncedSignal = (src, ms) => {
  const out = signal(src.peek());
  const flush = debounce((v) => {
    out.value = v;
  }, ms);
  effect(() => {
    const v = src.value;
    flush(v);
  });
  return out;
};
export {
  $,
  $$,
  animate,
  attr,
  batch,
  bind,
  cls,
  computed,
  createRouter,
  debounce,
  debouncedSignal,
  defineComponent,
  delegate,
  effect,
  esc,
  h,
  html,
  keyedList,
  mount,
  nextTick,
  on,
  onCleanup,
  once,
  show,
  signal,
  text,
  throttle,
  transitions,
  virtualList,
  watch
};
