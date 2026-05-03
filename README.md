# mini-react

轻量响应式框架，无构建依赖，纯 ES Module。三个独立包，按需引入。

## CDN 引入

```html
<!-- 推荐：锁定版本 -->
<script type="module">
import { signal, effect, mount } from 'https://cdn.jsdelivr.net/gh/forechoandlook/webui@v0.1.0/mini-react/dist/mini-react.dom.min.js'
</script>

<!-- 开发调试：始终最新 -->
<script type="module">
import { signal, effect, mount } from 'https://cdn.jsdelivr.net/gh/forechoandlook/webui/mini-react/dist/mini-react.dom.js'
</script>
```

| 包 | CDN | 含内容 | minified |
|---|---|---|---|
| core | `.../mini-react.core.min.js` | 响应式原语 | 1.5 KB |
| dom  | `.../mini-react.dom.min.js`  | core + DOM + 工具 | 5.7 KB |
| data | `.../mini-react.data.min.js` | core + 数据层 + 存储 | 4.5 KB |

dom 和 data 各自独立，均已内联 core，可单独使用也可同时引入。

---

## mini-react.core

纯响应式，无 DOM 依赖。

### `signal(initialValue, { equals? })` → Signal

```js
const count = signal(0)
count.value       // 读（订阅当前 effect）
count.peek()      // 读（不订阅）
count.value = 1   // 写，触发更新
```

`equals` 自定义相等判断，返回 `true` 时跳过更新。默认 `===`：

```js
const pos = signal({ x: 0, y: 0 }, {
  equals: (a, b) => a.x === b.x && a.y === b.y
})
pos.value = { x: 0, y: 0 }  // 不触发
```

### `computed(fn)` → Signal

自动追踪 `fn` 内读取的所有 signal，任意依赖变化时重新计算。

```js
const double = computed(() => count.value * 2)
double.value  // 只读
```

### `effect(fn)` → dispose()

`fn` 运行时自动追踪依赖，依赖变化时重新执行。`fn` 可返回清理函数。

```js
const stop = effect(() => {
  document.title = `${count.value} items`
  return () => console.log('cleanup')
})
stop()  // 取消订阅
```

### `batch(fn)`

合并 `fn` 内所有 signal 写入为一次更新，性能优化的核心手段。

```js
batch(() => {
  a.value = 1
  b.value = 2
  // effect 只触发一次
})
```

### `watch(sig, cb(newVal, oldVal))` → dispose()

监听单个 signal 变化，**首次不触发**（区别于 effect）。

```js
watch(count, (next, prev) => console.log(prev, '→', next))
```

### `onCleanup(fn)`

在 effect 内注册清理函数，下次重新执行前调用。可在任意嵌套深度使用。

```js
effect(() => {
  const timer = setInterval(tick, 1000)
  onCleanup(() => clearInterval(timer))
})
```

### `esc(str)` → string

HTML 转义，防 XSS。`&`, `<`, `>`, `"` → HTML 实体。

### `html(str)` → TrustedHTML

标记字符串为可信 HTML，在 `mount` / `keyedList` 中绕过转义。

### `version`

当前版本字符串，如 `"0.1.0"`。

---

## mini-react.dom

包含 core 全部导出，另加：

### `mount(el, fn, { escape? })` → dispose()

将 `fn()` 渲染到 `el.innerHTML`，fn 内 signal 变化时自动更新。`escape` 默认 `true`。

```js
mount($('app'), () => `<p>${esc(count.value)}</p>`)

// 原始 HTML
mount($('app'), () => html(`<b>${trustedStr}</b>`))
```

### `show(condSig, yes, no?)` → fn

条件渲染，返回函数供 `mount` 使用。

```js
mount($('app'), show(isLoggedIn, () => Dashboard(), () => Login()))
```

### `bind(el, sig)` → dispose()

输入框双向绑定：`sig → el.value`，用户输入 → `sig.value`。

