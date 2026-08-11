import { esc, html } from './core.js';
import { h, For } from './dom.js';

const _class = (...names) => names.filter(Boolean).join(' ');
const _signalValue = value => value && typeof value === 'object' && 'value' in value ? value.value : value;

export const Card = ({ title, children = '', className = '' } = {}) => h`
  <section class="${_class('mr-card', className)}">${title == null ? '' : h`<h2 class="mr-card-title">${title}</h2>`}${children}</section>
`;
export const Button = ({ label = '', variant = 'primary', type = 'button', disabled = false, className = '', action } = {}) =>
  html(`<button type="${esc(type)}" class="${esc(_class('mr-btn', variant === 'primary' ? '' : `mr-btn-${variant}`, className))}"${disabled ? ' disabled' : ''} data-mr-action="${esc(action ?? '')}">${esc(_signalValue(label))}</button>`);
export const Badge = ({ label = '', className = '' } = {}) => h`<span class="${_class('mr-badge', className)}">${label}</span>`;
export const Alert = ({ message = '', variant = '', className = '' } = {}) => h`<div role="alert" class="${_class('mr-alert', variant && `mr-alert-${variant}`, className)}">${message}</div>`;
export const Empty = ({ message = '暂无数据', className = '' } = {}) => h`<div class="${_class('mr-empty', className)}">${message}</div>`;
export const Spinner = ({ label = '加载中', className = '' } = {}) => h`<span class="${_class('mr-spinner', className)}" role="status" aria-label="${label}"></span>`;
export const Input = ({ name, label, value = '', placeholder = '', type = 'text', disabled = false, className = '', action } = {}) =>
  html(`<label class="mr-field ${esc(className)}">${label == null ? '' : `<span class="mr-label">${esc(_signalValue(label))}</span>`}<input class="mr-input" name="${esc(name ?? '')}" type="${esc(type)}" value="${esc(_signalValue(value) ?? '')}" placeholder="${esc(_signalValue(placeholder))}"${disabled ? ' disabled' : ''} data-mr-action="${esc(action ?? '')}"></label>`);
export const Select = ({ name, label, value = '', options = [], disabled = false, className = '', action } = {}) => {
  const selected = String(_signalValue(value));
  const optionHtml = options.map(option => `<option value="${esc(option.value)}"${String(option.value) === selected ? ' selected' : ''}>${esc(option.label ?? option.value)}</option>`).join('');
  return html(`<label class="mr-field ${esc(className)}">${label == null ? '' : `<span class="mr-label">${esc(_signalValue(label))}</span>`}<select class="mr-select" name="${esc(name ?? '')}"${disabled ? ' disabled' : ''} data-mr-action="${esc(action ?? '')}">${optionHtml}</select></label>`);
};
export const Textarea = ({ name, label, value = '', placeholder = '', disabled = false, className = '', action } = {}) =>
  html(`<label class="mr-field ${esc(className)}">${label == null ? '' : `<span class="mr-label">${esc(_signalValue(label))}</span>`}<textarea class="mr-textarea" name="${esc(name ?? '')}" placeholder="${esc(_signalValue(placeholder))}"${disabled ? ' disabled' : ''} data-mr-action="${esc(action ?? '')}">${esc(_signalValue(value) ?? '')}</textarea></label>`);

