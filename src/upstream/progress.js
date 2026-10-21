(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.OpenSpecProgress = api;
    }
}(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    function segmentFillPercents(percent, segmentCount) {
        var count = Math.max(1, Number(segmentCount) || 10);
        var normalized = Math.max(0, Math.min(100, Number(percent) || 0));
        var valuePerSegment = 100 / count;
        var result = [];
        var index;

        for (index = 0; index < count; index += 1) {
            result.push(Math.max(0, Math.min(100, (normalized - index * valuePerSegment) / valuePerSegment * 100)));
        }
        return result;
    }

    return { segmentFillPercents: segmentFillPercents };
}));
