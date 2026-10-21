window.__ModuleLoader__.load({ id: 'dsh-openspec', factory: require => {
  const React = require('react');
  const h = React.createElement;
  const html = '__ORIGINAL_HTML__';
  const css = '__ORIGINAL_CSS__';
  /* ORIGINAL_RUNTIME */
  async function apply(ctx) {
    await ctx.remote.$mount(TYPERT_REMOTE);
    ctx.inject(['remote.openspec'], install);
  }
  function install(ctx) {
    ctx.effect(() => ctx.locale.register('openspec', { zh: { title: 'SPEC', guide: '项目执行台、专项、规范与归档' }, en: { title: 'SPEC', guide: 'Project execution, initiatives, specs and archives' } }));
    const t = ctx.locale.bind('openspec');
    function Workbench(props) {
      const ref = React.useRef(null);
      const allowed = props.useAccess('openspec.read');
      const cwd = props.useSession(s => s.cwd);
      React.useEffect(() => {
        if (props.active === false || !allowed) return;
        const lifetime = new AbortController();
        const element = ref.current;
        // Only the mounted main OpenSpec view suppresses its own Session's
        // composer. Pending approvals/questions retain the shipped composer.
        const restoreComposer = props.compact ? () => {} : ctx.slots.inject('conversation.composer', () => ctx.slots.register({
          name: 'conversation.composer', priority: -20,
          select: owner => owner.sessionId === props.sessionId && !owner.pendingInteraction ? true : null,
        }, () => null));
        lifetime.signal.addEventListener('abort', restoreComposer, { once: true });
        const scope = element.shadowRoot || element.attachShadow({ mode: 'open' });
        if (!allowed) { scope.textContent = '当前会话无命令访问权限'; return () => lifetime.abort(); }
        const style = document.createElement('style'); style.textContent = css;
        const container = document.createElement('div'); container.className = 'dsh-openspec-root'; container.innerHTML = html;
        scope.replaceChildren(style, container);
        // conversation.view can live in an auto-height wrapper inside DSH's
        // scroll body. Percent height there grows with content instead of
        // establishing a viewport; bound our own surface to the visible area.
        const fit = () => {
          const top = element.getBoundingClientRect().top;
          const available = Math.max(160, window.innerHeight - Math.max(0, top));
          const height = available + 'px';
          if (element.style.height !== height) element.style.height = height;
        };
        if (!props.compact) {
          const resize = new ResizeObserver(fit);
          resize.observe(element.parentElement);
          window.addEventListener('resize', fit, { signal: lifetime.signal });
          lifetime.signal.addEventListener('abort', () => resize.disconnect(), { once: true });
          fit();
        }
        // DSH's outer scroll view sees a retargeted Shadow DOM host, not the
        // content scroller. Route wheel deltas through the real composed path.
        scope.addEventListener('wheel', event => {
          if (event.ctrlKey || event.defaultPrevented) return;
          const nodes = event.composedPath().filter(node => node instanceof HTMLElement);
          let outer = element.parentElement;
          while (outer) { nodes.push(outer); outer = outer.parentElement; }
          const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
          const delta = horizontal ? event.deltaX : event.deltaY;
          const target = nodes.find(node => {
            const overflow = getComputedStyle(node)[horizontal ? 'overflowX' : 'overflowY'];
            const size = horizontal ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
            const position = horizontal ? node.scrollLeft : node.scrollTop;
            return /auto|scroll/.test(overflow) && size > 1 && (delta < 0 ? position > 0 : position < size - 1);
          });
          if (!target) return;
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1;
          target.scrollBy({ left: horizontal ? delta * unit : 0, top: horizontal ? 0 : delta * unit, behavior: 'instant' });
          event.preventDefault(); event.stopPropagation();
        }, { passive: false, signal: lifetime.signal });
        async function call(request) {
          lifetime.signal.throwIfAborted();
          const response = await ctx.remote.openspec.read(props.sessionId, JSON.stringify(request), lifetime.signal);
          lifetime.signal.throwIfAborted();
          if (!response.ok) throw new Error(response.error?.message || 'OpenSpec 请求失败');
          return JSON.parse(response.value);
        }
        let revision = 0, initialWorkspace;
        const readWorkspace = async () => {
          const payload = await call({ action: 'workspace' }); revision = payload.revision;
          return payload;
        };
        // The original boot asks projects.list then workspace.load in sequence.
        // Reuse exactly that initial read; explicit refresh never uses the seed.
        const initial = () => initialWorkspace ||= readWorkspace();
        const workspace = async () => {
          if (initialWorkspace) { const payload = await initialWorkspace; initialWorkspace = undefined; return payload; }
          return readWorkspace();
        };
        const denied = async () => { throw new Error('项目由当前 DSH 会话关联，请在 DSH 工作区中管理。'); };
        const bridge = {
          projects: { list: async () => { const payload = await initial(); const p = payload.snapshot?.project; return { activeProjectId: payload.projectId, projects: p ? [{ id: payload.projectId, name: p.name, rootPath: p.rootPath, valid: true }] : [], diagnostic: null }; }, select: denied, add: denied, scan: denied, remove: denied, relink: denied },
          workspace: { load: workspace, refresh: readWorkspace, onChanged: () => () => {} },
          documents: { read: request => call({ action: 'document', path: request.documentId }) },
          initiatives: { load: request => call({ action: 'initiative', providerId: request.providerId, initiativeId: request.initiativeId, revision }), readArtifact: request => call({ action: 'artifact', providerId: request.providerId, initiativeId: request.initiativeId, artifactId: request.artifactId, sourceHash: request.sourceHash, revision }) },
          initiativeApp: { mount: request => call({ action: 'app', providerId: request.providerId, initiativeId: request.initiativeId, sourceHash: request.sourceHash, revision }) },
          clipboard: { write: text => navigator.clipboard.writeText(String(text)) }
        };
        if (!props.compact) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'dsh-openspec-sidebar'; button.textContent = '在侧边栏打开';
          button.addEventListener('click', () => ctx.sidebarRight.openTab('dsh-openspec'), { signal: lifetime.signal });
          scope.querySelector('.toolbar-actions').prepend(button);
        }
        mountOriginal(scope, bridge, lifetime);
        return () => lifetime.abort();
      }, [props.sessionId, cwd, allowed, props.active]);
      return h('div', { ref, style: { height: '100%', minHeight: 0, overflow: 'hidden' }, className: props.compact ? 'dsh-openspec-pane' : 'dsh-openspec-main', 'aria-label': 'SPEC' });
    }
    ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'dsh-openspec', order: 30, label: () => t('title'), locale: 'openspec' }, Workbench));
    ctx.effect(() => ctx.sidebarRightTabs.register({ id: 'dsh-openspec', kind: 'dsh-openspec', title: () => t('title'), guide: [{ id: 'openspec', title: () => t('title'), description: () => t('guide'), order: 45 }] }));
    function SidebarWorkbench(props) {
      const { tab } = props.useTabInfo();
      return h(Workbench, { ...props, compact: true, active: tab.visible });
    }
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-openspec', locale: 'openspec' }, SidebarWorkbench));
  }
  return { inject: ['slots', 'locale', 'remote', 'sidebarRightTabs', 'sidebarRight'], apply };
} });
