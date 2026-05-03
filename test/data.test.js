import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document  = win.document;
global.window    = win;
global.localStorage = win.window.localStorage;

const { signal, effect, createStore, createResource, createFetch } =
  await import('../src/data.js');

// ─────────────────────────────────────────────────────────────────────────────
describe('createStore — 基础响应式', () => {
  it('读写属性', () => {
    const s = createStore({ count: 0 });
    assert.equal(s.count, 0);
    s.count = 5;
    assert.equal(s.count, 5);
  });

  it('属性变化触发 effect', () => {
    const s = createStore({ name: 'a' });
    let last;
    effect(() => { last = s.name; });
    s.name = 'b';
    assert.equal(last, 'b');
  });

  it('写入相同值不触发 effect（signal === 比较）', () => {
    const s = createStore({ x: 1 });
    let runs = 0;
    effect(() => { s.x; runs++; });
    s.x = 1; // 相同值
    assert.equal(runs, 1);
  });

  it('symbol key 直接穿透，不建立 signal', () => {
    const sym = Symbol('test');
    const s = createStore({ [sym]: 42 });
    assert.equal(s[sym], 42);
  });

  it('初始值被 structuredClone（不共享引用）', () => {
    const orig = { arr: [1, 2, 3] };
    const s = createStore(orig);
    orig.arr.push(4);
    assert.equal(s.arr.length, 3); // store 不受原始对象影响
  });

  it('深层属性变化不触发（已知限制：只追踪顶层 key）', () => {
    const s = createStore({ obj: { x: 1 } });
    let runs = 0;
    effect(() => { s.obj; runs++; });
    s.obj.x = 2; // 直接 mutation，不是赋值 → 不触发
    assert.equal(runs, 1);
    // 正确做法：整体替换
    s.obj = { ...s.obj, x: 3 };
    assert.equal(runs, 2);
  });

  it('多个 key 独立追踪', () => {
    const s = createStore({ a: 1, b: 2 });
    let aRuns = 0, bRuns = 0;
    effect(() => { s.a; aRuns++; });
    effect(() => { s.b; bRuns++; });
    s.a = 10;
    assert.equal(aRuns, 2);
    assert.equal(bRuns, 1); // b 的 effect 未触发
  });
});

