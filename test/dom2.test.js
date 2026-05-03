import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;
global.location = win.window.location;
win.window.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve() });

const { signal, effect, bind, delegate, debounce, throttle, debouncedSignal, on, createRouter, mount, esc } =
  await import('../src/dom.js');

const input = () => {
  const el = document.createElement('input');
  // happy-dom: 手动触发 input 事件
  el.triggerInput = v => {
    el.value = v;
    el.dispatchEvent(new win.window.Event('input'));
  };
  return el;
};
const div = () => document.createElement('div');

// ─────────────────────────────────────────────────────────────────────────────
describe('bind — 双向绑定', () => {
  it('signal → input.value 同步', () => {
    const s = signal('hello');
    const el = input();
    bind(el, s);
    assert.equal(el.value, 'hello');
    s.value = 'world';
    assert.equal(el.value, 'world');
  });

  it('null signal → 空字符串', () => {
    const s = signal(null);
    const el = input();
    bind(el, s);
    assert.equal(el.value, '');
  });

  it('用户输入 → signal.value（input 事件）', () => {
    const s = signal('');
    const el = input();
    bind(el, s);
    el.triggerInput('typed');
    assert.equal(s.value, 'typed');
  });

  it('dispose 后 signal 变化不再同步到 input', () => {
    const s = signal('a');
    const el = input();
    const stop = bind(el, s);
    stop();
    s.value = 'b';
    assert.equal(el.value, 'a'); // 已 dispose，不更新
  });

  it('dispose 后 input 事件不再更新 signal', () => {
    const s = signal('a');
    const el = input();
    const stop = bind(el, s);
    stop();
    el.triggerInput('b');
    assert.equal(s.value, 'a'); // 已 dispose，signal 不变
  });

  it('数字 signal → input.value 是字符串（类型转换）', () => {
    const s = signal(42);
    const el = input();
    bind(el, s);
    assert.equal(el.value, '42'); // input.value 始终是字符串
    el.triggerInput('100');
    assert.equal(s.value, '100'); // 回写时是字符串，原来是数字 — 类型变了
    assert.equal(typeof s.value, 'string'); // 已知行为：bind 不做类型转换
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('delegate — 事件委托', () => {
  it('点击匹配选择器的元素触发 handler', () => {
    const d = div();
    d.innerHTML = '<button data-action="go">Go</button>';
    document.body.appendChild(d);

    let triggered = false;
    delegate.on('click', '[data-action="go"]', () => { triggered = true; });
    d.querySelector('[data-action="go"]').click();
    assert.ok(triggered);

    delegate.off('click', '[data-action="go"]');
    document.body.removeChild(d);
  });

  it('handler 收到 (event, matchedElement)', () => {
    const d = div();
    d.innerHTML = '<span data-tag="x">click</span>';
    document.body.appendChild(d);

    let gotEl = null;
    delegate.on('click', '[data-tag="x"]', (e, el) => { gotEl = el; });
    d.querySelector('[data-tag="x"]').click();
    assert.ok(gotEl);
    assert.equal(gotEl.dataset.tag, 'x');

    delegate.off('click', '[data-tag="x"]');
    document.body.removeChild(d);
  });

  it('off 后不再触发', () => {
    const d = div();
    d.innerHTML = '<button data-del="y">Y</button>';
    document.body.appendChild(d);

    let count = 0;
    delegate.on('click', '[data-del="y"]', () => count++);
    d.querySelector('[data-del="y"]').click();
    delegate.off('click', '[data-del="y"]');
    d.querySelector('[data-del="y"]').click();
    assert.equal(count, 1);

    document.body.removeChild(d);
  });

  it('不匹配的元素不触发', () => {
    const d = div();
    d.innerHTML = '<button>no match</button>';
    document.body.appendChild(d);

    let triggered = false;
    delegate.on('click', '[data-never]', () => { triggered = true; });
    d.querySelector('button').click();
    assert.ok(!triggered);

    delegate.off('click', '[data-never]');
    document.body.removeChild(d);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('debounce', () => {
  it('延迟执行', async () => {
    let calls = 0;
    const fn = debounce(() => calls++, 20);
    fn(); fn(); fn();
    assert.equal(calls, 0);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(calls, 1); // 只执行一次
  });

  it('.cancel() 阻止执行', async () => {
    let calls = 0;
    const fn = debounce(() => calls++, 20);
    fn();
    fn.cancel();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(calls, 0);
  });

  it('.flush() 立即执行并传参', () => {
    let received;
    const fn = debounce(v => { received = v; }, 1000);
    fn.flush('immediate');
    assert.equal(received, 'immediate');
  });
});

describe('throttle', () => {
  it('首次立即执行', () => {
    let calls = 0;
    const fn = throttle(() => calls++, 50);
    fn();
    assert.equal(calls, 1);
  });

  it('间隔内多次调用只执行一次', async () => {
    let calls = 0;
    const fn = throttle(() => calls++, 50);
    fn(); fn(); fn();
    assert.equal(calls, 1);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(calls, 2); // 尾调用在 throttle 结束后执行
  });

  it('.cancel() 阻止尾调用', async () => {
    let calls = 0;
    const fn = throttle(() => calls++, 50);
    fn(); fn(); // 第二次排入尾调用
    fn.cancel();
    await new Promise(r => setTimeout(r, 60));
    assert.equal(calls, 1); // 尾调用被取消
  });
});

describe('debouncedSignal', () => {
  it('输入变化后延迟同步到输出 signal', async () => {
    const src = signal('a');
    const out = debouncedSignal(src, 20);
    assert.equal(out.value, 'a'); // 初始值立即同步
    src.value = 'b';
    assert.equal(out.value, 'a'); // 未到防抖时间
    await new Promise(r => setTimeout(r, 30));
    assert.equal(out.value, 'b');
  });

  it('快速连续变化只触发一次', async () => {
    const src = signal(0);
    const out = debouncedSignal(src, 20);
    let runs = 0;
    effect(() => { out.value; runs++; });
    runs = 0;
    src.value = 1; src.value = 2; src.value = 3;
    await new Promise(r => setTimeout(r, 30));
    assert.equal(runs, 1);
    assert.equal(out.value, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createRouter', () => {
  it('match 提取路径参数', () => {
    const router = createRouter({ '/': () => 'home' });
    // 手动设置 current 来测试 match（不依赖 location.hash）
    router.current.value = '/users/42';
    const params = router.match('/users/:id');
    assert.deepEqual(params, ['42']);
  });

  it('match 多参数', () => {
    const router = createRouter({});
    router.current.value = '/a/1/b/2';
    assert.deepEqual(router.match('/a/:x/b/:y'), ['1', '2']);
  });

  it('match 不匹配返回 null', () => {
    const router = createRouter({});
    router.current.value = '/about';
    assert.equal(router.match('/users/:id'), null);
  });

  it('* 通配符匹配任意路径', () => {
    const router = createRouter({
      '/home': () => 'home',
      '*': () => '404',
    });
    router.current.value = '/unknown';
    // route 在 effect 里更新，手动触发
    assert.equal(typeof router.route.value, 'string'); // '404'
  });

  it('同一路径第二次命中缓存', () => {
    let calls = 0;
    const router = createRouter({
      '/p': () => { calls++; return 'page'; },
    });
    router.current.value = '/p';
    router.current.value = '/other-unknown';
    router.current.value = '/p'; // 回到 /p，命中缓存
    assert.equal(calls, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('on / once', () => {
  it('on 返回 dispose，调用后移除监听', () => {
    const d = div();
    let count = 0;
    const off = on(d, 'click', () => count++);
    d.click(); d.click();
    off();
    d.click();
    assert.equal(count, 2);
  });
});
