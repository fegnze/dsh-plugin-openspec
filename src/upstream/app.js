(function () {
    'use strict';

    var bridge = window.openSpecGUI;
    var hostRouter = window.OpenSpecHostRouter;
    var currentInitiativeAppHost = null;
    var currentInitiativeAppKey = '';
    var initiativeAppOperation = 0;
    var page = document.getElementById('page');
    var workspaceElement = document.querySelector('.workspace');
    var sidebarStatus = document.getElementById('sidebar-status');
    var searchInput = document.getElementById('global-search');
    var inPageSearch = document.getElementById('in-page-search');
    var inPageSearchInput = document.getElementById('in-page-search-input');
    var inPageSearchCount = document.getElementById('in-page-search-count');
    var inPageSearchPrevious = document.getElementById('in-page-search-previous');
    var inPageSearchNext = document.getElementById('in-page-search-next');
    var refreshButton = document.getElementById('refresh-button');
    var themeSelect = document.getElementById('theme-select');
    var toast = document.getElementById('toast');
    var projectPicker = document.getElementById('project-picker');
    var projectPickerButton = document.getElementById('project-picker-button');
    var projectPickerName = document.getElementById('project-picker-name');
    var projectOptions = document.getElementById('project-options');
    var projectHealth = document.getElementById('project-health');
    var projectManageButton = document.getElementById('project-manage-button');
    var toolbarProjectButton = document.getElementById('toolbar-project-button');
    var toolbarProjectName = document.getElementById('toolbar-project-name');
    var projectDialog = document.getElementById('project-dialog');
    var projectDialogStatus = document.getElementById('project-dialog-status');
    var projectRegistryList = document.getElementById('project-registry-list');
    var scanResults = document.getElementById('scan-results');
    var scanCandidateList = document.getElementById('scan-candidate-list');
    var scanResultsCount = document.getElementById('scan-results-count');
    var state = {
        registry: { activeProjectId: null, projects: [], diagnostic: null },
        projectId: null,
        routeProjectId: '',
        revision: 0,
        snapshot: null,
        view: 'overview',
        entityType: '',
        entityId: '',
        documentId: '',
        documentMode: 'rendered',
        detailPanel: 'tasks',
        targetTask: '',
        query: '',
        typeFilter: 'all',
        statusFilter: 'all',
        currentDocumentRequest: 0,
        currentWorkspaceRequest: 0,
        currentInitiativeRequest: 0,
        providerId: '',
        initiativeId: '',
        appRoute: '',
        artifactId: '',
        changeScope: 'independent',
        scanCandidates: []
    };
    var toastTimer = null;
    var updateTimer = null;
    var updateCheckRunning = false;
    var proposalCopyTimers = new WeakMap();
    var inPageSearchState = { query: '', matches: [], activeIndex: -1, returnFocus: null };
    var IN_PAGE_SEARCH_HIGHLIGHT = 'openspec-in-page-search';
    var IN_PAGE_SEARCH_CURRENT_HIGHLIGHT = 'openspec-in-page-search-current';

    function canUseCssHighlights() {
        return Boolean(window.CSS && window.CSS.highlights && typeof window.CSS.highlights.set === 'function' && typeof window.Highlight === 'function');
    }

    function clearInPageSearchHighlights() {
        if (canUseCssHighlights()) {
            window.CSS.highlights.delete(IN_PAGE_SEARCH_HIGHLIGHT);
            window.CSS.highlights.delete(IN_PAGE_SEARCH_CURRENT_HIGHLIGHT);
        }
        page.querySelectorAll('[data-in-page-search-match]').forEach(function (match) {
            var parent = match.parentNode;
            while (match.firstChild) { parent.insertBefore(match.firstChild, match); }
            parent.removeChild(match);
            parent.normalize();
        });
        inPageSearchState.matches = [];
        inPageSearchState.activeIndex = -1;
    }

    function updateInPageSearchControls() {
        var total = inPageSearchState.matches.length;
        var current = total ? inPageSearchState.activeIndex + 1 : 0;
        inPageSearchCount.textContent = current + ' / ' + total;
        inPageSearchPrevious.disabled = total === 0;
        inPageSearchNext.disabled = total === 0;
    }

    function pageTextNodes() {
        var walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || !node.parentElement || node.parentElement.closest('[data-in-page-search-match]')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        var nodes = [];
        var node;
        while ((node = walker.nextNode())) { nodes.push(node); }
        return nodes;
    }

    function matchingRanges(query) {
        var offset = 0;
        var entries = pageTextNodes().map(function (node) {
            var entry = { node: node, start: offset, end: offset + node.nodeValue.length };
            offset = entry.end;
            return entry;
        });
        var text = entries.map(function (entry) { return entry.node.nodeValue; }).join('');
        var lowerText = text.toLowerCase();
        var lowerQuery = query.toLowerCase();
        var ranges = [];
        var index = lowerText.indexOf(lowerQuery);
        while (index !== -1) {
            var end = index + query.length;
            var startEntry = entries.find(function (entry) { return index >= entry.start && index < entry.end; });
            var endEntry = entries.find(function (entry) { return end > entry.start && end <= entry.end; });
            if (startEntry && endEntry) {
                var range = document.createRange();
                range.setStart(startEntry.node, index - startEntry.start);
                range.setEnd(endEntry.node, end - endEntry.start);
                ranges.push(range);
            }
            index = lowerText.indexOf(lowerQuery, index + Math.max(query.length, 1));
        }
        return ranges;
    }

    function matchingFallbackMarks(query) {
        var lowerQuery = query.toLowerCase();
        var matches = [];
        pageTextNodes().forEach(function (node) {
            var text = node.nodeValue;
            var lowerText = text.toLowerCase();
            var index = lowerText.indexOf(lowerQuery);
            if (index === -1) { return; }
            var fragment = document.createDocumentFragment();
            var offset = 0;
            while (index !== -1) {
                fragment.appendChild(document.createTextNode(text.slice(offset, index)));
                var mark = document.createElement('mark');
                mark.className = 'in-page-search-match';
                mark.setAttribute('data-in-page-search-match', '');
                mark.textContent = text.slice(index, index + query.length);
                fragment.appendChild(mark);
                matches.push(mark);
                offset = index + query.length;
                index = lowerText.indexOf(lowerQuery, offset);
            }
            fragment.appendChild(document.createTextNode(text.slice(offset)));
            node.parentNode.replaceChild(fragment, node);
        });
        return matches;
    }

    function highlightInPageSearchMatches() {
        if (canUseCssHighlights()) {
            var highlight = new window.Highlight();
            inPageSearchState.matches.forEach(function (range) { highlight.add(range); });
            window.CSS.highlights.set(IN_PAGE_SEARCH_HIGHLIGHT, highlight);
        }
    }

    function showInPageSearchMatch(index) {
        var total = inPageSearchState.matches.length;
        if (!total) { updateInPageSearchControls(); return; }
        inPageSearchState.activeIndex = (index + total) % total;
        if (canUseCssHighlights()) {
            var current = new window.Highlight();
            current.add(inPageSearchState.matches[inPageSearchState.activeIndex]);
            window.CSS.highlights.set(IN_PAGE_SEARCH_CURRENT_HIGHLIGHT, current);
        } else {
            inPageSearchState.matches.forEach(function (match, matchIndex) {
                match.classList.toggle('is-current', matchIndex === inPageSearchState.activeIndex);
            });
        }
        var active = inPageSearchState.matches[inPageSearchState.activeIndex];
        var target = canUseCssHighlights() ? active.startContainer.parentElement : active;
        if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ block: 'center', inline: 'nearest' });
        }
        updateInPageSearchControls();
    }

    function runInPageSearch(query) {
        clearInPageSearchHighlights();
        inPageSearchState.query = query;
        if (!query) { updateInPageSearchControls(); return; }
        inPageSearchState.matches = canUseCssHighlights() ? matchingRanges(query) : matchingFallbackMarks(query);
        highlightInPageSearchMatches();
        showInPageSearchMatch(0);
    }

    function resetInPageSearch(restoreFocus) {
        clearInPageSearchHighlights();
        inPageSearchState.query = '';
        inPageSearchInput.value = '';
        inPageSearch.hidden = true;
        updateInPageSearchControls();
        var focusTarget = inPageSearchState.returnFocus;
        inPageSearchState.returnFocus = null;
        if (restoreFocus && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') { focusTarget.focus(); }
    }

    function openInPageSearch() {
        if (!inPageSearch.hidden) {
            inPageSearchInput.focus();
            inPageSearchInput.select();
            return;
        }
        inPageSearchState.returnFocus = document.activeElement;
        inPageSearch.hidden = false;
        inPageSearchInput.focus();
        inPageSearchInput.select();
        updateInPageSearchControls();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function slugify(value) {
        var slug = String(value || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[`*_~]/g, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .trim()
            .replace(/\s+/g, '-');
        return slug || 'section';
    }

    function icon(name, size) {
        return '<i data-lucide="' + escapeHtml(name) + '" data-icon-size="' + (size || 17) + '" aria-hidden="true"></i>';
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            document.querySelectorAll('[data-lucide]').forEach(function (element) {
                var size = Number(element.getAttribute('data-icon-size')) || 17;
                element.setAttribute('width', size);
                element.setAttribute('height', size);
                element.setAttribute('stroke-width', '1.8');
            });
            window.lucide.createIcons();
        }
    }

    function showToast(message) {
        clearTimeout(toastTimer);
        toast.textContent = message;
        toast.hidden = false;
        toastTimer = setTimeout(function () { toast.hidden = true; }, 1800);
    }

    function proposalCopyButton(proposalName, className) {
        var name = escapeHtml(proposalName);
        return '<button class="icon-button proposal-copy-button' + (className ? ' ' + className : '') + '" type="button" data-action="copy-proposal-name" data-proposal-name="' + name + '" data-tooltip="复制提案名" aria-label="复制提案名 ' + name + '">' + icon('copy', 15) + '</button>';
    }

    function showProposalCopyFeedback(button, proposalName) {
        var existingTimer = proposalCopyTimers.get(button);
        if (existingTimer) { clearTimeout(existingTimer); }
        button.classList.add('is-copied');
        button.setAttribute('data-tooltip', '已复制');
        button.setAttribute('aria-label', '已复制提案名 ' + proposalName);
        button.innerHTML = icon('check', 15);
        refreshIcons();
        proposalCopyTimers.set(button, setTimeout(function () {
            if (!button.isConnected) { return; }
            button.classList.remove('is-copied');
            button.setAttribute('data-tooltip', '复制提案名');
            button.setAttribute('aria-label', '复制提案名 ' + proposalName);
            button.innerHTML = icon('copy', 15);
            proposalCopyTimers.delete(button);
            refreshIcons();
        }, 1600));
    }

    async function copyProposalName(proposalName, button) {
        if (!proposalName) { return; }
        try {
            await bridge.clipboard.write(proposalName);
            showProposalCopyFeedback(button, proposalName);
            showToast('提案名已复制');
        } catch (error) {
            showToast('无法访问剪贴板');
        }
    }

    function formatDate(value) {
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) { return '时间未知'; }
        return new Intl.DateTimeFormat('zh-CN', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    function statusLabel(status) {
        return {
            'in-progress': '进行中',
            complete: '已完成',
            'no-tasks': '无任务',
            formal: '正式规范'
        }[status] || status || '状态未知';
    }

    function controlLabel(controlState) {
        return {
            attention: '需要处理',
            'in-progress': '进行中',
            'ready-to-archive': '待归档'
        }[controlState] || '状态未知';
    }

    function controlIcon(controlState) {
        return {
            attention: 'triangle-alert',
            'in-progress': 'activity',
            'ready-to-archive': 'circle-check-big'
        }[controlState] || 'circle-dot';
    }

    function typeLabel(type) {
        return { active: '活跃提案', archive: '归档提案', spec: '正式规范' }[type] || type;
    }

    function routeForCollection(type) {
        return type === 'active' ? 'overview' : (type === 'archive' ? 'archives' : 'specs');
    }

    function collectionForType(type) {
        return type === 'active' ? state.snapshot.changes : (type === 'archive' ? state.snapshot.archives : state.snapshot.specs);
    }

    function findEntity(type, id) {
        return collectionForType(type).find(function (item) { return item.id === id; }) || null;
    }

    function serializeState() {
        return hostRouter.serialize(state);
    }

    function syncUrl(replace) {
        var nextHash = '#' + serializeState();
        if (replace) { history.replaceState(null, '', nextHash); }
        else if (window.location.hash !== nextHash) { history.pushState(null, '', nextHash); }
    }

    function resetOverviewFilters() {
        state.typeFilter = 'all';
        state.statusFilter = 'all';
    }

    function readUrl() {
        var route = hostRouter.parse(window.location.hash);
        Object.keys(route).forEach(function (key) {
            if (key !== 'legacyChanges') { state[key] = route[key]; }
        });
        if (route.legacyChanges) {
            resetOverviewFilters();
            syncUrl(true);
        }
        searchInput.value = state.query;
    }

    function setView(view) {
        disposeInitiativeApp(Boolean(currentInitiativeAppHost));
        state.currentInitiativeRequest += 1;
        state.view = view;
        state.entityType = '';
        state.entityId = '';
        state.documentId = '';
        state.detailPanel = 'tasks';
        state.targetTask = '';
        state.query = '';
        state.providerId = '';
        state.initiativeId = '';
        state.appRoute = '';
        state.artifactId = '';
        if (view === 'overview') { resetOverviewFilters(); }
        searchInput.value = '';
        syncUrl(false);
        render();
        window.scrollTo(0, 0);
    }

    function setDetail(type, id, documentId, taskId) {
        disposeInitiativeApp(false);
        state.currentInitiativeRequest += 1;
        state.view = 'detail';
        state.entityType = type;
        state.entityId = id;
        state.documentId = documentId || '';
        state.detailPanel = type === 'active' && !documentId ? 'tasks' : 'documents';
        state.targetTask = taskId || '';
        state.query = '';
        searchInput.value = '';
        syncUrl(false);
        render();
        if (!state.targetTask) { window.scrollTo(0, 0); }
    }

    function setInitiative(providerId, initiativeId, artifactId) {
        var nextDescriptor = state.snapshot && state.snapshot.initiatives.find(function (item) {
            return item.providerId === providerId && item.id === initiativeId;
        });
        var nextKey = nextDescriptor && nextDescriptor.presentation.mode === 'embedded-app' ? embeddedAppKey(nextDescriptor) : providerId + ':' + initiativeId;
        if (currentInitiativeAppHost && currentInitiativeAppKey !== nextKey) {
            disposeInitiativeApp(false);
        }
        state.view = 'initiative';
        state.providerId = providerId || '';
        state.initiativeId = initiativeId || '';
        state.appRoute = '';
        state.artifactId = artifactId || '';
        state.entityType = '';
        state.entityId = '';
        state.documentId = '';
        state.query = '';
        searchInput.value = '';
        syncUrl(false);
        render();
        window.scrollTo(0, 0);
    }

    function updateNavigation() {
        var activeView = state.view === 'detail' ? routeForCollection(state.entityType) : (state.view === 'initiative' ? 'initiatives' : state.view);
        if (state.view === 'search') { activeView = ''; }
        document.querySelectorAll('.primary-nav [data-route]').forEach(function (button) {
            if (button.getAttribute('data-route') === activeView) { button.setAttribute('aria-current', 'page'); }
            else { button.removeAttribute('aria-current'); }
        });
    }

    function renderLoading() {
        workspaceElement.classList.remove('has-embedded-app');
        page.classList.remove('is-embedded-app');
        page.innerHTML = '<div class="loading-state" aria-label="正在载入"><span></span><span></span><span></span></div>';
    }

    function renderError(title, message) {
        page.innerHTML = '<section class="error-state">' + icon('circle-alert', 24) + '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p><button class="text-button" type="button" data-action="refresh">重新读取</button></section>';
        refreshIcons();
    }

    function renderEmptyWorkspace() {
        page.innerHTML = '<section class="onboarding-state"><div class="onboarding-mark">' + icon('folder-kanban', 28) + '</div><h1>没有已添加的项目</h1><p>添加一个包含 openspec 目录的本地项目，或扫描目录查找可导入项目。</p><div class="onboarding-actions"><button class="primary-command" type="button" data-project-action="add">' + icon('folder-plus', 17) + '添加项目</button><button class="secondary-command" type="button" data-project-action="scan">' + icon('scan-search', 17) + '扫描目录</button></div></section>';
        refreshIcons();
    }

    function progressHtml(tasks, label) {
        var total = Math.max(0, Number(tasks.total) || 0);
        var completed = Math.max(0, Number(tasks.completed) || 0);
        var percent = Math.max(0, Math.min(100, Number(tasks.percent) || 0));
        var segmentCount = 10;
        var fills = window.OpenSpecProgress.segmentFillPercents(percent, segmentCount);
        var segments = [];
        var index;

        for (index = 0; index < segmentCount; index += 1) {
            var partialStep = Math.round(fills[index] / 10);
            segments.push('<span class="progress-segment' + (fills[index] >= 100 ? ' is-filled' : (partialStep > 0 ? ' is-partial partial-' + partialStep : '')) + '"></span>');
        }

        return '<span class="progress-bar' + (percent === 100 ? ' is-complete' : '') + '" role="progressbar" aria-label="' + escapeHtml(label || '任务进度') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + percent + '" aria-valuetext="' + completed + ' / ' + total + ' tasks，' + percent + '%">' + segments.join('') + '</span>';
    }

    function metricButton(label, value, note, filter) {
        return '<button class="metric-block" type="button" data-status-filter="' + filter + '" aria-pressed="' + (state.statusFilter === filter) + '" aria-controls="proposal-content" aria-label="显示' + escapeHtml(label) + '提案，' + escapeHtml(value) + ' 项"><span class="metric-copy"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(note) + '</small></span></button>';
    }

    function filteredProposalTitle(filter) {
        return {
            attention: '需要处理的提案',
            'in-progress': '进行中的提案',
            'ready-to-archive': '待归档提案'
        }[filter] || '活跃提案';
    }

    function renderOverview() {
        var snapshot = state.snapshot;
        var items = filterChanges(snapshot.changes, state.statusFilter);
        var counts = changeCounts(snapshot.changes);
        var proposalContent = state.statusFilter === 'all'
            ? proposalOverview(snapshot.changes)
            : '<section class="execution-board focused-proposals" id="proposal-content"><div class="proposal-list-toolbar"><div><h2>' + filteredProposalTitle(state.statusFilter) + '</h2><span>' + items.length + ' 项 · 按最近更新排序</span></div>' + statusFilters(snapshot.changes, counts) + '</div>' + proposalTable(items, '没有符合当前筛选的提案') + '</section>';
        var summary = snapshot.stats.activeChanges ? snapshot.stats.activeChanges + ' 个活跃提案，优先处理当前任务与异常状态。' : '当前项目没有活跃提案。';
        page.innerHTML = '<header class="control-header"><div><span class="project-context">' + escapeHtml(snapshot.project.name) + '</span><h1>当前执行</h1><p>' + escapeHtml(summary) + '</p></div><div class="control-freshness">' + icon('check-circle-2', 17) + '<span><strong>内容已刷新</strong><small>' + formatDate(snapshot.generatedAt) + ' · ' + (snapshot.lifecycle.source === 'cli' ? 'OpenSpec CLI' : '文件推断') + '</small></span></div></header><section class="metric-strip" aria-label="提案状态摘要">' + metricButton('活跃', snapshot.stats.activeChanges, '状态总览', 'all') + metricButton('进行中', snapshot.stats.inProgressChanges, '正在交付', 'in-progress') + metricButton('待归档', snapshot.stats.readyToArchive, '任务已完成', 'ready-to-archive') + metricButton('需要处理', snapshot.stats.attentionChanges, '缺失或异常', 'attention') + '</section>' + proposalContent;
        refreshIcons();
    }

    function proposalLaneCard(change) {
        return '<div class="proposal-lane-card-shell is-' + change.controlState + '" data-entity-id="' + escapeHtml(change.id) + '"><button class="proposal-lane-card is-' + change.controlState + '" type="button" data-entity-type="active" data-entity-id="' + escapeHtml(change.id) + '"><span class="lane-card-meta"><span class="control-state is-' + change.controlState + '">' + icon(controlIcon(change.controlState), 15) + escapeHtml(controlLabel(change.controlState)) + '</span><time>' + formatDate(change.modifiedAt) + '</time></span><span class="lane-card-copy"><strong>' + escapeHtml(change.title) + '</strong><small>' + escapeHtml(change.id) + '</small></span><span class="lane-card-progress"><span><b>' + change.tasks.completed + ' / ' + change.tasks.total + '</b><em>' + change.tasks.percent + '%</em></span>' + progressHtml(change.tasks, change.title + ' 任务进度') + '</span></button>' + proposalCopyButton(change.id, 'proposal-lane-copy') + '</div>';
    }

    function proposalLane(items, config) {
        var laneItems = items.filter(function (item) { return item.controlState === config.state; });
        var laneId = 'proposal-lane-' + config.state;
        return '<section class="proposal-lane is-' + config.state + '" aria-labelledby="' + laneId + '"><header><span class="lane-heading-icon">' + icon(config.icon, 18) + '</span><span><h2 id="' + laneId + '">' + escapeHtml(config.label) + '</h2><small>' + escapeHtml(config.note) + '</small></span><strong>' + laneItems.length + '</strong></header><div class="proposal-lane-list">' + (laneItems.length ? laneItems.map(proposalLaneCard).join('') : '<div class="lane-empty">' + icon('circle-dashed', 17) + '<span>暂无' + escapeHtml(config.label) + '提案</span></div>') + '</div></section>';
    }

    function proposalOverview(items) {
        var lanes = [
            { state: 'in-progress', label: '进行中', note: '当前正在交付', icon: 'activity' },
            { state: 'ready-to-archive', label: '待归档', note: '任务已完成', icon: 'check-circle-2' },
            { state: 'attention', label: '需要处理', note: '缺失或异常', icon: 'triangle-alert' }
        ];
        var body = items.length
            ? '<div class="execution-lanes">' + lanes.map(function (config) { return proposalLane(items, config); }).join('') + '</div>'
            : '<div class="compact-empty execution-overview-empty">' + icon('inbox', 18) + '<span>当前项目没有活跃提案</span></div>';
        return '<section class="execution-board execution-overview" id="proposal-content"><div class="overview-heading"><div><h2>执行状态</h2><span>按状态分组 · 选择提案查看任务</span></div></div>' + body + '</section>';
    }

    function filterChanges(items, filter) {
        if (filter === 'all') { return items; }
        return items.filter(function (item) { return item.controlState === filter; });
    }

    function filterButton(value, label, count) {
        return '<button type="button" data-status-filter="' + value + '" aria-pressed="' + (state.statusFilter === value) + '" aria-controls="proposal-content">' + escapeHtml(label) + '<span>' + count + '</span></button>';
    }

    function changeCounts(items) {
        return {
            attention: items.filter(function (item) { return item.controlState === 'attention'; }).length,
            'in-progress': items.filter(function (item) { return item.controlState === 'in-progress'; }).length,
            'ready-to-archive': items.filter(function (item) { return item.controlState === 'ready-to-archive'; }).length
        };
    }

    function statusFilters(items, counts) {
        return '<div class="status-segments" role="group" aria-label="提案状态筛选">' + filterButton('all', '全部', items.length) + filterButton('in-progress', '进行中', counts['in-progress']) + filterButton('ready-to-archive', '待归档', counts['ready-to-archive']) + filterButton('attention', '需要处理', counts.attention) + '</div>';
    }

    function changeTableRow(change) {
        return '<div class="control-table-row-shell" data-entity-id="' + escapeHtml(change.id) + '"><button class="control-table-row is-' + change.controlState + '" type="button" data-entity-type="active" data-entity-id="' + escapeHtml(change.id) + '"><span class="proposal-cell"><strong>' + escapeHtml(change.title) + '</strong><small>' + escapeHtml(change.id) + '</small></span><span class="state-cell control-state is-' + change.controlState + '">' + icon(controlIcon(change.controlState), 15) + escapeHtml(controlLabel(change.controlState)) + '</span><span class="table-progress"><span><b>' + change.tasks.percent + '%</b><small>' + change.tasks.completed + ' / ' + change.tasks.total + ' tasks</small></span>' + progressHtml(change.tasks, change.title + ' 任务进度') + '</span><time class="updated-cell">' + formatDate(change.modifiedAt) + '</time>' + icon('chevron-right', 16) + '</button>' + proposalCopyButton(change.id, 'control-table-copy') + '</div>';
    }

    function proposalTable(items, emptyMessage) {
        return '<div class="control-table" id="proposal-list"><div class="control-table-head"><span>提案</span><span>状态</span><span>任务进度</span><span>更新</span><span></span></div>' + (items.length ? items.map(changeTableRow).join('') : '<div class="compact-empty">' + icon('inbox', 18) + '<span>' + escapeHtml(emptyMessage) + '</span></div>') + '</div>';
    }

    function documentEntityRow(entity) {
        var isSpec = entity.type === 'spec';
        var meta = isSpec ? entity.requirements + ' Requirements · ' + entity.scenarios + ' Scenarios' : statusLabel(entity.status) + ' · ' + entity.tasks.completed + '/' + entity.tasks.total;
        var row = '<button class="document-row" type="button" data-entity-type="' + entity.type + '" data-entity-id="' + escapeHtml(entity.id) + '"><span class="document-row-icon">' + icon(isSpec ? 'file-check-2' : 'archive', 17) + '</span><span><strong>' + escapeHtml(entity.title) + '</strong><small>' + escapeHtml(entity.id) + '</small></span><span class="document-row-meta">' + escapeHtml(meta) + '<small>' + formatDate(entity.modifiedAt) + '</small></span>' + icon('chevron-right', 16) + '</button>';
        return isSpec ? row : '<div class="document-row-shell" data-entity-id="' + escapeHtml(entity.id) + '">' + row + proposalCopyButton(entity.id, 'document-row-copy') + '</div>';
    }

    function renderCollection(view) {
        var config = { specs: { title: '正式规范', description: '浏览已经生效的 OpenSpec 能力定义。', items: state.snapshot.specs }, archives: { title: '归档记录', description: '查阅已经完成并归档的变更。', items: state.snapshot.archives } }[view];
        var items = config.items;
        var body;
        body = '<div class="document-list">' + (items.length ? items.map(documentEntityRow).join('') : '<div class="compact-empty">暂无内容</div>') + '</div>';
        page.innerHTML = '<header class="collection-header"><div><h1>' + config.title + '</h1><p>' + config.description + '</p></div><span class="collection-count">' + items.length + ' 项</span></header><section class="collection-body">' + body + '</section>';
        refreshIcons();
    }

    function initiativeStatusLabel(value) {
        return { planned: '已计划', active: '进行中', paused: '已暂停', complete: '已完成' }[value] || value || '状态未知';
    }

    function initiativeHealthLabel(value) {
        return { healthy: '健康', attention: '需要关注', blocked: '已阻塞', unknown: '未知' }[value] || value || '未知';
    }

    function initiativeHealthIcon(value) {
        return { healthy: 'circle-check', attention: 'triangle-alert', blocked: 'circle-x', unknown: 'circle-help' }[value] || 'circle-help';
    }

    function initiativeDiagnostics(items, compact) {
        if (!items || !items.length) { return ''; }
        return '<section class="initiative-diagnostics' + (compact ? ' is-compact' : '') + '" aria-label="Provider 诊断"><header>' + icon('shield-alert', 17) + '<div><h2>受控诊断</h2><p>诊断仅限 Initiative 范围，不影响官方 Change、Spec 和 Archive。</p></div><strong>' + items.length + '</strong></header><ul>' + items.map(function (item) {
            return '<li class="is-' + escapeHtml(item.severity) + '"><span>' + escapeHtml(item.code) + '</span><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.message) + '</p></li>';
        }).join('') + '</ul></section>';
    }

    function initiativeCard(item) {
        var scope = item.presentation.mode === 'embedded-app'
            ? [item.collection, '独立应用']
            : [item.changeRefs.length + ' Changes', item.artifacts.length + ' 成果'];
        var metadata = [item.id].concat(scope).map(function (value) {
            return '<span>' + escapeHtml(value) + '</span>';
        }).join('');
        return '<button class="initiative-row" type="button" data-provider-id="' + escapeHtml(item.providerId) + '" data-initiative-id="' + escapeHtml(item.id) + '"><span class="initiative-row-mark is-' + escapeHtml(item.health) + '">' + icon(initiativeHealthIcon(item.health), 18) + '</span><span class="initiative-row-copy"><span><strong>' + escapeHtml(item.title) + '</strong><em>' + escapeHtml(initiativeStatusLabel(item.status)) + '</em></span><p>' + escapeHtml(item.summary || item.goal || '暂无摘要') + '</p><small>' + metadata + '</small></span><span class="initiative-row-health"><span>' + escapeHtml(initiativeHealthLabel(item.health)) + '</span><small>' + escapeHtml(item.presentation.mode === 'embedded-app' ? '独立应用' : '通用视图') + '</small></span>' + icon('chevron-right', 18) + '</button>';
    }

    function renderInitiatives() {
        var items = state.snapshot.initiatives || [];
        var diagnostics = state.snapshot.initiativeDiagnostics || [];
        var relations = state.snapshot.changeRelations || { independentChangeIds: [] };
        var changeIds = state.changeScope === 'all' ? null : new Set(relations.independentChangeIds);
        var scopedChanges = changeIds ? state.snapshot.changes.filter(function (change) { return changeIds.has(change.id); }) : state.snapshot.changes;
        var list = items.length ? '<div class="initiative-list">' + items.map(initiativeCard).join('') + '</div>' : '<div class="initiative-empty"><span>' + icon('layers-3', 24) + '</span><div><h2>当前项目没有 Initiative</h2><p>标准 OpenSpec Changes、Specs 和 Archives 仍按原有方式工作。</p></div></div>';
        var scopeControl = '<div class="initiative-change-scope"><div><h2>Change 范围</h2><span>Initiative 只组织 Change，不改变官方索引。</span></div><div class="segmented-control" aria-label="Change 范围"><button class="segment-button" type="button" data-change-scope="independent" aria-pressed="' + (state.changeScope === 'independent') + '">独立 Change</button><button class="segment-button" type="button" data-change-scope="all" aria-pressed="' + (state.changeScope === 'all') + '">全部提案</button></div></div>';
        page.innerHTML = '<header class="initiative-header"><div><span class="project-context">' + escapeHtml(state.snapshot.project.name) + '</span><h1>Initiatives</h1><p>跨 Change 的专项组织与受控成果阅读。</p></div><div class="initiative-summary"><strong>' + items.length + '</strong><span>专项</span><small>' + diagnostics.length + ' 条诊断</small></div></header><section class="initiative-section" aria-labelledby="initiative-list-title"><div class="section-heading"><div><h2 id="initiative-list-title">专项目录</h2><span>由应用内置的受信 Provider 发现</span></div></div>' + list + '</section>' + initiativeDiagnostics(diagnostics, false) + '<section class="initiative-change-section">' + scopeControl + proposalTable(scopedChanges, state.changeScope === 'all' ? '当前项目没有活跃提案' : '没有独立的活跃 Change') + '</section>';
        refreshIcons();
    }

    function findInitiative(providerId, initiativeId) {
        return (state.snapshot.initiatives || []).find(function (item) {
            return item.providerId === providerId && item.id === initiativeId;
        }) || null;
    }

    function initiativeChangeRows(descriptor) {
        if (!descriptor.changeRefs.length) {
            return '<div class="compact-empty">未关联 Change</div>';
        }
        return '<div class="initiative-reference-list">' + descriptor.changeRefs.map(function (ref) {
            var active = state.snapshot.changes.find(function (change) { return change.id === ref.id; });
            var archived = state.snapshot.archives.find(function (change) { return change.referenceId === ref.id; });
            var entity = active || archived;
            if (!entity) {
                return '<div class="initiative-reference is-missing"><span>' + icon('file-warning', 16) + '</span><span><strong>' + escapeHtml(ref.id) + '</strong><small>' + escapeHtml(ref.relationship) + ' · 引用已失效</small></span></div>';
            }
            return '<button class="initiative-reference" type="button" data-entity-type="' + escapeHtml(entity.type) + '" data-entity-id="' + escapeHtml(entity.id) + '"><span>' + icon(entity.type === 'active' ? 'file-clock' : 'archive', 16) + '</span><span><strong>' + escapeHtml(entity.title) + '</strong><small>' + escapeHtml(ref.relationship) + ' · ' + escapeHtml(ref.id) + '</small></span>' + icon('arrow-up-right', 15) + '</button>';
        }).join('') + '</div>';
    }

    function renderGenericInitiative(descriptor) {
        var specificDiagnostics = (state.snapshot.initiativeDiagnostics || []).filter(function (item) {
            return (!item.providerId || item.providerId === descriptor.providerId) && (!item.initiativeId || item.initiativeId === descriptor.id);
        }).concat(descriptor.diagnostics || []);
        page.innerHTML = '<button class="back-button" type="button" data-route="initiatives">' + icon('arrow-left', 16) + '返回专项</button><header class="initiative-detail-header"><div><span class="initiative-kicker">' + escapeHtml(descriptor.type) + ' · ' + escapeHtml(descriptor.id) + '</span><h1>' + escapeHtml(descriptor.title) + '</h1><p>' + escapeHtml(descriptor.summary) + '</p></div><div class="initiative-health-block is-' + escapeHtml(descriptor.health) + '">' + icon(initiativeHealthIcon(descriptor.health), 19) + '<span><strong>' + escapeHtml(initiativeHealthLabel(descriptor.health)) + '</strong><small>' + escapeHtml(initiativeStatusLabel(descriptor.status)) + '</small></span></div></header><div class="initiative-detail-grid"><main><section class="initiative-goal"><span>专项目标</span><p>' + escapeHtml(descriptor.goal || '未声明专项目标。') + '</p></section><section class="initiative-content-section"><div class="section-heading"><div><h2>关联 Changes</h2><span>owned 表示主要归属，related 仅表示关联</span></div><strong>' + descriptor.changeRefs.length + '</strong></div>' + initiativeChangeRows(descriptor) + '</section><section class="initiative-content-section"><div class="section-heading"><div><h2>已登记成果</h2><span>按稳定 ID 通过安全读取边界打开</span></div><strong>' + descriptor.artifacts.length + '</strong></div><div id="initiative-artifacts" class="initiative-artifact-list"><div class="loading-state is-compact" role="status" aria-live="polite" aria-label="正在读取成果索引"><span></span><span></span></div></div></section></main><aside>' + initiativeDiagnostics(specificDiagnostics, true) + '<section class="initiative-provider-meta"><span>Provider</span><strong>' + escapeHtml(descriptor.providerId) + '</strong><small>schema ' + descriptor.schemaVersion + ' · source ' + escapeHtml(descriptor.sourceHash.slice(0, 10)) + '</small></section></aside></div><section id="initiative-artifact-reader"></section>';
        refreshIcons();
        loadGenericInitiative(descriptor);
    }

    function artifactIndexHtml(items, selectedId) {
        if (!items.length) { return '<div class="compact-empty">尚未登记成果</div>'; }
        return items.map(function (artifact) {
            return '<button class="initiative-artifact' + (artifact.id === selectedId ? ' is-selected' : '') + '" type="button" data-initiative-artifact="' + escapeHtml(artifact.id) + '"><span>' + icon(artifact.mediaType === 'text/markdown' ? 'file-text' : 'braces', 16) + '</span><span><strong>' + escapeHtml(artifact.title) + '</strong><small>' + escapeHtml(artifact.id) + ' · ' + Math.max(1, Math.ceil(artifact.size / 1024)) + ' KiB</small></span>' + icon('chevron-right', 15) + '</button>';
        }).join('');
    }

    async function loadGenericInitiative(descriptor) {
        var requestId = state.currentInitiativeRequest + 1;
        state.currentInitiativeRequest = requestId;
        var container = document.getElementById('initiative-artifacts');
        try {
            var payload = await bridge.initiatives.load({
                projectId: state.projectId,
                revision: state.revision,
                providerId: descriptor.providerId,
                initiativeId: descriptor.id
            });
            if (requestId !== state.currentInitiativeRequest || !container || !container.isConnected) { return; }
            container.innerHTML = artifactIndexHtml(payload.artifactIndex || [], state.artifactId);
            refreshIcons();
            if (state.artifactId) {
                var known = (payload.artifactIndex || []).some(function (item) { return item.id === state.artifactId; });
                if (known) { await loadInitiativeArtifact(descriptor, state.artifactId, requestId); }
                else { renderInitiativeArtifactError('成果不存在', '深链接中的成果 ID 未登记或已失效。'); }
            }
        } catch (error) {
            if (requestId !== state.currentInitiativeRequest || !container) { return; }
            container.innerHTML = '<div class="inline-diagnostic">' + icon('triangle-alert', 17) + '<span><strong>无法读取专项数据</strong><small>' + escapeHtml(error.message) + '</small></span><button class="text-button" type="button" data-action="refresh">重试</button></div>';
            refreshIcons();
        }
    }

    function renderInitiativeArtifactError(title, message) {
        var reader = document.getElementById('initiative-artifact-reader');
        if (!reader) { return; }
        reader.innerHTML = '<section class="error-state initiative-artifact-error">' + icon('file-warning', 23) + '<h2>' + escapeHtml(title) + '</h2><p>' + escapeHtml(message) + '</p></section>';
        refreshIcons();
    }

    async function loadInitiativeArtifact(descriptor, artifactId, expectedRequestId) {
        var reader = document.getElementById('initiative-artifact-reader');
        if (!reader) { return; }
        reader.innerHTML = '<div class="loading-state is-compact" role="status" aria-live="polite" aria-label="正在读取成果"><span></span><span></span></div>';
        try {
            var payload = await bridge.initiatives.readArtifact({
                projectId: state.projectId,
                revision: state.revision,
                providerId: descriptor.providerId,
                initiativeId: descriptor.id,
                sourceHash: descriptor.sourceHash,
                artifactId: artifactId
            });
            if (expectedRequestId !== state.currentInitiativeRequest || !reader.isConnected) { return; }
            var article = document.createElement('article');
            article.className = payload.mediaType === 'text/markdown' ? 'markdown-body' : 'raw-markdown';
            if (payload.mediaType === 'text/markdown') { article.appendChild(sanitizeMarkdown(payload.content)); }
            else { article.textContent = payload.content; }
            var section = document.createElement('section');
            section.className = 'initiative-artifact-reader';
            section.innerHTML = '<header><div><span>成果</span><h2>' + escapeHtml(payload.title) + '</h2><small>' + escapeHtml(payload.id) + '</small></div><button class="icon-button" type="button" data-action="close-initiative-artifact" aria-label="关闭成果" data-tooltip="关闭">' + icon('x', 16) + '</button></header>';
            section.appendChild(article);
            reader.replaceChildren(section);
            refreshIcons();
            requestAnimationFrame(function () { section.scrollIntoView({ block: 'start' }); });
        } catch (error) {
            if (expectedRequestId !== state.currentInitiativeRequest) { return; }
            renderInitiativeArtifactError('无法读取成果', error.message);
        }
    }

    function disposeInitiativeApp(restoreFocus) {
        var host = currentInitiativeAppHost;
        currentInitiativeAppHost = null;
        currentInitiativeAppKey = '';
        initiativeAppOperation += 1;
        if (!host) { return Promise.resolve(); }
        return Promise.resolve(host.dispose()).then(function () {
            if (restoreFocus) {
                var returnFocus = document.querySelector('.primary-nav [data-route="initiatives"]');
                if (returnFocus) { returnFocus.focus(); }
            }
        }).catch(function () {
            showToast('专用 Initiative App 清理失败');
        });
    }

    function embeddedAppKey(descriptor) {
        return descriptor.providerId + ':' + descriptor.id + ':' + state.revision + ':' + descriptor.sourceHash;
    }

    async function renderInitiativeAppError(host, container, descriptor, error) {
        if (host && currentInitiativeAppHost === host) {
            currentInitiativeAppHost = null;
            currentInitiativeAppKey = '';
            initiativeAppOperation += 1;
            try { await host.dispose(false); } catch (disposeError) { /* 保持原始 App 错误。 */ }
        }
        if (!container.isConnected || state.providerId !== descriptor.providerId || state.initiativeId !== descriptor.id) { return; }
        container.innerHTML = '<section class="error-state initiative-custom-error">' + icon('triangle-alert', 25) + '<h2>专用 Initiative App 运行失败</h2><p>' + escapeHtml(error && error.message ? error.message : '未知错误') + '</p><button class="secondary-command" type="button" data-action="retry-initiative-app">' + icon('rotate-ccw', 16) + '重试</button></section>';
        refreshIcons();
    }

    function renderEmbeddedInitiative(descriptor) {
        var appKey = embeddedAppKey(descriptor);
        if (currentInitiativeAppHost && currentInitiativeAppKey === appKey && currentInitiativeAppHost.root.isConnected) {
            currentInitiativeAppHost.setVisible(true);
            return;
        }
        page.innerHTML = '<section class="initiative-app-host-shell"><header><button class="back-button" type="button" data-route="initiatives">' + icon('arrow-left', 16) + '返回专项</button><span>' + escapeHtml(descriptor.title) + '</span></header><div class="initiative-app-boundary" id="initiative-app-boundary"><div class="loading-state is-compact" role="status" aria-live="polite" aria-label="正在载入独立 Initiative App"><span></span><span></span></div></div></section>';
        refreshIcons();
        var container = document.getElementById('initiative-app-boundary');
        var host = new window.OpenSpecInitiativeApps.EmbeddedInitiativeAppHost(container, bridge.initiativeApp, {
            onLocation: function (location) {
                if (currentInitiativeAppHost !== host || state.view !== 'initiative') { return; }
                state.appRoute = location || '';
                syncUrl(true);
            },
            onError: function (error) {
                renderInitiativeAppError(host, container, descriptor, error);
            },
            onReturnFocus: function () {
                var returnCommand = page.querySelector('.back-button[data-route="initiatives"]');
                if (returnCommand) { returnCommand.focus(); }
            }
        });
        var operation = initiativeAppOperation + 1;
        initiativeAppOperation = operation;
        currentInitiativeAppHost = host;
        currentInitiativeAppKey = appKey;
        host.mount({
            projectId: state.projectId,
            revision: state.revision,
            providerId: descriptor.providerId,
            initiativeId: descriptor.id,
            location: state.appRoute || ''
        }).then(function (mounted) {
            if (mounted && container.isConnected) {
                container.replaceChildren();
                host.focus().catch(function () { /* F6 仍可重新进入专项 App。 */ });
            }
        }).catch(function (error) {
            if (operation === initiativeAppOperation) {
                renderInitiativeAppError(host, container, descriptor, error);
            }
        });
    }

    function renderInitiativeDetail() {
        var descriptor = findInitiative(state.providerId, state.initiativeId);
        if (!descriptor) {
            renderError('Initiative 已不存在', '该专项、Provider 或深链接可能已失效。刷新不会影响官方 Change 索引。');
            return;
        }
        if (descriptor.presentation.mode !== 'embedded-app' && state.appRoute) {
            renderError('专项页面不存在', '深链接中的专用子路由不受支持。');
            return;
        }
        if (descriptor.presentation.mode === 'embedded-app') { renderEmbeddedInitiative(descriptor); }
        else { renderGenericInitiative(descriptor); }
    }

    function queryTerms() { return state.query.toLowerCase().trim().split(/\s+/).filter(Boolean); }

    function searchMatches(entry, terms) {
        var text = (entry.entityTitle + ' ' + entry.entityId + ' ' + entry.documentTitle + ' ' + entry.path + ' ' + entry.text).toLowerCase();
        return terms.every(function (term) { return text.indexOf(term) !== -1; });
    }

    function applySearchFilters(entries) {
        var terms = queryTerms();
        return entries.filter(function (entry) {
            if (!searchMatches(entry, terms)) { return false; }
            if (state.typeFilter !== 'all' && entry.entityType !== state.typeFilter) { return false; }
            if (state.statusFilter !== 'all' && entry.controlState !== state.statusFilter && entry.status !== state.statusFilter) { return false; }
            return true;
        });
    }

    function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function highlight(value) {
        var safe = escapeHtml(value);
        queryTerms().forEach(function (term) { safe = safe.replace(new RegExp('(' + escapeRegExp(escapeHtml(term)) + ')', 'ig'), '<mark>$1</mark>'); });
        return safe;
    }

    function searchSnippet(entry) {
        var text = entry.text || '';
        var lower = text.toLowerCase();
        var terms = queryTerms();
        var index = terms.length ? lower.indexOf(terms[0]) : 0;
        var start = Math.max(0, index - 70);
        var snippet = text.slice(start, start + 230).trim();
        return (start > 0 ? '…' : '') + snippet + (start + 230 < text.length ? '…' : '');
    }

    function searchResultRow(entry) {
        return '<button class="search-result-row" type="button" data-entity-type="' + entry.entityType + '" data-entity-id="' + escapeHtml(entry.entityId) + '" data-document-id="' + escapeHtml(entry.documentId) + '"><span><strong>' + highlight(entry.entityTitle) + '</strong><small>' + highlight(entry.path) + '</small><span>' + highlight(searchSnippet(entry)) + '</span></span><span class="type-chip">' + typeLabel(entry.entityType) + '</span>' + icon('arrow-up-right', 16) + '</button>';
    }

    function renderSearch() {
        var results = applySearchFilters(state.snapshot.searchIndex);
        page.innerHTML = '<header class="collection-header"><div><h1>搜索结果</h1><p>“' + escapeHtml(state.query) + '”</p></div><span class="collection-count">' + results.length + ' 个文档</span></header><div class="search-filters"><label><span>内容类型</span><select data-filter="type"><option value="all">全部类型</option><option value="active">活跃提案</option><option value="spec">正式规范</option><option value="archive">归档提案</option></select></label><label><span>运行状态</span><select data-filter="search-status"><option value="all">全部状态</option><option value="attention">需要处理</option><option value="in-progress">进行中</option><option value="ready-to-archive">待归档</option><option value="formal">正式规范</option></select></label></div><section class="search-results">' + (results.length ? results.slice(0, 100).map(searchResultRow).join('') : '<div class="empty-state">' + icon('search-x', 26) + '<h2>没有匹配内容</h2><p>调整关键字或筛选条件。</p></div>') + '</section>';
        page.querySelector('[data-filter="type"]').value = state.typeFilter;
        page.querySelector('[data-filter="search-status"]').value = state.statusFilter;
        refreshIcons();
    }

    function documentLabel(documentItem) {
        return { proposal: 'Proposal', design: 'Design', tasks: 'Tasks 原文', 'delta-spec': 'Spec', spec: 'Specification', document: 'Document' }[documentItem.kind] || documentItem.title;
    }

    function renderWarnings(warnings) {
        if (!warnings || !warnings.length) { return ''; }
        return '<aside class="warning-list"><strong>' + icon('triangle-alert', 15) + '需要处理</strong><ul>' + warnings.map(function (warning) { return '<li>' + escapeHtml(warning) + '</li>'; }).join('') + '</ul></aside>';
    }

    function taskRow(task, entity) {
        var current = entity.nextTask && task.id === entity.nextTask.id;
        var target = state.targetTask && task.id === state.targetTask;
        return '<div class="task-row' + (task.completed ? ' is-completed' : '') + (current ? ' is-current' : '') + (target ? ' is-target' : '') + '" id="task-' + escapeHtml(slugify(task.id)) + '" tabindex="-1"><span class="task-check">' + icon(task.completed ? 'check' : (current ? 'play' : 'circle'), 14) + '</span><span class="task-number">' + escapeHtml(task.id) + '</span><span class="task-title">' + escapeHtml(task.text) + '</span><span class="task-state">' + (task.completed ? '完成' : (current ? '当前' : '待办')) + '</span></div>';
    }

    function taskGroup(group, entity) {
        var items = entity.tasks.items.filter(function (item) { return item.groupId === group.id; });
        return '<section class="task-group"><header><span><b>' + escapeHtml(group.id) + '</b><strong>' + escapeHtml(group.title) + '</strong></span><span class="task-group-progress"><span>' + group.completed + ' / ' + group.total + '</span>' + progressHtml(group, group.title + ' 阶段进度') + '</span></header><div class="task-list">' + items.map(function (item) { return taskRow(item, entity); }).join('') + '</div></section>';
    }

    function contextDocumentButton(documentItem) {
        return '<button class="context-document" type="button" data-document-id="' + escapeHtml(documentItem.id) + '"><span>' + icon(documentItem.kind === 'delta-spec' ? 'file-check-2' : 'file-text', 16) + '<strong>' + escapeHtml(documentLabel(documentItem)) + '</strong></span>' + icon('arrow-up-right', 14) + '</button>';
    }

    function controlBadge(controlState) {
        return '<span class="control-badge is-' + controlState + '">' + icon(controlIcon(controlState), 14) + escapeHtml(controlLabel(controlState)) + '</span>';
    }

    function renderTaskDetail(entity) {
        var groups = entity.tasks.groups || [];
        var currentTask = entity.nextTask ? '<span class="task-code">' + escapeHtml(entity.nextTask.id) + '</span>' + escapeHtml(entity.nextTask.text) : escapeHtml(entity.nextAction);
        var locateAction = entity.nextTask ? '<button class="secondary-command locate-task-button" type="button" data-action="locate-current-task">' + icon('locate-fixed', 15) + '<span>定位任务</span></button>' : '';
        var warningContext = renderWarnings(entity.warnings);
        page.innerHTML = '<button class="back-button" type="button" data-route="overview">' + icon('arrow-left', 16) + '返回执行台</button><header class="change-detail-header"><div class="change-identity"><div class="change-state-line">' + controlBadge(entity.controlState) + '<span class="entity-id">' + escapeHtml(entity.id) + '</span>' + proposalCopyButton(entity.id, 'detail-copy-button') + '</div><h1>' + escapeHtml(entity.title) + '</h1></div><div class="detail-score"><strong>' + entity.tasks.percent + '%</strong><span>' + entity.tasks.completed + ' / ' + entity.tasks.total + ' tasks</span>' + progressHtml(entity.tasks, entity.title + ' 总体任务进度') + '</div></header><nav class="detail-tabs" aria-label="提案详情视图"><button type="button" data-panel="tasks" aria-current="page">' + icon('list-checks', 16) + '任务执行</button><button type="button" data-panel="documents">' + icon('files', 16) + '上下文文档</button></nav><section class="next-action-banner current-task-focus is-' + entity.controlState + '"><span class="next-action-icon">' + icon(entity.nextTask ? 'play' : controlIcon(entity.controlState), 19) + '</span><span><small>' + (entity.nextTask ? '当前任务' : '执行状态') + '</small><strong>' + currentTask + '</strong>' + (entity.nextTask ? '<em>' + escapeHtml(entity.nextTask.groupTitle) + ' · 剩余 ' + entity.remainingTasks + ' 项</em>' : '') + '</span>' + locateAction + '</section><div class="change-detail-layout"><main class="task-execution"><div class="panel-heading"><div><h2>任务阶段</h2><span>按 tasks.md 顺序</span></div><span class="task-total">' + entity.tasks.total + ' tasks</span></div>' + (groups.length ? groups.map(function (group) { return taskGroup(group, entity); }).join('') : '<div class="empty-state compact-task-state">' + icon('list-x', 24) + '<h2>还没有任务清单</h2><p>可继续查看已有规划文档和诊断信息。</p></div>') + '</main><aside class="context-rail"><details class="context-panel" open><summary>' + icon('panel-right', 15) + '<span>次级上下文</span><small>' + entity.documents.length + ' 个文档</small></summary><div class="context-panel-body">' + warningContext + '<section><h2>规划文档</h2><div class="context-document-list">' + entity.documents.map(contextDocumentButton).join('') + '</div></section><section class="source-panel"><span>状态来源</span><strong>' + (entity.statusSource === 'cli' ? 'OpenSpec CLI' : '文件推断') + '</strong><small>更新于 ' + formatDate(entity.modifiedAt) + '</small></section></div></details></aside></div>';
        refreshIcons();
        if (state.targetTask) {
            var target = document.getElementById('task-' + slugify(state.targetTask));
            if (target) {
                target.focus({ preventScroll: true });
                requestAnimationFrame(function () {
                    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
                });
            }
        }
    }

    function renderDocumentDetail(entity) {
        var backView = routeForCollection(entity.type);
        if (!state.documentId || !entity.documents.some(function (documentItem) { return documentItem.id === state.documentId; })) {
            state.documentId = entity.documents.length ? entity.documents[0].id : '';
            syncUrl(true);
        }
        var tabs = entity.documents.map(function (documentItem) { return '<button class="document-tab" type="button" role="tab" data-document-id="' + escapeHtml(documentItem.id) + '" aria-selected="' + (documentItem.id === state.documentId) + '">' + escapeHtml(documentLabel(documentItem)) + '</button>'; }).join('');
        var meta = entity.tasks ? controlBadge(entity.controlState) + '<span class="entity-id">' + entity.tasks.completed + ' / ' + entity.tasks.total + ' tasks</span>' : '<span class="type-chip">正式规范</span><span class="entity-id">' + entity.requirements + ' Requirements · ' + entity.scenarios + ' Scenarios</span>';
        var copyProposalAction = entity.type === 'spec' ? '' : proposalCopyButton(entity.id, 'detail-copy-button');
        page.innerHTML = '<button class="back-button" type="button" data-route="' + backView + '">' + icon('arrow-left', 16) + '返回' + (backView === 'overview' ? '执行台' : (backView === 'archives' ? '归档' : '规范')) + '</button><header class="document-detail-header"><div><span class="project-context">' + escapeHtml(typeLabel(entity.type)) + '</span><h1>' + escapeHtml(entity.title) + '</h1><div class="detail-meta">' + meta + '<span class="entity-id">' + escapeHtml(entity.id) + '</span>' + copyProposalAction + '</div></div></header>' + (entity.type === 'active' ? '<nav class="detail-tabs" aria-label="提案详情视图"><button type="button" data-panel="tasks">' + icon('list-checks', 16) + '任务执行</button><button type="button" data-panel="documents" aria-current="page">' + icon('files', 16) + '上下文文档</button></nav>' : '') + '<div class="document-bar"><div class="document-tabs" role="tablist" aria-label="文档类型">' + tabs + '</div><div class="document-actions"><div class="segmented-control" aria-label="文档视图"><button class="segment-button" type="button" data-mode="rendered" aria-pressed="' + (state.documentMode === 'rendered') + '">阅读</button><button class="segment-button" type="button" data-mode="raw" aria-pressed="' + (state.documentMode === 'raw') + '">原文</button></div><button class="icon-text-button" type="button" data-action="copy-path" data-tooltip="复制项目相对路径" aria-label="复制项目相对路径">' + icon('copy', 15) + '<span>复制路径</span></button></div></div><div id="document-container"><div class="loading-state" aria-label="正在读取文档"><span></span><span></span><span></span></div></div>';
        refreshIcons();
        if (state.documentId) { loadDocument(entity, state.documentId); }
    }

    function renderDetail() {
        var entity = findEntity(state.entityType, state.entityId);
        if (!entity) { renderError('内容已不存在', '该提案或规范可能已被移动、删除或归档。请刷新工作区后重试。'); return; }
        if (entity.type === 'active' && state.detailPanel === 'tasks') { renderTaskDetail(entity); }
        else { renderDocumentDetail(entity); }
    }

    function safeUrl(value, allowImage) {
        var url = String(value || '').trim();
        if (!url) { return ''; }
        if (/^#/i.test(url) || /^https:/i.test(url) || /^mailto:/i.test(url)) { return url; }
        if (allowImage && /^data:image\/(png|gif|jpeg|webp);base64,/i.test(url)) { return url; }
        return '';
    }

    function sanitizeMarkdown(markdown) {
        var html = window.marked.parse(markdown, { gfm: true, breaks: false });
        var template = document.createElement('template');
        var blockedSelector = 'script,style,iframe,object,embed,form,meta,link,base,svg,math';
        var usedSlugs = Object.create(null);
        template.innerHTML = html;
        template.content.querySelectorAll(blockedSelector).forEach(function (node) { node.replaceWith(document.createTextNode(node.outerHTML)); });
        template.content.querySelectorAll('*').forEach(function (element) {
            Array.from(element.attributes).forEach(function (attribute) {
                var name = attribute.name.toLowerCase();
                if (name.indexOf('on') === 0 || name === 'style' || name === 'srcdoc' || name === 'formaction' || name === 'id' || name === 'name') { element.removeAttribute(attribute.name); }
            });
            if (element.tagName === 'A') {
                var href = safeUrl(element.getAttribute('href'), false);
                if (href) { element.setAttribute('href', href); if (/^https?:/i.test(href)) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); } }
                else { element.removeAttribute('href'); }
            }
            if (element.tagName === 'IMG') {
                var src = safeUrl(element.getAttribute('src'), true);
                if (src) { element.setAttribute('src', src); } else { element.removeAttribute('src'); }
                if (!element.hasAttribute('alt')) { element.setAttribute('alt', ''); }
            }
            if (element.tagName === 'INPUT') {
                if ((element.getAttribute('type') || '').toLowerCase() !== 'checkbox') { element.replaceWith(document.createTextNode(element.outerHTML)); }
                else { Array.from(element.attributes).forEach(function (attribute) { if (!/^(type|checked|disabled)$/i.test(attribute.name)) { element.removeAttribute(attribute.name); } }); element.disabled = true; }
            }
        });
        template.content.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(function (heading) {
            var base = slugify(heading.textContent);
            var count = usedSlugs[base] || 0;
            usedSlugs[base] = count + 1;
            heading.id = count ? base + '-' + (count + 1) : base;
        });
        template.content.querySelectorAll('table').forEach(function (table) { var wrapper = document.createElement('div'); wrapper.className = 'table-scroll'; table.replaceWith(wrapper); wrapper.appendChild(table); });
        return template.content;
    }

    function tocHtml(container) {
        var headings = container.querySelectorAll('h2,h3,h4');
        if (!headings.length) { return ''; }
        return '<nav class="document-toc" aria-label="本页目录"><strong>本页目录</strong>' + Array.from(headings).map(function (heading) { return '<a href="#' + encodeURIComponent(heading.id) + '" data-level="' + heading.tagName.slice(1) + '">' + escapeHtml(heading.textContent) + '</a>'; }).join('') + '</nav>';
    }

    async function loadDocument(entity, documentId) {
        var requestId = state.currentDocumentRequest + 1;
        state.currentDocumentRequest = requestId;
        var container = document.getElementById('document-container');
        try {
            var payload = await bridge.documents.read({
                projectId: state.projectId,
                revision: state.revision,
                documentId: documentId
            });
            if (requestId !== state.currentDocumentRequest || !container) { return; }
            var article = document.createElement('article');
            article.className = state.documentMode === 'raw' ? 'raw-markdown' : 'markdown-body';
            if (state.documentMode === 'raw') { article.textContent = payload.markdown; }
            else { article.appendChild(sanitizeMarkdown(payload.markdown)); }
            var layout = document.createElement('div');
            layout.className = 'document-layout';
            var column = document.createElement('div');
            column.className = 'document-column';
            column.innerHTML = renderWarnings((entity.warnings || []).concat(payload.warnings || [])) + '<div class="document-meta">' + escapeHtml(payload.path) + ' · ' + formatDate(payload.modifiedAt) + '</div>';
            column.appendChild(article);
            layout.appendChild(column);
            if (state.documentMode === 'rendered') {
                var tocTemplate = document.createElement('template');
                tocTemplate.innerHTML = tocHtml(article);
                if (tocTemplate.content.firstElementChild) { layout.appendChild(tocTemplate.content.firstElementChild); }
            }
            resetInPageSearch(false);
            container.replaceChildren(layout);
            refreshIcons();
        } catch (error) {
            if (requestId !== state.currentDocumentRequest || !container) { return; }
            container.innerHTML = '<section class="error-state">' + icon('file-warning', 24) + '<h2>无法读取文档</h2><p>' + escapeHtml(error.message) + '</p><button class="text-button" type="button" data-action="refresh">刷新工作区</button></section>';
            refreshIcons();
        }
    }

    function render() {
        resetInPageSearch(false);
        if (!state.snapshot) { renderLoading(); return; }
        var selectedInitiative = state.view === 'initiative' ? findInitiative(state.providerId, state.initiativeId) : null;
        var expectedAppKey = selectedInitiative && selectedInitiative.presentation.mode === 'embedded-app' ? embeddedAppKey(selectedInitiative) : '';
        workspaceElement.classList.toggle('has-embedded-app', Boolean(expectedAppKey));
        page.classList.toggle('is-embedded-app', Boolean(expectedAppKey));
        if (currentInitiativeAppHost && currentInitiativeAppKey !== expectedAppKey) {
            disposeInitiativeApp(false);
        }
        updateNavigation();
        if (state.query) { state.view = 'search'; renderSearch(); }
        else if (state.view === 'overview') { renderOverview(); }
        else if (state.view === 'specs' || state.view === 'archives') { renderCollection(state.view); }
        else if (state.view === 'detail') { renderDetail(); }
        else if (state.view === 'initiatives') { renderInitiatives(); }
        else if (state.view === 'initiative') { renderInitiativeDetail(); }
        else { state.view = 'overview'; syncUrl(true); renderOverview(); }
    }

    function updateSidebar() {
        var lifecycle = state.snapshot.lifecycle;
        var inferred = lifecycle.source !== 'cli';
        sidebarStatus.innerHTML = '<div class="source-line ' + (inferred ? 'is-inferred' : '') + '"><span class="source-dot"></span><span>' + (inferred ? '文件推断' : 'OpenSpec CLI') + '</span></div><small>' + (inferred ? '只读扫描 · 状态可用' : '进行中 ' + state.snapshot.stats.inProgressChanges + ' · 待归档 ' + state.snapshot.stats.readyToArchive) + '</small>';
        if (inferred && lifecycle.diagnostic) { sidebarStatus.setAttribute('title', lifecycle.diagnostic); } else { sidebarStatus.removeAttribute('title'); }
    }

    async function loadWorkspace(refresh) {
        var requestId = state.currentWorkspaceRequest + 1;
        state.currentWorkspaceRequest = requestId;
        refreshButton.classList.add('is-refreshing');
        refreshButton.disabled = true;
        try {
            var payload = refresh ? await bridge.workspace.refresh() : await bridge.workspace.load();
            if (requestId !== state.currentWorkspaceRequest) { return; }
            state.projectId = payload.projectId;
            state.revision = payload.revision;
            state.snapshot = payload.snapshot;
            if (!payload.snapshot) {
                document.title = 'OpenSpec GUI';
                sidebarStatus.innerHTML = '<div class="source-line is-inferred"><span class="source-dot"></span><span>等待项目</span></div><small>只读模式</small>';
                renderEmptyWorkspace();
                return;
            }
            document.title = payload.snapshot.project.name + ' · OpenSpec GUI';
            updateSidebar();
            render();
            if (refresh) { showToast('执行状态已刷新'); }
        } catch (error) { renderError('无法载入 OpenSpec', error.message); }
        finally { refreshButton.classList.remove('is-refreshing'); refreshButton.disabled = false; refreshIcons(); }
    }

    async function checkForWorkspaceUpdates() {
        if (updateCheckRunning || document.hidden || !state.snapshot || !bridge.workspace.checkUpdates) { return; }
        updateCheckRunning = true;
        try {
            var result = await bridge.workspace.checkUpdates();
            if (result.changed) {
                state.currentDocumentRequest += 1;
                state.currentInitiativeRequest += 1;
                await loadWorkspace(false);
                showToast('项目内容已更新');
            }
        } catch (error) {
            showToast('自动刷新检查失败');
        } finally {
            updateCheckRunning = false;
        }
    }

    function applyTheme(value) {
        var theme = value || 'system';
        var resolved = theme;
        if (theme === 'system') { resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
        document.documentElement.setAttribute('data-resolved-theme', resolved);
        document.getElementById('app-shell').setAttribute('data-theme', theme);
        themeSelect.value = theme;
        /* 独立 Initiative App 保留自己的主题，不注入宿主样式。 */
    }

    async function copyDocumentPath() {
        if (!state.documentId) { return; }
        try { await bridge.clipboard.write(state.documentId); showToast('路径已复制'); }
        catch (error) { showToast('无法访问剪贴板'); }
    }

    function activeProject() {
        return state.registry.projects.find(function (project) { return project.id === state.registry.activeProjectId; }) || null;
    }

    function updateProjectSelector() {
        var active = activeProject();
        var options = state.registry.projects.map(function (project) {
            var current = project.id === state.registry.activeProjectId;
            var status = project.valid ? (current ? '当前项目' : '可切换') : '路径失效';
            var iconName = current ? 'check' : (project.valid ? 'folder' : 'triangle-alert');
            return '<button class="project-option' + (project.valid ? '' : ' is-invalid') + '" type="button" role="option" tabindex="-1" data-project-option="' + escapeHtml(project.id) + '" aria-selected="' + current + '"><span class="project-option-icon">' + icon(iconName, 15) + '</span><span><strong>' + escapeHtml(project.name) + '</strong><small>' + escapeHtml(status) + '</small></span></button>';
        }).join('');
        projectOptions.innerHTML = options || '<div class="project-menu-empty">尚未添加项目</div>';
        projectPickerName.textContent = active ? active.name : '尚未添加项目';
        projectPickerButton.disabled = !state.registry.projects.length;
        projectPickerButton.setAttribute('aria-label', active ? '切换项目，当前为 ' + active.name : '切换项目');
        projectHealth.textContent = active ? (active.valid ? 'OpenSpec 已连接' : '需要重新关联') : '等待选择';
        projectHealth.classList.toggle('is-invalid', Boolean(active && !active.valid));
        toolbarProjectName.textContent = active ? active.name : '选择项目';
        toolbarProjectButton.classList.toggle('is-invalid', Boolean(active && !active.valid));
        searchInput.disabled = !active || !active.valid;
        refreshButton.disabled = !active || !active.valid;
        refreshIcons();
    }

    function closeProjectMenu(returnFocus) {
        projectOptions.hidden = true;
        projectPickerButton.setAttribute('aria-expanded', 'false');
        projectPicker.classList.remove('is-open');
        if (currentInitiativeAppHost && !projectDialog.open) { currentInitiativeAppHost.setVisible(true); }
        if (returnFocus) { projectPickerButton.focus(); }
    }

    function openProjectMenu(preferLast) {
        if (projectPickerButton.disabled) { return; }
        if (currentInitiativeAppHost) { currentInitiativeAppHost.setVisible(false); }
        projectOptions.hidden = false;
        projectPickerButton.setAttribute('aria-expanded', 'true');
        projectPicker.classList.add('is-open');
        var options = Array.from(projectOptions.querySelectorAll('[data-project-option]'));
        var target = preferLast ? options[options.length - 1] : projectOptions.querySelector('[aria-selected="true"]');
        (target || options[0]).focus();
    }

    function moveProjectOptionFocus(current, direction) {
        var options = Array.from(projectOptions.querySelectorAll('[data-project-option]'));
        var index = options.indexOf(current);
        var next = Math.max(0, Math.min(options.length - 1, index + direction));
        if (options[next]) { options[next].focus(); }
    }

    async function selectProjectFromMenu(projectId) {
        closeProjectMenu(false);
        if (!projectId || projectId === state.registry.activeProjectId) {
            projectPickerButton.focus();
            return;
        }
        try {
            state.registry = await bridge.projects.select(projectId);
            updateProjectSelector();
            resetProjectView();
            await loadWorkspace(false);
            projectPickerButton.focus();
        } catch (error) {
            showToast(error.message);
            await refreshRegistry();
            projectDialog.showModal();
        }
    }

    async function restoreRouteProject() {
        if (!state.routeProjectId || state.routeProjectId === state.registry.activeProjectId) {
            return false;
        }
        var project = state.registry.projects.find(function (item) {
            return item.id === state.routeProjectId && item.valid;
        });
        if (!project) {
            return false;
        }
        state.registry = await bridge.projects.select(project.id);
        updateProjectSelector();
        await loadWorkspace(false);
        return true;
    }

    function renderProjectRegistry() {
        projectRegistryList.innerHTML = state.registry.projects.length ? state.registry.projects.map(function (project) {
            var current = project.id === state.registry.activeProjectId;
            var health = project.valid ? (current ? '当前项目' : '状态正常') : '路径失效';
            return '<div class="project-registry-row' + (project.valid ? '' : ' is-invalid') + (current ? ' is-current' : '') + '"><span class="project-registry-icon">' + icon(project.valid ? 'folder-git-2' : 'folder-x', 17) + '</span><span class="project-registry-copy"><span class="project-registry-title"><strong>' + escapeHtml(project.name) + '</strong><em class="project-health-badge">' + escapeHtml(health) + '</em></span><small>' + escapeHtml(project.rootPath) + '</small>' + (project.error ? '<em class="project-error">' + escapeHtml(project.error) + '</em>' : '') + '</span><span class="project-registry-actions">' + (project.valid && !current ? '<button class="secondary-command project-select-command" type="button" data-project-action="select" data-project-id="' + escapeHtml(project.id) + '">切换</button>' : '') + (!project.valid ? '<button class="icon-button" type="button" data-project-action="relink" data-project-id="' + escapeHtml(project.id) + '" aria-label="重新关联 ' + escapeHtml(project.name) + '" data-tooltip="重新关联">' + icon('folder-sync', 16) + '</button>' : '') + '<button class="icon-button is-danger" type="button" data-project-action="remove" data-project-id="' + escapeHtml(project.id) + '" aria-label="移除项目 ' + escapeHtml(project.name) + '" data-tooltip="移除">' + icon('trash-2', 16) + '</button></span></div>';
        }).join('') : '<div class="compact-empty">尚未添加项目</div>';
        refreshIcons();
    }

    async function refreshRegistry() {
        state.registry = await bridge.projects.list();
        updateProjectSelector();
        renderProjectRegistry();
        if (state.registry.diagnostic) {
            projectDialogStatus.textContent = state.registry.diagnostic;
        }
    }

    function resetProjectView() {
        disposeInitiativeApp(false);
        state.snapshot = null;
        state.projectId = null;
        state.entityType = '';
        state.entityId = '';
        state.documentId = '';
        state.providerId = '';
        state.initiativeId = '';
        state.appRoute = '';
        state.artifactId = '';
        state.changeScope = 'independent';
        state.query = '';
        state.view = 'overview';
        resetOverviewFilters();
        state.currentDocumentRequest += 1;
        state.currentInitiativeRequest += 1;
        searchInput.value = '';
        syncUrl(true);
        renderLoading();
    }

    async function addProjectPaths(paths) {
        projectDialogStatus.textContent = '正在验证项目…';
        var result = await bridge.projects.add(paths && paths.length ? { paths: paths } : {});
        if (result.canceled) {
            projectDialogStatus.textContent = '';
            return;
        }
        state.registry = result.registry;
        updateProjectSelector();
        renderProjectRegistry();
        resetProjectView();
        await loadWorkspace(false);
        projectDialogStatus.textContent = '项目已添加';
    }

    async function scanProjects() {
        projectDialogStatus.textContent = '正在扫描目录…';
        var result = await bridge.projects.scan({});
        if (result.canceled) {
            projectDialogStatus.textContent = '';
            return;
        }
        state.scanCandidates = result.candidates;
        scanResults.hidden = false;
        scanResultsCount.textContent = result.candidates.length + ' 个候选';
        scanCandidateList.innerHTML = result.candidates.length ? result.candidates.map(function (candidate, index) {
            return '<label class="scan-candidate"><input type="checkbox" value="' + index + '"' + (candidate.registered ? ' disabled' : ' checked') + '><span><strong>' + escapeHtml(candidate.name) + '</strong><small>' + escapeHtml(candidate.rootPath) + '</small></span><em>' + (candidate.registered ? '已添加' : '可导入') + '</em></label>';
        }).join('') : '<div class="compact-empty">没有发现 OpenSpec 项目</div>';
        projectDialogStatus.textContent = '扫描完成';
        refreshIcons();
    }

    async function runProjectAction(action, projectId) {
        try {
            if (action === 'add') {
                await addProjectPaths();
            } else if (action === 'scan') {
                await scanProjects();
            } else if (action === 'select') {
                state.registry = await bridge.projects.select(projectId);
                updateProjectSelector();
                renderProjectRegistry();
                resetProjectView();
                await loadWorkspace(false);
                projectDialog.close();
            } else if (action === 'remove') {
                var project = state.registry.projects.find(function (item) { return item.id === projectId; });
                if (project && window.confirm('从工作台移除“' + project.name + '”？\n\n项目文件不会被删除或修改。')) {
                    state.registry = await bridge.projects.remove(projectId);
                    updateProjectSelector();
                    renderProjectRegistry();
                    resetProjectView();
                    await loadWorkspace(false);
                }
            } else if (action === 'relink') {
                var relinked = await bridge.projects.relink(projectId);
                if (!relinked.canceled) {
                    state.registry = relinked.registry;
                    updateProjectSelector();
                    renderProjectRegistry();
                    resetProjectView();
                    await loadWorkspace(false);
                }
            } else if (action === 'close') {
                projectDialog.close();
            }
        } catch (error) {
            projectDialogStatus.textContent = error.message;
        }
    }

    document.addEventListener('click', function (event) {
        var projectOptionButton = event.target.closest('[data-project-option]');
        var projectActionButton = event.target.closest('[data-project-action]');
        var routeButton = event.target.closest('[data-route]');
        var initiativeButton = event.target.closest('[data-provider-id][data-initiative-id]');
        var initiativeArtifactButton = event.target.closest('[data-initiative-artifact]');
        var changeScopeButton = event.target.closest('[data-change-scope]');
        var entityButton = event.target.closest('[data-entity-type][data-entity-id]');
        var filterButtonElement = event.target.closest('[data-status-filter]');
        var panelButton = event.target.closest('[data-panel]');
        var documentButton = event.target.closest('[data-document-id]');
        var modeButton = event.target.closest('[data-mode]');
        var actionButton = event.target.closest('[data-action]');
        var inPageSearchAction = event.target.closest('[data-in-page-search-action]');
        if (!projectPicker.contains(event.target)) { closeProjectMenu(false); }
        if (inPageSearchAction) {
            var searchAction = inPageSearchAction.getAttribute('data-in-page-search-action');
            if (searchAction === 'previous') { showInPageSearchMatch(inPageSearchState.activeIndex - 1); }
            else if (searchAction === 'next') { showInPageSearchMatch(inPageSearchState.activeIndex + 1); }
            else if (searchAction === 'close') { resetInPageSearch(true); }
            return;
        }
        if (projectOptionButton) {
            selectProjectFromMenu(projectOptionButton.getAttribute('data-project-option'));
            return;
        }
        if (projectActionButton) {
            runProjectAction(projectActionButton.getAttribute('data-project-action'), projectActionButton.getAttribute('data-project-id') || '');
            return;
        }
        if (actionButton) {
            var action = actionButton.getAttribute('data-action');
            if (action === 'copy-proposal-name') { copyProposalName(actionButton.getAttribute('data-proposal-name') || '', actionButton); return; }
            if (action === 'refresh') { loadWorkspace(true); return; }
            if (action === 'copy-path') { copyDocumentPath(); return; }
            if (action === 'close-initiative-artifact') { state.artifactId = ''; syncUrl(false); renderInitiativeDetail(); return; }
            if (action === 'retry-initiative-app') { state.appRoute = ''; syncUrl(true); renderInitiativeDetail(); return; }
            if (action === 'locate-current-task') {
                var currentEntity = findEntity(state.entityType, state.entityId);
                if (currentEntity && currentEntity.nextTask) {
                    state.targetTask = currentEntity.nextTask.id;
                    syncUrl(true);
                    renderTaskDetail(currentEntity);
                }
                return;
            }
        }
        if (initiativeButton) { setInitiative(initiativeButton.getAttribute('data-provider-id'), initiativeButton.getAttribute('data-initiative-id'), ''); return; }
        if (initiativeArtifactButton && state.view === 'initiative') { state.artifactId = initiativeArtifactButton.getAttribute('data-initiative-artifact') || ''; syncUrl(false); renderInitiativeDetail(); return; }
        if (changeScopeButton && state.view === 'initiatives') { state.changeScope = changeScopeButton.getAttribute('data-change-scope') === 'all' ? 'all' : 'independent'; syncUrl(true); renderInitiatives(); changeScopeButton = page.querySelector('[data-change-scope="' + state.changeScope + '"]'); if (changeScopeButton) { changeScopeButton.focus(); } return; }
        if (routeButton) { setView(routeButton.getAttribute('data-route')); return; }
        if (filterButtonElement) {
            var filter = filterButtonElement.getAttribute('data-status-filter');
            var metricFilter = filterButtonElement.classList.contains('metric-block');
            state.view = 'overview';
            state.statusFilter = filter;
            syncUrl(true);
            renderOverview();
            var focusSelector = metricFilter || filter === 'all' ? '.metric-block[data-status-filter="' + filter + '"]' : '.status-segments [data-status-filter="' + filter + '"]';
            var refreshedFilter = page.querySelector(focusSelector);
            if (refreshedFilter) { refreshedFilter.focus(); }
            return;
        }
        if (entityButton) { setDetail(entityButton.getAttribute('data-entity-type'), entityButton.getAttribute('data-entity-id'), entityButton.getAttribute('data-document-id') || '', entityButton.getAttribute('data-task-id') || ''); return; }
        if (panelButton && state.view === 'detail') { state.detailPanel = panelButton.getAttribute('data-panel'); state.targetTask = ''; if (state.detailPanel === 'tasks') { state.documentId = ''; } syncUrl(false); renderDetail(); return; }
        if (documentButton && state.view === 'detail') { state.detailPanel = 'documents'; state.documentId = documentButton.getAttribute('data-document-id'); state.targetTask = ''; syncUrl(false); renderDetail(); return; }
        if (modeButton) { state.documentMode = modeButton.getAttribute('data-mode'); syncUrl(true); renderDetail(); return; }
    });

    page.addEventListener('change', function (event) {
        if (event.target.matches('[data-filter="type"]')) { state.typeFilter = event.target.value; syncUrl(true); renderSearch(); }
        if (event.target.matches('[data-filter="search-status"]')) { state.statusFilter = event.target.value; syncUrl(true); renderSearch(); }
    });

    searchInput.addEventListener('input', function () {
        state.query = searchInput.value.trim();
        if (!state.query && state.view === 'search') {
            state.view = 'overview';
            resetOverviewFilters();
        }
        syncUrl(true);
        render();
    });

    inPageSearchInput.addEventListener('input', function () {
        runInPageSearch(inPageSearchInput.value);
    });

    inPageSearchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            showInPageSearchMatch(inPageSearchState.activeIndex + (event.shiftKey ? -1 : 1));
        }
    });

    document.addEventListener('keydown', function (event) {
        if (!event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            if (!projectDialog.open) { openInPageSearch(); }
            return;
        }
        if (!inPageSearch.hidden && event.key === 'Escape') {
            event.preventDefault();
            resetInPageSearch(true);
            return;
        }
        var projectOption = event.target.closest('[data-project-option]');
        if (projectOption) {
            if (event.key === 'ArrowDown') { event.preventDefault(); moveProjectOptionFocus(projectOption, 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); moveProjectOptionFocus(projectOption, -1); }
            else if (event.key === 'Home') { event.preventDefault(); projectOptions.querySelector('[data-project-option]').focus(); }
            else if (event.key === 'End') { event.preventDefault(); Array.from(projectOptions.querySelectorAll('[data-project-option]')).pop().focus(); }
            else if (event.key === 'Escape') { event.preventDefault(); closeProjectMenu(true); }
            else if (event.key === 'Tab') { closeProjectMenu(false); }
            return;
        }
        if (event.key === 'F6' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && currentInitiativeAppHost) {
            event.preventDefault();
            currentInitiativeAppHost.focus().catch(function () { /* 保持宿主焦点。 */ });
            return;
        }
        if (event.key === '/' && document.activeElement !== searchInput && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { event.preventDefault(); searchInput.focus(); }
        if (event.key === 'Escape' && document.activeElement === searchInput) { searchInput.value = ''; state.query = ''; state.view = 'overview'; resetOverviewFilters(); syncUrl(true); render(); searchInput.blur(); }
    });

    refreshButton.addEventListener('click', function () { loadWorkspace(true); });
    async function openProjectDialog() {
        projectDialogStatus.textContent = '';
        scanResults.hidden = true;
        await refreshRegistry();
        if (currentInitiativeAppHost) { await currentInitiativeAppHost.setVisible(false); }
        projectDialog.showModal();
        refreshIcons();
    }
    projectManageButton.addEventListener('click', openProjectDialog);
    toolbarProjectButton.addEventListener('click', openProjectDialog);
    projectPickerButton.addEventListener('click', function () {
        if (projectPickerButton.getAttribute('aria-expanded') === 'true') { closeProjectMenu(true); }
        else { openProjectMenu(false); }
    });
    projectPickerButton.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openProjectMenu(event.key === 'ArrowUp');
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeProjectMenu(true);
        }
    });
    document.getElementById('import-candidates-button').addEventListener('click', async function () {
        var paths = Array.from(scanCandidateList.querySelectorAll('input:checked')).map(function (input) {
            return state.scanCandidates[Number(input.value)].rootPath;
        });
        if (!paths.length) {
            projectDialogStatus.textContent = '请选择至少一个候选项目';
            return;
        }
        await addProjectPaths(paths);
        scanResults.hidden = true;
    });
    projectDialog.addEventListener('click', function (event) {
        if (event.target === projectDialog) { projectDialog.close(); }
    });
    projectDialog.addEventListener('close', function () {
        if (currentInitiativeAppHost) { currentInitiativeAppHost.setVisible(true); }
    });
    themeSelect.addEventListener('change', function () { localStorage.setItem('openspec-workbench-theme', themeSelect.value); applyTheme(themeSelect.value); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (themeSelect.value === 'system') { applyTheme('system'); } });
    async function handleRouteChange() {
        readUrl();
        if (!await restoreRouteProject()) { render(); }
    }
    window.addEventListener('popstate', function () { handleRouteChange(); });
    window.addEventListener('hashchange', function () { handleRouteChange(); });
    window.addEventListener('focus', checkForWorkspaceUpdates);
    document.addEventListener('visibilitychange', function () {
        if (currentInitiativeAppHost) { currentInitiativeAppHost.setVisible(!document.hidden && !projectDialog.open && projectOptions.hidden); }
        if (!document.hidden) { checkForWorkspaceUpdates(); }
    });
    window.addEventListener('beforeunload', function () {
        if (updateTimer) { clearInterval(updateTimer); }
        state.currentInitiativeRequest += 1;
        disposeInitiativeApp(false);
    });

    async function initialize() {
        if (!bridge) {
            renderError('无法连接桌面进程', '预加载接口不可用，请重新启动应用。');
            return;
        }
        readUrl();
        applyTheme(localStorage.getItem('openspec-workbench-theme') || 'system');
        refreshIcons();
        await refreshRegistry();
        await restoreRouteProject();
        await loadWorkspace(false);
        bridge.workspace.onChanged(function () { loadWorkspace(false); });
        updateTimer = setInterval(checkForWorkspaceUpdates, 30000);
    }

    initialize().catch(function (error) {
        renderError('无法启动 OpenSpec GUI', error.message);
    });
}());
