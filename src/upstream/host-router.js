(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.OpenSpecHostRouter = api;
    }
}(typeof window === 'undefined' ? null : window, function () {
    'use strict';

    var VIEWS = ['overview', 'specs', 'archives', 'detail', 'search', 'initiatives', 'initiative'];

    function safeValue(params, name, maximum) {
        var value = params.get(name) || '';
        return value.length <= maximum ? value : '';
    }

    function parse(hash) {
        var params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
        var requestedView = safeValue(params, 'view', 32) || 'overview';
        var legacyChanges = requestedView === 'changes';
        var view = legacyChanges ? 'overview' : requestedView;
        if (VIEWS.indexOf(view) === -1) {
            view = 'overview';
        }
        return {
            view: view,
            legacyChanges: legacyChanges,
            entityType: safeValue(params, 'type', 32),
            entityId: safeValue(params, 'id', 180),
            documentId: safeValue(params, 'doc', 512),
            detailPanel: params.get('panel') === 'documents' || params.get('doc') ? 'documents' : 'tasks',
            targetTask: safeValue(params, 'task', 160),
            documentMode: params.get('mode') === 'raw' ? 'raw' : 'rendered',
            query: safeValue(params, 'q', 500),
            typeFilter: safeValue(params, 'filter', 80) || 'all',
            statusFilter: safeValue(params, 'status', 80) || 'all',
            providerId: safeValue(params, 'provider', 80),
            routeProjectId: safeValue(params, 'project', 160),
            initiativeId: safeValue(params, 'initiative', 80),
            appRoute: safeValue(params, 'route', 2048),
            artifactId: safeValue(params, 'artifact', 160)
            , changeScope: params.get('scope') === 'all' ? 'all' : 'independent'
        };
    }

    function serialize(state) {
        var params = new URLSearchParams();
        params.set('view', state.view);
        if (state.entityType) { params.set('type', state.entityType); }
        if (state.entityId) { params.set('id', state.entityId); }
        if (state.documentId) { params.set('doc', state.documentId); }
        if (state.detailPanel !== 'tasks') { params.set('panel', state.detailPanel); }
        if (state.targetTask) { params.set('task', state.targetTask); }
        if (state.documentMode !== 'rendered') { params.set('mode', state.documentMode); }
        if (state.query) { params.set('q', state.query); }
        if (state.typeFilter !== 'all') { params.set('filter', state.typeFilter); }
        if (state.statusFilter !== 'all') { params.set('status', state.statusFilter); }
        if (state.providerId) { params.set('provider', state.providerId); }
        if (state.projectId || state.routeProjectId) { params.set('project', state.projectId || state.routeProjectId); }
        if (state.initiativeId) { params.set('initiative', state.initiativeId); }
        if (state.appRoute) { params.set('route', state.appRoute); }
        if (state.artifactId) { params.set('artifact', state.artifactId); }
        if (state.changeScope === 'all') { params.set('scope', 'all'); }
        return params.toString();
    }

    return { parse: parse, serialize: serialize, views: VIEWS.slice() };
}));
