export { signal, computed, effect, batch, watch, onCleanup, esc, html } from './core.js';
import { signal, computed, effect, esc } from './core.js';

// ── Bind descriptors ──────────────────────────────────────────────────────────
export const text = sig        => ({ __bind:'text',  sig, render: el => el.textContent = esc(sig.value) });
export const cls  = mapSig     => ({ __bind:'class', sig: mapSig, render: el => el.className = Object.entries(mapSig.value).filter(([,v])=>v).map(([k])=>k).join(' ') });
export const attr = (name,sig) => ({ __bind:'attr',  name, sig, render: el => el.setAttribute(name, sig.value) });

// ── Focus preservation across innerHTML replacement ────────────────────────────
// A plain `el.innerHTML = ...` re-render destroys and recreates every node in
// `el`, so a focused <input>/<textarea> (e.g. a search box bound to its own
// signal) loses focus on every keystroke — the browser drops the old node,
// the new one starts unfocused, and only one character lands per render.
// We snapshot which element had focus (+ its selection) before the swap and
// re-locate the equivalent element afterwards to restore it.
function _focusPath(root, node) {
  if (!node || !root.contains(node)) return null;
  if (node.id) return { by: 'id', id: node.id, tag: node.tagName };
  const name = node.getAttribute?.('name');
  if (name) return { by: 'name', name, tag: node.tagName };
  const path = [];
  let cur = node;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(cur));
    cur = parent;
  }
  return { by: 'path', tag: node.tagName, path };
}

// Avoids relying on the global CSS.escape (not always present outside real
// browsers, e.g. in test runners) for the handful of characters that would
// otherwise break the attribute-selector strings built below.
const _escAttr = s => String(s).replace(/["\\]/g, '\\$&');

function _resolveFocusPath(root, info) {
  if (!info) return null;
  let found = null;
  if (info.by === 'id') found = root.querySelector(`[id="${_escAttr(info.id)}"]`);
  else if (info.by === 'name') found = root.querySelector(`${info.tag}[name="${_escAttr(info.name)}"]`);
  else {
    let cur = root;
    for (const idx of info.path) { cur = cur?.children?.[idx]; if (!cur) break; }
    found = cur ?? null;
  }
  return found && found.tagName === info.tag ? found : null;
}

function _captureFocus(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active)) return () => {};
  const info = _focusPath(root, active);
  if (!info) return () => {};
  const isTextField = 'selectionStart' in active && typeof active.selectionStart === 'number';
  const selStart = isTextField ? active.selectionStart : null;
  const selEnd = isTextField ? active.selectionEnd : null;
  const scrollTop = active.scrollTop;
  return () => {
    const next = _resolveFocusPath(root, info);
    if (!next || next === active) return;
    next.focus({ preventScroll: true });
    if (isTextField && 'setSelectionRange' in next && selStart != null) {
      try { next.setSelectionRange(selStart, selEnd); } catch {}
    }
    next.scrollTop = scrollTop;
  };
}