```js
const name = signal('')
bind($('input'), name)
```

### `text(sig)` / `cls(mapSig)` / `attr(name, sig)`

bind descriptor，精细控制单个 DOM 属性，避免整体 innerHTML 重渲：

```js
mount($('btn'), cls(computed(() => ({ active: tab.value === 'home' }))))
mount($('link'), attr('href', url))
mount($('label'), text(count))
```

### `keyedList(itemsSig, renderItem, getKey?, { escape? })` → `parentEl => dispose()`

按 key diff 渲染列表，增删带 slideDown/fadeOut 动画。

```js
keyedList(
  todos,
  item => `<div>${esc(item.text)}</div>`,
  item => item.id
)($('list'))
```

### `virtualList(itemsSig, renderItem, itemHeight?, overscan?, { escape? })` → `{ el, dispose }`

固定行高虚拟滚动，只渲染可视区域。

```js
const { el } = virtualList(bigList, item => `<div>${esc(item.name)}</div>`, 48)
$('wrap').appendChild(el)
```

### `delegate.on(event, selector, handler(e, el))` / `delegate.off(event, selector)`

事件委托，绑定在 document 上，适合动态 DOM。

```js
delegate.on('click', '[data-action="delete"]', (e, el) => remove(el.dataset.id))
delegate.off('click', '[data-action="delete"]')
```

### `createRouter(routes)` → `{ current, route, navigate, match }`

Hash 模式路由。

```js
const router = createRouter({
  '/':      () => Home(),
  '/about': () => About(),
  '*':      () => NotFound(),
})
router.navigate('/about')
router.current.value          // 当前路径 signal
router.route                  // 当前组件 computed
router.match('/users/:id')    // → ['42'] 或 null
```

### `animate(el, keyframes, opts)` → Animation

Web Animations API 简单封装。

### `transitions.fadeIn(el)` / `fadeOut(el)` / `slideDown(el)`

内置过渡，keyedList 增删时自动调用。

### `$(id)` / `$$(sel, root?)`

```js
$('app')              // document.getElementById
$$('.item')           // [...querySelectorAll]
$$('li', $('list'))   // 限定根节点
```

### `on(el, evt, fn, opts?)` → dispose()

```js
const off = on(document, 'keydown', e => { if (e.key === 'Escape') close() })
off()
```

### `once(el, evt, fn)`

只触发一次，自动移除。

### `nextTick(fn)` → Promise

延迟到微任务队列清空后，适合在 signal 更新后读取 DOM 状态。

```js
count.value++
await nextTick()
console.log($('counter').textContent)  // 已更新
```

### `debounce(fn, ms)` → fn

```js
const onSearch = debounce(q => fetch(`/search?q=${q}`), 300)
// .cancel() 取消  .flush() 立即执行
```

### `throttle(fn, ms)` → fn

```js
const onScroll = throttle(updateHeader, 100)
on(window, 'scroll', onScroll, { passive: true })
// .cancel() 取消尾调用
```

### `debouncedSignal(srcSig, ms)` → Signal

输入防抖的 signal 版本，常用于搜索框。

```js
const input  = signal('')
const search = debouncedSignal(input, 300)

bind($('input'), input)
const [res] = createResource(search, q =>
  fetch(`/api/search?q=${q}`).then(r => r.json())
)
```

### `defineComponent(fn)` → `(props?) => result`

语义包装，无额外行为。

---

## mini-react.data

包含 core 全部导出，另加：

### `createResource(source?, fetcher)` → `[state, actions]`

响应式异步数据，自带 loading / error / abort。

```js
// 一次性请求
const [res, { refetch }] = createResource((_, sig) =>
  fetch('/api/user', { signal: sig }).then(r => r.json())
)
effect(() => {
  if (res.loading.value) return
  console.log(res.data.value, res.error.value)
})

// source 变化自动重新请求
const userId = signal(1)
const [user] = createResource(userId, (id, sig) =>
  fetch(`/api/users/${id}`, { signal: sig }).then(r => r.json())
)
```

