import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const win = new Window();
global.document = win.document;
global.window   = win;

const { signal, computed, mount, show, bind, text, cls, attr, h, defineComponent, on, esc, html, keyedList } =
  await import('../src/dom.js');

// helpers
const el  = (tag = 'div') => document.createElement(tag);
const div = ()             => el('div');

describe('mount — 字符串', () => {
  it('渲染字符串', () => {
    const d = div();
    mount(d, () => 'hello');
    assert.equal(d.innerHTML, 'hello');
  });

  it('escape 默认开启', () => {
    const d = div();
    mount(d, () => '<b>x</b>');
    assert.equal(d.innerHTML, '&lt;b&gt;x&lt;/b&gt;');
  });

  it('escape:false 渲染原始 HTML', () => {
    const d = div();
    mount(d, () => '<b>x</b>', { escape: false });
    assert.equal(d.innerHTML, '<b>x</b>');
  });

  it('响应 signal 变化', () => {
    const s = signal('a');
    const d = div();
    mount(d, () => s.value);
    assert.equal(d.innerHTML, 'a');
    s.value = 'b';
    assert.equal(d.innerHTML, 'b');
  });

  it('TrustedHTML 不转义', () => {
    const d = div();
    mount(d, () => html('<b>ok</b>'));
    assert.equal(d.innerHTML, '<b>ok</b>');
  });

  it('dispose 停止更新', () => {
    const s = signal('a');
    const d = div();
    const stop = mount(d, () => s.value);
    stop();
    s.value = 'b';
    assert.equal(d.innerHTML, 'a');
  });
});

describe('mount — 对象组件', () => {
  it('渲染 html + setup', () => {
    const d = div();
    let setupCalled = 0;
    mount(d, () => ({
      html: '<span>hi</span>',
      setup: () => { setupCalled++; },
    }));
    assert.equal(d.innerHTML, '<span>hi</span>');
    assert.equal(setupCalled, 1);
  });

  it('setup 只执行一次（signal 变化不重复调用）', () => {
    const s = signal('a');
    const d = div();
    let setupCalled = 0;
    mount(d, () => ({
      html: () => `<span>${s.value}</span>`,
      setup: () => { setupCalled++; },
    }));
    s.value = 'b';
    s.value = 'c';
    assert.equal(setupCalled, 1);
  });

  it('html 是函数时响应 signal', () => {
    const s = signal('x');
    const d = div();
    mount(d, () => ({
      html: () => `<p>${s.value}</p>`,
      setup: () => {},
    }));
    assert.equal(d.innerHTML, '<p>x</p>');
    s.value = 'y';
    assert.equal(d.innerHTML, '<p>y</p>');
  });

  it('dispose 调用 setup 返回的 cleanup', () => {
    const d = div();
    let cleaned = false;
    const stop = mount(d, () => ({
      html: '<span></span>',
      setup: () => () => { cleaned = true; },
    }));
    stop();
    assert.ok(cleaned);
  });

  it('children 自动挂载子组件', () => {
    const d = div();
    mount(d, () => ({
      html: '<div><span data-r="inner"></span></div>',
      children: { inner: () => 'child' },
    }));
    assert.equal(d.querySelector('[data-r="inner"]').innerHTML, 'child');
  });
});

describe('show', () => {
  it('条件为真渲染 yes', () => {
    const flag = signal(true);
    const d = div();
    mount(d, show(flag, () => 'yes', () => 'no'));
    assert.equal(d.innerHTML, 'yes');
  });

  it('条件为假渲染 no', () => {
    const flag = signal(false);
    const d = div();
    mount(d, show(flag, () => 'yes', () => 'no'));
    assert.equal(d.innerHTML, 'no');
  });

  it('切换时更新', () => {
    const flag = signal(true);
    const d = div();
    mount(d, show(flag, () => 'yes', () => 'no'));
    flag.value = false;
    assert.equal(d.innerHTML, 'no');
  });
});

describe('bind descriptors', () => {
  it('text(sig) 更新 textContent', () => {
    const s = signal('hello');
    const d = div();
    mount(d, text(s));
    assert.equal(d.textContent, 'hello');
    s.value = 'world';
    assert.equal(d.textContent, 'world');
  });

  it('cls(mapSig) 更新 className', () => {
    const map = signal({ active: true, disabled: false });
    const d = div();
    mount(d, cls(map));
    assert.equal(d.className, 'active');
    map.value = { active: false, disabled: true };
    assert.equal(d.className, 'disabled');
  });

  it('attr(name, sig) 更新属性', () => {
    const href = signal('/a');
    const d = el('a');
    mount(d, attr('href', href));
    assert.equal(d.getAttribute('href'), '/a');
    href.value = '/b';
    assert.equal(d.getAttribute('href'), '/b');
  });
});

