export { signal, computed, effect, batch, watch, onCleanup, esc, html, store, setUpdateMode, getUpdateMode, flushSync, setSchedulerMaxRuns, getSchedulerStats } from './core.js';
import { signal, computed, effect, batch, esc } from './core.js';

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
  // id/name are an explicit, author-chosen signal of "same logical slot" —
  // trust them even across a tag change (e.g. an <input id="q"> swapped for
  // a <button id="q">). The positional path has no such intent behind it, so
  // it only counts as a match when the tag also still lines up.
  if (info.by === 'id') return root.querySelector(`[id="${_escAttr(info.id)}"]`);
  if (info.by === 'name') return root.querySelector(`[name="${_escAttr(info.name)}"]`);
  let cur = root;
  for (const idx of info.path) { cur = cur?.children?.[idx]; if (!cur) break; }
  return cur && cur.tagName === info.tag ? cur : null;
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

// ── Morph (DOM-to-DOM diff/patch) ───────────────────────────────────────────────
// Replaces the old "blind el.innerHTML = newHtml" render step. Instead of
// tearing down and recreating every node on every re-render, this walks the
// existing live DOM in parallel with the freshly-rendered HTML and patches
// only what actually changed — unchanged nodes (and their focus/selection/
// scroll/internal state) are left alone. Matching is by explicit key
// (`data-key` attribute, or `id` as an implicit key) first, falling back to
// same-tag positional matching for everything else — the same rule
// `keyedList` already used for lists, now applied to all rendering.
function _nodeKey(n) {
  if (!n || n.nodeType !== 1) return null;
  const dk = n.getAttribute('data-key');
  if (dk != null) return `k:${dk}`;
  if (n.id) return `id:${n.id}`;
  return null;
}

function _sameNodeType(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  return a.nodeType === 1 ? a.tagName === b.tagName : true;
}

// Form controls track "live" state (typed value, checked, selection) that
// doesn't round-trip through attributes — and must never be clobbered while
// the user is actively interacting with the element.
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
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (oldEl !== document.activeElement && oldEl.value !== newEl.value) oldEl.value = newEl.value;
    if (tag === 'INPUT') {
      const checked = newEl.hasAttribute('checked');
      if (oldEl.checked !== checked) oldEl.checked = checked;
    }
  } else if (tag === 'OPTION') {
    const selected = newEl.hasAttribute('selected');
    if (oldEl.selected !== selected) oldEl.selected = selected;
  }
}

function _patchNode(oldNode, newNode) {
  if (oldNode.nodeType === 3 || oldNode.nodeType === 8) { // text / comment
    if (oldNode.data !== newNode.data) oldNode.data = newNode.data;
    return;
  }
  if (oldNode.nodeType !== 1) return;
  _patchAttrs(oldNode, newNode);
  _morphChildren(oldNode, newNode);
}

