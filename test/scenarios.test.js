import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window = win;
global.location = win.location;
win.HTMLElement.prototype.animate = () => ({ finished: Promise.resolve() });

const {
  signal, computed, batch, effect, mount, h, For, store, bind,
  virtualList, createRouter, defineComponent, setUpdateMode,
} = await import('../src/dom.js');
const { createResource } = await import('../src/data.js');

afterEach(() => setUpdateMode('sync'));
const div = () => document.createElement('div');

describe('real-world scenario — task dashboard', () => {
  it('filtering, focus, inline field edits, batches and keyed reorders preserve the right DOM', () => {
    const tasks = store([
      { id: 'a', title: 'Write proposal', done: false },
      { id: 'b', title: 'Review PR', done: false },
      { id: 'c', title: 'Deploy release', done: true },
    ]);
    const query = signal('');
    const visible = computed(() => {
      const q = query.value.toLowerCase();
      return [...tasks].filter(task => task.title.toLowerCase().includes(q));
    });
    const root = div();
    document.body.appendChild(root);
    mount(root, () => h`
      <section>
        <input id="search" value="${query.value}">
        <strong id="count">${visible.value.length}</strong>
        <ul>${For(visible.value, task => task.id, task => h`
          <li data-key="${task.id}"><span class="title">${task.title}</span><span class="state">${task.done ? 'done' : 'todo'}</span></li>
        `)}</ul>
      </section>
    `);
    const input = root.querySelector('#search');
    bind(input, query);
    input.focus();
    input.value = 'review';
    input.dispatchEvent(new win.Event('input'));
    assert.equal(document.activeElement, input, 'filtering while typing preserves focus');
    assert.deepEqual([...root.querySelectorAll('li')].map(el => el.dataset.key), ['b']);

    input.value = '';
    input.dispatchEvent(new win.Event('input'));
    const a = root.querySelector('[data-key="a"]');
    const c = root.querySelector('[data-key="c"]');
    batch(() => { tasks[0].title = 'Write final proposal'; tasks[1].done = true; });
    assert.equal(root.querySelector('[data-key="a"]'), a);
    assert.equal(root.querySelector('[data-key="b"] .state').textContent, 'done');
    assert.equal(root.querySelector('[data-key="a"] .title').textContent, 'Write final proposal');

    tasks.reverse();
    assert.deepEqual([...root.querySelectorAll('li')].map(el => el.dataset.key), ['c', 'b', 'a']);
    assert.equal(root.querySelector('[data-key="c"]'), c, 'reorder moves existing nodes rather than recreating them');
  });
});

describe('real-world scenario — virtual activity feed', () => {
  it('keeps a scrolled-in row reactive without re-rendering the entire feed', () => {
    const rows = store(Array.from({ length: 40 }, (_, i) => ({ id: i, text: `event-${i}` })));
    const feed = virtualList(signal(rows), row => h`<article data-key="${row.id}">${row.text}</article>`, 20, 1);
    document.body.appendChild(feed.el);
    Object.defineProperty(feed.el, 'clientHeight', { value: 40, configurable: true });
    feed.el.scrollTop = 200;
    feed.el.dispatchEvent(new win.Event('scroll'));
    const row10 = feed.el.querySelector('[data-key="10"]');
    assert.ok(row10);
    rows[10].text = 'event-10-updated';
    assert.equal(feed.el.querySelector('[data-key="10"]'), row10);
    assert.equal(row10.textContent, 'event-10-updated');
    feed.dispose();
  });
});

describe('real-world scenario — async detail panel', () => {
  it('ignores a stale response after the user changes selection', async () => {
    const selected = signal('a');
    const pending = new Map();
    const [{ data, loading }] = createResource(selected, (id, abort) => new Promise(resolve => {
      pending.set(id, value => { if (!abort.aborted) resolve(value); });
    }));
    const root = div();
    mount(root, () => h`<aside>${loading.value ? 'loading' : data.value?.name ?? 'empty'}</aside>`);
    selected.value = 'b';
    pending.get('a')({ name: 'old A' });
    await Promise.resolve();
    assert.equal(root.textContent, 'loading');
    pending.get('b')({ name: 'new B' });
    await Promise.resolve();
    assert.equal(root.textContent, 'new B');
  });
});

describe('real-world scenario — route cache and cleanup', () => {
  it('keeps cached route state but releases effects on unmount', () => {
    let created = 0, ticks = 0;
    const Home = defineComponent((_, ctx) => {
      created++;
      const clock = ctx.signal(0);
      ctx.effect(() => { clock.value; ticks++; });
      return () => h`<p>home ${clock.value}</p>`;
    });
    const router = createRouter({ '/': () => Home(), '/other': () => 'other' }, { keepAlive: true });
    const root = div();
    const stop = mount(root, () => router.route.value);
    router.current.value = '/other';
    router.current.value = '/';
    assert.equal(created, 1, 'returning to keepAlive route reuses its instance');
    stop();
    router.dispose();
    const before = ticks;
    // Updating unrelated global routing state cannot wake disposed route effects.
    router.current.value = '/other';
    assert.equal(ticks, before);
  });
});

describe('real-world scenario — derived metrics', () => {
  it('does not repaint a metric when source writes keep its derived value stable', () => {
    const requests = signal(1);
    const health = computed(() => requests.value % 2 ? 'odd' : 'even');
    const root = div();
    let renders = 0;
    mount(root, () => { renders++; return h`<output>${health.value}</output>`; });
    requests.value = 3;
    assert.equal(renders, 1, 'odd → odd should not rerender the metric');
    requests.value = 4;
    assert.equal(renders, 2);
  });
});

describe('real-world scenario — rapid typeahead updates', () => {
  it('coalesces many writes into one final DOM commit in microtask mode', async () => {
    setUpdateMode('microtask');
    const text = signal('');
    const root = div();
    let renders = 0;
    mount(root, () => { renders++; return h`<p>${text.value}</p>`; });
    text.value = 'r'; text.value = 're'; text.value = 'rea'; text.value = 'real';
    assert.equal(root.textContent, '');
    await Promise.resolve();
    assert.equal(root.textContent, 'real');
    assert.equal(renders, 2, 'initial render + one coalesced commit');
  });
});

describe('real-world scenario — bad backend list data', () => {
  it('surfaces duplicate server IDs through the render error boundary instead of corrupting rows', () => {
    const records = signal([{ id: 'same', name: 'first' }, { id: 'same', name: 'second' }]);
    const root = div();
    const originalError = console.error;
    console.error = () => {};
    try {
      mount(root, () => h`<ul>${For(records.value, row => row.id, row => h`<li>${row.name}</li>`)}</ul>`);
      assert.match(root.textContent, /Render error/);
    } finally {
      console.error = originalError;
    }
  });
});
