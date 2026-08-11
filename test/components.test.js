import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window = win;

const { signal, mount, h } = await import('../src/dom.js');
const { Button, Input, Select, Textarea, Table, ui, onUIDebug } = await import('../src/components.js');

describe('default components', () => {
  it('mounts form and button primitives without template errors', () => {
    const root = document.createElement('div');
    mount(root, () => h`<div>${Button({ label: '保存', disabled: true })}${Input({ name: 'name', value: 'Ada' })}${Select({ value: 'b', options: [{ value: 'a' }, { value: 'b' }] })}${Textarea({ value: '备注' })}</div>`);
    assert.equal(root.querySelector('button').disabled, true);
    assert.equal(root.querySelector('input').value, 'Ada');
    assert.equal(root.querySelector('select').value, 'b');
    assert.equal(root.querySelector('textarea').value, '备注');
  });

  it('Table renders semantic headers, keyed rows, custom cells, and an empty state', () => {
    const rows = signal([{ id: 1, name: 'Ada', score: 8 }]);
    const root = document.createElement('div');
    mount(root, () => Table({ rows, caption: '成绩', columns: [
      { key: 'name', label: '姓名' },
      { key: 'score', label: '积分', render: row => h`<strong>${row.score}</strong>` },
    ] }));
    assert.equal(root.querySelector('caption').textContent, '成绩');
    assert.deepEqual([...root.querySelectorAll('th')].map(el => el.textContent), ['姓名', '积分']);
    const row = root.querySelector('tr[data-key="1"]');
    rows.value = [{ id: 1, name: 'Grace', score: 9 }];
    assert.equal(root.querySelector('tr[data-key="1"]'), row);
    assert.deepEqual([...root.querySelectorAll('td')].map(el => el.textContent), ['Grace', '9']);

    mount(root, () => Table({ rows: [], columns: [{ key: 'name' }, { key: 'email' }], empty: '没有记录' }));
    assert.equal(root.querySelector('.mr-table-empty td').textContent, '没有记录');
    assert.equal(root.querySelector('.mr-table-empty td').getAttribute('colspan'), '2');
  });

  it('ui resolves JSON values, dispatches named actions, and emits redacted debug events', () => {
    const name = signal('Ada');
    const root = document.createElement('div');
    const events = [];
    const off = onUIDebug(event => events.push(event));
    let clicks = 0;
    const stop = mount(root, () => ui({ type: 'stack', children: [
      { type: 'text', as: 'h2', text: '$name' },
      { type: 'input', name: 'name', value: '$name', action: 'changeName' },
      { type: 'button', label: '保存', action: 'save' },
    ] }, { values: { name }, actions: { save: () => clicks++ }, debug: true }));
    assert.equal(root.querySelector('h2').textContent, 'Ada');
    name.value = 'Grace';
    assert.equal(root.querySelector('input').value, 'Grace');
    root.querySelector('button').click();
    assert.equal(clicks, 1);
    assert.ok(events.some(event => event.type === 'render'));
    assert.deepEqual(events.find(event => event.type === 'action'), { type: 'action', action: 'save', event: 'click', field: undefined });
    stop(); off();
  });
});
