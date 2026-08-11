# mini-react · 速查
轻量响应式框架，无构建，纯 ES Module。
```js
import { signal, effect, computed, batch, watch, asyncEffect,
         mount, show, bind, text, cls, attr, h, For, store, defineComponent,
         Card, Button, Input, Select, Textarea, Badge, Alert, Empty, Spinner, Table,
         ui, setUIDebug, onUIDebug,
         createQueryClient, createQuery,
         delegate, keyedList, virtualList, createRouter,
         setUpdateMode, getUpdateMode, flushSync,
         $, $$, on, once, nextTick, debounce, throttle, debouncedSignal,
         esc, html } from 'https://cdn.jsdelivr.net/gh/forechoandlook/mini-react@latest/dist/mini-react.min.js';
```
- `signal(v)` — 创建响应式值，`.value` 读写（追踪依赖），`.peek()` 读但不追踪
- `computed(() => expr)` — 派生值，自动追踪依赖，只读
- `effect(() => { ... return cleanup })` — 副作用，依赖变化自动重跑，返回 dispose 函数
- `batch(() => { a.value=1; b.value=2 })` — 合并多次写入，effect 只触发一次；`delegate.on` 的事件分发已经自动包了一层 `batch`，一个事件处理函数里改多个 signal 本来就只触发一次渲染
- `setUpdateMode('sync' | 'microtask')` — 全局更新模式，默认 `'sync'`（写 signal 立即同步生效，全库/全部测试都假设这个）；切到 `'microtask'` 后，同一个同步任务里对任意多个 signal 的写入会自动合并成一次 flush（在下一个 microtask），代价是写完不能立刻读到最新 DOM，需要 `await nextTick()`。这是一个全局开关，不支持同一个应用里混用两种模式。`getUpdateMode()` 读当前模式，`flushSync()` 在 `'microtask'` 模式下强制立即提交挂起的更新
- `watch(sig, (next, prev) => {})` — 值变化时回调，不立即执行，正确遵守 signal 的自定义 equals
- `asyncEffect(async (signal) => {})` — 异步副作用，重跑或 dispose 时自动 abort 上一次请求，async 错误不会被吞掉
- `esc(str)` — HTML 转义，防 XSS
- `html(str)` — 标记为受信任的 HTML，跳过转义
- `mount(el, () => htmlStr)` — 挂载组件，传函数保证在 effect 内执行，依赖变化自动更新；重渲染时若被聚焦的元素有 `id` 或 `name`，会自动在新 DOM 里找到同一个元素并恢复焦点 + 光标位置（`{ escape: false }` 下渲染 `<input>` 等表单元素时尤其重要，否则每次按键都会因为 innerHTML 被整体替换而失焦）
- `show(cond, yes, no?)` — 条件渲染；`cond` 可以是 signal 或普通值，`yes`/`no` 可以是字符串或函数
- `bind(inputEl, sig)` — 表单双向绑定，返回 dispose 函数
- `text(sig)` — 绑定描述符，更新 `el.textContent`，传给 `mount` 使用
- `cls(mapSig)` — 绑定描述符，`signal({ active: true, hidden: false })` 自动拼 className
- `attr(name, sig)` — 绑定描述符，响应式更新任意 attribute
- `delegate.on('click', '[data-action]', (e, target) => {})` — 事件委托，返回 unlisten 函数（handler 级别精确移除）
- `delegate.off('click', '[data-action]')` — 移除该 selector 下所有 handler
- `animate(el, keyframes, opts)` — Web Animations API 封装
- `transitions.fadeIn(el)` / `transitions.fadeOut(el)` / `transitions.slideDown(el)` — 预设动画
- `keyedList(itemsSig, item => htmlStr, item => item.id, { escape: false, tag: 'div' })` — 有 key 的列表，只更新变化项，自带动画；`tag` 可指定容器元素类型（如 `'li'` 用于 `<ul>`）；调用方式：`keyedList(...)(parentEl)`；`renderItem` 除了返回字符串，也可以返回 `h\`\`` 结果——这样单项内容更新走编译模板的细粒度 patch（只写变化的插值点），而不是整段重新解析 HTML；增删/淡入淡出动画行为不变
- `virtualList(itemsSig, item => htmlStr, itemHeight)` — 超长列表虚拟滚动，返回 `{ el, dispose }`；`renderItem` 同样可以返回 `h\`\`` 结果享受细粒度 patch；已可见的行在数据变化时也会被更新（不再是只在首次进入可视区时渲染一次就冻结）
- `createRouter(routes, { keepAlive? })` — hash 路由，支持 `:param` 参数路由；默认 `keepAlive: false`，每次访问都重新调用 route 工厂（组件本地状态不保留）；`keepAlive: true` 时按 `pattern + params` 缓存组件实例，离开再回来时复用同一实例、`signal()` 状态保留（但实例内部的 `ctx.effect`/`ctx.asyncEffect` 会在离开时停止，不会在返回时自动恢复——只有渲染用到的 signal 值会保留）；返回 `{ current, route, navigate(path), match(pattern), invalidate(pattern?) }`，`invalidate()` 清空全部缓存，`invalidate('/a')` 只清该路由
- `h\`<div>${component}</div>\`` — 编译一次结构、克隆+精确打补丁的模板字面量（不是每次重新解析 HTML 字符串），值为函数或组件对象时自动挂载到 slot，普通值自动转义。同一个 callsite 多次渲染只解析一次
- `For(items, keyFn, (item, i) => h\`...\`)` — `h\`\`` 模板里的键控列表插槽，例如 `h\`<tbody>${For(rows.value, r => r.id, r => h\`<tr data-key="${r.id}">...</tr>\`)}</tbody>\``。每行本身是嵌套的 `h\`\`` 模板：结构只解析一次，之后新增行只是原生 `cloneNode`，已有行只 patch 变化的插值点；增删/重排走 O(变化量) 的 keyed diff，不会重建未受影响的行；配合 `store()`（见下）单元格更新可以做到 O(1)，完全不经过外层的 key-diff
- `Card`、`Button`、`Input`、`Select`、`Textarea`、`Badge`、`Alert`、`Empty`、`Spinner`、`Table` — 默认 UI 原语；需引入可选 CSS。`Table({ rows, columns, key?, caption?, empty? })` 支持数组或 signal 行数据、键控更新、横向滚动及空状态；排序、分页、筛选仍由业务层控制。
- `ui(schema, { values?, actions?, debug? })` — JSON 驱动的组合入口。schema 只描述结构，`"$name"` 引用 `values.name`（可为 signal）；`action` 仅引用显式 `actions` 映射中的函数，避免把可执行代码写进 JSON。`setUIDebug(true)` 与 `onUIDebug(listener)` 提供默认关闭的渲染/事件调试入口，事件不会暴露输入值。
- `store(array)` — 按字段细粒度响应的数组：`store[i].field` 读取时才懒创建一个该字段的 `Signal`，写 `store[i].field = x` 只通知读过这个字段的 effect，不牵连其它行/字段。`push`/`splice`/`sort`/整行替换/`length =` 等结构性操作会让受影响的行失去身份缓存并触发一次整体重渲染；纯字段读取（`.length`、`for..of`）不会被字段写入误触发。搭配 `For` 使用时，单元格更新是 O(1) 且完全不经过 `For` 的外层扫描——注意每个被读过的字段都会分配一个独立的 `Signal` 对象，字段多、行数多时比同样数据的普通数组多占不少内存，不需要逐字段细粒度更新的场景优先用普通 `signal(array)` + `.map()`
- `defineComponent((props, ctx) => () => htmlStr)` — 有状态组件，见下方说明。同一个 `defineComponent()` 定义的组件，如果连续两次调用时 props 浅比较相等（同 key、每个值 `Object.is` 相等），会直接复用上一次的实例（不重跑 `setup`、不触发 `onUnmount`/`onMount`、DOM 不会被拆除重建）——这只对"同一个位置渲染一个组件"生效；同一个组件类型在循环里同时渲染多个实例时不会互相串状态，但也拿不到这个优化
- `$(id)` — `document.getElementById` 简写
- `$$(sel, root?)` — `querySelectorAll` 简写，返回数组
- `on(el, evt, fn)` — addEventListener，返回 unlisten 函数
- `once(el, evt, fn)` — 只触发一次的事件监听
- `nextTick(fn)` — 等当前同步任务完成后执行
- `debounce(fn, ms)` — 防抖，返回的函数有 `.cancel()` 和 `.flush()`
- `throttle(fn, ms)` — 节流，返回的函数有 `.cancel()`
- `debouncedSignal(sig, ms)` — 返回防抖后的新 signal，输入 signal 变化后延迟更新
- `createResource(sourceSig?, async (src, signal) => data)` — 数据请求，返回 `[{ data, loading, error }, { refetch, mutate }]`，source 变化自动重新请求并 abort 上一次
- `createFetch({ cache, ttl, retry, retryDelay, store, dedupe })` — 带缓存、请求合并和重试的 fetch 工厂，返回 `{ get(key, fetcher, opts?), invalidate(key?) }`；默认缓存 30 秒且相同 key 的并发请求只发一次。`get` 可用 `{ cache: false }`、`{ ttl: 0 }` 或 `{ dedupe: false }` 显式关闭对应默认行为。浏览器会自动协商 gzip/br；实际网络压缩需由 API/CDN 返回 `Content-Encoding`，前端不能也不应手动设置 `Accept-Encoding`。
- `createQueryClient(options?)` / `createQuery(options)` — 完整的数据同步层。`client.query({ queryKey, queryFn, staleTime?, gcTime?, tags?, refetchInterval? })` 返回 `[{ data, error, status, fetchStatus, updatedAt, isStale }, controls]`；这些字段都是 signal，可直接在 `mount`/`h\`\`` 中读取。默认不在窗口聚焦时自动刷新，避免后台频繁请求；可用 `refetchOnWindowFocus: true` 开启。
- Query controls：`refetch()`、`setData(updater)`、`invalidate()`、`cancel()`、`dispose()`；Client 还提供 `prefetchQuery`、`fetchQuery`、`setQueryData`、`invalidateQueries({ queryKey?, tags?, exact? })`、`cancelQueries`、`removeQueries`。缓存有 stale/GC 两个独立周期，查询无 observer 后按 `gcTime` 回收；JSON 返回值默认做结构共享，等价字段会复用旧引用（可设 `structuralSharing: false` 关闭）。
- `client.mutate({ mutationFn, variables, optimistic?, invalidate? })` — mutation 支持乐观更新与失败回滚；`optimistic` 可写 `{ queryKey, updater }`，`invalidate` 使用与 `invalidateQueries` 相同的过滤器。`client.infiniteQuery({ queryKey, queryFn, initialPageParam, getNextPageParam })` 提供 `fetchNextPage()`。
- `client.dehydrate()` / `client.hydrate(snapshot)` — SSR/预加载的安全 JSON 快照；`client.persist({ storage, key, version })` 支持版本化持久化；`client.sync(channelName?)` 使用 `BroadcastChannel` 跨标签广播失效（不广播数据）；`client.fetchJSON()` 会复用 ETag 并读取服务端 `Cache-Control: max-age`。`client.subscribe()` / `client.getDebugSnapshot()` 是无 UI 绑定的 Query 调试入口。

```js
const client = createQueryClient({ staleTime: 30_000, gcTime: 5 * 60_000 });
const [user, userQuery] = client.query({
  queryKey: ['user', userId],
  tags: ['user'],
  queryFn: ({ signal }) => fetch(`/api/users/${userId}`, { signal }).then(r => r.json()),
});

mount(root, () => h`<p>${user.fetchStatus.value === 'fetching' ? '刷新中' : user.data.value?.name ?? '加载中'}</p>`);
// 保存后：await client.invalidateQueries({ tags: ['user'] });
```
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
