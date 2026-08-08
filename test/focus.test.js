import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, mount } = await import('../src/dom.js');

const div = () => document.createElement('div');

// Regression: a search box bound to its own signal used to lose focus on
// every keystroke because mount() replaced the whole subtree's innerHTML,
// destroying the focused <input> and creating an unfocused one in its place.
//
// Since mount() now morphs (diffs+patches) instead of blindly reassigning
// innerHTML, an <input id="q"> is matched by id across renders and the *same*
// DOM node is reused — so focus is never actually lost in the first place.
// The capture/restore logic in _captureFocus/_resolveFocusPath below still
// exists as a fallback for the rarer case where a focused element genuinely
// gets replaced (different tag, or no stable key to match on).
//
// Note: comparisons below use assert.ok(a === b) rather than assert.equal —
// assert.equal's failure path runs util.inspect on both operands, which is
// pathologically slow for happy-dom Element objects (deep circular
// parent/child/ownerDocument links) and can hang the test for a minute-plus
// instead of just failing.
describe('mount — focus preservation across re-render', () => {
  it('输入框在自身 signal 驱动的重渲染后保留焦点（morph 复用同一节点）', () => {
    document.body.innerHTML = '';
    const query = signal('');
    const d = div();
    document.body.appendChild(d);
    mount(d, () => `<input id="q" value="${query.value}">`, { escape: false });

    const input = document.getElementById('q');
    input.focus();
    assert.ok(document.activeElement === input);

    query.value = 'h'; // triggers a re-render
    const next = document.getElementById('q');
    assert.ok(next === input, 'morph should reuse the same node (matched by id), not recreate it');
    assert.ok(document.activeElement === next, 'focus should still be on it');
  });

  it('focus 回退路径：确实被换成不同标签的元素时，尽力把焦点转移过去', () => {
    document.body.innerHTML = '';
    const query = signal('input');
    const d = div();
    document.body.appendChild(d);
    // No stable key, and the tag itself changes — morph can't reuse the node,
    // this exercises the _captureFocus/_resolveFocusPath fallback directly.
    mount(d, () => (query.value === 'input' ? `<input id="q">` : `<button id="q">go</button>`), { escape: false });

    const input = document.getElementById('q');
    input.focus();
    assert.ok(document.activeElement === input);

    query.value = 'button';
    const next = document.getElementById('q');
    assert.ok(next.tagName === 'BUTTON');
    assert.ok(document.activeElement === next, 'focus should follow to the replacement element via the id fallback');
  });

  it('保留光标位置（selectionStart/End）', () => {
    document.body.innerHTML = '';
    const query = signal('ab');
    const d = div();
    document.body.appendChild(d);
    mount(d, () => `<input id="q" value="${query.value}">`, { escape: false });

    const input = document.getElementById('q');
    input.focus();
    input.setSelectionRange(1, 1);

    query.value = 'acb';
    const next = document.getElementById('q');
    assert.equal(next.selectionStart, 1);
    assert.equal(next.selectionEnd, 1);
  });

  it('未聚焦时重渲染不会意外抢焦点', () => {
    document.body.innerHTML = '';
    const query = signal('');
    const d = div();
    document.body.appendChild(d);
    mount(d, () => `<input id="q" value="${query.value}"><button id="b">go</button>`, { escape: false });
    document.getElementById('b').focus();

    query.value = 'x';
    assert.equal(document.activeElement?.id, 'b');
  });
});
