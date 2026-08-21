// Real Chromium coverage for the public, built ESM bundle. Keep this separate
// from the fast happy-dom suite: it catches browser-only focus, input, layout
// and scrolling behaviour and is safe to run in CI after `playwright install`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

let server, baseUrl, browser;

const pageHtml = `<!doctype html>
<meta charset="utf-8"><title>mini-react browser regression</title>
<main id="app"></main><div id="feed"></div><output id="batched"></output>
<script type="module">
  import { signal, store, mount, h, For, bind, virtualList, setUpdateMode } from '/dist/mini-react.min.js';
  const tasks = store([
    { id: 'a', title: 'Write proposal', done: false }, { id: 'b', title: 'Review PR', done: false }, { id: 'c', title: 'Deploy release', done: true },
  ]);
  const query = signal(''), root = document.querySelector('#app');
  mount(root, () => {
    const q = query.value.toLowerCase(), visible = [...tasks].filter(task => task.title.toLowerCase().includes(q));
    return h\`<section><input id="search" value="\${query.value}"><ul>\${For(visible, task => task.id, task => h\`<li data-key="\${task.id}"><span class="title">\${task.title}</span><span class="state">\${task.done ? 'done' : 'todo'}</span></li>\`)}</ul></section>\`;
  });
  bind(root.querySelector('#search'), query);
  const rows = store(Array.from({ length: 40 }, (_, id) => ({ id, text: 'event-' + id })));
  const feed = virtualList(signal(rows), row => h\`<article data-key="\${row.id}">\${row.text}</article>\`, 20, 1);
  feed.el.id = 'virtual-feed'; feed.el.style.height = '40px'; document.querySelector('#feed').append(feed.el);
  const batched = signal(''); mount(document.querySelector('#batched'), () => h\`<span>\${batched.value}</span>\`);
  window.__miniReactTest = {
    updateTask: () => { tasks[0].title = 'Write final proposal'; tasks[1].done = true; }, reverse: () => tasks.reverse(),
    updateScrolledRow: () => { rows[10].text = 'event-10-updated'; },
    rapidWrites: async () => { setUpdateMode('microtask'); batched.value = 'r'; batched.value = 're'; batched.value = 'rea'; batched.value = 'real'; const immediate = document.querySelector('#batched').textContent; await Promise.resolve(); const final = document.querySelector('#batched').textContent; setUpdateMode('sync'); return { immediate, final }; },
    dispose: () => feed.dispose(),
  };
</script>`;

before(async () => {
  server = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(pageHtml); return; }
    const dist = req.url.match(/^\/dist\/(mini-react[\w.]*\.js)$/);
    if (dist) {
      try {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(await readFile(new URL(`../dist/${dist[1]}`, import.meta.url)));
        return;
      } catch {
        res.writeHead(404); res.end('not found'); return;
      }
    }
    res.writeHead(404); res.end('not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

test('built bundle preserves focus and patches keyed rows in Chromium', async () => {
  const page = await browser.newPage(), problems = [];
  page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); }); page.on('pageerror', error => problems.push(error.message));
  await page.goto(baseUrl); await page.locator('#search').fill('review');
  assert.equal(await page.locator('#search').evaluate(el => document.activeElement === el && el.value === 'review'), true);
  assert.deepEqual(await page.locator('li').evaluateAll(rows => rows.map(row => row.dataset.key)), ['b']);
  await page.locator('#search').fill('');
  await page.evaluate(() => { window.__rowA = document.querySelector('[data-key="a"]'); window.__miniReactTest.updateTask(); });
  assert.equal(await page.evaluate(() => document.querySelector('[data-key="a"]') === window.__rowA), true);
  assert.equal(await page.locator('[data-key="a"] .title').textContent(), 'Write final proposal');
  assert.equal(await page.locator('[data-key="b"] .state').textContent(), 'done');
  await page.evaluate(() => window.__miniReactTest.reverse());
  assert.deepEqual(await page.locator('li').evaluateAll(rows => rows.map(row => row.dataset.key)), ['c', 'b', 'a']);
  assert.deepEqual(problems, []); await page.close();
});

test('virtual scrolling and microtask batching work in Chromium', async () => {
  const page = await browser.newPage(), problems = [];
  page.on('console', msg => { if (msg.type() === 'error') problems.push(msg.text()); }); page.on('pageerror', error => problems.push(error.message));
  await page.goto(baseUrl);
  await page.locator('#virtual-feed').evaluate(el => { el.scrollTop = 200; el.dispatchEvent(new Event('scroll')); });
  await page.locator('#virtual-feed [data-key="10"]').waitFor();
  await page.evaluate(() => { window.__row10 = document.querySelector('#virtual-feed [data-key="10"]'); window.__miniReactTest.updateScrolledRow(); });
  assert.equal(await page.locator('#virtual-feed [data-key="10"]').textContent(), 'event-10-updated');
  assert.equal(await page.evaluate(() => document.querySelector('#virtual-feed [data-key="10"]') === window.__row10), true);
  assert.deepEqual(await page.evaluate(() => window.__miniReactTest.rapidWrites()), { immediate: '', final: 'real' });
  assert.deepEqual(problems, []); await page.close();
});
