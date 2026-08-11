# mini-react

一个无需构建步骤、原生 ES Module 的轻量响应式 UI 运行时。它以 signal/effect
为响应式核心，提供原生 DOM 挂载、编译模板、键控列表、细粒度数组 store、路由和
浏览器端数据工具。

```js
import { signal, mount, h, For } from
  'https://cdn.jsdelivr.net/gh/forechoandlook/mini-react@latest/dist/mini-react.min.js';

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
- lazy `computed` values can be released with `.dispose()`; scheduler
  diagnostics are available through `getSchedulerStats()`
- `mount`, `h```, `For`, `show`, keyed lists, virtual lists and DOM morphing
- `store(array)` for per-field list reactivity
- stateful `defineComponent`, hash routing and event delegation
- `createResource`, `createFetch`, `createStore`, localStorage and IndexedDB

## Packages

| File | Purpose |
| --- | --- |
| `dist/mini-react.min.js` | Full browser ESM bundle |
| `dist/mini-react.core.min.js` | Signals and reactive primitives |
| `dist/mini-react.dom.min.js` | DOM rendering and UI helpers |
| `dist/mini-react.data.min.js` | Data fetching and browser storage |

Run locally with `npm ci`, `npm test`, and `npm run build`.

See [README.mini.md](README.mini.md) for the complete Chinese API reference and examples.
