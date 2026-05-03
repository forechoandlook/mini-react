import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, watch, onCleanup, esc, html } from '../src/core.js';

describe('signal', () => {
  it('读写基本值', () => {
    const s = signal(1);
    assert.equal(s.value, 1);
    s.value = 2;
    assert.equal(s.value, 2);
  });

  it('peek 不触发订阅', () => {
    const s = signal(0);
    let runs = 0;
    effect(() => { s.value; runs++; });
    assert.equal(runs, 1);
    s.peek(); // 不订阅
    s.value = 1;
    assert.equal(runs, 2); // 只因 .value 的订阅触发
  });

  it('相等时不触发更新', () => {
    const s = signal(1);
    let runs = 0;
    effect(() => { s.value; runs++; });
    s.value = 1; // 相等，跳过
    assert.equal(runs, 1);
  });

  it('自定义 equals', () => {
    const s = signal({ x: 0 }, { equals: (a, b) => a.x === b.x });
    let runs = 0;
    effect(() => { s.value; runs++; });
    s.value = { x: 0 }; // equals 返回 true，跳过
    assert.equal(runs, 1);
    s.value = { x: 1 };
    assert.equal(runs, 2);
  });
});

describe('computed', () => {
  it('自动追踪依赖', () => {
    const a = signal(2);
    const b = computed(() => a.value * 3);
    assert.equal(b.value, 6);
    a.value = 4;
    assert.equal(b.value, 12);
  });

  it('只在依赖变化时重新计算', () => {
    const a = signal(1);
    let runs = 0;
    const c = computed(() => { runs++; return a.value; });
    assert.equal(runs, 1);
    a.value = 1; // 相等，跳过
    assert.equal(runs, 1);
    a.value = 2;
    assert.equal(runs, 2);
  });

  it('链式 computed', () => {
    const a = signal(1);
    const b = computed(() => a.value + 1);
    const c = computed(() => b.value * 2);
    assert.equal(c.value, 4);
    a.value = 2;
    assert.equal(c.value, 6);
  });
});

describe('effect', () => {
  it('立即执行', () => {
    let ran = false;
    effect(() => { ran = true; });
    assert.ok(ran);
  });

  it('依赖变化时重新执行', () => {
    const s = signal(0);
    let last;
    effect(() => { last = s.value; });
    s.value = 5;
    assert.equal(last, 5);
  });

  it('dispose 停止追踪', () => {
    const s = signal(0);
    let runs = 0;
    const stop = effect(() => { s.value; runs++; });
    stop();
    s.value = 1;
    assert.equal(runs, 1); // dispose 后不再运行
  });

  it('cleanup 在重新执行前调用', () => {
    const s = signal(0);
    const log = [];
    effect(() => {
      const v = s.value; // 快照当前值
      log.push(`run:${v}`);
      return () => log.push(`cleanup:${v}`);
    });
    s.value = 1;
    assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1']);
  });

  it('dispose 时调用 cleanup', () => {
    let cleaned = false;
    const stop = effect(() => () => { cleaned = true; });
    stop();
    assert.ok(cleaned);
  });

  it('动态依赖追踪', () => {
    const cond = signal(true);
    const a = signal('a');
    const b = signal('b');
    let runs = 0;
    effect(() => { runs++; cond.value ? a.value : b.value; });
    assert.equal(runs, 1);
    b.value = 'B'; // 当前没订阅 b
    assert.equal(runs, 1);
    a.value = 'A';
    assert.equal(runs, 2);
  });

  it('错误不中断其他 effect', () => {
    const s = signal(0);
    let otherRan = false;
    effect(() => { s.value; throw new Error('boom'); });
    effect(() => { s.value; otherRan = true; });
    // 不应抛出
    s.value = 1;
    assert.ok(otherRan);
  });
});

describe('batch', () => {
  it('合并多次写入为一次更新', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;
    effect(() => { a.value + b.value; runs++; });
    assert.equal(runs, 1);
    batch(() => { a.value = 1; b.value = 2; });
    assert.equal(runs, 2); // 只触发一次
  });
});

describe('watch', () => {
  it('首次不触发', () => {
    const s = signal(0);
    let triggered = false;
    watch(s, () => { triggered = true; });
    assert.ok(!triggered);
  });

  it('变化时触发，传入新旧值', () => {
    const s = signal(0);
    let args;
    watch(s, (n, o) => { args = [n, o]; });
    s.value = 5;
    assert.deepEqual(args, [5, 0]);
  });

  it('dispose 后停止', () => {
    const s = signal(0);
    let count = 0;
    const stop = watch(s, () => count++);
    stop();
    s.value = 1;
    assert.equal(count, 0);
  });
});

describe('onCleanup', () => {
  it('在 effect 内注册，重跑前调用', () => {
    const s = signal(0);
    const log = [];
    effect(() => {
      s.value;
      onCleanup(() => log.push('clean'));
    });
    s.value = 1;
    s.value = 2;
    assert.deepEqual(log, ['clean', 'clean']);
  });
});

describe('esc', () => {
  it('转义 HTML 特殊字符', () => {
    assert.equal(esc('<b>"test"&</b>'), '&lt;b&gt;&quot;test&quot;&amp;&lt;/b&gt;');
  });

  it('null/undefined 转为空字符串', () => {
    assert.equal(esc(null), '');
    assert.equal(esc(undefined), '');
  });
});

describe('html', () => {
  it('标记为可信 HTML', () => {
    const t = html('<b>ok</b>');
    assert.ok(t.__trusted);
    assert.equal(t.value, '<b>ok</b>');
  });
});
