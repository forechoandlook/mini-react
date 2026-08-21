import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, mount, h, defineComponent } = await import('../src/dom.js');

const div = () => document.createElement('div');

describe('h`` compiled templates — instantiate once, patch in place', () => {
  it('模板只解析一次：同一 callsite 渲染多次不会重复创建 <template>', () => {
    let templateCreations = 0;
    const origCreateElement = document.createElement.bind(document);
    document.createElement = (tag, ...rest) => {
      if (tag === 'template') templateCreations++;
      return origCreateElement(tag, ...rest);
    };
    try {
      const n = signal(0);
      const d = div();
      // Render function called fresh every time, but it's the SAME tagged
      // template literal callsite each time — `strings` identity is stable.
      mount(d, () => h`<div>count: ${n.value}</div>`);
      for (let i = 1; i <= 5; i++) n.value = i;
      assert.equal(templateCreations, 1, 'template 应该只被解析一次，之后全部走 cloneNode + 定点 patch');
    } finally {
      document.createElement = origCreateElement;
    }
  });

  it('只有真正变化的插值点被写入，其余节点原样保留', () => {
    const n = signal(1);
    const d = div();
    mount(d, () => h`<div><span id="fixed">static</span> count: ${n.value}</div>`);
    const fixed = d.querySelector('#fixed');
    n.value = 2;
    assert.equal(d.querySelector('#fixed'), fixed);
    assert.ok(d.textContent.includes('count: 2'));
  });

  it('相同值不会触发任何 DOM 写入（Object.is 快速跳过）', () => {
    const n = signal(5);
    const d = div();
    mount(d, () => h`<p>${n.value}</p>`);
    const textNode = [...d.querySelector('p').childNodes].find(x => x.nodeType === 3);
    const before = textNode.data;
    n.value = 5; // same value — signal's default eq already blocks this, but
                 // exercise the binding-level Object.is guard too via a
                 // computed-free direct read that could otherwise re-fire.
    assert.equal(textNode.data, before);
  });

  it('布尔属性插值：${cond ? "disabled" : ""} 作为完整属性名写入/移除', () => {
    const busy = signal(false);
    const d = div();
    mount(d, () => h`<button type="submit" ${busy.value ? 'disabled' : ''}>登录</button>`);
    const btn = d.querySelector('button');
    assert.equal(btn.disabled, false);
    assert.equal(btn.hasAttribute('disabled'), false);

    busy.value = true;
    assert.equal(btn.disabled, true);
    assert.equal(btn.hasAttribute('disabled'), true);

    busy.value = false;
    assert.equal(btn.disabled, false);
    assert.equal(btn.hasAttribute('disabled'), false);
  });

  it('属性插值：只更新变化的属性，混合静态+动态的属性值也正确拼接', () => {
    const cls = signal('a');
    const d = div();
    mount(d, () => h`<div id="x" class="prefix-${cls.value}-suffix" data-static="keep"></div>`);
    const x = d.querySelector('#x');
    assert.equal(x.className, 'prefix-a-suffix');
    x.setAttribute('data-runtime', 'user-set');

    cls.value = 'b';
    const x2 = d.querySelector('#x');
    assert.equal(x2, x, '属性变化不应该换节点');
    assert.equal(x2.className, 'prefix-b-suffix');
    assert.equal(x2.getAttribute('data-static'), 'keep');
    assert.equal(x2.getAttribute('data-runtime'), 'user-set');
  });

  it('危险 URL 属性会被移除，动态事件属性会被拒绝', () => {
    const url = signal('javascript:alert(1)');
    const d = div();
    mount(d, () => h`<a id="link" href="${url.value}">safe label</a>`);
    assert.equal(d.querySelector('#link').getAttribute('href'), null);

    const originalError = console.error;
    console.error = () => {};
    try {
      const bad = div();
      mount(bad, () => h`<button onclick="${'alert(1)'}">bad</button>`);
      assert.ok(bad.textContent.includes('Render error'));
    } finally {
      console.error = originalError;
    }
  });

  it('value 属性走 DOM property，且聚焦时不会打断用户输入', () => {
    const val = signal('a');
    const d = div();
    document.body.appendChild(d); // .focus() only sets activeElement for attached nodes
    mount(d, () => h`<input id="q" value="${val.value}">`);
    const input = d.querySelector('#q');
    input.focus();
    input.value = 'user typed'; // simulate the user editing — not reflected back into val

    val.value = 'a'; // signal itself unchanged in this test, but drive an update path:
    val.value = 'b'; // upstream data changed while the field is focused
    assert.equal(input.value, 'user typed', '聚焦中的输入框不应被外部渲染覆盖');
  });

  it('嵌套组件插值：defineComponent 实例正常挂载、拥有自己的生命周期', async () => {
    const mounts = [];
    const Child = defineComponent((props, ctx) => {
      ctx.onMount(() => mounts.push(props.label));
      return () => `child:${props.label}`;
    });
    const d = div();
    mount(d, () => h`<div>${Child({ label: 'x' })}</div>`);
    await new Promise(r => setTimeout(r, 5));
    assert.ok(d.textContent.includes('child:x'));
    assert.deepEqual(mounts, ['x']);
  });

  it('同一挂载点切换到不同形状的模板（不同 callsite）会整体重建，不会用错绑定', () => {
    const branch = signal('a');
    const d = div();
    mount(d, () => (branch.value === 'a' ? h`<p id="pa">A ${1}</p>` : h`<span id="pb">B ${2}</span>`));
    assert.equal(d.querySelector('#pa').textContent, 'A 1');

    branch.value = 'b';
    assert.equal(d.querySelector('#pa'), null);
    assert.equal(d.querySelector('#pb').textContent, 'B 2');
  });

  it('html() 受信任内容作为插值：原样插入，不转义', () => {
    const html = (s) => ({ __trusted: true, value: String(s) });
    const raw = signal('<b>bold</b>');
    const d = div();
    mount(d, () => h`<div>${html(raw.value)}</div>`);
    assert.ok(d.querySelector('b') !== null);
    assert.equal(d.querySelector('b').textContent, 'bold');
  });
});