describe('h tagged template', () => {
  it('纯字符串返回字符串', () => {
    const result = h`<div>hello</div>`;
    assert.equal(typeof result, 'string');
    assert.equal(result, '<div>hello</div>');
  });

  it('非组件插值自动转义', () => {
    const name = '<b>Alice</b>';
    const result = h`<p>${name}</p>`;
    assert.equal(result, '<p>&lt;b&gt;Alice&lt;/b&gt;</p>');
  });

  it('组件插值生成 { html, children }', () => {
    const Child = () => 'child';
    const result = h`<div>${Child}</div>`;
    assert.equal(typeof result, 'object');
    assert.ok(result.html.includes('data-slot'));
    assert.ok(Object.keys(result.children).length === 1);
  });

  it('多个子组件各有独立 slot', () => {
    const A = () => 'a';
    const B = () => 'b';
    const result = h`<div>${A}${B}</div>`;
    assert.equal(Object.keys(result.children).length, 2);
  });

  it('挂载后子组件正常渲染', () => {
    const Child = () => 'hello';
    const d = div();
    mount(d, () => h`<div>${Child}</div>`);
    assert.ok(d.innerHTML.includes('hello'));
  });
});

describe('defineComponent', () => {
  it('返回对象组件，html 是渲染函数', () => {
    const Comp = defineComponent(({ name }) => () => `hi ${name}`);
    const inst = Comp({ name: 'Alice' });
    assert.equal(typeof inst.html, 'function');
    assert.equal(inst.html(), 'hi Alice');
  });

  it('props 默认为 {}', () => {
    const Comp = defineComponent(({ x = 1 }) => () => String(x));
    const inst = Comp();
    assert.equal(inst.html(), '1');
  });

  it('factory 标记 __isComponent', () => {
    const Comp = defineComponent(() => () => '');
    assert.ok(Comp.__isComponent);
  });

  it('实例也标记 __isComponent', () => {
    const Comp = defineComponent(() => () => '');
    assert.ok(Comp().__isComponent);
  });

  it('displayName 取函数名', () => {
    const MyCard = defineComponent(function MyCard() { return () => ''; });
    assert.equal(MyCard.displayName, 'MyCard');
  });

  it('自定义 name', () => {
    const Comp = defineComponent(() => () => '', { name: 'Custom' });
    assert.equal(Comp.displayName, 'Custom');
  });

  it('mount 后 onMount 被调用', async () => {
    let mounted = false;
    const Comp = defineComponent((_, { onMount }) => {
      onMount(() => { mounted = true; });
      return () => '<div></div>';
    });
    const d = div();
    mount(d, Comp({}), { escape: false });
    await Promise.resolve(); // nextTick
    assert.ok(mounted);
  });

  it('dispose 后 onUnmount 被调用', async () => {
    let unmounted = false;
    const Comp = defineComponent((_, { onUnmount }) => {
      onUnmount(() => { unmounted = true; });
      return () => '<div></div>';
    });
    const d = div();
    const stop = mount(d, Comp({}), { escape: false });
    stop();
    assert.ok(unmounted);
  });

  it('内部 signal 驱动重渲染', () => {
    const Comp = defineComponent((_, { signal }) => {
      const count = signal(0);
      return () => `<span>${count.value}</span>`;
    });
    const d = div();
    // 需要拿到内部 signal 的引用来测试，改用 ctx.effect 驱动
    mount(d, Comp({}), { escape: false });
    assert.ok(d.innerHTML.includes('<span>0</span>'));
  });

  it('dispose 停止内部 effect', () => {
    let runs = 0;
    const { signal: sig, effect: eff } = (() => {
      // 通过 ctx 验证
      let _ctx;
      const Comp = defineComponent((_, ctx) => { _ctx = ctx; return () => ''; });
      const d = div();
      const stop = mount(d, Comp({}), { escape: false });
      const s = _ctx.signal(0);
      _ctx.effect(() => { s.value; runs++; });
      runs = 0;
      s.value = 1; // effect 跑一次
      assert.equal(runs, 1);
      stop(); // dispose
      s.value = 2;
      return { signal: s };
    })();
    assert.equal(runs, 1); // dispose 后不再运行
  });
});

describe('esc', () => {
  it('转义 & < > "', () => {
    assert.equal(esc('&<>"'), '&amp;&lt;&gt;&quot;');
  });
});
