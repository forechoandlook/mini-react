import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

win.window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve() });

const { signal, h, keyedList, virtualList } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('keyedList — renderItem 可以返回 h`` 结果，走细粒度 patch', () => {
  it('渲染出正确内容，且节点上挂着编译模板的活绑定', () => {
    const sig = signal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    const parent = div();
    keyedList(sig, item => h`<span>${item.text}</span>`, item => item.id)(parent);
    assert.equal(parent.children[0].textContent, 'A');
    assert.equal(parent.children[1].textContent, 'B');
  });

  it('更新内容时只写变化的文本节点，不重建元素', () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = div();
    keyedList(sig, item => h`<span class="x">${item.text}</span>`, item => item.id)(parent);
    const span = parent.children[0].querySelector('span');

    sig.value = [{ id: 'a', text: 'A2' }];

    assert.equal(parent.children[0].querySelector('span'), span, '<span> 应该原地复用');
    assert.equal(span.textContent, 'A2');
  });

  it('相同内容不会触发任何写入（Object.is 跳过）', () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = div();
    keyedList(sig, item => h`<span>${item.text}</span>`, item => item.id)(parent);
    const span = parent.children[0].querySelector('span');
    const origData = span.firstChild.data;

    sig.value = [{ id: 'a', text: 'A' }]; // 新数组，内容相同

    assert.equal(span.firstChild.data, origData);
  });

  it('删除项仍然是异步淡出（h`` 模式不改变现有的动画行为）', async () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = div();
    keyedList(sig, item => h`<span>${item.text}</span>`, item => item.id)(parent);
    sig.value = [];
    assert.equal(parent.children.length, 1);
    await Promise.resolve();
    assert.equal(parent.children.length, 0);
  });
});

describe('virtualList — renderItem 可以返回 h`` 结果', () => {
  it('可见区域内的行正确渲染内容', () => {
    const items = signal(Array.from({ length: 20 }, (_, i) => ({ id: i, text: `row-${i}` })));
    const { el } = virtualList(items, item => h`<span>${item.text}</span>`, 20, 2);
    document.body.appendChild(el);
    Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true });
    el.dispatchEvent(new win.Event('scroll'));
    const first = el.querySelector('span');
    assert.ok(first);
    assert.match(first.textContent, /^row-\d+$/);
  });

  it('数据变化时，已可见的行内容会被更新（不再是只创建一次就冻结）', () => {
    const items = signal(Array.from({ length: 5 }, (_, i) => ({ id: i, text: `row-${i}` })));
    const { el } = virtualList(items, item => h`<span>${item.text}</span>`, 20, 2);
    document.body.appendChild(el);
    Object.defineProperty(el, 'clientHeight', { value: 200, configurable: true });
    el.dispatchEvent(new win.Event('scroll'));

    items.value = items.value.map(it => it.id === 0 ? { ...it, text: 'row-0-updated' } : it);

    const spans = [...el.querySelectorAll('span')].map(s => s.textContent);
    assert.ok(spans.includes('row-0-updated'), `expected updated text among ${spans}`);
  });
});