/** A semantic, responsive data table. `rows` can be an array or Signal. */
export const Table = ({ rows = [], columns = [], key = row => row?.id ?? row?.key, caption, ariaLabel = '数据表', empty = '暂无数据', className = '', tableClassName = '', rowClassName = '' } = {}) => {
  const items = _signalValue(rows) ?? [];
  const cols = columns ?? [];
  const cell = (column, row, index) => typeof column.render === 'function' ? column.render(row, index) : typeof column.value === 'function' ? column.value(row, index) : row?.[column.key];
  const header = For(cols, (column, index) => column.key ?? index, column => h`<th scope="col" class="${column.headerClassName ?? ''}">${column.label ?? column.key}</th>`);
  const body = items.length
    ? For(items, key, (row, index) => {
        // Include the current row in each keyed cell item. This means a row
        // update refreshes existing cells instead of leaving a nested For
        // renderer closed over the old row object.
        const cells = cols.map(column => ({ column, row, index }));
        return h`<tr data-key="${key(row, index)}" class="${typeof rowClassName === 'function' ? rowClassName(row, index) : rowClassName}">${For(cells, item => item.column.key, item => h`<td class="${item.column.className ?? ''}">${cell(item.column, item.row, item.index)}</td>`)}</tr>`;
      })
    : h`<tr class="mr-table-empty"><td colspan="${Math.max(cols.length, 1)}">${empty}</td></tr>`;
  return h`<div class="mr-table-wrap ${className}"><table class="mr-table ${tableClassName}" aria-label="${ariaLabel}"><caption class="${caption == null ? 'mr-sr-only' : ''}">${caption ?? ariaLabel}</caption><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
};

// ── JSON UI renderer ────────────────────────────────────────────────────────
// JSON controls structure only. Event handlers stay in caller-owned `actions`.
let _uiDebug = false;
const _uiDebugListeners = new Set();
export const setUIDebug = enabled => { _uiDebug = Boolean(enabled); };
export const getUIDebugState = () => ({ enabled: _uiDebug, listeners: _uiDebugListeners.size });
export const onUIDebug = listener => { _uiDebugListeners.add(listener); return () => _uiDebugListeners.delete(listener); };
const _debug = (enabled, event) => { if (enabled || _uiDebug) for (const listener of _uiDebugListeners) listener(event); };

const _path = (value, path) => path.split('.').reduce((current, part) => current?.[part], value);
const _resolve = (value, values) => {
  if (typeof value !== 'string' || !value.startsWith('$')) return _signalValue(value);
  return _signalValue(_path(values, value.slice(1)));
};
const _attr = value => esc(value ?? '');
const _children = (children, values) => (children ?? []).map(child => _renderNode(child, values)).join('');

function _renderNode(node, values) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  const value = name => _resolve(node[name], values);
  const children = () => _children(node.children, values);
  const cls = _attr(value('className'));
  switch (node.type) {
    case 'stack': return `<div class="mr-stack ${cls}">${children()}</div>`;
    case 'inline': return `<div class="mr-inline ${cls}">${children()}</div>`;
    case 'card': return `<section class="mr-card ${cls}">${node.title == null ? '' : `<h2 class="mr-card-title">${_attr(value('title'))}</h2>`}${children()}</section>`;
    case 'text': return `<${node.as === 'p' ? 'p' : node.as === 'h1' || node.as === 'h2' || node.as === 'h3' ? node.as : 'span'} class="${cls}">${_attr(value('text'))}</${node.as === 'p' ? 'p' : node.as === 'h1' || node.as === 'h2' || node.as === 'h3' ? node.as : 'span'}>`;
    case 'button': return `<button type="${_attr(node.buttonType ?? 'button')}" class="mr-btn ${node.variant && node.variant !== 'primary' ? `mr-btn-${_attr(node.variant)}` : ''} ${cls}" data-mr-action="${_attr(node.action)}" ${value('disabled') ? 'disabled' : ''}>${_attr(value('label'))}</button>`;
    case 'input': return `<label class="mr-field ${cls}">${node.label == null ? '' : `<span class="mr-label">${_attr(value('label'))}</span>`}<input class="mr-input" name="${_attr(node.name)}" type="${_attr(node.inputType ?? 'text')}" value="${_attr(value('value'))}" placeholder="${_attr(value('placeholder'))}" data-mr-action="${_attr(node.action)}" ${value('disabled') ? 'disabled' : ''}></label>`;
    case 'textarea': return `<label class="mr-field ${cls}">${node.label == null ? '' : `<span class="mr-label">${_attr(value('label'))}</span>`}<textarea class="mr-textarea" name="${_attr(node.name)}" placeholder="${_attr(value('placeholder'))}" data-mr-action="${_attr(node.action)}" ${value('disabled') ? 'disabled' : ''}>${_attr(value('value'))}</textarea></label>`;
    case 'badge': return `<span class="mr-badge ${cls}">${_attr(value('label'))}</span>`;
    case 'alert': return `<div role="alert" class="mr-alert ${node.variant ? `mr-alert-${_attr(node.variant)}` : ''} ${cls}">${_attr(value('message'))}</div>`;
    case 'empty': return `<div class="mr-empty ${cls}">${_attr(value('message') ?? '暂无数据')}</div>`;
    case 'spinner': return `<span class="mr-spinner ${cls}" role="status" aria-label="${_attr(value('label') ?? '加载中')}"></span>`;
    case 'divider': return '<hr class="mr-divider">';
    default: return '';
  }
}

/** Render a JSON UI schema. Action payloads intentionally omit field values. */
export const ui = (schema, { values = {}, actions = {}, debug = false } = {}) => ({
  __isComponent: true,
  html: () => {
    _debug(debug, { type: 'render' });
    return _renderNode(schema, values);
  },
  setup: root => {
    const dispatch = event => {
      const target = event.target.closest?.('[data-mr-action]');
      const action = target?.dataset.mrAction;
      if (!action || !root.contains(target)) return;
      const handler = actions[action];
      _debug(debug, { type: 'action', action, event: event.type, field: target.name || undefined });
      if (typeof handler === 'function') handler(event, { action, name: target.name, checked: target.checked });
    };
    root.addEventListener('click', dispatch);
    root.addEventListener('input', dispatch);
    root.addEventListener('change', dispatch);
    return () => { root.removeEventListener('click', dispatch); root.removeEventListener('input', dispatch); root.removeEventListener('change', dispatch); };
  },
});
