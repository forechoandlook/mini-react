# mini-react
轻量响应式框架，无构建依赖，纯 ES Module。三个独立包，按需引入。
## CDN 引入
```js
// lib.js
export * from 'https://cdn.jsdelivr.net/gh/forechoandlook/mini-react/dist/mini-react.min.js';
```

| 包 | CDN | 含内容 | gz |
|---|---|---|---|
| core | `mini-react.core.min.js` | 响应式原语 | 0.8KB |
| dom | `mini-react.dom.min.js` | core + DOM + 工具 | 2.9KB |
| data | `mini-react.data.min.js` | core + 数据层 + 存储 | 2.1KB |
| all | `mini-react.min.js` | core + DOM + 工具 + 数据层 + 存储 | 4.2KB |

## mini-react.core
纯响应式，无 DOM 依赖。
### `signal(initialValue, { equals? })` → Signal
```js
const count = signal(0)
count.value // 读（订阅当前 effect）
count.peek() // 读（不订阅）
count.value = 1 // 写，触发更新
```
`equals` 自定义相等判断，返回 `true` 时跳过更新。默认 `===`：
```js
const pos = signal({ x: 0, y: 0 }, {
 equals: (a, b) => a.x === b.x && a.y === b.y
})
pos.value = { x: 0, y: 0 } // 不触发
```
### `computed(fn)` → Signal
自动追踪 `fn` 内读取的所有 signal，任意依赖变化时重新计算。
- **立即计算**：创建时同步执行一次
- **只读**：写入 `.value` 无效
- **错误处理**：`fn` 抛出异常时打印 `console.error`，保持上一个值
```js
const double = computed(() => count.value * 2)
double.value // 只读
```
### `effect(fn)` → dispose()
`fn` 运行时自动追踪依赖，依赖变化时重新执行。`fn` 可返回清理函数。
- **立即执行**：创建时同步执行一次
- **错误处理**：`fn` 抛出异常时打印 `console.error` 并恢复之前的依赖，不影响其他 effect
```js
const stop = effect(() => {
 document.title = `${count.value} items`
 return () => console.log('cleanup')
})
stop() // 取消订阅，触发最后一次 cleanup
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

## mini-react.dom
包含 core 全部导出，另加：
### `mount(el, fn, { escape? })` → dispose()
将 `fn()` 渲染到 `el.innerHTML`，fn 内 signal 变化时自动更新。`escape` 默认 `true`。
- **`{ html, setup, children }`**：`html` 设置结构（支持响应式函数），`setup(el)` 只执行一次并返回 cleanup，`children` 自动挂载子组件
- **错误处理**：渲染出错时显示红色错误块，不崩溃整个页面
- **dispose**：停止响应式追踪并调用 setup cleanup
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
### `h\`...\`` → string | `{ html, children }`
组件模板 tagged template。插值是组件（函数/对象）时生成 `<span data-slot>` 占位并收集 `children`，非组件插值自动转义后内联。无子组件时直接返回字符串。详见 [嵌套组件](#嵌套组件)。
```js
const App = defineComponent(() => h`
  <div>${Counter({ label: '+' })} <span>${userName}</span></div>
`)
```

### `createRouter(routes)` → `{ current, route, navigate, match }`
Hash 模式路由。
- **路由结果缓存**：每个 path 首次匹配后缓存组件实例，hash 切回时复用
```js
const router = createRouter({
 '/': () => Home(),
 '/about': () => About(),
 '*': () => NotFound(),
})
router.navigate('/about')
router.current.value // 当前路径 signal
router.route // 当前组件 computed
router.match('/users/:id') // → ['42'] 或 null
```
### `animate(el, keyframes, opts)` → Animation
Web Animations API 简单封装。
### `transitions.fadeIn(el)` / `fadeOut(el)` / `slideDown(el)`
内置过渡，keyedList 增删时自动调用。
### `$(id)` / `$$(sel, root?)`
```js
$('app') // document.getElementById
$$('.item') // [...querySelectorAll]
$$('li', $('list')) // 限定根节点
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
console.log($('counter').textContent) // 已更新
```
### `debounce(fn, ms)` → fn
```js
const onSearch = debounce(q => fetch(`/search?q=${q}`), 300)
// .cancel() 取消 .flush() 立即执行
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
const input = signal('')
const search = debouncedSignal(input, 300)
bind($('input'), input)
const [res] = createResource(search, q =>
 fetch(`/api/search?q=${q}`).then(r => r.json())
)
```
### `defineComponent(fn, { name? })` → `(props?) => result`
定义函数组件，标记 `displayName` 便于调试。支持两种写法：

**字符串组件** — 适合纯展示，可直接插值嵌套：
```js
const Badge = defineComponent(({ text, color = 'blue' }) =>
  `<span class="badge badge-${esc(color)}">${esc(text)}</span>`
)

const Card = defineComponent(({ title, count }) =>
  `<div class="card">
    <h3>${esc(title)}</h3>
    ${Badge({ text: count })}
  </div>`
)

mount($('app'), () => Card({ title: 'Tasks', count: todos.value.length }))
```

**对象组件** `{ html, setup(el) }` — 适合有交互/副作用的组件：
- `html` 定义结构，可以是字符串或返回字符串的函数（响应式）
- `setup(el)` 只执行一次，返回 cleanup 函数

```js
const Counter = defineComponent(({ label = '+', step = 1 } = {}) => {
  const n = signal(0)
  return {
    html: `<div class="counter">
      <span data-r="val"></span>
      <button data-r="btn">${esc(label)}</button>
    </div>`,
    setup: el => {
      const s1 = mount(el.querySelector('[data-r="val"]'), () => String(n.value))
      const s2 = on(el.querySelector('[data-r="btn"]'), 'click', () => { n.value += step })
      return () => { s1(); s2() }
    }
  }
})
```

**嵌套组件** — 用 `h` tagged template，直接把子组件插值进去：
```js
const App = defineComponent(() => h`
  <div class="app">
    <h1>My App</h1>
    ${Counter({ label: 'A +1' })}
    ${Counter({ label: 'B +5', step: 5 })}
  </div>
`)

mount($('app'), App())
```

非组件插值自动 HTML 转义后内联：
```js
const name = 'Alice'
const Card = defineComponent(({ title }) => h`
  <div>
    <h2>${title}</h2>
    <p>hello ${name}</p>
  </div>
`)
```

> **重要：组件结构应保持静态，响应式下推到 signal。**
>
> mini-react 没有虚拟 DOM，无法像 React 那样 diff 组件树复用实例。  
> 若父组件模板读取了 signal，effect 重跑时子组件会被销毁重建。
>
> ```js
> // ❌ 错误：count.value 变化会导致 Counter 重建
> const App = () => h`<div>${String(count.value)} ${Counter()}</div>`
>
> // ✅ 正确：响应式绑定到具体节点，组件结构不变
> const App = defineComponent(() => h`
>   <div>
>     ${Numeric({ sig: count })}
>     ${Counter()}
>   </div>
> `)
> ```
>
> 经验法则：`h` 模板里**不要直接读 `.value`**，把响应式封装进子组件或用 `children` + `mount` 单独挂载。

`children` 和 `setup` 仍可单独使用，适合需要精细控制的场景：
```js
defineComponent(() => ({
  html: `<div><div data-r="c"></div><button id="x">X</button></div>`,
  children: { c: Counter() },
  setup: el => on(el.querySelector('#x'), 'click', reset),
}))
```

**children / slot** — 字符串组件直接传 HTML 字符串，对象组件在 `setup` 里挂载：
```js
// 字符串 slot
const Panel = defineComponent(({ title, children = '' }) =>
  `<div class="panel"><h2>${esc(title)}</h2><div class="body">${children}</div></div>`
)
mount($('app'), () => Panel({ title: 'Hello', children: Badge({ text: 'new' }) }))
```

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
api.invalidate('user-1') // 失效单条
api.invalidate() // 清空全部
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
prefs.theme = 'light' // 自动写入 localStorage，刷新后恢复
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
await ls.get('key') // { data: 123 }
await ls.set('big', hugeObj, { compress: true }) // gzip 压缩
await ls.get('big', { compress: true })
ls.remove('key')
ls.clear()
```
compress 读写须对称。quota 超限时自动剔除最旧一条后重试。
### `idb(dbName, storeName?)` → store
Promise 化的 IndexedDB，支持 TTL 过期。
```js
const db = idb('my-app') // storeName 默认 'kv'
const cache = idb('my-app', 'cache')
await db.set('user', { name: 'Alice' })
await db.get('user') // { name: 'Alice' }
await db.set('token', val, { ttl: 3_600_000 }) // 1 小时过期
await db.delete('user')
await db.keys() // 所有 key
await db.clear()
```

## 局限
| 项 | 说明 |
|---|---|
| `createStore` 深层响应 | 只追踪顶层 key |
| `createStore persist` | localStorage 明文，不存敏感数据 |
| `virtualList` | 固定行高，不支持动态高度 |
| 路由 | 仅 Hash 模式，无嵌套路由 |
| `keyedList` diff | innerHTML 字符串比较，可用 morphdom 替换 |
| `idb` 跨 store 事务 | 不支持 |
| SSR / hydration, TypeScript 类型 | 主动放弃 |
| CompressionStream | Chrome 80+ / Firefox 113+ / Safari 16.4+ |