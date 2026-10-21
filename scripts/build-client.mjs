import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const upstream = path => read('src/upstream/' + path);
let html = (await upstream('index.html')).split('<body>')[1].split('</body>')[0];
html = html.replace(/<img src="assets\/product-mark.png" alt="">/, '<span aria-hidden="true">SPEC</span>');
html = html.replace('aria-label="切换项目"', 'aria-label="当前会话项目" disabled');
html = html.replace(/\s*<button type="button" data-route="initiatives"[\s\S]*?<\/button>/, '');
html = html.replace('</nav>', '</nav><nav class="primary-nav initiative-nav" aria-label="专项导航" hidden></nav>');
html = html.replace('<nav class="primary-nav"', '<div class="navigation-strip"><nav class="primary-nav"');
html = html.replace('aria-label="专项导航" hidden></nav>', 'aria-label="专项导航" hidden></nav></div>');
let css = await upstream('styles.css');
css = css.replaceAll(':root', ':host').replace(/\bhtml\b|\bbody\b/g, '.dsh-openspec-root').replaceAll('@media (max-width:', '@container (max-width:').replaceAll('position: fixed', 'position: absolute');
// Preserve original geometry and component styles; only substitute the host palette.
css += `\n:host{--canvas:var(--dsw-alias-bg-base);--surface:var(--dsw-alias-bg-layer-1);--surface-raised:var(--dsw-alias-bg-layer-2);--surface-muted:var(--dsw-alias-interactive-bg-hover);--ink:var(--dsw-alias-label-primary);--muted:var(--dsw-alias-label-secondary);--line:var(--dsw-alias-border-l1);--line-strong:var(--dsw-alias-border-l2);--blue:var(--dsw-alias-brand-primary);--blue-soft:var(--dsw-alias-interactive-bg-active);--green:var(--dsw-alias-state-success-primary);--amber:var(--dsw-alias-state-warn-primary);--red:var(--dsw-alias-state-error-primary);--sidebar:var(--dsw-specific-sidebar-fill);--sidebar-raised:var(--dsw-alias-bg-layer-2);--sidebar-text:var(--dsw-alias-label-primary);--sidebar-muted:var(--dsw-alias-label-secondary);--sidebar-border:var(--dsw-alias-border-l1);--code:var(--dsw-alias-markdown-code-block);--code-text:var(--dsw-alias-label-primary);display:block;height:100%;min-height:0;container-type:inline-size}.dsh-openspec-root{height:100%;position:relative}.window-drag-region,.theme-control,#project-manage-button,#toolbar-project-button{display:none!important}.sidebar,.toolbar{-webkit-app-region:no-drag}.brand{padding-top:20px}.project-picker-button{pointer-events:none}.project-picker-button>svg:last-child{display:none}.page{min-height:0}.dsh-openspec-sidebar{border:0;background:transparent;color:inherit;cursor:pointer}.toolbar-actions{flex-shrink:0}\n`;
css += '.brand-mark{font-size:10px;letter-spacing:-.5px;display:flex;align-items:center;justify-content:center}.dsh-openspec-root button{border-color:var(--line)}';
let app = await upstream('app.js');
// A null snapshot is a settled empty project, not an in-flight request.
app = app.replace('    function render() {', "    var workspaceState = 'initial', workspaceError = '';\n    function render() {");
app = app.replace('        if (!state.snapshot) { renderLoading(); return; }', `        if (!state.snapshot) {
            updateNavigation();
            if (workspaceState === 'empty') { renderEmptyWorkspace(); }
            else if (workspaceState === 'error') { renderError('无法载入 OpenSpec', workspaceError); }
            else { renderLoading(); }
            return;
        }`);
app = app.replace('        refreshButton.classList.add(\'is-refreshing\');', "        workspaceState = 'loading'; workspaceError = '';\n        refreshButton.classList.add('is-refreshing');");
app = app.replace('            state.snapshot = payload.snapshot;', "            state.snapshot = payload.snapshot;\n            workspaceState = payload.snapshot ? 'ready' : 'empty';");
app = app.replace("} catch (error) { renderError('无法载入 OpenSpec', error.message); }", "} catch (error) { if (requestId !== state.currentWorkspaceRequest) { return; } workspaceState = 'error'; workspaceError = error.message; renderError('无法载入 OpenSpec', error.message); }");
app = app.replace("finally { refreshButton.classList.remove('is-refreshing'); refreshButton.disabled = false; refreshIcons(); }", "finally { if (requestId === state.currentWorkspaceRequest) { refreshButton.classList.remove('is-refreshing'); refreshButton.disabled = false; refreshIcons(); } }");
app = app.replace("        renderError('无法启动 OpenSpec GUI', error.message);", "        workspaceState = 'error'; workspaceError = error.message;\n        renderError('无法启动 OpenSpec GUI', error.message);");
css += '.initiative-nav{margin-top:16px;padding-top:14px;border-top:1px solid var(--line);min-height:0;overflow:auto;flex-shrink:1}.initiative-nav button{flex-shrink:0;min-height:42px;height:auto;text-align:left}.initiative-nav button span{white-space:normal;overflow-wrap:anywhere;line-height:1.4}.initiative-nav[hidden]{display:none}';
app = app.replace('    function render() {', `    function renderInitiativeNavigation() {
        var nav = document.querySelector('.initiative-nav');
        var items = state.snapshot.initiatives || [];
        nav.hidden = !items.length;
        nav.innerHTML = items.map(function (item) {
            var selected = state.view === 'initiative' && state.providerId === item.providerId && state.initiativeId === item.id && !state.query;
            return '<button type="button" data-provider-id="' + escapeHtml(item.providerId) + '" data-initiative-id="' + escapeHtml(item.id) + '" aria-label="' + escapeHtml(item.title) + '" title="' + escapeHtml(item.title) + '"' + (selected ? ' aria-current="page"' : '') + '>' + icon('layers-3', 18) + '<span>' + escapeHtml(item.title) + '</span></button>';
        }).join('');
    }

    function render() {`);