function _morphChildren(parent, newParent) {
  const initialOld = new Set(parent.childNodes);
  const oldKeyMap = new Map();
  for (const n of parent.childNodes) {
    const k = _nodeKey(n);
    if (k != null && !oldKeyMap.has(k)) oldKeyMap.set(k, n);
  }

  const usedOld = new Set();
  let oldCursor = parent.firstChild;
  let newChild = newParent.firstChild;

  while (newChild) {
    const nextNewChild = newChild.nextSibling;
    const k = _nodeKey(newChild);
    let match = null;
    if (k != null) {
      const candidate = oldKeyMap.get(k);
      // Same key but a different tag (e.g. `id="q"` used first on an
      // <input>, then on a <button>) can't be patched in place — attributes
      // like `value`/`checked` wouldn't make sense on the new tag, and
      // tagName itself is immutable. Fall through to a real replace.
      if (candidate && !usedOld.has(candidate) && _sameNodeType(candidate, newChild)) match = candidate;
    } else if (
      oldCursor && initialOld.has(oldCursor) && !usedOld.has(oldCursor) &&
      _nodeKey(oldCursor) == null && _sameNodeType(oldCursor, newChild)
    ) {
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

/** Diff+patch `el`'s children against freshly-parsed `htmlStr` in place. */
function _morphInto(el, htmlStr) {
  const tpl = document.createElement('template');
  tpl.innerHTML = htmlStr;
  _morphChildren(el, tpl.content);
}

// ── Compiled templates (h``) ────────────────────────────────────────────────────
// The morph engine above still pays for a string-rebuild + native HTML parse
// on every render, even when only one value inside a big template changed —
// that's the real remaining cost the "skip if identical string" check can't
// touch. This gives h`` templates a way around both: a tagged template
// literal's `strings` array is the *same object reference* on every call to
// the same callsite (guaranteed by the JS spec, even inside a loop/function
// called repeatedly), so we can compile the static structure once per
// callsite — parse it into a <template> a single time, and record exactly
// where each interpolated value lands — then on every render just
// `cloneNode` (native, no parsing) and poke the handful of values that
// actually changed directly into their known spot. No string rebuild, no
// re-parse, no tree diff.
//
// Caveat shared with every library that uses this technique (e.g. lit-html):
// classifying "is this slot inside a tag (attribute) or in child content" is
// done by scanning the static text for an unclosed `<` — a literal `<`/`>`
// in text content (not as a tag) will confuse it. Use `&lt;`/`&gt;` there.
const _templateCache = new WeakMap(); // strings array -> { tpl, bindings }
const _urlAttributes = new Set(['action', 'formaction', 'href', 'src', 'xlink:href', 'poster']);
const _booleanAttrs = new Set(['disabled', 'checked', 'selected', 'hidden', 'readonly', 'required', 'multiple', 'autofocus', 'open', 'inert', 'controls', 'loop', 'muted', 'autoplay', 'playsinline', 'async', 'defer', 'reversed', 'ismap', 'novalidate', 'formnovalidate', 'allowfullscreen', 'default']);
const _svgChildTag = /^(?:<!--[\s\S]*?-->|\s)*<(rect|path|g|circle|ellipse|line|polyline|polygon|text|tspan|use|defs|clippath|lineargradient|radialgradient|stop|mask|pattern|image|foreignobject|switch|symbol|marker)\b/i;

function _validateTemplateBindings(bindings, slotCount) {
  const seen = new Set();
  for (const binding of bindings) {
    if (binding.kind === 'attr') {
      const name = binding.attrName.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') {
        throw new TypeError(`h: dynamic ${binding.attrName} attributes are not allowed; attach events with on()/delegate.on()`);
      }
      for (const slot of binding.slots) seen.add(slot);
    } else if (binding.kind === 'flag') {
      for (const slot of binding.slots) seen.add(slot);
    } else seen.add(binding.index);
  }
  if (seen.size !== slotCount || [...seen].some(i => i < 0 || i >= slotCount)) {
    throw new TypeError('h: every interpolation must be a complete child or attribute value');
  }
}

function _safeAttributeValue(name, value) {
  if (!_urlAttributes.has(name.toLowerCase())) return value;
  const normalized = String(value).replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) return null;
  if (normalized.startsWith('data:')) {
    return /^data:image\/(png|jpe?g|gif|webp|avif)(;|,)/.test(normalized) ? value : null;
  }
  return value;
}

function _classifySlotKinds(strings) {
  const kinds = [];
  let mode = 'text';
  let quote = '';
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s[j];
      const next = s[j + 1];
      if (mode === 'comment') {
        if (c === '-' && next === '-' && s[j + 2] === '>') { mode = 'text'; j += 2; }
        continue;
      }
      if (quote) {
        if (c === quote) quote = '';
        continue;
      }
      if (mode === 'text') {
        if (c === '<' && next === '!' && s[j + 2] === '-' && s[j + 3] === '-') { mode = 'comment'; j += 3; continue; }
        if (c === '<' && (next === '/' || next === '!' || (next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z'))) mode = 'tag';
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '>') mode = 'text';
    }
    if (i < strings.length - 1) kinds.push(mode === 'text' ? 'child' : 'attr');
  }
  return kinds;
}

function _recordBindings(root) {
  const bindings = [];
  const walk = (node, path) => {
    if (node.nodeType === 8) { // comment marker for a child-position slot
      const m = /^@@h(\d+)@@$/.exec(node.data);
      if (m) bindings.push({ path, kind: 'child', index: Number(m[1]) });
      return;
    }
    if (node.nodeType === 1) {
      for (const a of [...node.attributes]) {
        if (a.name.includes('@@h')) {
          const slots = [...a.name.matchAll(/@@h(\d+)@@/g)].map(mm => Number(mm[1]));
          bindings.push({ path, kind: 'flag', template: a.name, slots });
        } else if (a.value.includes('@@h')) {
          const slots = [...a.value.matchAll(/@@h(\d+)@@/g)].map(mm => Number(mm[1]));
          bindings.push({ path, kind: 'attr', attrName: a.name, template: a.value, slots });
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
  let html = strings[0];
  for (let i = 0; i < kinds.length; i++) {
    html += kinds[i] === 'child' ? `<!--@@h${i}@@-->` : `@@h${i}@@`;
    html += strings[i + 1];
  }
  const tpl = document.createElement('template');
  const svgWrap = _svgChildTag.test(html);
  tpl.innerHTML = svgWrap ? `<svg xmlns="http://www.w3.org/2000/svg">${html}</svg>` : html;
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
  return typeof v === 'function' || (v != null && typeof v === 'object' &&
    (v.__isComponent === true || typeof v.html === 'function' || typeof v.setup === 'function'));
}

function _teardownForEntry(entry) {
  entry.rowStop?.();
  entry.tplState?.dispose?.();
  for (const n of entry.nodes) n.parentNode?.removeChild(n);
}

function _teardownChildBinding(lb) {
  lb.childStop?.();
  lb.childStop = null;
  if (lb.forMap) { for (const entry of lb.forMap.values()) _teardownForEntry(entry); lb.forMap = null; }
  if (lb.tplEntry) { _teardownForEntry(lb.tplEntry); lb.tplEntry = null; }
  for (const n of lb.owned) n.parentNode?.removeChild(n);
  lb.owned = [];
}

// Renders `result` (an h`` result or plain string) into `entry`, replacing
// entry.nodes in place at their current DOM position when the template
// shape changes. No-ops on the DOM entirely if nothing about the rendered
// output actually changed (the inner _update*Binding calls are themselves
// Object.is-gated per slot).
function _renderForEntry(parent, entry, result) {
  const swap = newNodes => {
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
        const liveBindings = bindings.map(b => _instantiateBinding(root, b));
        swap(nodes);
        entry.tplState = { tpl, liveBindings, dispose: () => liveBindings.forEach(b => b.kind === 'child' && _teardownChildBinding(b)) };
      }
    for (const b of entry.tplState.liveBindings) {
      if (b.kind === 'attr') _updateAttrBinding(b, result.values);
      else if (b.kind === 'flag') _updateFlagBinding(b, result.values);
      else _updateChildBinding(b, result.values);
    }
  } else {
    // Plain-string fallback: no fine-grained patch, just a per-item HTML reparse.
    const html = result == null ? '' : String(result);
    if (entry.lastHtml !== html) {
      const t = document.createElement('template');
      t.innerHTML = html;
      swap([...t.content.childNodes]);
      entry.lastHtml = html;
    }
  }
}

// Keyed list reconciliation for h`` templates (see `For` below). Each item's
// render() is itself an h`` result, so unlike the string-template `morph`
// path this never rebuilds/reparses HTML: existing rows are cloned once
// (native, no parsing) and thereafter only their changed slots are poked;
// only add/remove/reorder touches real DOM nodes at all.
//
// Each row gets its own persistent effect (entry.rowStop) wrapping
// `render(item, i)`. It's driven by entry.itemSig/entry.indexSig rather than
// plain fields specifically so that a `store()` row (see core.js) works for
// free: if `render` reads `store()`-backed fields, this effect subscribes to
// those exact field signals, and a later `row.field = x` reruns *only* this
// one row's effect directly — `_updateForBinding` below is never even
// called, so the O(n) key-diff loop doesn't run at all for pure field edits.
// For a plain immutable-array item (the `.map()`/`.filter()` pattern), the
// item reference itself is what changes, so the fast path's
// `entry.itemSig.value = items[i]` is what triggers the rerun instead — same
// mechanism, no special-casing needed between the two.
//
// Fast path: when the key sequence is byte-for-byte the same as last time
// (no add/remove/reorder), touch only entry.itemSig — Signal already no-ops
// on an unchanged reference, so untouched rows cost one reference compare
// and nothing else.
function _updateForBinding(lb, forVal) {
  const { items, keyFn, render } = forVal;
  if (lb.lastKind !== 'for') {
    _teardownChildBinding(lb);
    lb.forMap = new Map();
    lb.forKeys = [];
    lb.lastKind = 'for';
  }
  const map = lb.forMap;
  const parent = lb.marker.parentNode;
  // Evaluate keys once. Besides avoiding a second user keyFn call on every
  // update, rejecting duplicates prevents two logical rows from sharing one
  // DOM/effect entry (a particularly confusing source of stale UI).
  const newKeys = new Array(items.length), seenKeys = new Set();
  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    if (seenKeys.has(key)) throw new TypeError(`For: duplicate key ${String(key)}`);
    seenKeys.add(key); newKeys[i] = key;
  }

  let sameShape = items.length === lb.forKeys.length;
  if (sameShape) {
    for (let i = 0; i < items.length; i++) {
      if (newKeys[i] !== lb.forKeys[i]) { sameShape = false; break; }
    }
  }

  if (sameShape) {
    for (let i = 0; i < items.length; i++) {
      map.get(lb.forKeys[i]).itemSig.value = items[i]; // no-op unless the reference changed
    }
    return;
  }

  // Structural path: add/remove/reorder happened — full keyed reconciliation.
  const usedKeys = new Set();
  let cursor = lb.marker;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = newKeys[i];
    usedKeys.add(key);
    let entry = map.get(key);
    if (!entry) {
      entry = { nodes: [], tplState: null, itemSig: signal(item), indexSig: signal(i), rowStop: null };
      entry.rowStop = effect(() => _renderForEntry(parent, entry, render(entry.itemSig.value, entry.indexSig.value)));
      map.set(key, entry);
    } else {
      batch(() => { entry.indexSig.value = i; entry.itemSig.value = item; }); // coalesce into a single rerun
    }

    let after = cursor.nextSibling;
    for (const n of entry.nodes) {
      if (n !== after) parent.insertBefore(n, after);
      after = n.nextSibling;
    }
    cursor = entry.nodes[entry.nodes.length - 1] ?? cursor;
  }

  for (const [key, entry] of map) {
    if (!usedKeys.has(key)) { _teardownForEntry(entry); map.delete(key); }
  }
  lb.forKeys = newKeys;
}

let _autoKeySeq = 0;
const _autoKeys = new WeakMap();

function _arrayItemKey(item, i) {
  if (item != null && typeof item === 'object') {
    if (item.key != null) return item.key;
    if (item.id != null) return item.id;
    let k = _autoKeys.get(item);
    if (k == null) {
      if (item.__isTemplateResult) {
        const { bindings } = _compileTemplate(item.strings);
        for (const b of bindings) {
          if (b.kind === 'attr' && b.attrName === 'data-key' && b.slots.length === 1 && b.template === `@@h${b.slots[0]}@@`) {
            k = item.values[b.slots[0]];
            break;
          }
        }
        if (k == null) k = _templateContentKey(item);
      } else {
        k = 'k' + (++_autoKeySeq).toString(36);
      }
      _autoKeys.set(item, k);
    }
    return k;
  }
  return item ?? i;
}

function _templateContentKey(item) {
  let out = '';
  for (let i = 0; i < item.values.length; i++) {
    const v = item.values[i];
    out += '\0';
    if (v == null || typeof v !== 'object') out += String(v);
    else if (v.__isTemplateResult) out += _templateContentKey(v);
    else if (v.__isFor) out += 'for';
    else {
      let id = _autoKeys.get(v);
      if (id == null) { id = 'k' + (++_autoKeySeq).toString(36); _autoKeys.set(v, id); }
      out += id;
    }
  }
  return out;
}

function _updateNestedTemplate(lb, result) {
  if (lb.lastKind !== 'nested-tpl') {
    _teardownChildBinding(lb);
    lb.tplEntry = { nodes: [], tplState: null };
    lb.lastKind = 'nested-tpl';
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
  if (value?.__isFor) { _updateForBinding(lb, value); lb.lastValue = value; return; }
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
  if (Object.is(value, lb.lastValue)) return; // the actual fine-grained skip
  lb.lastValue = value;

  if (_isComponentValue(value)) {
    _teardownChildBinding(lb);
    const wrapper = document.createElement('span');
    wrapper.style.display = 'contents';
    lb.marker.after(wrapper);
    lb.childStop = mount(wrapper, () => (typeof value === 'function' ? value() : value));
    lb.owned = [wrapper];
    lb.lastKind = 'component';
    return;
  }

  if (value != null && typeof value === 'object' && value.__trusted) {
    _teardownChildBinding(lb);
    const tpl = document.createElement('template');
    tpl.innerHTML = value.value;
    const nodes = [...tpl.content.childNodes];
    lb.marker.after(...nodes);
    lb.owned = nodes;
    lb.lastKind = 'trusted';
    return;
  }

  // Plain value → a single safe Text node (Text nodes can't be interpreted
  // as markup, so this needs no manual escaping at all).
  const text = value == null ? '' : String(value);
  if (lb.lastKind === 'text' && lb.owned[0]) { lb.owned[0].data = text; return; }
  _teardownChildBinding(lb);
  const textNode = document.createTextNode(text);
  lb.marker.after(textNode);
  lb.owned = [textNode];
  lb.lastKind = 'text';
}

function _updateAttrBinding(lb, values) {
  let changed = false;
  for (const slot of lb.slots) if (lb.lastValues[slot] !== values[slot]) changed = true;
  if (!changed) return;
  let out = lb.template;
  for (const slot of lb.slots) {
    lb.lastValues[slot] = values[slot];
    out = out.split(`@@h${slot}@@`).join(values[slot] == null ? '' : String(values[slot]));
  }
  out = _safeAttributeValue(lb.attrName, out);
  if (out == null) { lb.el.removeAttribute(lb.attrName); return; }
  const attrName = lb.attrName.toLowerCase();
  if (_booleanAttrs.has(attrName) && lb.slots.length === 1 && lb.template === `@@h${lb.slots[0]}@@`) {
    const v = values[lb.slots[0]];
    const on = !(v === false || v == null || v === '' || v === 'false' || v === 0);
    if (!on) {
      lb.el.removeAttribute(lb.attrName);
      if (attrName === 'checked' && 'checked' in lb.el) lb.el.checked = false;
      if (attrName === 'disabled' && 'disabled' in lb.el) lb.el.disabled = false;
      if (attrName === 'selected' && 'selected' in lb.el) lb.el.selected = false;
      return;
    }
    lb.el.setAttribute(lb.attrName, '');
    if (attrName === 'checked' && 'checked' in lb.el) lb.el.checked = true;
    if (attrName === 'disabled' && 'disabled' in lb.el) lb.el.disabled = true;
    if (attrName === 'selected' && 'selected' in lb.el) lb.el.selected = true;
    return;
  }
  const tag = lb.el.tagName;
  if (lb.attrName === 'value' && (tag === 'INPUT' || tag === 'TEXTAREA')) {
    if (lb.el !== document.activeElement && lb.el.value !== out) lb.el.value = out;
    return;
  }
  if (lb.el.getAttribute(lb.attrName) !== out) lb.el.setAttribute(lb.attrName, out);
}

function _flagNamesFromValue(value) {
  if (value == null || value === false || value === true || value === '') return [];
  return String(value).trim().split(/\s+/).filter(Boolean);
}

function _updateFlagBinding(lb, values) {
  let changed = false;
  for (const slot of lb.slots) if (lb.lastValues[slot] !== values[slot]) changed = true;
  if (!changed) return;
  let out = lb.template;
  for (const slot of lb.slots) {
    lb.lastValues[slot] = values[slot];
    out = out.split(`@@h${slot}@@`).join(values[slot] == null ? '' : String(values[slot]));
  }
  const next = _flagNamesFromValue(out);
  for (const name of next) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on') || lower === 'srcdoc') {
      throw new TypeError(`h: dynamic ${name} attributes are not allowed; attach events with on()/delegate.on()`);
    }
  }
  for (const name of lb.applied) {
    if (!next.includes(name)) lb.el.removeAttribute(name);
  }
  for (const name of next) {
    if (!lb.el.hasAttribute(name)) lb.el.setAttribute(name, '');
  }
  lb.applied = next;
}

function _instantiateBinding(root, binding) {
  const node = _resolvePath(root, binding.path);
  if (binding.kind === 'attr') {
    return { kind: 'attr', el: node, attrName: binding.attrName, template: binding.template, slots: binding.slots, lastValues: {} };
  }
  if (binding.kind === 'flag') {
    node.removeAttribute(binding.template);
    return { kind: 'flag', el: node, template: binding.template, slots: binding.slots, lastValues: {}, applied: [] };
  }
  const marker = document.createTextNode('');
  node.parentNode.replaceChild(marker, node);
  return { kind: 'child', marker, index: binding.index, owned: [], lastValue: undefined, lastKind: null, childStop: null };
}

/** Render an h`` TemplateResult into `el`, reusing the live instance across renders when the template shape is unchanged. */
function _renderTemplateResult(el, result, prevState) {
  const compiled = _compileTemplate(result.strings);
  const { tpl, bindings } = compiled;
  let state = prevState;
  if (!state || state.tpl !== tpl) {
    state?.dispose();
    const { root, nodes } = _materializeCompiled(compiled);
    const liveBindings = bindings.map(b => _instantiateBinding(root, b));
    el.textContent = '';
    for (const n of nodes) el.appendChild(n);
    state = { tpl, liveBindings, dispose: () => liveBindings.forEach(lb => lb.kind === 'child' && _teardownChildBinding(lb)) };
  }
  for (const lb of state.liveBindings) {
    if (lb.kind === 'attr') _updateAttrBinding(lb, result.values);
    else if (lb.kind === 'flag') _updateFlagBinding(lb, result.values);
    else _updateChildBinding(lb, result.values);
  }
  return state;
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
  // Last HTML string actually parsed+morphed into `el`. The effect below
  // reruns whenever a *read* signal changes, which isn't the same as "the
  // rendered *output* changed" — a broader effect rerunning for an unrelated
  // reason, or two notifications collapsing to the same result, can produce
  // byte-identical markup. Skipping the parse+diff in that case avoids the
  // most expensive step (native HTML parsing) for a render that would have
  // patched nothing anyway. This does NOT reduce cost for the common case of
  // "template output genuinely changed a little" — regenerating the string
  // and parsing it is unavoidable there given the string-template model.
  let _lastHtml;
  // Live compiled-template instance (see h`` / _renderTemplateResult above).
  // Kept across renders (unlike everything else here) specifically so it can
  // be reused — that persistence is the whole point of the fast path.
  let _tplState = null;
  const _dropTplState = () => { _tplState?.dispose(); _tplState = null; };

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

      if (typeof r === 'string') {
        _dropTplState();
        if (escape) {
          // Escaped plain text is always exactly one text node — no HTML to
          // parse/diff, just keep (or create) that single node and update it.
          if (el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) el.textContent = r;
          else if (el.firstChild.data !== r) el.firstChild.data = r;
        } else if (r !== _lastHtml) {
          _morphInto(el, r);
          _lastHtml = r;
        }
      }
      else if (r?.__trusted) {
        _dropTplState();
        if (r.value !== _lastHtml) { _morphInto(el, r.value); _lastHtml = r.value; }
      }
      else if (r?.__bind)                 { _dropTplState(); r.render(el); }
      else if (r?.__isTemplateResult) {
        // A template has no HTML-string snapshot. Clear a previous snapshot
        // so switching back to that same string cannot incorrectly skip its
        // morph and leave the template DOM in place.
        _lastHtml = undefined;
        _tplState = _renderTemplateResult(el, r, _tplState);
      }
      else if (r && typeof r === 'object') {
        _dropTplState();
        const rawHtml = typeof r.html === 'function' ? r.html() : (r.html ?? r.render?.() ?? '');
        if (rawHtml !== _lastHtml) { _morphInto(el, rawHtml); _lastHtml = rawHtml; }

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
      else { _dropTplState(); }
      if (cid !== undefined) _lastCid = cid;
      restoreFocus();
    } catch (e) { console.error('[mount]', e); el.innerHTML = `<div style="color:#f85149">Render error</div>`; }
  });

  return () => { stop(); _setupCleanup?.(); _childrenStop?.(); _dropTplState(); };
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
      // A single dispatch is a natural synchronous batch boundary: coalesce
      // every signal write any handler makes during this event into one
      // effect flush, instead of one flush per write.
      batch(() => { for (const [sel, fn] of reg.get(evt)) { const t = e.target.closest(sel); if (t) fn(e, t); } });
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
// `renderItem` may return an h`` result — reuses the same compiled-template
// clone+patch machinery as `For` (parse the row shape once, then only poke
// changed slots), instead of always reparsing an HTML string per item. Plain
// strings/`html()` still work exactly as before (innerHTML replace) for
// backward compatibility. Enter/exit animations and reorder-by-insertBefore
// are unchanged either way.
export const keyedList = (itemsSig, renderItem, getKey = i => i.id ?? i.key, { escape = true, tag = 'div' } = {}) => {
  const domMap = new Map();
  return parentEl => {
    const disposeEntry = (entry, animate = false) => {
      entry.stop();
      entry.el.__tplState?.dispose?.();
      if (animate) transitions.fadeOut(entry.el).finished?.then(() => entry.el.remove()) ?? entry.el.remove();
      else entry.el.remove();
    };
    const renderEntry = entry => {
      const raw = renderItem(entry.item.value, entry.index.value);
      const el = entry.el;
      if (raw?.__isTemplateResult) el.__tplState = _renderTemplateResult(el, raw, el.__tplState);
      else {
        const h = escape && typeof raw === 'string' && !raw?.__trusted ? esc(raw) : (raw?.value ?? raw);
        if (el.innerHTML !== h) el.innerHTML = h;
      }
    };
    const stop = effect(() => {
    try {
      const items = itemsSig.value;
      const keys = new Array(items.length), live = new Set();
      for (let i = 0; i < items.length; i++) {
        const key = getKey(items[i], i);
        if (live.has(key)) throw new TypeError(`keyedList: duplicate key ${String(key)}`);
        live.add(key); keys[i] = key;
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
          const el = document.createElement(tag);
          el.dataset.key = key;
          entry = { el, item: signal(item), index: signal(i), stop: null };
          entry.stop = effect(() => renderEntry(entry));
          domMap.set(key, entry); parentEl.appendChild(el);
          transitions.slideDown(el);
        } else {
          batch(() => { entry.item.value = item; entry.index.value = i; });
        }
        const el = entry.el;
        if (prev) { const next = prev.nextSibling; if (next !== el) parentEl.insertBefore(el, next); }
        else if (parentEl.firstChild !== el) parentEl.insertBefore(el, parentEl.firstChild);
        prev = el;
      }
    } catch (e) { console.error('[keyedList]', e); }
    });
    return () => {
      stop();
      for (const entry of domMap.values()) disposeEntry(entry);
      domMap.clear();
    };
  };
};

