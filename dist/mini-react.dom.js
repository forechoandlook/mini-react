/* mini-react/dom v0.1.8 | https://github.com/forechoandlook/mini-react */

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
  const mark = () => {
    if (dirty || disposed) return;
    dirty = true;
    _notify(s._subs);
  };
  mark._isComputed = true;
  const read = () => {
    if (!dirty || disposed) return s._v;
    dirty = false;
    try {
      const v = _run(fn, mark, deps, null);
      if (v !== s._v) s._v = v;
    } catch (e) {
      dirty = true;
      console.error("[computed]", e);
    }
    return s._v;
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

// src/dom.js
var text = (sig) => ({ __bind: "text", sig, render: (el) => el.textContent = esc(sig.value) });
var cls = (mapSig) => ({ __bind: "class", sig: mapSig, render: (el) => el.className = Object.entries(mapSig.value).filter(([, v]) => v).map(([k]) => k).join(" ") });
var attr = (name, sig) => ({ __bind: "attr", name, sig, render: (el) => el.setAttribute(name, sig.value) });
function _focusPath(root, node) {
  if (!node || !root.contains(node)) return null;
  if (node.id) return { by: "id", id: node.id, tag: node.tagName };
  const name = node.getAttribute?.("name");
  if (name) return { by: "name", name, tag: node.tagName };
  const path = [];
  let cur = node;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) return null;
    path.unshift([...parent.children].indexOf(cur));
    cur = parent;
  }
  return { by: "path", tag: node.tagName, path };
}
var _escAttr = (s) => String(s).replace(/["\\]/g, "\\$&");
function _resolveFocusPath(root, info) {
  if (!info) return null;
  if (info.by === "id") return root.querySelector(`[id="${_escAttr(info.id)}"]`);
  if (info.by === "name") return root.querySelector(`[name="${_escAttr(info.name)}"]`);
  let cur = root;
  for (const idx of info.path) {
    cur = cur?.children?.[idx];
    if (!cur) break;
  }
  return cur && cur.tagName === info.tag ? cur : null;
}
function _captureFocus(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active)) return () => {
  };
  const info = _focusPath(root, active);
  if (!info) return () => {
  };
  const isTextField = "selectionStart" in active && typeof active.selectionStart === "number";
  const selStart = isTextField ? active.selectionStart : null;
  const selEnd = isTextField ? active.selectionEnd : null;
  const scrollTop = active.scrollTop;
  return () => {
    const next = _resolveFocusPath(root, info);
    if (!next || next === active) return;
    next.focus({ preventScroll: true });
    if (isTextField && "setSelectionRange" in next && selStart != null) {
      try {
        next.setSelectionRange(selStart, selEnd);
      } catch {
      }
    }
    next.scrollTop = scrollTop;
  };
}
function _nodeKey(n) {
  if (!n || n.nodeType !== 1) return null;
  const dk = n.getAttribute("data-key");
  if (dk != null) return `k:${dk}`;
  if (n.id) return `id:${n.id}`;
  return null;
}
function _sameNodeType(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  return a.nodeType === 1 ? a.tagName === b.tagName : true;
}
function _patchAttrs(oldEl, newEl) {
  const newAttrs = newEl.attributes, oldAttrs = oldEl.attributes;
  for (let i = 0; i < newAttrs.length; i++) {
    const { name, value } = newAttrs[i];
    if (oldEl.getAttribute(name) !== value) oldEl.setAttribute(name, value);
  }
  for (let i = oldAttrs.length - 1; i >= 0; i--) {
    const name = oldAttrs[i].name;
    if (!newEl.hasAttribute(name)) oldEl.removeAttribute(name);
  }
  const tag = oldEl.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    if (oldEl !== document.activeElement && oldEl.value !== newEl.value) oldEl.value = newEl.value;
    if (tag === "INPUT") {
      const checked = newEl.hasAttribute("checked");
      if (oldEl.checked !== checked) oldEl.checked = checked;
    }
  } else if (tag === "OPTION") {
    const selected = newEl.hasAttribute("selected");
    if (oldEl.selected !== selected) oldEl.selected = selected;
  }
}
function _patchNode(oldNode, newNode) {
  if (oldNode.nodeType === 3 || oldNode.nodeType === 8) {
    if (oldNode.data !== newNode.data) oldNode.data = newNode.data;
    return;
  }
  if (oldNode.nodeType !== 1) return;
  _patchAttrs(oldNode, newNode);
  _morphChildren(oldNode, newNode);
}
function _morphChildren(parent, newParent) {
  const initialOld = new Set(parent.childNodes);
  const oldKeyMap = /* @__PURE__ */ new Map();
  for (const n of parent.childNodes) {
    const k = _nodeKey(n);
    if (k != null && !oldKeyMap.has(k)) oldKeyMap.set(k, n);
  }
  const usedOld = /* @__PURE__ */ new Set();
  let oldCursor = parent.firstChild;
  let newChild = newParent.firstChild;
  while (newChild) {
    const nextNewChild = newChild.nextSibling;
    const k = _nodeKey(newChild);
    let match = null;
    if (k != null) {
      const candidate = oldKeyMap.get(k);
      if (candidate && !usedOld.has(candidate) && _sameNodeType(candidate, newChild)) match = candidate;
    } else if (oldCursor && initialOld.has(oldCursor) && !usedOld.has(oldCursor) && _nodeKey(oldCursor) == null && _sameNodeType(oldCursor, newChild)) {
      match = oldCursor;
    }
    if (match) {
      if (match !== oldCursor) parent.insertBefore(match, oldCursor);
      _patchNode(match, newChild);
      usedOld.add(match);
      oldCursor = match.nextSibling;
    } else {
      parent.insertBefore(document.importNode(newChild, true), oldCursor);
    }
    newChild = nextNewChild;
  }
  for (const n of initialOld) {
    if (!usedOld.has(n) && n.parentNode === parent) parent.removeChild(n);
  }
}
function _morphInto(el, htmlStr) {
  const tpl = document.createElement("template");
  tpl.innerHTML = htmlStr;
  _morphChildren(el, tpl.content);
}
var _templateCache = /* @__PURE__ */ new WeakMap();
var _urlAttributes = /* @__PURE__ */ new Set(["action", "formaction", "href", "src", "xlink:href"]);
function _validateTemplateBindings(bindings, slotCount) {
  const seen = /* @__PURE__ */ new Set();
  for (const binding of bindings) {
    if (binding.kind === "attr") {
      const name = binding.attrName.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        throw new TypeError(`h: dynamic ${binding.attrName} attributes are not allowed; attach events with on()/delegate.on()`);
      }
      for (const slot of binding.slots) seen.add(slot);
    } else seen.add(binding.index);
  }
  if (seen.size !== slotCount || [...seen].some((i) => i < 0 || i >= slotCount)) {
    throw new TypeError("h: every interpolation must be a complete child or attribute value");
  }
}
function _safeAttributeValue(name, value) {
  if (!_urlAttributes.has(name.toLowerCase())) return value;
  const normalized = String(value).replace(/[\u0000-\u0020]/g, "").toLowerCase();
  return normalized.startsWith("javascript:") || normalized.startsWith("vbscript:") || normalized.startsWith("data:text/html") ? null : value;
}
function _classifySlotKinds(strings) {
  const kinds = [];
  let acc = "";
  for (let i = 0; i < strings.length - 1; i++) {
    acc += strings[i];
    kinds.push(acc.lastIndexOf("<") > acc.lastIndexOf(">") ? "attr" : "child");
  }
  return kinds;
}
function _recordBindings(root) {
  const bindings = [];
  const walk = (node, path) => {
    if (node.nodeType === 8) {
      const m = /^@@h(\d+)@@$/.exec(node.data);
      if (m) bindings.push({ path, kind: "child", index: Number(m[1]) });
      return;
    }
    if (node.nodeType === 1) {
      for (const a of [...node.attributes]) {
        if (a.value.includes("@@h")) {
          const slots = [...a.value.matchAll(/@@h(\d+)@@/g)].map((mm) => Number(mm[1]));
          bindings.push({ path, kind: "attr", attrName: a.name, template: a.value, slots });
        }
      }
    }
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i], [...path, i]);
  };
  for (let i = 0; i < root.childNodes.length; i++) walk(root.childNodes[i], [i]);
  return bindings;
}
function _compileTemplate(strings) {
  let compiled = _templateCache.get(strings);
  if (compiled) return compiled;
  const kinds = _classifySlotKinds(strings);
  let html2 = strings[0];
  for (let i = 0; i < kinds.length; i++) {
    html2 += kinds[i] === "child" ? `<!--@@h${i}@@-->` : `@@h${i}@@`;
    html2 += strings[i + 1];
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = html2;
  const bindings = _recordBindings(tpl.content);
  _validateTemplateBindings(bindings, strings.length - 1);
  compiled = { tpl, bindings };
  _templateCache.set(strings, compiled);
  return compiled;
}
function _resolvePath(root, path) {
  let node = root;
  for (const i of path) node = node.childNodes[i];
  return node;
}
function _isComponentValue(v) {
  return typeof v === "function" || v != null && typeof v === "object" && (v.__isComponent || v.__isTemplateResult || v.html != null || v.setup || v.children);
}
function _teardownForEntry(entry) {
  entry.rowStop?.();
  entry.tplState?.dispose?.();
  for (const n of entry.nodes) n.parentNode?.removeChild(n);
}
function _teardownChildBinding(lb) {
  lb.childStop?.();
  lb.childStop = null;
  if (lb.forMap) {
    for (const entry of lb.forMap.values()) _teardownForEntry(entry);
    lb.forMap = null;
  }
  for (const n of lb.owned) n.parentNode?.removeChild(n);
  lb.owned = [];
}
function _renderForEntry(parent, entry, result) {
  const swap = (newNodes) => {
    if (entry.nodes.length) {
      const anchor = entry.nodes[entry.nodes.length - 1].nextSibling;
      for (const n of entry.nodes) n.parentNode?.removeChild(n);
      for (const n of newNodes) parent.insertBefore(n, anchor);
    }
    entry.nodes = newNodes;
  };
  if (result?.__isTemplateResult) {
    const { tpl, bindings } = _compileTemplate(result.strings);
    if (!entry.tplState || entry.tplState.tpl !== tpl) {
      entry.tplState?.dispose();
      const root = tpl.content.cloneNode(true);
      const liveBindings = bindings.map((b) => _instantiateBinding(root, b));
      swap([...root.childNodes]);
      entry.tplState = { tpl, liveBindings, dispose: () => liveBindings.forEach((b) => b.kind === "child" && _teardownChildBinding(b)) };
    }
    for (const b of entry.tplState.liveBindings) {
      if (b.kind === "attr") _updateAttrBinding(b, result.values);
      else _updateChildBinding(b, result.values);
    }
  } else {
    const html2 = result == null ? "" : String(result);
    if (entry.lastHtml !== html2) {
      const t = document.createElement("template");
      t.innerHTML = html2;
      swap([...t.content.childNodes]);
      entry.lastHtml = html2;
    }
  }
}
function _updateForBinding(lb, forVal) {
  const { items, keyFn, render } = forVal;
  if (lb.lastKind !== "for") {
    _teardownChildBinding(lb);
    lb.forMap = /* @__PURE__ */ new Map();
    lb.forKeys = [];
    lb.lastKind = "for";
  }
  const map = lb.forMap;
  const parent = lb.marker.parentNode;
  let sameShape = items.length === lb.forKeys.length;
  if (sameShape) {
    for (let i = 0; i < items.length; i++) {
      if (keyFn(items[i], i) !== lb.forKeys[i]) {
        sameShape = false;
        break;
      }
    }
  }
  if (sameShape) {
    for (let i = 0; i < items.length; i++) {
      map.get(lb.forKeys[i]).itemSig.value = items[i];
    }
    return;
  }
  const usedKeys = /* @__PURE__ */ new Set();
  const newKeys = new Array(items.length);
  let cursor = lb.marker;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = keyFn(item, i);
    newKeys[i] = key;
    usedKeys.add(key);
    let entry = map.get(key);
    if (!entry) {
      entry = { nodes: [], tplState: null, itemSig: signal(item), indexSig: signal(i), rowStop: null };
      entry.rowStop = effect(() => _renderForEntry(parent, entry, render(entry.itemSig.value, entry.indexSig.value)));
      map.set(key, entry);
    } else {
      batch(() => {
        entry.indexSig.value = i;
        entry.itemSig.value = item;
      });
    }
    let after = cursor.nextSibling;
    for (const n of entry.nodes) {
      if (n !== after) parent.insertBefore(n, after);
      after = n.nextSibling;
    }
    cursor = entry.nodes[entry.nodes.length - 1] ?? cursor;
  }
  for (const [key, entry] of map) {
    if (!usedKeys.has(key)) {
      _teardownForEntry(entry);
      map.delete(key);
    }
  }
  lb.forKeys = newKeys;
}
function _updateChildBinding(lb, values) {
  const value = values[lb.index];
  if (value?.__isFor) {
    _updateForBinding(lb, value);
    lb.lastValue = value;
    return;
  }
  if (Object.is(value, lb.lastValue)) return;
  lb.lastValue = value;
  if (_isComponentValue(value)) {
    _teardownChildBinding(lb);
    const wrapper = document.createElement("span");
    wrapper.style.display = "contents";
    lb.marker.after(wrapper);
    lb.childStop = mount(wrapper, () => typeof value === "function" ? value() : value);
    lb.owned = [wrapper];
    lb.lastKind = "component";
    return;
  }
  if (value != null && typeof value === "object" && value.__trusted) {
    _teardownChildBinding(lb);
    const tpl = document.createElement("template");
    tpl.innerHTML = value.value;
    const nodes = [...tpl.content.childNodes];
    lb.marker.after(...nodes);
    lb.owned = nodes;
    lb.lastKind = "trusted";
    return;
  }
  const text2 = value == null ? "" : String(value);
  if (lb.lastKind === "text" && lb.owned[0]) {
    lb.owned[0].data = text2;
    return;
  }
  _teardownChildBinding(lb);
  const textNode = document.createTextNode(text2);
  lb.marker.after(textNode);
  lb.owned = [textNode];
  lb.lastKind = "text";
}
function _updateAttrBinding(lb, values) {
  let changed = false;
  for (const slot of lb.slots) if (lb.lastValues[slot] !== values[slot]) changed = true;
  if (!changed) return;
  let out = lb.template;
  for (const slot of lb.slots) {
    lb.lastValues[slot] = values[slot];
    out = out.split(`@@h${slot}@@`).join(values[slot] == null ? "" : String(values[slot]));
  }
  out = _safeAttributeValue(lb.attrName, out);
  if (out == null) {
    lb.el.removeAttribute(lb.attrName);
    return;
  }
  const tag = lb.el.tagName;
  if (lb.attrName === "value" && (tag === "INPUT" || tag === "TEXTAREA")) {
    if (lb.el !== document.activeElement && lb.el.value !== out) lb.el.value = out;
    return;
  }
  if (lb.el.getAttribute(lb.attrName) !== out) lb.el.setAttribute(lb.attrName, out);
}
function _instantiateBinding(root, binding) {
  const node = _resolvePath(root, binding.path);
  if (binding.kind === "attr") {
    return { kind: "attr", el: node, attrName: binding.attrName, template: binding.template, slots: binding.slots, lastValues: {} };
  }
  return { kind: "child", marker: node, index: binding.index, owned: [], lastValue: void 0, lastKind: null, childStop: null };
}
function _renderTemplateResult(el, result, prevState) {
  const { tpl, bindings } = _compileTemplate(result.strings);
  let state = prevState;
  if (!state || state.tpl !== tpl) {
    state?.dispose();
    const root = tpl.content.cloneNode(true);
    const liveBindings = bindings.map((b) => _instantiateBinding(root, b));
    el.textContent = "";
    el.appendChild(root);
    state = { tpl, liveBindings, dispose: () => liveBindings.forEach((lb) => lb.kind === "child" && _teardownChildBinding(lb)) };
  }
  for (const lb of state.liveBindings) {
    if (lb.kind === "attr") _updateAttrBinding(lb, result.values);
    else _updateChildBinding(lb, result.values);
  }
  return state;
}
var mount = (el, component, { escape = true } = {}) => {
  let _everSetup = false, _lastCid, _setupCleanup = null, _childrenStop = null;
  let _lastHtml;
  let _tplState = null;
  const _dropTplState = () => {
    _tplState?.dispose();
    _tplState = null;
  };
  const stop = effect(() => {
    try {
      const restoreFocus = _captureFocus(el);
      _childrenStop?.();
      _childrenStop = null;
      const r = typeof component === "function" ? component() : component;
      const cid = r && typeof r === "object" ? r.__cid : void 0;
      const isNewComponent = cid !== void 0 ? cid !== _lastCid : !_everSetup;
      if (isNewComponent && _everSetup) {
        _setupCleanup?.();
        _setupCleanup = null;
      }
      if (typeof r === "string") {
        _dropTplState();
        if (escape) {
          if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) el.textContent = r;
          else if (el.firstChild.data !== r) el.firstChild.data = r;
        } else if (r !== _lastHtml) {
          _morphInto(el, r);
          _lastHtml = r;
        }
      } else if (r?.__trusted) {
        _dropTplState();
        if (r.value !== _lastHtml) {
          _morphInto(el, r.value);
          _lastHtml = r.value;
        }
      } else if (r?.__bind) {
        _dropTplState();
        r.render(el);
      } else if (r?.__isTemplateResult) {
        _tplState = _renderTemplateResult(el, r, _tplState);
      } else if (r && typeof r === "object") {
        _dropTplState();
        const rawHtml = typeof r.html === "function" ? r.html() : r.html ?? r.render?.() ?? "";
        if (rawHtml !== _lastHtml) {
          _morphInto(el, rawHtml);
          _lastHtml = rawHtml;
        }
        if (r.setup && isNewComponent) {
          _everSetup = true;
          const cleanup = r.setup(el);
          if (typeof cleanup === "function") _setupCleanup = cleanup;
        }
        if (r.children) {
          const childStops = [];
          for (const [key, child] of Object.entries(r.children)) {
            const sel = /^[.#[]/.test(key) ? key : `[data-r="${key}"]`;
            const slot = el.querySelector(sel);
            if (slot) childStops.push(mount(slot, child));
          }
          _childrenStop = () => childStops.forEach((f) => f?.());
        }
      } else {
        _dropTplState();
      }
      if (cid !== void 0) _lastCid = cid;
      restoreFocus();
    } catch (e) {
      console.error("[mount]", e);
      el.innerHTML = `<div style="color:#f85149">Render error</div>`;
    }
  });
  return () => {
    stop();
    _setupCleanup?.();
    _childrenStop?.();
    _dropTplState();
  };
};
var show = (cond, yes, no = "") => () => {
  const v = cond && typeof cond === "object" && "value" in cond ? cond.value : cond;
  const branch = v ? yes : no;
  return typeof branch === "function" ? branch() : branch;
};
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
      batch(() => {
        for (const [sel, fn] of reg.get(evt)) {
          const t = e.target.closest(sel);
          if (t) fn(e, t);
        }
      });
    }, { capture: true });
  };
  return {
    // Returns an unlisten function for handler-level deregistration
    on: (evt, sel, fn) => {
      ensure(evt);
      const entry = [sel, fn];
      reg.get(evt).push(entry);
      return () => reg.set(evt, reg.get(evt).filter((e) => e !== entry));
    },
    // Removes all handlers for a selector (kept for compat)
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
var keyedList = (itemsSig, renderItem, getKey = (i) => i.id ?? i.key, { escape = true, tag = "div" } = {}) => {
  const domMap = /* @__PURE__ */ new Map();
  return (parentEl) => effect(() => {
    try {
      const items = itemsSig.value;
      const live = new Set(items.map(getKey));
      for (const [key, el] of [...domMap]) {
        if (!live.has(key)) {
          el.__tplState?.dispose?.();
          transitions.fadeOut(el).finished?.then(() => el.remove()) ?? el.remove();
          domMap.delete(key);
        }
      }
      let prev = null;
      for (const item of items) {
        const key = getKey(item);
        const raw = renderItem(item);
        let el = domMap.get(key);
        if (!el) {
          el = document.createElement(tag);
          el.dataset.key = key;
          domMap.set(key, el);
          parentEl.appendChild(el);
          transitions.slideDown(el);
        }
        if (raw?.__isTemplateResult) {
          el.__tplState = _renderTemplateResult(el, raw, el.__tplState);
        } else {
          const h2 = escape && typeof raw === "string" && !raw?.__trusted ? esc(raw) : raw?.value ?? raw;
          if (el.innerHTML !== h2) el.innerHTML = h2;
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
  const disposeRow = (entry) => {
    entry.stop();
    entry.el.__tplState?.dispose?.();
    entry.el.remove();
  };
  const renderRow = (entry) => {
    const raw = renderItem(entry.item.value, entry.index.value);
    const el = entry.el;
    if (raw?.__isTemplateResult) el.__tplState = _renderTemplateResult(el, raw, el.__tplState);
    else {
      const h2 = escape && typeof raw === "string" && !raw?.__trusted ? esc(raw) : raw?.value ?? raw;
      if (el.innerHTML !== h2) el.innerHTML = h2;
    }
  };
  const update = (track = false) => {
    const items = track ? itemsSig.value : itemsSig.peek();
    const start = Math.max(0, Math.floor(wrap.scrollTop / itemHeight) - overscan);
    const end = Math.min(items.length, Math.ceil((wrap.scrollTop + wrap.clientHeight) / itemHeight) + overscan);
    const vis = /* @__PURE__ */ new Set();
    for (let i = start; i < end; i++) {
      const item = items[i], key = item.id ?? item.key ?? i;
      vis.add(key);
      let entry = rendered.get(key);
      if (!entry) {
        const el = document.createElement("div");
        Object.assign(el.style, { position: "absolute", top: `${i * itemHeight}px`, height: `${itemHeight}px`, width: "100%" });
        entry = { el, item: signal(item), index: signal(i), stop: null };
        entry.stop = effect(() => renderRow(entry));
        inner.appendChild(el);
        rendered.set(key, entry);
      } else {
        batch(() => {
          entry.item.value = item;
          entry.index.value = i;
        });
      }
      entry.el.style.top = `${i * itemHeight}px`;
    }
    for (const [k, entry] of rendered) if (!vis.has(k)) {
      disposeRow(entry);
      rendered.delete(k);
    }
    inner.style.height = `${items.length * itemHeight}px`;
  };
  const onScroll = () => update(false);
  wrap.addEventListener("scroll", onScroll, { passive: true });
  const stopEffect = effect(() => update(true));
  return {
    el: wrap,
    dispose: () => {
      for (const entry of rendered.values()) disposeRow(entry);
      rendered.clear();
      wrap.removeEventListener("scroll", onScroll);
      stopEffect();
    }
  };
};
var createRouter = (routes, { keepAlive = false } = {}) => {
  const current = signal(location.hash.slice(1) || "/");
  let disposed = false;
  const onHashChange = () => {
    current.value = location.hash.slice(1) || "/";
  };
  window.addEventListener("hashchange", onHashChange);
  const cache = keepAlive ? /* @__PURE__ */ new Map() : null;
  const resolve = (key, factory) => {
    if (!keepAlive) return factory();
    if (cache.has(key)) return cache.get(key);
    const inst = factory();
    cache.set(key, inst);
    return inst;
  };
  const route = signal(void 0);
  const stopRoute = effect(() => {
    const path = current.value;
    for (const [pat, comp] of Object.entries(routes)) {
      if (pat === "*") continue;
      const regex = new RegExp("^" + pat.replace(/:\w+/g, "([^/]+)") + "$");
      const m = path.match(regex);
      if (m) {
        const params = m.slice(1);
        route.value = typeof comp === "function" ? resolve(`${pat}|${params.join("/")}`, () => comp(...params)) : comp;
        return;
      }
    }
    if (routes["*"]) {
      const c = routes["*"];
      route.value = typeof c === "function" ? resolve("*", c) : c;
      return;
    }
    route.value = null;
  });
  return {
    current,
    route,
    navigate: (path) => {
      if (!disposed) location.hash = path;
    },
    match: (pat) => {
      const m = current.value.match(new RegExp("^" + pat.replace(/:\w+/g, "([^/]+)") + "$"));
      return m ? m.slice(1) : null;
    },
    // Drop cached instance(s) so the next visit rebuilds fresh. Omit `pattern`
    // to clear everything; pass a route pattern to clear just that route
    // (across all of its param combinations).
    invalidate: (pattern) => {
      if (!cache) return;
      if (pattern === void 0) {
        cache.clear();
        return;
      }
      for (const k of [...cache.keys()]) if (k === pattern || k.startsWith(`${pattern}|`)) cache.delete(k);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("hashchange", onHashChange);
      stopRoute();
      cache?.clear();
    }
  };
};
var h = (strings, ...values) => ({ __isTemplateResult: true, strings, values });
var For = (items, keyFn, render) => ({ __isFor: true, items, keyFn, render });
var $ = (id) => document.getElementById(id);
var $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
var on = (el, evt, fn, opts) => {
  el.addEventListener(evt, fn, opts);
  return () => el.removeEventListener(evt, fn, opts);
};
var once = (el, evt, fn) => on(el, evt, fn, { once: true });
var nextTick = (fn) => Promise.resolve().then(fn);
function _shallowEqualProps(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!Object.is(a[k], b[k])) return false;
  return true;
}
var defineComponent = (setup, { name } = {}) => {
  let _cache = null;
  const factory = (props = {}) => {
    if (_cache && _shallowEqualProps(_cache.props, props)) return _cache.instance;
    const stops = [], mountCbs = [], unmountCbs = [];
    const ctx = {
      signal: (v, opts) => signal(v, opts),
      computed: (fn) => computed(fn),
      effect: (fn) => {
        const s = effect(fn);
        stops.push(s);
        return s;
      },
      asyncEffect: (fn) => {
        const s = effect(() => {
          const ctrl = new AbortController();
          Promise.resolve(fn(ctrl.signal)).catch((e) => {
            if (e?.name !== "AbortError") console.error("[asyncEffect]", e);
          });
          return () => ctrl.abort();
        });
        stops.push(s);
        return s;
      },
      onMount: (fn) => mountCbs.push(fn),
      onUnmount: (fn) => unmountCbs.push(fn)
    };
    const renderFn = setup(props, ctx);
    const instance = {
      __isComponent: true,
      // Stable per-instance id so mount() can tell "same instance, revisited"
      // (skip setup) apart from "a different component swapped in" (run its
      // setup) — see the comment in mount() for why this matters.
      __cid: Symbol(name ?? setup.name ?? "Component"),
      html: typeof renderFn === "function" ? renderFn : () => String(renderFn ?? ""),
      setup: (el) => {
        nextTick(() => mountCbs.forEach((fn) => fn(el)));
        return () => {
          unmountCbs.forEach((fn) => fn());
          stops.forEach((s) => s());
          if (_cache?.instance === instance) _cache = null;
        };
      }
    };
    _cache = { props, instance };
    return instance;
  };
  factory.displayName = name ?? setup.name ?? "Component";
  factory.__isComponent = true;
  return factory;
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
  For,
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
  flushSync,
  getSchedulerStats,
  getUpdateMode,
  h,
  html,
  keyedList,
  mount,
  nextTick,
  on,
  onCleanup,
  once,
  setSchedulerMaxRuns,
  setUpdateMode,
  show,
  signal,
  store,
  text,
  throttle,
  transitions,
  virtualList,
  watch
};
