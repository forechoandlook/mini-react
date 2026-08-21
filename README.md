# mini-react

一个无需构建步骤、原生 ES Module 的轻量响应式 UI 运行时。它以 signal/effect
为响应式核心，提供原生 DOM 挂载、编译模板、键控列表、细粒度数组 store、路由和
浏览器端数据工具。

```js
import { signal, mount, h, For } from
  'https://cdn.jsdelivr.net/gh/forechoandlook/mini-react@main/dist/mini-react.dom.min.js';

const count = signal(0);
mount(document.querySelector('#app'), () => h`
  <p>${count.value}</p>
`);
count.value += 1; // DOM is updated synchronously
```

## Included

- `signal`, `computed`, `effect`, `watch`, `batch`, `asyncEffect`
- synchronous updates by default, plus optional microtask batching via
  `setUpdateMode('microtask')`
- deduplicated derived updates: a signal dependency diamond settles all
  `computed` values before dependent effects run
- a computed value now notifies consumers only when its derived output changes
- lazy `computed` values can be released with `.dispose()`; scheduler
  diagnostics are available through `getSchedulerStats()`
- `mount`, `h```, `For`, `show`, keyed lists, virtual lists and DOM morphing
- `store(array)` for per-field list reactivity
- stateful `defineComponent`, hash routing and event delegation
- `createResource`, `createFetch`, `createStore`, localStorage and IndexedDB

## Packages

| File | Purpose |
| --- | --- |
| `dist/mini-react.min.js` | Thin re-export of the packages below (loads them as separate modules) |
| `dist/mini-react.core.min.js` | Signals and reactive primitives |
| `dist/mini-react.dom.min.js` | DOM rendering (`mount`, `h`, `For`, …) plus core re-exports |
| `dist/mini-react.query.min.js` | Query client |
| `dist/mini-react.data.min.js` | `createResource` / storage (imports core + query) |
| `dist/mini-react.components.min.js` | Optional UI primitives (imports core + dom) |
| `dist/mini-react.min.css` | Optional scoped UI primitives |

## Optional CSS

The CSS is opt-in and scoped under `.mr-root`, with no global reset. Its primary
API is composable utilities (`mr-flex`, `mr-gap-2`, `mr-p-4`, `mr-bg-soft`, ...),
plus optional ready-made card/button/form classes.

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/forechoandlook/mini-react@main/dist/mini-react.min.css">
<main class="mr-root mr-auto-dark mr-min-h-screen mr-bg-soft mr-p-4">
  <section class="mr-flex mr-flex-col mr-gap-3 mr-p-4 mr-bg-base mr-border mr-rounded-md mr-shadow">
    <label class="mr-flex mr-flex-col mr-gap-1 mr-font-semibold">Name <input class="mr-input"></label>
    <button class="mr-btn mr-w-full">Save</button>
  </section>
</main>
```

Run locally with `npm ci`, `npx playwright install chromium`, `npm test`, and
`npm run build`. The test suite includes real Chromium coverage of focus/input,
compiled-template patches, keyed reorders, virtual scrolling, and microtask
batching against the built browser bundle.

See [README.mini.md](README.mini.md) for the complete Chinese API reference and examples.