// ── DOM mount ─────────────────────────────────────────────────────────────────
export const mount = (el, component, { escape = true } = {}) => {
  // Identity for the "run setup once" rule below.
  //  - defineComponent() tags each instance with a stable `__cid`, so a
  //    *different* component swapped into the same mount point (e.g. a
  //    router switching routes) is correctly detected as new and gets its
  //    own setup()/onMount — while the *same* cached instance revisited
  //    (router keepAlive) is correctly recognized and setup is not rerun.
  //  - Plain `{ html, setup }` object literals returned fresh from the
  //    render function every time (a common, tested pattern — there's no
  //    stable reference to compare) have no `__cid`; for those we keep the
  //    original behavior of running setup exactly once ever for this mount
  //    point, since object identity can't tell "same logical component" from
  //    "different one" for them.
  let _everSetup = false, _lastCid, _setupCleanup = null, _childrenStop = null;

  const stop = effect(() => {
    try {
      const restoreFocus = _captureFocus(el);

      // Stop children from previous render before replacing innerHTML
      _childrenStop?.();
      _childrenStop = null;

      const r = typeof component === 'function' ? component() : component;
      const cid = r && typeof r === 'object' ? r.__cid : undefined;
      const isNewComponent = cid !== undefined ? cid !== _lastCid : !_everSetup;

      if (isNewComponent && _everSetup) {
        _setupCleanup?.();
        _setupCleanup = null;
      }

      if (typeof r === 'string')           { el.innerHTML = escape ? esc(r) : r; }
      else if (r?.__trusted)              { el.innerHTML = r.value; }
      else if (r?.__bind)                 { r.render(el); }
      else if (r && typeof r === 'object') {
        const rawHtml = typeof r.html === 'function' ? r.html() : (r.html ?? r.render?.() ?? '');
        el.innerHTML = rawHtml;

        // Setup runs once per distinct component instance
        if (r.setup && isNewComponent) {
          _everSetup = true;
          const cleanup = r.setup(el);
          if (typeof cleanup === 'function') _setupCleanup = cleanup;
        }

        // Children re-mount on every render into fresh DOM
        if (r.children) {
          const childStops = [];
          for (const [key, child] of Object.entries(r.children)) {
            const sel = /^[.#[]/.test(key) ? key : `[data-r="${key}"]`;
            const slot = el.querySelector(sel);
            if (slot) childStops.push(mount(slot, child));
          }
          _childrenStop = () => childStops.forEach(f => f?.());
        }
      }
      if (cid !== undefined) _lastCid = cid;
      restoreFocus();
    } catch (e) { console.error('[mount]', e); el.innerHTML = `<div style="color:#f85149">Render error</div>`; }
  });

  return () => { stop(); _setupCleanup?.(); _childrenStop?.(); };
};

export const show = (cond, yes, no = '') => () => {
  const v = cond && typeof cond === 'object' && 'value' in cond ? cond.value : cond;
  const branch = v ? yes : no;
  return typeof branch === 'function' ? branch() : branch;
};

// ── Two-way bind ──────────────────────────────────────────────────────────────
export const bind = (el, sig) => {
  const stop = effect(() => { el.value = sig.value ?? ''; });
  const onInput = () => { sig.value = el.value; };
  el.addEventListener('input', onInput);
  return () => { stop(); el.removeEventListener('input', onInput); };
};

// ── Event delegation ──────────────────────────────────────────────────────────
export const delegate = (() => {
  const reg = new Map();
  const ensure = evt => {
    if (reg.has(evt)) return;
    reg.set(evt, []);
    document.addEventListener(evt, e => {
      for (const [sel, fn] of reg.get(evt)) { const t = e.target.closest(sel); if (t) fn(e, t); }
    }, { capture: true });
  };
  return {
    // Returns an unlisten function for handler-level deregistration
    on: (evt, sel, fn) => {
      ensure(evt);
      const entry = [sel, fn];
      reg.get(evt).push(entry);
      return () => reg.set(evt, reg.get(evt).filter(e => e !== entry));
    },
    // Removes all handlers for a selector (kept for compat)
    off: (evt, sel) => { if (reg.has(evt)) reg.set(evt, reg.get(evt).filter(([s]) => s !== sel)); },
  };
})();

// ── Animations ────────────────────────────────────────────────────────────────
export const animate = (el, kf, opts = { duration: 300 }) => el.animate(kf, opts);
export const transitions = {
  fadeIn:    el => animate(el, [{opacity:0},{opacity:1}],                                                    {duration:200}),
  fadeOut:   el => animate(el, [{opacity:1},{opacity:0}],                                                    {duration:180}),
  slideDown: el => animate(el, [{opacity:0,transform:'translateY(-8px)'},{opacity:1,transform:'translateY(0)'}], {duration:220}),
};

// ── Keyed list ────────────────────────────────────────────────────────────────
// tag option lets callers control the wrapper element type (e.g. 'li' for <ul>)
export const keyedList = (itemsSig, renderItem, getKey = i => i.id ?? i.key, { escape = true, tag = 'div' } = {}) => {
  const domMap = new Map();
  return parentEl => effect(() => {
    try {
      const items = itemsSig.value;
      const live  = new Set(items.map(getKey));
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
        const h   = escape && typeof raw === 'string' && !raw?.__trusted ? esc(raw) : (raw?.value ?? raw);
        let el = domMap.get(key);
        if (!el) {
          el = document.createElement(tag);
          el.dataset.key = key; el.innerHTML = h;
          domMap.set(key, el); parentEl.appendChild(el);
          transitions.slideDown(el);
        } else if (el.innerHTML !== h) { el.innerHTML = h; }
        if (prev) { const next = prev.nextSibling; if (next !== el) parentEl.insertBefore(el, next); }
        else if (parentEl.firstChild !== el) parentEl.insertBefore(el, parentEl.firstChild);
        prev = el;
      }
    } catch (e) { console.error('[keyedList]', e); }
  });
};

