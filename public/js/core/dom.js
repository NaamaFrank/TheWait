/**
 * Tiny DOM builder. Everything user- or server-supplied goes in as `textContent`,
 * so no screen ever needs to hand-concatenate HTML strings.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `el('div.card', { onclick }, children)`.
 * The tag may carry `.class` and `#id` shorthand.
 */
export function el(selector, props = {}, children = []) {
  const [tagPart, ...classParts] = selector.split('.');
  const [tag, id] = tagPart.split('#');

  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classParts.length) node.classList.add(...classParts);

  applyProps(node, props);
  append(node, children);
  return node;
}

/** SVG counterpart - `document.createElement` cannot build SVG nodes. */
export function svg(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, String(value));
  }

  append(node, children);
  return node;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;

    if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'class') {
      node.classList.add(...String(value).split(/\s+/).filter(Boolean));
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else if (key === 'style') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(node, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replaces a container's children in one pass. */
export function render(container, children) {
  container.replaceChildren();
  append(container, children);
  return container;
}

export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => [...scope.querySelectorAll(selector)];