app = app.replace('        updateNavigation();\n        if (state.query)', '        updateNavigation();\n        renderInitiativeNavigation();\n        if (state.query)');
app = app.replaceAll('data-route="initiatives"', 'data-route="overview"').replaceAll('返回专项', '返回执行台');
// Keep upstream sources intact; the DSH initiative directory is not a second project-wide change index.
app = app.replace(/    function renderInitiatives\(\) \{[\s\S]*?\n    \}/, original => original
  .replace(/        var (?:relations|changeIds|scopedChanges|scopeControl) = [^\n]*\n/g, '')
  .replace(" + '<section class=\"initiative-change-section\">' + scopeControl + proposalTable(scopedChanges, state.changeScope === 'all' ? '当前项目没有活跃提案' : '没有独立的活跃 Change') + '</section>'", '')
  .replace('<h1>Initiatives</h1>', '<h1>专项</h1>')
  .replace('<span>由应用内置的受信 Provider 发现</span>', ''));

app = app.replace(/    function renderEmptyWorkspace\(\) \{[\s\S]*?\n    \}/, `    function renderEmptyWorkspace() {
        page.innerHTML = '<section class="onboarding-state"><div class="onboarding-mark">' + icon('folder-kanban', 28) + '</div><h1>当前会话项目没有 OpenSpec 目录</h1><p>项目由 DSH 会话自动关联；创建 openspec 目录后刷新即可。</p></section>';
        refreshIcons();
    }`);
app = app.replace("if (Number.isNaN(date.getTime()))", "if (Number.isNaN(date.getTime()) || date.getTime() === 0)");
app = app.replace("projectPickerButton.disabled = !state.registry.projects.length;", "projectPickerButton.disabled = true; projectPickerButton.setAttribute('aria-label', '当前会话项目');");
app = app.replace(" + proposalContent;", " + renderWarnings(snapshot.warnings || []) + proposalContent;");
app = app.replace('window.lucide.createIcons();', "window.lucide.createIcons({ root: document });");
app = app.replace(/\s*document.title = [^;]+;/g, '');
app = app.replace("        updateTimer = setInterval(checkForWorkspaceUpdates, 30000);", '        // DSH owns lifecycle; explicit refresh instead of a second background poller.');
app = app.replace("        bridge.workspace.onChanged(function () { loadWorkspace(false); });", '');
app = app.replace("        applyTheme(localStorage.getItem('openspec-workbench-theme') || 'system');", "        applyTheme('system');");
// The original desktop CSP is not inherited in a native DSH slot: enforce a strict HTML allowlist.
app = app.replace("        template.content.querySelectorAll(blockedSelector)", `        var allowedTags = new Set('P BR HR H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE EM STRONG DEL S A TABLE THEAD TBODY TFOOT TR TH TD INPUT DETAILS SUMMARY SPAN DIV'.split(' '));
        template.content.querySelectorAll('*').forEach(function (element) {
            if (!allowedTags.has(element.tagName)) { element.replaceWith(document.createTextNode(element.outerHTML)); return; }
            Array.from(element.attributes).forEach(function (attribute) {
                var permitted = (element.tagName === 'A' && attribute.name === 'href') || (element.tagName === 'INPUT' && /^(type|checked|disabled)$/.test(attribute.name)) || (/^(TH|TD)$/.test(element.tagName) && /^(colspan|rowspan)$/.test(attribute.name));
                if (!permitted) { element.removeAttribute(attribute.name); }
            });
        });
        template.content.querySelectorAll(blockedSelector)`);
app = app.replace("    document.addEventListener('click', function (event) {", `    document.addEventListener('click', function (event) {
        var anchor = event.target.closest('a[href^="#"]');
        if (anchor) { event.preventDefault(); var target = document.getElementById(decodeURIComponent(anchor.getAttribute('href').slice(1))); if (target) { target.scrollIntoView({ block: 'start' }); } return; }`);
// Native iframe belongs to the host element; unlike WebContentsView it must not be cleared after mount.
app = app.replace('                container.replaceChildren();', '                // Sandboxed iframe remains mounted in its boundary.');
app = app.replace('            location: state.appRoute || \'\'', '            sourceHash: descriptor.sourceHash,\n            location: state.appRoute || \'\'');
const dependencies = await Promise.all(['marked.umd.js','lucide.min.js','progress.js','host-router.js'].map(upstream));
css += '\n' + await read('src/layout.css');
const adapter = await read('src/client-adapter.js');
const contract = (await read('src/remote-contract.mjs')).replace("import { z } from 'zod';", "const { z } = require('zod');").replace(/export const /g, 'const ');
const runtime = `${contract}\nfunction mountOriginal(scope, bridge, lifetime) {\n${await read('src/renderer-scope.js')}\n${dependencies.join('\n')}\n${await read('src/initiative-sandbox.js')}\ninstallInitiativeSandbox(window, document, lifetime);\n${app}\n}`;
await writeFile(new URL('src/client.js', root), '// Generated by scripts/build-client.mjs from checked-in OpenSpecGUI sources.\n' + adapter.replace('/* ORIGINAL_RUNTIME */', () => runtime).replace("'__ORIGINAL_HTML__'", () => JSON.stringify(html)).replace("'__ORIGINAL_CSS__'", () => JSON.stringify(css)));
console.log('Built original renderer with isolated DSH lifecycle adapter.');
