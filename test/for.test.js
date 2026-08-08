import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, mount, h, For } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('For — keyed list inside h`` templates', () => {
  it('渲染出的行数与顺序符合数据', () => {
    const rows = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"><td>${r.name}</td></tr>`)}</tbody></table>`);
    assert.deepEqual([...d.querySelectorAll('tr')].map(tr => tr.dataset.key), ['1', '2', '3']);
    assert.deepEqual([...d.querySelectorAll('td')].map(td => td.textContent), ['a', 'b', 'c']);
  });

  it('更新单行的某个单元格：只有该 <td> 的文本被改写，其它行的 DOM 引用不变', () => {
    const rows = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"><td>${r.name}</td></tr>`)}</tbody></table>`);
    const trs = [...d.querySelectorAll('tr')];
    const tds = [...d.querySelectorAll('td')];

    rows.value = rows.value.map(r => r.id === 2 ? { ...r, name: 'B!' } : r);

    const trs2 = [...d.querySelectorAll('tr')];
    const tds2 = [...d.querySelectorAll('td')];
    assert.deepEqual(trs2, trs, '行元素应原地复用（同一批 DOM 引用）');
    assert.equal(tds2[1].textContent, 'B!');
    assert.equal(tds2[1], tds[1], '<td> 也应原地复用，只是文本被改写');
    assert.equal(tds2[0].textContent, 'a');
    assert.equal(tds2[2].textContent, 'c');
  });

  it('新增一行：只插入新节点，已存在的行不受影响', () => {
    const rows = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"><td>${r.name}</td></tr>`)}</tbody></table>`);
    const tr1 = d.querySelector('[data-key="1"]');

    rows.value = [...rows.value, { id: 3, name: 'c' }];

    assert.deepEqual([...d.querySelectorAll('tr')].map(tr => tr.dataset.key), ['1', '2', '3']);
    assert.equal(d.querySelector('[data-key="1"]'), tr1);
  });

  it('删除中间一行：只移除对应节点，其余行保留身份', () => {
    const rows = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"><td>${r.name}</td></tr>`)}</tbody></table>`);
    const tr1 = d.querySelector('[data-key="1"]');
    const tr3 = d.querySelector('[data-key="3"]');

    rows.value = rows.value.filter(r => r.id !== 2);

    assert.deepEqual([...d.querySelectorAll('tr')].map(tr => tr.dataset.key), ['1', '3']);
    assert.equal(d.querySelector('[data-key="1"]'), tr1);
    assert.equal(d.querySelector('[data-key="3"]'), tr3);
  });

  it('重排序（反转）：DOM 节点跟着 key 移动位置，节点身份不变', () => {
    const rows = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"></tr>`)}</tbody></table>`);
    const before = new Map([...d.querySelectorAll('tr')].map(tr => [tr.dataset.key, tr]));

    rows.value = [...rows.value].reverse();

    const after = [...d.querySelectorAll('tr')];
    assert.deepEqual(after.map(tr => tr.dataset.key), ['3', '2', '1']);
    for (const tr of after) assert.equal(before.get(tr.dataset.key), tr, `key=${tr.dataset.key} 应复用同一节点`);
  });

  it('清空列表：所有行被移除', () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    const d = div();
    mount(d, () => h`<table><tbody>${For(rows.value, r => r.id, r => h`<tr data-key="${r.id}"></tr>`)}</tbody></table>`);
    rows.value = [];
    assert.equal(d.querySelectorAll('tr').length, 0);
  });

  it('For 与普通兄弟插值共存（列表前后还有别的内容）', () => {
    const rows = signal([{ id: 1 }, { id: 2 }]);
    const title = signal('t1');
    const d = div();
    mount(d, () => h`<div><h1>${title.value}</h1><ul>${For(rows.value, r => r.id, r => h`<li data-key="${r.id}"></li>`)}</ul><p>footer</p></div>`);
    assert.equal(d.querySelector('h1').textContent, 't1');
    assert.equal(d.querySelectorAll('li').length, 2);
    assert.equal(d.querySelector('p').textContent, 'footer');

    title.value = 't2';
    rows.value = [...rows.value, { id: 3 }];
    assert.equal(d.querySelector('h1').textContent, 't2');
    assert.equal(d.querySelectorAll('li').length, 3);
    assert.equal(d.querySelector('p').textContent, 'footer');
  });
});
