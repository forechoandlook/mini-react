import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;
// mock el.animate — 原型级别，不影响 createElement 调用链
win.window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve() });

const { signal, computed, effect, batch, mount, show, keyedList, h, defineComponent, on } =
  await import('../src/dom.js');

const div = () => document.createElement('div');

// ─────────────────────────────────────────────────────────────────────────────
describe('show — 边界情况', () => {
  it('no 参数省略时默认渲染空字符串', () => {
    const flag = signal(false);
    const d = div();
    mount(d, show(flag, () => 'yes'));
    assert.equal(d.innerHTML, '');
  });

  it('传入普通 boolean（非 signal）— 静默失效，始终走 no 分支', () => {
    // cond.value 在非 signal 时是 undefined（falsy）
    // 这是已知限制：show 的第一个参数必须是 signal
    const d = div();
    mount(d, show(true, () => 'yes', () => 'no'));
    assert.equal(d.innerHTML, 'no'); // true.value === undefined → 走 no
  });

  it('signal 切换多次保持正确', () => {
    const flag = signal(true);
    const d = div();
    mount(d, show(flag, () => 'yes', () => 'no'));
    flag.value = false;
    flag.value = true;
    flag.value = false;
    assert.equal(d.innerHTML, 'no');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('batch — 嵌套', () => {
  it('单层 batch 只触发一次 effect', () => {
    const a = signal(0), b = signal(0);
    let runs = 0;
    effect(() => { a.value + b.value; runs++; });
    runs = 0;
    batch(() => { a.value = 1; b.value = 2; });
    assert.equal(runs, 1);
  });

  it('嵌套 batch：所有写入合并为一次更新', () => {
    const a = signal(0), b = signal(0), c = signal(0);
    let runs = 0;
    effect(() => { a.value + b.value + c.value; runs++; });
    runs = 0;
    batch(() => {
      a.value = 1;
      batch(() => { b.value = 2; }); // 内层不提前 flush，外层统一处理
      c.value = 3;
    });
    assert.equal(runs, 1); // 全部合并为一次
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('computed — 菱形依赖', () => {
  it('A→B、A→C、B+C→D：A 变化时 D 计算两次（push 模型已知行为）', () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value * 2);
    let dRuns = 0;
    const d = computed(() => { dRuns++; return b.value + c.value; });

    assert.equal(d.value, 4); // b=2, c=2
    dRuns = 0;
    a.value = 2; // b=3, c=4, d=7
    assert.equal(d.value, 7);
    // push 模型无拓扑排序：b 先通知 d，d 用旧 c 计算一次；c 再通知 d，d 再算一次
    assert.equal(dRuns, 2); // 记录实际行为：计算两次但结果正确
  });

  it('batch 不保护 computed 菱形（computed 通知绕过 _batching）', () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => a.value * 2);
    let dRuns = 0;
    const d = computed(() => { dRuns++; return b.value + c.value; });
    dRuns = 0;
    batch(() => { a.value = 3; });
    // computed 在 flush 时直接调用订阅者，不走 _pending，d 仍然计算两次
    assert.equal(dRuns, 2); // 已知限制：computed 不参与批量调度
    assert.equal(d.value, 10); // 结果正确
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('keyedList — 排序与增删', () => {
  const items = sig => {
    const parent = div();
    keyedList(sig, item => item.text, item => item.id)(parent);
    return parent;
  };
  const keys = parent => [...parent.children].map(el => el.dataset.key);

  it('初始渲染顺序正确', () => {
    const sig = signal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }]);
    const parent = items(sig);
    assert.deepEqual(keys(parent), ['a', 'b']);
  });

  it('整体倒序', () => {
    const sig = signal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
    const parent = items(sig);
    sig.value = [{ id: 'c', text: 'C' }, { id: 'b', text: 'B' }, { id: 'a', text: 'A' }];
    assert.deepEqual(keys(parent), ['c', 'b', 'a']);
  });

  it('中间插入新项', () => {
    const sig = signal([{ id: 'a', text: 'A' }, { id: 'c', text: 'C' }]);
    const parent = items(sig);
    sig.value = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }];
    assert.deepEqual(keys(parent), ['a', 'b', 'c']);
  });

  it('删除中间项', () => {
    const sig = signal([{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }]);
    const parent = items(sig);
    sig.value = [{ id: 'a', text: 'A' }, { id: 'c', text: 'C' }];
    // fadeOut 是异步的，删除后 domMap 已清除，但 DOM 移除依赖 animation.finished
    // 这里只验证 domMap 不再跟踪已删除项（通过再次更新不报错来间接验证）
    sig.value = [{ id: 'a', text: 'A' }, { id: 'd', text: 'D' }, { id: 'c', text: 'C' }];
    assert.deepEqual(keys(parent).filter(k => k !== 'b'), ['a', 'd', 'c']);
  });

  it('清空列表 — 移除是异步的（fadeOut.finished.then）', async () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = items(sig);
    sig.value = [];
    // 同步时元素还在 DOM（fadeOut 动画未结束）
    assert.equal(parent.children.length, 1);
    // 等待 microtask，Promise.resolve().then(el.remove) 执行后节点移除
    await Promise.resolve();
    assert.equal(parent.children.length, 0);
  });

  it('更新已有项内容', () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = items(sig);
    sig.value = [{ id: 'a', text: 'A2' }];
    assert.equal(parent.children[0].innerHTML, 'A2');
  });

  it('相同内容不重新设置 innerHTML', () => {
    const sig = signal([{ id: 'a', text: 'A' }]);
    const parent = items(sig);
    const el = parent.children[0];
    sig.value = [{ id: 'a', text: 'A' }]; // 内容相同
    assert.equal(parent.children[0], el); // 同一个节点，未被替换
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('children key 规则', () => {
  it('纯字符串 → [data-r="key"]', () => {
    const d = div();
    mount(d, () => ({
      html: '<div><span data-r="foo"></span></div>',
      children: { foo: () => 'bar' },
    }));
    assert.equal(d.querySelector('[data-r="foo"]').innerHTML, 'bar');
  });

  it('. 开头 → class 选择器', () => {
    const d = div();
    mount(d, () => ({
      html: '<div><span class="slot"></span></div>',
      children: { '.slot': () => 'ok' },
    }));
    assert.equal(d.querySelector('.slot').innerHTML, 'ok');
  });

  it('# 开头 → id 选择器', () => {
    const d = div();
    mount(d, () => ({
      html: '<div><span id="myslot"></span></div>',
      children: { '#myslot': () => 'ok' },
    }));
    assert.equal(d.querySelector('#myslot').innerHTML, 'ok');
  });

  it('[ 开头 → 属性选择器', () => {
    const d = div();
    mount(d, () => ({
      html: '<div><span data-x="1"></span></div>',
      children: { '[data-x="1"]': () => 'ok' },
    }));
    assert.equal(d.querySelector('[data-x="1"]').innerHTML, 'ok');
  });

  it('选择器找不到节点时不报错', () => {
    const d = div();
    assert.doesNotThrow(() => {
      mount(d, () => ({
        html: '<div></div>',
        children: { missing: () => 'x' },
      }));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('h tagged template — 边界情况', () => {
  it('null/undefined 插值渲染为空字符串', () => {
    assert.equal(h`<p>${null}</p>`, '<p></p>');
    assert.equal(h`<p>${undefined}</p>`, '<p></p>');
  });

  it('数字插值转义后内联', () => {
    assert.equal(h`<p>${42}</p>`, '<p>42</p>');
  });

  it('组件结果对象（{ html }）识别为组件', () => {
    const result = h`<div>${{ html: '<b>x</b>', setup: () => {} }}</div>`;
    assert.equal(typeof result, 'object');
    assert.ok(result.html.includes('data-slot'));
  });

  it('__isComponent 标记的对象识别为组件', () => {
    const Comp = defineComponent(() => 'hi');
    const result = h`<div>${Comp}</div>`;
    assert.equal(typeof result, 'object'); // 被识别为组件，不是字符串
  });

  it('混合插值：字符串转义，组件占位', () => {
    const Child = () => 'child';
    const result = h`<div>${'<b>evil</b>'}${Child}</div>`;
    assert.ok(result.html.includes('&lt;b&gt;')); // 字符串被转义
    assert.ok(result.html.includes('data-slot')); // 组件有占位
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('mount — 边界情况', () => {
  it('直接传非函数字符串', () => {
    const d = div();
    mount(d, 'hello');
    assert.equal(d.innerHTML, 'hello');
  });

  it('组件函数返回 null/undefined 不报错', () => {
    const d = div();
    assert.doesNotThrow(() => mount(d, () => null));
    assert.doesNotThrow(() => mount(d, () => undefined));
  });

  it('多次 dispose 不报错', () => {
    const d = div();
    const stop = mount(d, () => 'x');
    assert.doesNotThrow(() => { stop(); stop(); });
  });
});
