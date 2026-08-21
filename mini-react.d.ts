export const version: string;

export type EqualsFn<T> = (a: T, b: T) => boolean;

export interface Signal<T> {
  value: T;
  peek(): T;
}

export interface WritableStore<T extends Record<string, unknown>> extends Signal<T> {
  [key: string]: unknown;
}

export function signal<T>(value: T, opts?: { equals?: EqualsFn<T> }): Signal<T>;
export function computed<T>(fn: () => T): Signal<T>;
export function effect(fn: () => void | (() => void)): () => void;
export function batch<T>(fn: () => T): T;
export function watch<T>(sig: Signal<T>, cb: (value: T) => void): () => void;
export function onCleanup(fn: () => void): void;
export function asyncEffect(fn: (signal: AbortSignal) => unknown): () => void;
export function store<T extends Record<string, unknown>>(initial: T): WritableStore<T>;
export function esc(value: unknown): string;
export function html(value: unknown): { __trusted: true; value: string };
export function setUpdateMode(mode: 'sync' | 'microtask'): void;
export function getUpdateMode(): 'sync' | 'microtask';
export function flushSync(): void;
export function setSchedulerMaxRuns(n: number): void;
export function getSchedulerStats(): { flushes: number; runs: number; lastFlushRuns: number; maxRuns: number };

export interface TemplateResult {
  __isTemplateResult: true;
  strings: TemplateStringsArray;
  values: unknown[];
}

export interface ForResult<T> {
  __isFor: true;
  items: T[] | Signal<T[]>;
  keyFn: (item: T, index: number) => unknown;
  render: (item: T, index: number) => unknown;
}

export function h(strings: TemplateStringsArray, ...values: unknown[]): TemplateResult;
export function For<T>(
  items: T[] | Signal<T[]>,
  keyFn: (item: T, index: number) => unknown,
  render: (item: T, index: number) => unknown,
): ForResult<T>;

export function mount(
  el: Element,
  component: unknown,
  opts?: { escape?: boolean },
): () => void;

export function show(cond: unknown, yes: unknown, no?: unknown): () => unknown;
export function bind(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, sig: Signal<string>): () => void;
export function delegate(root: ParentNode, type: string, selector: string, handler: (event: Event, match: Element) => void): () => void;
export function text(sig: Signal<unknown>): { __bind: 'text'; sig: Signal<unknown>; render: (el: Element) => void };
export function cls(mapSig: Signal<Record<string, unknown>>): { __bind: 'class'; sig: Signal<Record<string, unknown>>; render: (el: Element) => void };
export function attr(name: string, sig: Signal<unknown>): { __bind: 'attr'; name: string; sig: Signal<unknown>; render: (el: Element) => void };

export function keyedList<T>(
  itemsSig: Signal<T[]>,
  renderItem: (item: T, index: number) => unknown,
  getKey?: (item: T, index: number) => unknown,
  opts?: { escape?: boolean; tag?: string },
): HTMLElement;
export function virtualList<T>(
  itemsSig: Signal<T[]>,
  renderItem: (item: T, index: number) => unknown,
  itemHeight?: number,
  overscan?: number,
  opts?: { escape?: boolean },
): HTMLElement;
export function createRouter(
  routes: Record<string, unknown>,
  opts?: { keepAlive?: boolean },
): { go: (path: string) => void; match: Signal<unknown> };

export function animate(el: Element, kf: Keyframe[] | PropertyIndexedKeyframes, opts?: KeyframeAnimationOptions): Animation;
export const transitions: Record<string, unknown>;

export function $(id: string): HTMLElement | null;
export function $$(sel: string, root?: ParentNode): Element[];
export function on(el: EventTarget, evt: string, fn: EventListenerOrEventListenerObject, opts?: AddEventListenerOptions | boolean): () => void;
export function once(el: EventTarget, evt: string, fn: EventListenerOrEventListenerObject): () => void;
export function nextTick(fn: () => void): Promise<void>;

export function defineComponent<P extends Record<string, unknown>>(
  setup: (props: P, ctx: ComponentContext) => unknown,
  opts?: { name?: string },
): (props?: P) => ComponentInstance;

export interface ComponentContext {
  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  asyncEffect: typeof asyncEffect;
  onMount: (fn: (el: Element) => void) => void;
  onUnmount: (fn: () => void) => void;
}

export interface ComponentInstance {
  __isComponent: true;
  html: (el?: Element) => unknown;
  setup: (el: Element) => () => void;
}

export function debounce<T extends (...args: never[]) => unknown>(fn: T, ms: number): T & { cancel(): void; flush(...args: Parameters<T>): ReturnType<T> };
export function throttle<T extends (...args: never[]) => unknown>(fn: T, ms: number): T & { cancel(): void };
export function debouncedSignal<T>(src: Signal<T>, ms: number): Signal<T>;

export function createQueryClient(options?: Record<string, unknown>): {
  query: (options: Record<string, unknown>) => unknown;
};
export const defaultQueryClient: ReturnType<typeof createQueryClient>;
export function createQuery(options: Record<string, unknown>): unknown;

export function createResource<T, S = unknown>(
  source: Signal<S> | ((src: S, signal: AbortSignal) => Promise<T> | T),
  fetcher?: (src: S, signal: AbortSignal) => Promise<T> | T,
): [
  { data: Signal<T | undefined>; loading: Signal<boolean>; error: Signal<unknown> },
  { refetch(): void; mutate(value: T): void },
];
export function createFetch(options?: Record<string, unknown>): {
  get: (key: string, fetcher: () => Promise<unknown>, opts?: Record<string, unknown>) => Promise<unknown>;
};
export function createStore<T>(init: T, opts?: { persist?: unknown }): Signal<T> & T;
export const ls: {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
};
export function idb(dbName: string, storeName?: string): {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};

export const Card: (props?: Record<string, unknown>) => TemplateResult;
export const Button: (props?: Record<string, unknown>) => unknown;
export const Badge: (props?: Record<string, unknown>) => TemplateResult;
export const Alert: (props?: Record<string, unknown>) => TemplateResult;
export const Empty: (props?: Record<string, unknown>) => TemplateResult;
export const Spinner: (props?: Record<string, unknown>) => TemplateResult;
export const Input: (props?: Record<string, unknown>) => unknown;
export const Select: (props?: Record<string, unknown>) => unknown;
export const Textarea: (props?: Record<string, unknown>) => unknown;
export const Table: (props?: Record<string, unknown>) => TemplateResult;
export function ui(schema: unknown, opts?: Record<string, unknown>): unknown;
export function setUIDebug(enabled: boolean): void;
export function getUIDebugState(): { enabled: boolean; listeners: number };
export function onUIDebug(listener: (...args: unknown[]) => void): () => void;