// ── Virtual scroll ────────────────────────────────────────────────────────────
export const virtualList = (itemsSig, renderItem, itemHeight = 50, overscan = 5, { escape = true } = {}) => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position:'relative', overflow:'auto', height:'100%' });
  const inner = document.createElement('div');
  inner.style.position = 'relative';
  wrap.appendChild(inner);
  const rendered = new Map();
  const disposeRow = entry => {
    entry.stop();
    entry.el.__tplState?.dispose?.();
    entry.el.remove();
  };
  const renderRow = entry => {
    const raw = renderItem(entry.item.value, entry.index.value);
    const el = entry.el;
    if (raw?.__isTemplateResult) el.__tplState = _renderTemplateResult(el, raw, el.__tplState);
    else {
      const h = escape && typeof raw === 'string' && !raw?.__trusted ? esc(raw) : (raw?.value ?? raw);
      if (el.innerHTML !== h) el.innerHTML = h;
    }
  };
  const update = (track = false) => {
    const items = track ? itemsSig.value : itemsSig.peek();
    const start = Math.max(0, Math.floor(wrap.scrollTop / itemHeight) - overscan);
    const end   = Math.min(items.length, Math.ceil((wrap.scrollTop + wrap.clientHeight) / itemHeight) + overscan);
    const vis   = new Set();
    for (let i = start; i < end; i++) {
      const item = items[i], key = item.id ?? item.key ?? i;
      vis.add(key);
      let entry = rendered.get(key);
      if (!entry) {
        const el = document.createElement('div');
        Object.assign(el.style, { position:'absolute', top:`${i*itemHeight}px`, height:`${itemHeight}px`, width:'100%' });
        entry = { el, item: signal(item), index: signal(i), stop: null };
        entry.stop = effect(() => renderRow(entry));
        inner.appendChild(el); rendered.set(key, entry);
      } else {
        batch(() => { entry.item.value = item; entry.index.value = i; });
      }
      entry.el.style.top = `${i * itemHeight}px`;
    }
    for (const [k, entry] of rendered) if (!vis.has(k)) { disposeRow(entry); rendered.delete(k); }
    inner.style.height = `${items.length * itemHeight}px`;
  };
  const onScroll = () => update(false);
  wrap.addEventListener('scroll', onScroll, { passive: true });
  // The list effect tracks shape/replacements; each visible row has its own
  // effect scope, so a store() field write updates that row only, even after
  // scrolling it into view.
  const stopEffect = effect(() => update(true));
  return {
    el: wrap,
    dispose: () => {
      for (const entry of rendered.values()) disposeRow(entry);
      rendered.clear();
      wrap.removeEventListener('scroll', onScroll);
      stopEffect();
    },
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
  let disposed = false;
  const onHashChange = () => { current.value = location.hash.slice(1) || '/'; };
  window.addEventListener('hashchange', onHashChange);
  const cache = keepAlive ? new Map() : null;
  const resolve = (key, factory) => {
    if (!keepAlive) return factory();
    if (cache.has(key)) return cache.get(key);
    const inst = factory();
    cache.set(key, inst);
    return inst;
  };
  const route = signal(undefined);
  const stopRoute = effect(() => {
      const path = current.value;
      for (const [pat, comp] of Object.entries(routes)) {
        if (pat === '*') continue;
        const regex = new RegExp('^' + pat.replace(/:\w+/g, '([^/]+)') + '$');
        const m = path.match(regex);
        if (m) {
          const params = m.slice(1);
          route.value = typeof comp === 'function'
            ? resolve(`${pat}|${params.join('/')}`, () => comp(...params))
            : comp;
          return;
        }
      }
      if (routes['*']) {
        const c = routes['*'];
        route.value = typeof c === 'function' ? resolve('*', c) : c;
        return;
      }
      route.value = null;
  });
  return {
    current, route,
    navigate: path => { if (!disposed) location.hash = path; },
    match: pat => { const m = current.value.match(new RegExp('^' + pat.replace(/:\w+/g,'([^/]+)') + '$')); return m ? m.slice(1) : null; },
    // Drop cached instance(s) so the next visit rebuilds fresh. Omit `pattern`
    // to clear everything; pass a route pattern to clear just that route
    // (across all of its param combinations).
    invalidate: pattern => {
      if (!cache) return;
      if (pattern === undefined) { cache.clear(); return; }
      for (const k of [...cache.keys()]) if (k === pattern || k.startsWith(`${pattern}|`)) cache.delete(k);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('hashchange', onHashChange);
      stopRoute();
      cache?.clear();
    },
  };
};