describe('createStore — persist', () => {
  it('写入时同步到 localStorage', () => {
    localStorage.clear();
    const s = createStore({ theme: 'light' }, { persist: 'prefs' });
    s.theme = 'dark';
    const stored = JSON.parse(localStorage.getItem('prefs'));
    assert.equal(stored.theme, 'dark');
  });

  it('初始化时从 localStorage 恢复', () => {
    localStorage.setItem('prefs2', JSON.stringify({ theme: 'dark' }));
    const s = createStore({ theme: 'light', lang: 'zh' }, { persist: 'prefs2' });
    assert.equal(s.theme, 'dark'); // 从 localStorage 恢复
    assert.equal(s.lang, 'zh');    // init 里的 key 保留
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('signal — 数组变异陷阱', () => {
  it('直接 .push() 不触发 effect（变异 vs 替换）', () => {
    const arr = signal([1, 2]);
    let runs = 0;
    effect(() => { arr.value; runs++; });
    arr.value.push(3); // 变异，=== 相等，不触发
    assert.equal(runs, 1);
    assert.equal(arr.value.length, 3); // 数据变了，但 effect 没跑
  });

  it('替换数组才触发 effect', () => {
    const arr = signal([1, 2]);
    let runs = 0;
    effect(() => { arr.value; runs++; });
    arr.value = [...arr.value, 3];
    assert.equal(runs, 2);
  });

  it('对象 signal 同理：属性 mutation 不触发', () => {
    const obj = signal({ x: 1 });
    let runs = 0;
    effect(() => { obj.value; runs++; });
    obj.value.x = 2; // 变异，不触发
    assert.equal(runs, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('effect — 嵌套', () => {
  it('内层 effect 独立追踪依赖', () => {
    const a = signal(1), b = signal(10);
    let inner = 0, outer = 0;
    effect(() => {
      a.value; outer++;
      effect(() => { b.value; inner++; });
    });
    assert.equal(outer, 1); assert.equal(inner, 1);
    b.value = 20; // 只触发内层
    assert.equal(outer, 1); assert.equal(inner, 2);
    a.value = 2;  // 触发外层，外层重新注册内层 effect
    assert.equal(outer, 2);
  });

  it('外层重跑时内层 effect 的 cleanup 被调用', () => {
    const a = signal(0);
    const log = [];
    effect(() => {
      a.value;
      const stop = effect(() => {
        log.push('inner-run');
        return () => log.push('inner-clean');
      });
      return stop; // 外层 cleanup 调用内层 dispose
    });
    log.length = 0;
    a.value = 1; // 外层重跑 → stop() → inner-clean，然后重新注册
    assert.ok(log.includes('inner-clean'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createResource', () => {
  it('无 source：立即发起请求，loading → data', async () => {
    const [res] = createResource(() => Promise.resolve(42));
    assert.equal(res.loading.value, true);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(res.data.value, 42);
    assert.equal(res.loading.value, false);
    assert.equal(res.error.value, null);
  });

  it('请求失败时设置 error', async () => {
    const err = new Error('fail');
    const [res] = createResource(() => Promise.reject(err));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(res.error.value, err);
    assert.equal(res.loading.value, false);
  });

  it('source signal 变化时取消上一次请求', async () => {
    const id = signal(1);
    let aborted = false;
    const [res] = createResource(id, (v, sig) => {
      sig.addEventListener('abort', () => { aborted = true; });
      return new Promise(r => setTimeout(() => r(v), 50));
    });
    id.value = 2; // 触发新请求，旧请求被 abort
    await new Promise(r => setTimeout(r, 10));
    assert.ok(aborted);
  });

  it('mutate 直接更新 data', async () => {
    const [res, { mutate }] = createResource(() => Promise.resolve(1));
    await new Promise(r => setTimeout(r, 0));
    mutate(99);
    assert.equal(res.data.value, 99);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('createFetch', () => {
  it('首次请求正常返回', async () => {
    const api = createFetch({ cache: false });
    const result = await api.get('k', () => Promise.resolve('data'));
    assert.equal(result, 'data');
  });

  it('cache 命中时不再调用 fetcher', async () => {
    const api = createFetch({ ttl: 60_000 });
    let calls = 0;
    await api.get('k2', () => { calls++; return Promise.resolve('v'); });
    await api.get('k2', () => { calls++; return Promise.resolve('v'); });
    assert.equal(calls, 1);
  });

  it('ttl:0 强制跳过缓存', async () => {
    const api = createFetch({ ttl: 60_000 });
    let calls = 0;
    await api.get('k3', () => { calls++; return Promise.resolve('v'); });
    await api.get('k3', () => { calls++; return Promise.resolve('v'); }, { ttl: 0 });
    assert.equal(calls, 2);
  });

  it('invalidate(key) 使单条失效', async () => {
    const api = createFetch({ ttl: 60_000 });
    let calls = 0;
    await api.get('k4', () => { calls++; return Promise.resolve('v'); });
    api.invalidate('k4');
    await api.get('k4', () => { calls++; return Promise.resolve('v'); });
    assert.equal(calls, 2);
  });

  it('invalidate() 清空全部', async () => {
    const api = createFetch({ ttl: 60_000 });
    let calls = 0;
    const f = () => { calls++; return Promise.resolve('v'); };
    await api.get('x', f); await api.get('y', f);
    api.invalidate();
    await api.get('x', f); await api.get('y', f);
    assert.equal(calls, 4);
  });

  it('失败后重试（retry:1），最终成功', async () => {
    const api = createFetch({ retry: 1, retryDelay: 1, cache: false });
    let calls = 0;
    const result = await api.get('r', () => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('fail'));
      return Promise.resolve('ok');
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  it('重试耗尽后抛出异常', async () => {
    const api = createFetch({ retry: 1, retryDelay: 1, cache: false });
    await assert.rejects(
      api.get('e', () => Promise.reject(new Error('always fail'))),
      /always fail/
    );
  });
});