// ── Virtual scroll ────────────────────────────────────────────────────────────
export const virtualList = (itemsSig, renderItem, itemHeight = 50, overscan = 5, { escape = true } = {}) => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position:'relative', overflow:'auto', height:'100%' });
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  wrap.appendChild(inner);
  const rendered = new Map();
  const update = () => {
    const items = itemsSig.value;
    const start = Math.max(0, Math.floor(wrap.scrollTop / itemHeight) - overscan);
    const end   = Math.min(items.length, Math.ceil((wrap.scrollTop + wrap.clientHeight) / itemHeight) + overscan);
    const vis   = new Set();
    for (let i = start; i < end; i++) {
      const item = items[i], key = item.id ?? item.key ?? i;
      vis.add(key);
      if (!rendered.has(key)) {
        const el = document.createElement('div');
        Object.assign(el.style, { position:'absolute', top:`${i*itemHeight}px`, height:`${itemHeight}px`, width:'100%' });
        const raw = renderItem(item);
        el.innerHTML = escape && typeof raw === 'string' && !raw?.__trusted ? esc(raw) : (raw?.value ?? raw);
        inner.appendChild(el); rendered.set(key, el);
      }
    }
    for (const [k, el] of rendered) if (!vis.has(k)) { el.remove(); rendered.delete(k); }
    inner.style.height = `${items.length * itemHeight}px`;
  };
  wrap.addEventListener('scroll', update, { passive: true });
  // Fix: capture stopEffect so dispose can fully clean up
  const stopEffect = effect(() => { itemsSig.value; update(); });
  return {
    el: wrap,
    dispose: () => { rendered.clear(); wrap.removeEventListener('scroll', update); stopEffect(); },
  };
};

// ── Router ────────────────────────────────────────────────────────────────────
// keepAlive: false (default) — every navigation calls the route's factory
// fresh, matching prior behavior (a route's local component state does not
// survive leaving and returning to it).
// keepAlive: true — the component instance returned by a route's factory is
// cached per (pattern + params) and reused on repeat visits, so its signals/
// effects/DOM keep running in the background instead of being torn down and
// recreated. Safe to enable now that mount() scopes setup()/onMount to the
// specific component *instance* rather than firing at most once ever per
// mount point — earlier that dual-purpose flag caused a stale cache attempt
// to be reverted (see git history) because a cached instance's setup would
// never re-run for a *different* component swapped into the same slot.
export const createRouter = (routes, { keepAlive = false } = {}) => {
  const current = signal(location.hash.slice(1) || '/');
  window.addEventListener('hashchange', () => { current.value = location.hash.slice(1) || '/'; });
  const cache = keepAlive ? new Map() : null;
  const resolve = (key, factory) => {
    if (!keepAlive) return factory();
    if (cache.has(key)) return cache.get(key);
    const inst = factory();
    cache.set(key, inst);
    return inst;
  };
  const route = (() => {
    const s = signal(undefined);
    const run = () => {
      const path = current.value;
      for (const [pat, comp] of Object.entries(routes)) {
        if (pat === '*') continue;
        const regex = new RegExp('^' + pat.replace(/:\w+/g, '([^/]+)') + '$');
        const m = path.match(regex);
        if (m) {
          const params = m.slice(1);
          s.value = typeof comp === 'function'
            ? resolve(`${pat}|${params.join('/')}`, () => comp(...params))
            : comp;
          return;
        }
      }
      if (routes['*']) {
        const c = routes['*'];
        s.value = typeof c === 'function' ? resolve('*', c) : c;
        return;
      }
      s.value = null;
    };
    effect(run);
    return s;
  })();
  return {
    current, route,
    navigate: path => { location.hash = path; },
    match: pat => { const m = current.value.match(new RegExp('^' + pat.replace(/:\w+/g,'([^/]+)') + '$')); return m ? m.slice(1) : null; },
    // Drop cached instance(s) so the next visit rebuilds fresh. Omit `pattern`
    // to clear everything; pass a route pattern to clear just that route
    // (across all of its param combinations).
    invalidate: pattern => {
      if (!cache) return;
      if (pattern === undefined) { cache.clear(); return; }
      for (const k of [...cache.keys()]) if (k === pattern || k.startsWith(`${pattern}|`)) cache.delete(k);
    },
  };
};

