import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, effect, setUpdateMode, getUpdateMode, flushSync } = await import('../src/dom.js');

// Always restore the default so other test files (which assume synchronous
// updates, as does most of the library today) aren't affected by ordering.
afterEach(() => setUpdateMode('sync'));

describe('setUpdateMode — sync (default) vs microtask', () => {
  it('默认是 sync：写信号后 effect 立即同步执行', () => {
    assert.equal(getUpdateMode(), 'sync');
    const s = signal(0);
    let seen;
    effect(() => { seen = s.value; });
    s.value = 1;
    assert.equal(seen, 1, 'sync 模式下不需要等待，立刻生效');
  });

  it("microtask 模式：写信号后 effect 不会立刻执行，要等一个 microtask", async () => {
    setUpdateMode('microtask');
    const s = signal(0);
    let seen = 0, runs = 0;
    effect(() => { seen = s.value; runs++; });
    assert.equal(runs, 1); // initial run is always synchronous

    s.value = 1;
    assert.equal(seen, 0, '写入后同一个同步任务里还不应该生效');
    assert.equal(runs, 1);

    await Promise.resolve();
    assert.equal(seen, 1, '一个 microtask 之后应该已经生效');
    assert.equal(runs, 2);
  });

  it('microtask 模式：同一个同步任务里对多个信号的写入合并为一次 effect 执行', async () => {
    setUpdateMode('microtask');
    const a = signal(0), b = signal(0);
    let runs = 0;
    effect(() => { a.value; b.value; runs++; });
    assert.equal(runs, 1);

    a.value = 1; b.value = 2; a.value = 3;
    assert.equal(runs, 1, '还没 flush');

    await Promise.resolve();
    assert.equal(runs, 2, '三次写入应该只触发一次重跑');
  });

  it('microtask 模式：flushSync() 可以立刻强制提交，不用等 microtask', () => {
    setUpdateMode('microtask');
    const s = signal(0);
    let seen;
    effect(() => { seen = s.value; });
    s.value = 5;
    assert.equal(seen, 0);
    flushSync();
    assert.equal(seen, 5, 'flushSync 应该立即提交挂起的更新');
  });

  it('microtask 模式下 batch() 依旧在自己结束时同步提交', () => {
    setUpdateMode('microtask');
    // batch is imported lazily here to avoid unused-import lint noise elsewhere
    return import('../src/dom.js').then(({ batch, signal: sig2 }) => {
      const s = sig2(0);
      let seen;
      effect(() => { seen = s.value; });
      batch(() => { s.value = 9; });
      assert.equal(seen, 9, 'batch() 内部的写入应该在 batch() 返回时就已生效');
    });
  });
});
