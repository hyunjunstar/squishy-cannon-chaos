export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = '', attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function icon(name: string): HTMLImageElement {
  const i = document.createElement('img');
  i.src = `img/${name}.png`;
  i.alt = '';
  i.draggable = false;
  return i;
}
