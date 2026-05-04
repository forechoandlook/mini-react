# mini-react · 速查
轻量响应式框架，无构建，纯 ES Module。
```js
import { signal, effect, computed, batch, watch, asyncEffect,
         mount, show, bind, text, cls, attr, h, defineComponent,
         delegate, keyedList, virtualList, createRouter,
         $, $$, on, once, nextTick, debounce, throttle, debouncedSignal,
         esc, html } from 'https://cdn.jsdelivr.net/gh/forechoandlook/mini-react@latest/dist/mini-react.min.js';
```
- `signal(v)` — 创建响应式值，`.value` 读写（追踪依赖），`.peek()` 读但不追踪
- `computed(() => expr)` — 派生值，自动追踪依赖，只读
- `effect(() => { ... return cleanup })` — 副作用，依赖变化自动重跑，返回 dispose 函数
- `batch(() => { a.value=1; b.value=2 })` — 合并多次写入，effect 只触发一次
- `watch(sig, (next, prev) => {})` — 值变化时回调，不立即执行，正确遵守 signal 的自定义 equals
- `asyncEffect(async (signal) => {})` — 异步副作用，重跑或 dispose 时自动 abort 上一次请求，async 错误不会被吞掉
- `esc(str)` — HTML 转义，防 XSS
- `html(str)` — 标记为受信任的 HTML，跳过转义
- `mount(el, () => htmlStr)` — 挂载组件，传函数保证在 effect 内执行，依赖变化自动更新
- `show(cond, yes, no?)` — 条件渲染；`cond` 可以是 signal 或普通值，`yes`/`no` 可以是字符串或函数
- `bind(inputEl, sig)` — 表单双向绑定，返回 dispose 函数
- `text(sig)` — 绑定描述符，更新 `el.textContent`，传给 `mount` 使用
- `cls(mapSig)` — 绑定描述符，`signal({ active: true, hidden: false })` 自动拼 className
- `attr(name, sig)` — 绑定描述符，响应式更新任意 attribute
- `delegate.on('click', '[data-action]', (e, target) => {})` — 事件委托，返回 unlisten 函数（handler 级别精确移除）
- `delegate.off('click', '[data-action]')` — 移除该 selector 下所有 handler
- `animate(el, keyframes, opts)` — Web Animations API 封装
- `transitions.fadeIn(el)` / `transitions.fadeOut(el)` / `transitions.slideDown(el)` — 预设动画
- `keyedList(itemsSig, item => htmlStr, item => item.id, { escape: false, tag: 'div' })` — 有 key 的列表，只更新变化项，自带动画；`tag` 可指定容器元素类型（如 `'li'` 用于 `<ul>`）；调用方式：`keyedList(...)(parentEl)`
- `virtualList(itemsSig, item => htmlStr, itemHeight)` — 超长列表虚拟滚动，返回 `{ el, dispose }`
- `createRouter(routes)` — hash 路由，支持 `:param` 参数路由，无缓存（保证响应式组件不过期）；返回 `{ current, route, navigate(path), match(pattern) }`
- `h\`<div>${component}</div>\`` — 模板字面量，值为函数或组件对象时自动挂载到 slot，普通值自动转义
- `defineComponent((props, ctx) => () => htmlStr)` — 有状态组件，见下方说明
- `$(id)` — `document.getElementById` 简写
- `$$(sel, root?)` — `querySelectorAll` 简写，返回数组
- `on(el, evt, fn)` — addEventListener，返回 unlisten 函数
- `once(el, evt, fn)` — 只触发一次的事件监听
- `nextTick(fn)` — 等当前同步任务完成后执行
- `debounce(fn, ms)` — 防抖，返回的函数有 `.cancel()` 和 `.flush()`
- `throttle(fn, ms)` — 节流，返回的函数有 `.cancel()`
- `debouncedSignal(sig, ms)` — 返回防抖后的新 signal，输入 signal 变化后延迟更新
- `createResource(sourceSig?, async (src, signal) => data)` — 数据请求，返回 `[{ data, loading, error }, { refetch, mutate }]`，source 变化自动重新请求并 abort 上一次
- `createFetch({ cache, ttl, retry, retryDelay, store })` — 带缓存和重试的 fetch 工厂，返回 `{ get(key, fetcher, opts?), invalidate(key?) }`
- `createStore(init, { persist? })` — 响应式对象 store，字段读写自动追踪；`persist` 指定 localStorage key，写入经 microtask 防抖，多次写合并一次序列化
- `ls.get(key)` / `ls.set(key, val, { compress? })` / `ls.remove(key)` — localStorage 封装，支持 gzip 压缩；写满时打印警告，不自动驱逐其他 key
- `idb(dbName, storeName?)` — IndexedDB KV 封装，返回 `{ get, set(key, val, { ttl? }), delete, clear, keys }`；TTL 为懒删除（读时清理）

**函数组件**：纯函数，只接收普通值，无内部状态。调用方在 `() =>` 包裹内读 `.value` 再传入，这层函数是渲染上下文，effect 在此追踪依赖。
```js
const SessionItem = ({ s, active }) => `
  <div class="px-3 py-2 ${active ? 'bg-primary/5' : ''}"
       data-session-id="${esc(s.sessionId)}">
    ${esc(s.display)}
  </div>`;
// active 是 signal — 调用方解包，组件本身不感知
mount(el, () => SessionItem({ s: session.value, active: activeId.value === session.value.sessionId }));
```
**defineComponent**：有状态组件。`setup(props, ctx)` 执行一次，返回渲染函数（必须是函数，不能是字符串）。`ctx` 提供隔离的响应式作用域，所有资源随组件 dispose 自动清理。
```js
const SessionPanel = defineComponent(({ id }, { signal, computed, effect, asyncEffect, onMount, onUnmount }) => {
  const data    = signal(null);
  const loading = signal(true);
  const count   = computed(() => data.value?.items?.length ?? 0);
  onMount(async (el) => {
    // 首次渲染后，el 是挂载的 DOM 节点
  });
  onUnmount(() => {
    // 组件销毁时释放资源
  });
  // query 变化时自动重新请求，组件销毁时自动 abort
  asyncEffect(async (signal) => {
    const d = await fetch(`/api/session/${id}`, { signal }).then(r => r.json());
    if (!signal.aborted) { data.value = d; loading.value = false; }
  });

  return () => loading.value
    ? `<div>loading...</div>`
    : `<div>${esc(data.value.name)} (${count.value} items)</div>`;
});
mount(el, SessionPanel({ id: 'abc' }));
```
**keyedList 注意**：renderItem 返回 HTML 字符串时须加 `{ escape: false }`，否则整段 HTML 会被二次转义为文本。
**Router 参数路由**：
```js
const router = createRouter({
  '/':          () => HomeView(),
  '/users/:id': (id) => UserView({ id }),
  '*':          () => NotFound(),
});
mount(app, () => router.route.value);
router.navigate('/users/42');
```
注意 路由延迟到数据就绪后再应用.
IndexedDB 做本地缓存，降低服务器压力
使用纯html + js ES Modules + css实现，基于 tailwindcss daisyui 和 mini-react 实现, 后端可以使用express库做快速开发. 开发和部署不一样，部署使用build.mjs对js css做整体打包和压缩.demo页面代码为:
```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <script>document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'dark')</script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>title</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@5/daisyui.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@9/marked.min.js"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="h-dvh overflow-hidden flex flex-col bg-base-100 text-base-content">
  <div id="root" class="flex flex-col flex-1 overflow-hidden"></div>
  <script type="module" src="app.js"></script>
</body>
</html>
```