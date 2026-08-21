import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window = win;

const { signal, computed, effect, mount, h } = await import('../src/dom.js');
const { createQueryClient } = await import('../src/query.js');

const div = () => document.createElement('div');

describe('review fixes', () => {
  it('does not treat { html: string } as raw markup inside h``', () => {
    const d = div();
    const orig = console.error;
    console.error = () => {};
    try {
      mount(d, () => h`<div id="host">${{ html: '<img id="xss" src="x" onerror="1">' }}</div>`);
    } finally {
      console.error = orig;
    }
    assert.equal(!!d.querySelector('#xss'), false);
  });

  it('does not mount a DOM node via .children duck typing', () => {
    const d = div();
    const span = document.createElement('span');
    span.id = 'kept';
    mount(d, () => h`<div>${span}</div>`);
    assert.equal(d.querySelector('#kept'), null);
    assert.equal(d.querySelector('span[style]') || d.querySelector('span'), null);
  });

  it('strips data:image/svg+xml and poster javascript URLs', () => {
    const d = div();
    mount(d, () => h`<a id="a" href="${'data:image/svg+xml,<svg onload=alert(1)>'}">x</a><video id="v" poster="${'javascript:alert(1)'}"></video>`);
    assert.equal(d.querySelector('#a').getAttribute('href'), null);
    assert.equal(d.querySelector('#v').getAttribute('poster'), null);
  });

  it('disabled=${false} and checked=${false} remove the boolean attribute', () => {
    const on = signal(true);
    const d = div();
    mount(d, () => h`<button id="b" disabled=${on.value}></button><input id="c" type="checkbox" checked=${on.value}>`);
    assert.equal(d.querySelector('#b').disabled, true);
    assert.equal(d.querySelector('#c').checked, true);
    on.value = false;
    assert.equal(d.querySelector('#b').disabled, false);
    assert.equal(d.querySelector('#b').hasAttribute('disabled'), false);
    assert.equal(d.querySelector('#c').checked, false);
    assert.equal(d.querySelector('#c').hasAttribute('checked'), false);
  });

  it('array children with data-key keep identity when prepended', () => {
    const rows = signal([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
    const d = div();
    document.body.appendChild(d);
    mount(d, () => h`<ul>${rows.value.map((r) => h`<li data-key="${r.id}"><input value="${r.name}"></li>`)}</ul>`);
    const inputA = d.querySelector('input');
    inputA.value = 'typed-in-A';
    rows.value = [{ id: 'z', name: 'Z' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const inputs = [...d.querySelectorAll('input')];
    assert.equal(inputs[1], inputA);
    assert.equal(inputs[1].value, 'typed-in-A');
    d.remove();
  });

  it('nested h`` inside svg keeps SVG namespace', () => {
    const d = div();
    mount(d, () => h`<svg>${h`<rect id="r" width="1" height="1" />`}</svg>`);
    const rect = d.querySelector('#r');
    assert.ok(rect);
    assert.equal(rect.namespaceURI, 'http://www.w3.org/2000/svg');
    assert.equal(rect.parentElement.tagName.toLowerCase(), 'svg');
  });

  it('literal < in text before an interpolation still compiles', () => {
    const d = div();
    mount(d, () => h`<p>a < b ${'c'}</p>`);
    assert.ok(!d.textContent.includes('Render error'));
    assert.ok(d.textContent.includes('a < b'));
    assert.ok(d.textContent.includes('c'));
  });

  it('computed recovers after a throwing run', () => {
    const src = signal(0);
    const orig = console.error;
    console.error = () => {};
    const c = computed(() => {
      if (src.value === 1) throw new Error('boom');
      return src.value * 10;
    });
    const seen = [];
    effect(() => { seen.push(c.value); });
    assert.deepEqual(seen, [0]);
    src.value = 1;
    src.value = 2;
    console.error = orig;
    assert.equal(c.value, 20);
    assert.ok(seen.includes(20));
  });

  it('invalidateQueries([1]) does not refetch [10]', async () => {
    const client = createQueryClient({ staleTime: 0 });
    let one = 0, ten = 0;
    const [, c1] = client.query({ queryKey: [1], enabled: false, queryFn: async () => ++one });
    const [, c10] = client.query({ queryKey: [10], enabled: false, queryFn: async () => ++ten });
    await c1.refetch();
    await c10.refetch();
    assert.equal(one, 1);
    assert.equal(ten, 1);
    await client.invalidateQueries({ queryKey: [1] });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(one, 2);
    assert.equal(ten, 1);
    c1.dispose();
    c10.dispose();
    client.destroy();
  });
});
