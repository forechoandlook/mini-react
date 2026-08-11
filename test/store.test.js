import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, effect, mount, h, For, store, virtualList } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('store — per-field reactive array', () => {
  it('读取字段值与底层数组一致', () => {
    const s = store([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    assert.equal(s[0].name, 'a');
    assert.equal(s[1].id, 2);
    assert.equal(s.length, 2);
  });

  it('写字段只通知读取了该字段的 effect，不通知其它 effect', () => {
    const s = store([{ id: 1, score: 10 }, { id: 2, score: 20 }]);
    let runsA = 0, runsB = 0;
    effect(() => { s[0].score; runsA++; });
    effect(() => { s[1].score; runsB++; });
    assert.equal(runsA, 1);
    assert.equal(runsB, 1);

    s[0].score = 99;
    assert.equal(runsA, 2, 'row0 的 effect 应该重跑');
    assert.equal(runsB, 1, 'row1 的 effect 不应该被牵连');
    assert.equal(s[0].score, 99);
  });

  it('只读 .length（不读字段）的 effect 不会因字段写入而重跑', () => {
    const s = store([{ id: 1, v: 1 }]);
    let runs = 0;
    effect(() => { s.length; runs++; });
    assert.equal(runs, 1);
    s[0].v = 2;
    assert.equal(runs, 1, '结构没变，只读 length 的 effect 不该重跑');
    s.push({ id: 2, v: 3 });
    assert.equal(runs, 2, 'push 改变了形状，应该重跑');
  });

  it('For + store：改一个单元格只重渲染那一行，其它行 DOM 引用不变', () => {
    const s = store(Array.from({ length: 50 }, (_, i) => ({ id: i, score: i })));
    const rowsSig = signal(s); // outer signal only needs to fire once for initial mount
    const d = div();
    mount(d, () => h`<table><tbody>${For(rowsSig.value, r => r.id, r => h`<tr data-key="${r.id}"><td class="score">${r.score}</td></tr>`)}</tbody></table>`);

    const before = [...d.querySelectorAll('tr')];
    const scoreCell = d.querySelector('[data-key="10"] .score');
    assert.equal(scoreCell.textContent, '10');

    s[10].score = 999; // direct field write — no outer array signal touched at all

    assert.equal(d.querySelector('[data-key="10"] .score').textContent, '999');
    const after = [...d.querySelectorAll('tr')];
    assert.deepEqual(after, before, '所有 <tr> 应该还是同一批 DOM 引用');
  });

  it('For + store：push 一行后新增对应 DOM，旧行不受影响（结构信号自动触发重渲染，无需手动通知）', () => {
    const s = store([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(s, r => r.id, r => h`<tr data-key="${r.id}"><td>${r.name}</td></tr>`)}</tbody></table>`);
    const tr1 = d.querySelector('[data-key="1"]');

    s.push({ id: 3, name: 'c' });

    assert.deepEqual([...d.querySelectorAll('tr')].map(tr => tr.dataset.key), ['1', '2', '3']);
    assert.equal(d.querySelector('[data-key="1"]'), tr1);
  });

  it('virtualList + store：可视行字段更新只刷新自己的行作用域', () => {
    const rows = store([{ id: 1, score: 10 }, { id: 2, score: 20 }]);
    const list = virtualList(signal(rows), row => h`<span data-key="${row.id}">${row.score}</span>`, 20, 2);
    assert.equal(list.el.querySelector('[data-key="2"]').textContent, '20');
    rows[1].score = 99;
    assert.equal(list.el.querySelector('[data-key="2"]').textContent, '99');
    list.dispose();
  });
});
