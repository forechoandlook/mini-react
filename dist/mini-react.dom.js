/* mini-react/dom v0.1.18 | https://github.com/forechoandlook/mini-react */

// src/dom.js
import { signal, computed, effect, batch, watch, onCleanup, esc, html, store, setUpdateMode, getUpdateMode, flushSync, setSchedulerMaxRuns, getSchedulerStats } from "./mini-react.core.js";
import { signal as signal2, computed as computed2, effect as effect2, batch as batch2, esc as esc2 } from "./mini-react.core.js";
var text = (sig) => ({ __bind: "text", sig, render: (el) => el.textContent = esc2(sig.value) });
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
var _urlAttributes = /* @__PURE__ */ new Set(["action", "formaction", "href", "src", "xlink:href", "poster"]);
var _booleanAttrs = /* @__PURE__ */ new Set(["disabled", "checked", "selected", "hidden", "readonly", "required", "multiple", "autofocus", "open", "inert", "controls", "loop", "muted", "autoplay", "playsinline", "async", "defer", "reversed", "ismap", "novalidate", "formnovalidate", "allowfullscreen", "default"]);
var _svgChildTag = /^(?:<!--[\s\S]*?-->|\s)*<(rect|path|g|circle|ellipse|line|polyline|polygon|text|tspan|use|defs|clippath|lineargradient|radialgradient|stop|mask|pattern|image|foreignobject|switch|symbol|marker)\b/i;
function _validateTemplateBindings(bindings, slotCount) {
  const seen = /* @__PURE__ */ new Set();
  for (const binding of bindings) {
    if (binding.kind === "attr") {
      const name = binding.attrName.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        throw new TypeError(`h: dynamic ${binding.attrName} attributes are not allowed; attach events with on()/delegate.on()`);
      }
      for (const slot of binding.slots) seen.add(slot);
    } else if (binding.kind === "flag") {
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
  if (normalized.startsWith("javascript:") || normalized.startsWith("vbscript:")) return null;
  if (normalized.startsWith("data:")) {
    return /^data:image\/(png|jpe?g|gif|webp|avif)(;|,)/.test(normalized) ? value : null;
  }
  return value;
}
function _classifySlotKinds(strings) {
  const kinds = [];
  let mode = "text";
  let quote = "";
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      const next = s[j + 1];
      if (mode === "comment") {
        if (c === "-" && next === "-" && s[j + 2] === ">") {
          mode = "text";
          j += 2;
        }
        continue;
      }
      if (quote) {
        if (c === quote) quote = "";
        continue;
      }
      if (mode === "text") {
        if (c === "<" && next === "!" && s[j + 2] === "-" && s[j + 3] === "-") {
          mode = "comment";
          j += 3;
          continue;
        }
        if (c === "<" && (next === "/" || next === "!" || next >= "A" && next <= "Z" || next >= "a" && next <= "z")) mode = "tag";
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === ">") mode = "text";
    }
    if (i < strings.length - 1) kinds.push(mode === "text" ? "child" : "attr");
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
        if (a.name.includes("@@h")) {
          const slots = [...a.name.matchAll(/@@h(\d+)@@/g)].map((mm) => Number(mm[1]));
          bindings.push({ path, kind: "flag", template: a.name, slots });
        } else if (a.value.includes("@@h")) {
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
  const svgWrap = _svgChildTag.test(html2);
  tpl.innerHTML = svgWrap ? `<svg xmlns="http://www.w3.org/2000/svg">${html2}</svg>` : html2;
  const bindRoot = svgWrap ? tpl.content.firstElementChild : tpl.content;
  const bindings = _recordBindings(bindRoot);
  _validateTemplateBindings(bindings, strings.length - 1);
  compiled = { tpl, bindings, svgWrap };
  _templateCache.set(strings, compiled);
  return compiled;
}
function _materializeCompiled(compiled) {
  const clone = compiled.tpl.content.cloneNode(true);
  if (!compiled.svgWrap) return { root: clone, nodes: [...clone.childNodes] };
  const svg = clone.firstElementChild;
  return { root: svg, nodes: [...svg.childNodes] };
}
function _resolvePath(root, path) {
  let node = root;
  for (const i of path) node = node.childNodes[i];
  return node;
}
function _isComponentValue(v) {
  return typeof v === "function" || v != null && typeof v === "object" && (v.__isComponent === true || typeof v.html === "function" || typeof v.setup === "function");
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
  if (lb.tplEntry) {
    _teardownForEntry(lb.tplEntry);
    lb.tplEntry = null;
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
    const compiled = _compileTemplate(result.strings);
    const { tpl, bindings } = compiled;
    if (!entry.tplState || entry.tplState.tpl !== tpl) {
      entry.tplState?.dispose();
      const { root, nodes } = _materializeCompiled(compiled);
      const liveBindings = bindings.map((b) => _instantiateBinding(root, b));
      swap(nodes);
      entry.tplState = { tpl, liveBindings, dispose: () => liveBindings.forEach((b) => b.kind === "child" && _teardownChildBinding(b)) };
    }
    for (const b of entry.tplState.liveBindings) {
      if (b.kind === "attr") _updateAttrBinding(b, result.values);
      else if (b.kind === "flag") _updateFlagBinding(b, result.values);
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
  const newKeys = new Array(items.length), seenKeys = /* @__PURE__ */ new Set();
  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    if (seenKeys.has(key)) throw new TypeError(`For: duplicate key ${String(key)}`);
    seenKeys.add(key);
    newKeys[i] = key;
  }
  let sameShape = items.length === lb.forKeys.length;
  if (sameShape) {
    for (let i = 0; i < items.length; i++) {
      if (newKeys[i] !== lb.forKeys[i]) {
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
  let cursor = lb.marker;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = newKeys[i];
    usedKeys.add(key);
    let entry = map.get(key);
    if (!entry) {
      entry = { nodes: [], tplState: null, itemSig: signal2(item), indexSig: signal2(i), rowStop: null };
      entry.rowStop = effect2(() => _renderForEntry(parent, entry, render(entry.itemSig.value, entry.indexSig.value)));
      map.set(key, entry);
    } else {
      batch2(() => {
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
var _autoKeySeq = 0;
var _autoKeys = /* @__PURE__ */ new WeakMap();
function _arrayItemKey(item, i) {
  if (item != null && typeof item === "object") {
    if (item.key != null) return item.key;
    if (item.id != null) return item.id;
    let k = _autoKeys.get(item);
    if (k == null) {
      if (item.__isTemplateResult) {
        const { bindings } = _compileTemplate(item.strings);
        for (const b of bindings) {
          if (b.kind === "attr" && b.attrName === "data-key" && b.slots.length === 1 && b.template === `@@h${b.slots[0]}@@`) {
            k = item.values[b.slots[0]];
            break;
          }
        }
        if (k == null) k = _templateContentKey(item);
      } else {
        k = "k" + (++_autoKeySeq).toString(36);
      }
      _autoKeys.set(item, k);
    }
    return k;
  }
  return item ?? i;
}
function _templateContentKey(item) {
  let out = "";
  for (let i = 0; i < item.values.length; i++) {
    const v = item.values[i];
    out += "\0";
    if (v == null || typeof v !== "object") out += String(v);
    else if (v.__isTemplateResult) out += _templateContentKey(v);
    else if (v.__isFor) out += "for";
    else {
      let id = _autoKeys.get(v);
      if (id == null) {
        id = "k" + (++_autoKeySeq).toString(36);
        _autoKeys.set(v, id);
      }
      out += id;
    }
  }
  return out;
}
function _updateNestedTemplate(lb, result) {
  if (lb.lastKind !== "nested-tpl") {
    _teardownChildBinding(lb);
    lb.tplEntry = { nodes: [], tplState: null };
    lb.lastKind = "nested-tpl";
  }
  const parent = lb.marker.parentNode;
  _renderForEntry(parent, lb.tplEntry, result);
  let after = lb.marker.nextSibling;
  for (const n of lb.tplEntry.nodes) {
    if (n !== after) parent.insertBefore(n, after);
    after = n.nextSibling;
  }
}
function _updateChildBinding(lb, values) {
  const value = values[lb.index];
  if (value?.__isFor) {
    _updateForBinding(lb, value);
    lb.lastValue = value;
    return;
  }
  if (Array.isArray(value)) {
    _updateForBinding(lb, { items: value, keyFn: _arrayItemKey, render: (item) => item });
    lb.lastValue = value;
    return;
  }
  if (value?.__isTemplateResult) {
    _updateNestedTemplate(lb, value);
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
  const attrName = lb.attrName.toLowerCase();
  if (_booleanAttrs.has(attrName) && lb.slots.length === 1 && lb.template === `@@h${lb.slots[0]}@@`) {
    const v = values[lb.slots[0]];
    const on2 = !(v === false || v == null || v === "" || v === "false" || v === 0);
    if (!on2) {
      lb.el.removeAttribute(lb.attrName);
      if (attrName === "checked" && "checked" in lb.el) lb.el.checked = false;
      if (attrName === "disabled" && "disabled" in lb.el) lb.el.disabled = false;
      if (attrName === "selected" && "selected" in lb.el) lb.el.selected = false;
      return;
    }
    lb.el.setAttribute(lb.attrName, "");
    if (attrName === "checked" && "checked" in lb.el) lb.el.checked = true;
    if (attrName === "disabled" && "disabled" in lb.el) lb.el.disabled = true;
    if (attrName === "selected" && "selected" in lb.el) lb.el.selected = true;
    return;
  }
  const tag = lb.el.tagName;
  if (lb.attrName === "value" && (tag === "INPUT" || tag === "TEXTAREA")) {
    if (lb.el !== document.activeElement && lb.el.value !== out) lb.el.value = out;
    return;
  }
  if (lb.el.getAttribute(lb.attrName) !== out) lb.el.setAttribute(lb.attrName, out);
}
function _flagNamesFromValue(value) {
  if (value == null || value === false || value === true || value === "") return [];
  return String(value).trim().split(/\s+/).filter(Boolean);
}
function _updateFlagBinding(lb, values) {
  let changed = false;
  for (const slot of lb.slots) if (lb.lastValues[slot] !== values[slot]) changed = true;
  if (!changed) return;
  let out = lb.template;
  for (const slot of lb.slots) {
    lb.lastValues[slot] = values[slot];
    out = out.split(`@@h${slot}@@`).join(values[slot] == null ? "" : String(values[slot]));
  }
  const next = _flagNamesFromValue(out);
  for (const name of next) {
    const lower = name.toLowerCase();
    if (lower.startsWith("on") || lower === "srcdoc") {
      throw new TypeError(`h: dynamic ${name} attributes are not allowed; attach events with on()/delegate.on()`);
    }
  }
  for (const name of lb.applied) {
    if (!next.includes(name)) lb.el.removeAttribute(name);
  }
  for (const name of next) {
    if (!lb.el.hasAttribute(name)) lb.el.setAttribute(name, "");
  }
  lb.applied = next;
}
function _instantiateBinding(root, binding) {
  const node = _resolvePath(root, binding.path);
  if (binding.kind === "attr") {
    return { kind: "attr", el: node, attrName: binding.attrName, template: binding.template, slots: binding.slots, lastValues: {} };
  }
  if (binding.kind === "flag") {
    node.removeAttribute(binding.template);
    return { kind: "flag", el: node, template: binding.template, slots: binding.slots, lastValues: {}, applied: [] };
  }
  const marker = document.createTextNode("");
  node.parentNode.replaceChild(marker, node);
  return { kind: "child", marker, index: binding.index, owned: [], lastValue: void 0, lastKind: null, childStop: null };
}
function _renderTemplateResult(el, result, prevState) {
  const compiled = _compileTemplate(result.strings);
  const { tpl, bindings } = compiled;
  let state = prevState;
  if (!state || state.tpl !== tpl) {
    state?.dispose();
    const { root, nodes } = _materializeCompiled(compiled);
    const liveBindings = bindings.map((b) => _instantiateBinding(root, b));
    el.textContent = "";
    for (const n of nodes) el.appendChild(n);
    state = { tpl, liveBindings, dispose: () => liveBindings.forEach((lb) => lb.kind === "child" && _teardownChildBinding(lb)) };
  }
  for (const lb of state.liveBindings) {
    if (lb.kind === "attr") _updateAttrBinding(lb, result.values);
    else if (lb.kind === "flag") _updateFlagBinding(lb, result.values);
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
  const stop = effect2(() => {
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
        _lastHtml = void 0;
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
  const stop = effect2(() => {
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
      batch2(() => {
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
  return (parentEl) => {
    const disposeEntry = (entry, animate2 = false) => {
      entry.stop();
      entry.el.__tplState?.dispose?.();
      if (animate2) transitions.fadeOut(entry.el).finished?.then(() => entry.el.remove()) ?? entry.el.remove();
      else entry.el.remove();
    };
    const renderEntry = (entry) => {
      const raw = renderItem(entry.item.value, entry.index.value);
      const el = entry.el;
      if (raw?.__isTemplateResult) el.__tplState = _renderTemplateResult(el, raw, el.__tplState);
      else {
        const h2 = escape && typeof raw === "string" && !raw?.__trusted ? esc2(raw) : raw?.value ?? raw;
        if (el.innerHTML !== h2) el.innerHTML = h2;
      }
    };
    const stop = effect2(() => {
      try {
        const items = itemsSig.value;
        const keys = new Array(items.length), live = /* @__PURE__ */ new Set();
        for (let i = 0; i < items.length; i++) {
          const key = getKey(items[i], i);
          if (live.has(key)) throw new TypeError(`keyedList: duplicate key ${String(key)}`);
          live.add(key);
          keys[i] = key;
        }
        for (const [key, entry] of [...domMap]) {
          if (!live.has(key)) {
            disposeEntry(entry, true);
            domMap.delete(key);
          }
        }
        let prev = null;
        for (let i = 0; i < items.length; i++) {
          const item = items[i], key = keys[i];
          let entry = domMap.get(key);
          if (!entry) {
            const el2 = document.createElement(tag);
            el2.dataset.key = key;
            entry = { el: el2, item: signal2(item), index: signal2(i), stop: null };
            entry.stop = effect2(() => renderEntry(entry));
            domMap.set(key, entry);
            parentEl.appendChild(el2);
            transitions.slideDown(el2);
          } else {
            batch2(() => {
              entry.item.value = item;
              entry.index.value = i;
            });
          }
          const el = entry.el;
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
    return () => {
      stop();
      for (const entry of domMap.values()) disposeEntry(entry);
      domMap.clear();
    };
  };
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
      const h2 = escape && typeof raw === "string" && !raw?.__trusted ? esc2(raw) : raw?.value ?? raw;
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
        entry = { el, item: signal2(item), index: signal2(i), stop: null };
        entry.stop = effect2(() => renderRow(entry));
        inner.appendChild(el);
        rendered.set(key, entry);
      } else {
        batch2(() => {
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
  const stopEffect = effect2(() => update(true));
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
  const current = signal2(location.hash.slice(1) || "/");
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
  const route = signal2(void 0);
  const stopRoute = effect2(() => {
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
      signal: (v, opts) => signal2(v, opts),
      computed: (fn) => computed2(fn),
      effect: (fn) => {
        const s = effect2(fn);
        stops.push(s);
        return s;
      },
      asyncEffect: (fn) => {
        const s = effect2(() => {
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
  const out = signal2(src.peek());
  const flush = debounce((v) => {
    out.value = v;
  }, ms);
  effect2(() => {
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