// ── Component template literal ────────────────────────────────────────────────
export const h = (strings, ...values) => {
  let htmlStr = '';
  const children = {};
  let idx = 0;
  strings.forEach((str, i) => {
    htmlStr += str;
    if (i < values.length) {
      const val = values[i];
      const isComp = val !== null && val !== undefined &&
        (typeof val === 'function' || val?.__isComponent ||
         (typeof val === 'object' && (val.html != null || val.setup || val.children)));
      if (isComp) {
        const id = `__s${idx++}`;
        htmlStr += `<span data-slot="${id}"></span>`;
        children[`[data-slot="${id}"]`] = val;
      } else {
        htmlStr += esc(String(val ?? ''));
      }
    }
  });
  return Object.keys(children).length ? { html: htmlStr, children } : htmlStr;
};

// ── Utils ─────────────────────────────────────────────────────────────────────
export const $         = id => document.getElementById(id);
export const $$        = (sel, root = document) => [...root.querySelectorAll(sel)];
export const on        = (el, evt, fn, opts) => { el.addEventListener(evt, fn, opts); return () => el.removeEventListener(evt, fn, opts); };
export const once      = (el, evt, fn) => on(el, evt, fn, { once: true });
export const nextTick  = fn => Promise.resolve().then(fn);

// ── defineComponent ───────────────────────────────────────────────────────────
// For stateful components with private signals, effects, and lifecycle hooks.
// setup(props, ctx) runs once; return a render function () => htmlString.
// All ctx.effect and ctx.asyncEffect are automatically stopped on unmount.
export const defineComponent = (setup, { name } = {}) => {
  const factory = (props = {}) => {
    const stops = [], mountCbs = [], unmountCbs = [];
    const ctx = {
      signal:      (v, opts) => signal(v, opts),
      computed:    fn        => computed(fn),
      effect:      fn        => { const s = effect(fn); stops.push(s); return s; },
      asyncEffect: fn        => { const s = effect(() => { const ctrl = new AbortController(); Promise.resolve(fn(ctrl.signal)).catch(e => { if (e?.name !== 'AbortError') console.error('[asyncEffect]', e); }); return () => ctrl.abort(); }); stops.push(s); return s; },
      onMount:     fn        => mountCbs.push(fn),
      onUnmount:   fn        => unmountCbs.push(fn),
    };
    const renderFn = setup(props, ctx);
    return {
      __isComponent: true,
      // Stable per-instance id so mount() can tell "same instance, revisited"
      // (skip setup) apart from "a different component swapped in" (run its
      // setup) — see the comment in mount() for why this matters.
      __cid: Symbol(name ?? setup.name ?? 'Component'),
      html: typeof renderFn === 'function' ? renderFn : () => String(renderFn ?? ''),
      setup: el => {
        nextTick(() => mountCbs.forEach(fn => fn(el)));
        return () => { unmountCbs.forEach(fn => fn()); stops.forEach(s => s()); };
      },
    };
  };
  factory.displayName = name ?? setup.name ?? 'Component';
  factory.__isComponent = true;
  return factory;
};

export const debounce = (fn, ms) => {
  let t;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush  = (...args) => { clearTimeout(t); fn(...args); };
  return d;
};

export const throttle = (fn, ms) => {
  let last = 0, t;
  const d = (...args) => {
    const now = Date.now(), remaining = ms - (now - last);
    if (remaining <= 0) { clearTimeout(t); last = now; fn(...args); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...args); }, remaining); }
  };
  d.cancel = () => clearTimeout(t);
  return d;
};

export const debouncedSignal = (src, ms) => {
  const out = signal(src.peek());
  const flush = debounce(v => { out.value = v; }, ms);
  effect(() => { const v = src.value; flush(v); });
  return out;
};