`actions.refetch()` 手动重新请求，`actions.mutate(v)` 乐观更新。

### `createFetch({ cache?, ttl?, retry?, retryDelay?, store? })` → `{ get, invalidate }`

请求缓存 + 自动重试管理器。

| 选项 | 默认 | 说明 |
|---|---|---|
| `cache` | `true` | 是否启用缓存 |
| `ttl` | `30000` | 缓存有效期 ms |
| `retry` | `2` | 失败重试次数（指数退避） |
| `retryDelay` | `1000` | 首次重试等待 ms |
| `store` | `null` | 外部缓存适配器（如 `idb()`） |

```js
const api = createFetch({ ttl: 60_000, retry: 3 })

const user = await api.get('user-1', () =>
  fetch('/api/users/1').then(r => r.json())
)

// 强制跳过缓存
await api.get('user-1', fetcher, { ttl: 0 })

api.invalidate('user-1')  // 失效单条
api.invalidate()           // 清空全部

// 配合 createResource
const [res] = createResource(userId, id =>
  api.get(`user-${id}`, () => fetch(`/api/users/${id}`).then(r => r.json()))
)

// 持久化缓存（接入 IndexedDB）
const api2 = createFetch({ ttl: 5 * 60_000, store: idb('api-cache') })
```

### `createStore(obj, { persist? })` → Proxy

响应式对象，读写属性自动订阅/触发更新。

```js
const form = createStore({ name: '', age: 0 })
effect(() => console.log(form.name))
form.name = 'Alice'

// 持久化到 localStorage
const prefs = createStore({ theme: 'dark' }, { persist: 'prefs' })
prefs.theme = 'light'  // 自动写入 localStorage，刷新后恢复
```

**跨组件共享**：模块顶层声明即是全局状态，ES Module 单例保证唯一实例。

```js
// store.js
export const user = createStore({ name: '', role: 'guest' })

// a.js — 写
import { user } from './store.js'
user.name = 'Alice'

// b.js — 读，自动响应
import { user } from './store.js'
mount($('name'), () => user.name)
```

> 局限：只追踪顶层 key，嵌套对象需整体替换：
> `form.addr = { ...form.addr, city: 'Beijing' }` ✅

### `ls` — localStorage 封装

```js
await ls.set('key', { data: 123 })
await ls.get('key')                           // { data: 123 }
await ls.set('big', hugeObj, { compress: true })  // gzip 压缩
await ls.get('big', { compress: true })
ls.remove('key')
ls.clear()
```

compress 读写须对称。quota 超限时自动剔除最旧一条后重试。

### `idb(dbName, storeName?)` → store

Promise 化的 IndexedDB，支持 TTL 过期。

```js
const db = idb('my-app')           // storeName 默认 'kv'
const cache = idb('my-app', 'cache')

await db.set('user', { name: 'Alice' })
await db.get('user')                          // { name: 'Alice' }
await db.set('token', val, { ttl: 3_600_000 }) // 1 小时过期
await db.delete('user')
await db.keys()                               // 所有 key
await db.clear()
```

---

## 局限

| 项 | 说明 |
|---|---|
| `createStore` 深层响应 | 只追踪顶层 key |
| `createStore persist` | localStorage 明文，不存敏感数据 |
| `virtualList` | 固定行高，不支持动态高度 |
| 路由 | 仅 Hash 模式，无嵌套路由 |
| `keyedList` diff | innerHTML 字符串比较，可用 morphdom 替换 |
| `idb` 跨 store 事务 | 不支持 |
| SSR / hydration | 主动放弃 |
| TypeScript 类型 | 主动放弃 |
| CompressionStream | Chrome 80+ / Firefox 113+ / Safari 16.4+ |
