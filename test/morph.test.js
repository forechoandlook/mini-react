import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, mount } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('mount — DOM morph (diff/patch instead of blind innerHTML replace)', () => {
  it('未变化的子节点在重渲染后是同一个 DOM 引用', () => {
    const bump = signal(0); // forces a re-render without changing the list itself
    const d = div();
    mount(d, () => { bump.value; return `<ul><li data-key="a">A</li><li data-key="b">B</li></ul>`; });
    const liA = d.querySelector('[data-key="a"]');

    bump.value = 1; // triggers a re-render with identical markup
    const liA2 = d.querySelector('[data-key="a"]');
    assert.ok(liA2 === liA, '未变化的 keyed 节点应原地复用');
  });

  it('只有变化的属性被更新，其余属性原样保留', () => {
    const cls = signal('a');
    const d = div();
    mount(d, () => `<div id="x" class="${cls.value}" data-static="keep"></div>`, { escape: false });
    const x = d.querySelector('#x');
    x.setAttribute('data-runtime', 'set-by-user'); // simulate something outside the render touching the DOM

    cls.value = 'b';
    const x2 = d.querySelector('#x');
    assert.ok(x2 === x);
    assert.equal(x2.className, 'b');
    assert.equal(x2.getAttribute('data-static'), 'keep');
  });

  it('列表按 data-key 重排：DOM 节点跟着 key 移动，不是内容整体重写', () => {
    const order = signal(['a', 'b', 'c']);
    const d = div();
    mount(d, () => `<ul>${order.value.map(k => `<li data-key="${k}">${k}</li>`).join('')}</ul>`, { escape: false });

    order.value = ['c', 'a', 'b'];
    const ul = d.querySelector('ul');
    assert.deepEqual([...ul.children].map(c => c.dataset.key), ['c', 'a', 'b']);
  });

  it('删除的列表项对应的 DOM 节点被移除', () => {
    const order = signal(['a', 'b', 'c']);
    const d = div();
    mount(d, () => `<ul>${order.value.map(k => `<li data-key="${k}">${k}</li>`).join('')}</ul>`, { escape: false });

    order.value = ['a', 'c'];
    assert.equal(d.querySelectorAll('li').length, 2);
    assert.equal(d.querySelector('[data-key="b"]'), null);
  });

  it('文本节点内容变化时只更新 data，不重建元素', () => {
    const label = signal('hello');
    const d = div();
    mount(d, () => `<p id="p">${label.value}</p>`, { escape: false });
    const p = d.querySelector('#p');
    const textNode = p.firstChild;

    label.value = 'world';
    assert.equal(p.firstChild, textNode, '文本节点应原地更新，不是新建');
    assert.equal(p.textContent, 'world');
  });

  it('标签不同时无法复用，回退为真正替换（不会把新标签的属性硬套在旧节点上）', () => {
    const kind = signal('input');
    const d = div();
    mount(d, () => (kind.value === 'input' ? `<input id="x" value="v">` : `<span id="x">v</span>`), { escape: false });
    const before = d.querySelector('#x');
    assert.equal(before.tagName, 'INPUT');

    kind.value = 'span';
    const after = d.querySelector('#x');
    assert.equal(after.tagName, 'SPAN');
    assert.notEqual(after, before);
  });

  it('escape:true 的纯字符串渲染仍然是安全转义的单一文本节点', () => {
    const raw = signal('<b>x</b>');
    const d = div();
    mount(d, () => raw.value); // escape defaults to true
    assert.equal(d.innerHTML, '&lt;b&gt;x&lt;/b&gt;');
    raw.value = '<i>y</i> & z';
    assert.equal(d.innerHTML, '&lt;i&gt;y&lt;/i&gt; &amp; z');
  });

  it('id 隐式作为 key：没写 data-key 的元素也能按 id 原地复用', () => {
    const n = signal(1);
    const d = div();
    mount(d, () => `<div id="box">count ${n.value}</div>`, { escape: false });
    const box = d.querySelector('#box');
    n.value = 2;
    assert.ok(d.querySelector('#box') === box);
    assert.equal(box.textContent, 'count 2');
  });
});
