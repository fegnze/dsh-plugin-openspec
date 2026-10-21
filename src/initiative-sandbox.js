// Browser-only host for the original renderer's EmbeddedInitiativeAppHost seam.
// Project code executes in an opaque-origin frame, never in this renderer's shadow root.
function installInitiativeSandbox(window, document, lifetime) {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
  // Serialized into the opaque-origin frame; never closes over host APIs or state.
  function installFragmentNavigation(document) {
    function navigate(event) {
      const anchor = event.target.closest?.('a[href]');
      const href = anchor?.getAttribute('href');
      if (!href?.startsWith('#')) return;
      // srcdoc inherits the parent's base URL: even a missing/malformed fragment
      // must not fall through to the browser's default cross-document navigation.
      event.preventDefault();
      if (event.type === 'auxclick') return;
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = id ? document.getElementById(id) : document.documentElement;
      if (!target) return;
      for (let node = target; node; node = node.parentElement) {
        if (node.tagName === 'DETAILS') node.open = true;
      }
      // Non-interactive headings/sections need a temporary focus target for Enter
      // and screen readers; do not change the author's tab order.
      if (target.tabIndex < 0 && !target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    }
    document.addEventListener('click', navigate, true);
    document.addEventListener('auxclick', navigate, true);
  }
  function sourceDocument(html, assets = {}) {
    // Parse inertly. Strip navigation and external dependencies before any resource can load.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const asset = raw => {
      const path = (raw || '').replace(/^\.\//, '');
      if (!path || /[\\:%?#]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
      return Object.hasOwn(assets, path) && typeof assets[path] === 'string' ? assets[path] : undefined;
    };
    for (const link of parsed.querySelectorAll('link[rel="stylesheet"]')) {
      const content = asset(link.getAttribute('href'));
      if (content === undefined) throw new Error('专项样式资源未提供或路径不受支持');
      const style = parsed.createElement('style'); style.textContent = content; link.replaceWith(style);
    }
    for (const node of parsed.querySelectorAll('script[src]')) {
      const content = asset(node.getAttribute('src'));
      if (content === undefined || node.type === 'module') throw new Error('专项脚本资源未提供或模块脚本不受支持');
      const script = parsed.createElement('script'); script.textContent = content; node.replaceWith(script);
    }
    parsed.querySelectorAll('base,meta[http-equiv],iframe,frame,object,embed,form,link,audio,video,source,track').forEach(node => node.remove());
    parsed.querySelectorAll('*').forEach(node => {
      for (const attribute of Array.from(node.attributes)) {
        if (/^(src|srcset|poster|action|formaction|ping|background|xlink:href)$/i.test(attribute.name)) {
          if (!(node.tagName === 'IMG' && attribute.name === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribute.value))) node.removeAttribute(attribute.name);
        }
        if (/^(href|target|download)$/i.test(attribute.name) && !(attribute.name === 'href' && /^#[^\s]*$/.test(attribute.value))) node.removeAttribute(attribute.name);
      }
    });
    const navigation = parsed.createElement('script');
    navigation.textContent = '(' + installFragmentNavigation.toString() + ')(document);';
    parsed.head.prepend(navigation);
    const meta = parsed.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = policy;
    parsed.head.prepend(meta);
    return '<!doctype html>' + parsed.documentElement.outerHTML;
  }
  class EmbeddedInitiativeAppHost {
    constructor(root, bridge) {
      this.root = root; this.bridge = bridge; this.generation = 0; this.frame = null;
      lifetime.signal.addEventListener('abort', () => this.dispose(), { once: true });
    }
    async mount(request) {
      const generation = ++this.generation;
      const payload = await this.bridge.mount(request);
      if (generation !== this.generation || lifetime.signal.aborted || !this.root.isConnected) return false;
      const frame = document.createElement('iframe');
      frame.title = payload.title || '专项';
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      // Chromium Embedded Enforcement also requires subsequent documents to accept this policy.
      frame.setAttribute('csp', policy);
      frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'; usb 'none'");
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:white';
      frame.srcdoc = sourceDocument(payload.html, payload.assets);
      this.frame = frame; this.root.replaceChildren(frame);
      return true;
    }
    async focus() { this.frame?.focus(); return { applied: Boolean(this.frame) }; }
    async setVisible(visible) { if (this.frame) this.frame.hidden = !visible; }
    async dispose() { ++this.generation; this.frame?.remove(); this.frame = null; }
  }
  window.OpenSpecInitiativeApps = { EmbeddedInitiativeAppHost };
}
