// The original imperative renderer lives exclusively inside the React-owned shadow root.
// No host DOM queries, global URL changes, title changes, global libraries or lasting listeners.
const nativeWindow = scope.ownerDocument.defaultView;
const nativeDocument = scope.ownerDocument;
const timers = new Set();
const listeners = [];
const location = { hash: '' };
const history = { pushState(_a, _b, hash) { location.hash = hash; }, replaceState(_a, _b, hash) { location.hash = hash; } };
const setTimeout = (callback, delay) => { const id = nativeWindow.setTimeout(() => { timers.delete(id); if (!lifetime.signal.aborted) callback(); }, delay); timers.add(id); return id; };
const clearTimeout = id => { timers.delete(id); nativeWindow.clearTimeout(id); };
const setInterval = () => { throw new Error('Background polling is not supported'); };
const clearInterval = () => {};
const addListener = (target, type, fn, options) => { target.addEventListener(type, fn, options); listeners.push(() => target.removeEventListener(type, fn, options)); };
const document = new Proxy(scope, { get(_target, key) {
  if (key === 'getElementById') return id => scope.getElementById(id);
  if (key === 'querySelector' || key === 'querySelectorAll') return scope[key].bind(scope);
  if (key === 'documentElement' || key === 'body') return scope.host;
  if (key === 'activeElement') return scope.activeElement;
  if (key === 'hidden') return nativeDocument.hidden;
  if (key === 'addEventListener') return (type, fn, options) => addListener(scope, type, fn, options);
  const value = nativeDocument[key]; return typeof value === 'function' ? value.bind(nativeDocument) : value;
} });
const window = new Proxy({ openSpecGUI: bridge, location, history }, { get(target, key) {
  if (key in target) return target[key];
  if (key === 'scrollTo') return () => scope.getElementById('page')?.scrollTo(0, 0);
  if (key === 'addEventListener') return (type, fn, options) => addListener(scope.host, type, fn, options);
  if (key === 'matchMedia') return query => {
    const media = nativeWindow.matchMedia(query);
    return { get matches() { return media.matches; }, addEventListener: (type, fn, options) => addListener(media, type, fn, options) };
  };
  if (key === 'CSS') return undefined; // local fallback marks avoid shared CSS.highlights keys
  const value = nativeWindow[key]; return typeof value === 'function' ? value.bind(nativeWindow) : value;
}, set(target, key, value) { target[key] = value; return true; } });
const globalThis = window;
const self = window;
const module = undefined, exports = undefined, define = undefined;
const localStorage = { getItem: () => null, setItem: () => {} };
lifetime.signal.addEventListener('abort', () => { timers.forEach(id => nativeWindow.clearTimeout(id)); listeners.forEach(dispose => dispose()); scope.replaceChildren(); }, { once: true });