// ── Component template literal ────────────────────────────────────────────────
// `strings` is the same array reference every time this literal's callsite
// runs (a JS spec guarantee), which is what lets _compileTemplate() cache
// the parsed structure once per callsite and mount() patch it in place on
// every later render — see the "Compiled templates" block above `mount()`.
export const h = (strings, ...values) => ({ __isTemplateResult: true, strings, values });

// Keyed list for use as an h`` child slot, e.g. `h\`<tbody>${For(rows, r => r.id, r => h\`<tr>...\`)}</tbody>\``.
// render(item, index) should return another h`` result (fine-grained: only
// changed cells patch) or a plain string (whole-row reparse fallback).
export const For = (items, keyFn, render) => ({ __isFor: true, items, keyFn, render });

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
// Shallow prop equality — same rule React's memo()/Solid's untrack-diffing
// use: same key set, every value `Object.is`-equal. New object literals
// (the common `Child({ label: x })` call shape) never pass `===`, so this
// is what actually lets repeated calls with unchanged props be recognized
// as "nothing changed" rather than "a new component".
function _shallowEqualProps(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export const defineComponent = (setup, { name } = {}) => {
  // One memo slot per defineComponent() call (i.e. per component *type* used
  // at one logical position). Calling the factory again with shallow-equal
  // props returns the exact same instance object — no new __cid, no setup()
  // rerun, no DOM teardown/remount — instead of building (and immediately
  // throwing away) a brand-new instance on every parent re-render, which is
  // what happened before: a fresh __cid on every call meant mount()'s
  // "same instance revisited" check could never succeed for components
  // embedded via h`` (only the router's explicit instance cache benefited).
  // This only helps a component used at a single call site; multiple
  // simultaneous instances of the same type (e.g. one factory reused in a
  // loop) will thrash the single slot and just get no memoization — never
  // incorrect reuse, since a props mismatch always falls through to a fresh
  // instance. For per-instance memoization across a list, use `For`/`store`.
  let _cache = null; // { props, instance }
  const factory = (props = {}) => {
    if (_cache && _shallowEqualProps(_cache.props, props)) return _cache.instance;
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
    const instance = {
      __isComponent: true,
      // Stable per-instance id so mount() can tell "same instance, revisited"
      // (skip setup) apart from "a different component swapped in" (run its
      // setup) — see the comment in mount() for why this matters.
      __cid: Symbol(name ?? setup.name ?? 'Component'),
      html: typeof renderFn === 'function' ? renderFn : () => String(renderFn ?? ''),
      setup: el => {
        nextTick(() => mountCbs.forEach(fn => fn(el)));
        return () => {
          unmountCbs.forEach(fn => fn());
          stops.forEach(s => s());
          // Only this exact instance's own teardown may clear the memo slot —
          // if a newer call already replaced it, that newer entry must stand.
          if (_cache?.instance === instance) _cache = null;
        };
      },
    };
    _cache = { props, instance };
    return instance;
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
