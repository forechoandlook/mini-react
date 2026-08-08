import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, mount, h, defineComponent } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('defineComponent — 相同 props 的重复调用应该复用同一个实例', () => {
  it('shallow-equal props → 同一个实例对象（setup 不重跑）', () => {
    let setupRuns = 0;
    const Child = defineComponent((props) => {
      setupRuns++;
      return () => `label:${props.label}`;
    });
    const a = Child({ label: 'x' });
    const b = Child({ label: 'x' }); // 新的 props 对象字面量，但内容相同
    assert.equal(a, b, '应该是同一个 instance 引用');
    assert.equal(setupRuns, 1, 'setup 只该跑一次');
  });

  it('props 变化 → 新实例（setup 重跑）', () => {
    let setupRuns = 0;
    const Child = defineComponent((props) => {
      setupRuns++;
      return () => `label:${props.label}`;
    });
    const a = Child({ label: 'x' });
    const b = Child({ label: 'y' });
    assert.notEqual(a, b);
    assert.equal(setupRuns, 2);
  });

  it('父组件重渲染但 props 不变时，嵌套 h`` 组件不会被拆除重建', async () => {
    let mounts = 0, unmounts = 0, setupRuns = 0;
    const Child = defineComponent((props, ctx) => {
      setupRuns++;
      ctx.onMount(() => mounts++);
      ctx.onUnmount(() => unmounts++);
      return () => `v:${props.label}`;
    });

    const bump = signal(0); // 触发父组件重渲染，但不影响传给 Child 的 props
    const d = div();
    mount(d, () => { bump.value; return h`<div>${Child({ label: 'fixed' })}</div>`; });
    await new Promise(r => setTimeout(r, 5));
    const wrapper = d.querySelector('span');
    assert.equal(setupRuns, 1);
    assert.equal(mounts, 1);

    bump.value = 1; // 父组件重渲染，Child({label:'fixed'}) 再次被调用，但 props 相同
    await new Promise(r => setTimeout(r, 5));

    assert.equal(setupRuns, 1, 'props 没变，setup 不应该重跑');
    assert.equal(unmounts, 0, '不应该被卸载');
    assert.equal(d.querySelector('span'), wrapper, '包裹节点应该还是同一个（没有被拆除重建）');
  });

  it('父组件重渲染且 props 变化时，Child 正常换新实例、触发生命周期', async () => {
    let setupRuns = 0, unmounts = 0;
    const Child = defineComponent((props, ctx) => {
      setupRuns++;
      ctx.onUnmount(() => unmounts++);
      return () => `v:${props.label}`;
    });

    const label = signal('a');
    const d = div();
    mount(d, () => h`<div>${Child({ label: label.value })}</div>`);
    assert.equal(d.textContent, 'v:a');
    assert.equal(setupRuns, 1);

    label.value = 'b';
    assert.equal(d.textContent, 'v:b');
    assert.equal(setupRuns, 2, 'props 变了，应该是新实例');
    assert.equal(unmounts, 1, '旧实例应该被正常卸载');
  });

  it('组件被卸载后，之后用相同 props 再次调用会创建全新实例（不复用已销毁的旧实例）', () => {
    let setupRuns = 0;
    const Child = defineComponent(() => { setupRuns++; return () => 'x'; });

    const show = signal(true);
    const d = div();
    mount(d, () => (show.value ? h`<div>${Child({ label: 'x' })}</div>` : h`<div></div>`));
    assert.equal(setupRuns, 1);

    show.value = false; // 卸载
    show.value = true;  // 重新挂载，props 内容和第一次一样

    assert.equal(setupRuns, 2, '旧实例已经被销毁，不能被当成"没变化"复用');
  });

  it('顶层 mount(el, () => Child(props)) 用法（不经过 h``）：props 不变时 setup 也不重跑', () => {
    let setupRuns = 0, unmounts = 0;
    const Child = defineComponent((props, ctx) => {
      setupRuns++;
      ctx.onUnmount(() => unmounts++);
      return () => `top:${props.label}`;
    });

    const bump = signal(0);
    const d = div();
    mount(d, () => { bump.value; return Child({ label: 'fixed' }); });
    assert.equal(setupRuns, 1);
    assert.equal(d.textContent, 'top:fixed');

    bump.value = 1; // 顶层 mount 的 effect 重跑，重新调用 Child(props)，但 props 没变
    bump.value = 2;

    assert.equal(setupRuns, 1, 'props 没变，顶层 mount 也不该重跑 setup');
    assert.equal(unmounts, 0);
    assert.equal(d.textContent, 'top:fixed');
  });

  it('顶层 mount(el, () => Child(props)) 用法：props 变化时正常换新实例', () => {
    let setupRuns = 0, unmounts = 0;
    const Child = defineComponent((props, ctx) => {
      setupRuns++;
      ctx.onUnmount(() => unmounts++);
      return () => `top:${props.label}`;
    });

    const label = signal('a');
    const d = div();
    mount(d, () => Child({ label: label.value }));
    assert.equal(d.textContent, 'top:a');
    assert.equal(setupRuns, 1);

    label.value = 'b';
    assert.equal(d.textContent, 'top:b');
    assert.equal(setupRuns, 2);
    assert.equal(unmounts, 1);
  });

  it('同一个组件类型同时渲染多个实例（列表场景）：单一缓存槽不会导致状态串号', () => {
    // defineComponent 的 memo 槽是"每个 defineComponent() 调用一个"，不是"每个逻辑实例一个"——
    // 用同一个 factory 连续渲染不同 props 的多个实例时，预期是拿不到 memo 收益（每次都 miss），
    // 但绝不能把 A 实例的状态错误地喂给 B。
    let setupRuns = 0;
    const Card = defineComponent((props) => {
      setupRuns++;
      const ownLabel = props.label; // 捕获创建时的 props，验证后续调用不会污染它
      return () => `card:${ownLabel}`;
    });

    const rows = [{ id: 1, label: 'A' }, { id: 2, label: 'B' }, { id: 3, label: 'C' }];
    const instances = rows.map(r => Card({ label: r.label }));

    assert.equal(setupRuns, 3, '三个不同 props 的调用，每个都应该是独立实例');
    assert.deepEqual(instances.map(i => i.html()), ['card:A', 'card:B', 'card:C'], '每个实例必须保留自己的 props，不能互相覆盖');
    // 三个实例互不相同
    assert.equal(new Set(instances).size, 3);

    // 重新以相同的三组 props 再跑一轮：因为缓存槽在三次调用之间被互相顶替，
    // 每一个仍然会 miss（拿不到 memo 收益），但内容依然各自正确，不会串号。
    const instances2 = rows.map(r => Card({ label: r.label }));
    assert.deepEqual(instances2.map(i => i.html()), ['card:A', 'card:B', 'card:C']);
  });

  it('props 含函数（如事件回调）：每次都是新引用，预期每次都判定为"变了"（已知限制，非 bug）', () => {
    let setupRuns = 0;
    const Btn = defineComponent((props) => {
      setupRuns++;
      return () => `btn:${props.label}`;
    });
    Btn({ label: 'x', onClick: () => {} });
    Btn({ label: 'x', onClick: () => {} }); // 新的箭头函数，引用不同

    assert.equal(setupRuns, 2, '函数 prop 每次都是新引用，shallow-equal 必然判定为变化——这是预期行为，不是缺陷');
  });

  it('props 含 NaN：Object.is 语义下应视为相等（优于朴素 ===）', () => {
    let setupRuns = 0;
    const Child = defineComponent((props) => { setupRuns++; return () => String(props.v); });
    const a = Child({ v: NaN });
    const b = Child({ v: NaN });
    assert.equal(a, b);
    assert.equal(setupRuns, 1, 'NaN 与 NaN 在 Object.is 下相等，不应该被判定为变化');
  });
});
