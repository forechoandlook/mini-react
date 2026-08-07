import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;
global.location = win.location;

const { signal, mount, defineComponent, createRouter } = await import('../src/dom.js');

const div = () => document.createElement('div');
const tick = () => new Promise(r => setTimeout(r, 5));

describe('mount — component-swap setup/onMount', () => {
  it('每个 defineComponent 实例在被换入同一挂载点时都会触发自己的 onMount', async () => {
    const calls = [];
    const A = defineComponent((props, ctx) => { ctx.onMount(() => calls.push('A')); return () => 'A'; });
    const B = defineComponent((props, ctx) => { ctx.onMount(() => calls.push('B')); return () => 'B'; });

    const which = signal('a');
    const d = div();
    mount(d, () => (which.value === 'a' ? A() : B()));
    await tick();
    assert.deepEqual(calls, ['A']);

    which.value = 'b';
    await tick();
    assert.deepEqual(calls, ['A', 'B'], 'B 的 onMount 必须触发，不能被 A 的调用永久挡住');
  });

  it('匿名 { html, setup } 对象每次渲染重新创建时，setup 仍然只跑一次（不回归）', () => {
    const s = signal('a');
    const d = div();
    let setupCalled = 0;
    mount(d, () => ({
      html: () => `<span>${s.value}</span>`,
      setup: () => { setupCalled++; },
    }));
    s.value = 'b';
    s.value = 'c';
    assert.equal(setupCalled, 1);
  });
});

describe('createRouter — keepAlive', () => {
  it('keepAlive 默认关闭：每次访问都是全新实例（不回归）', async () => {
    let calls = 0;
    const router = createRouter({ '/x': () => { calls++; return 'x'; } });
    location.hash = '#/x'; await tick();
    location.hash = '#/y'; await tick(); // no matching route, factory not called
    location.hash = '#/x'; await tick();
    assert.equal(calls, 2);
  });

  it('keepAlive:true 时组件实例被复用，内部 signal 状态跨导航保留', async () => {
    const counters = {};
    const A = defineComponent((props, ctx) => {
      const count = ctx.signal(0);
      counters.a = count;
      return () => `A:${count.value}`;
    });
    const B = defineComponent(() => () => 'B');

    const router = createRouter({ '/a': () => A(), '/b': () => B() }, { keepAlive: true });
    const d = div();
    mount(d, () => router.route.value);

    location.hash = '#/a';
    await tick();
    counters.a.value = 5;
    assert.equal(d.innerHTML, 'A:5');

    location.hash = '#/b';
    await tick();
    assert.equal(d.innerHTML, 'B');

    location.hash = '#/a';
    await tick();
    assert.equal(d.innerHTML, 'A:5', '离开又回来后本地 signal 状态应保留');
  });

  it('invalidate() 清空缓存后下一次访问重新构建', async () => {
    let calls = 0;
    const router = createRouter({ '/a': () => { calls++; return `a${calls}`; } }, { keepAlive: true });
    location.hash = '#/a'; await tick();
    assert.equal(calls, 1);
    location.hash = '#/b'; await tick();
    location.hash = '#/a'; await tick();
    assert.equal(calls, 1, '缓存命中，不应重新构建');

    router.invalidate('/a');
    location.hash = '#/b'; await tick();
    location.hash = '#/a'; await tick();
    assert.equal(calls, 2, 'invalidate 后应重新构建');
  });
});
