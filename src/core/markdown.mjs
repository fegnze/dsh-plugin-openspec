// Ported from OpenSpecGUI/src/core/markdown.js; SHA-256 0f5362972e1d68e32b94da83b43eda66f650d3f606a3e9e2dbf9385c8d0fd518.
// Original algorithms retained; DSH adapter supplies all filesystem capabilities.
'use strict';

/**
 * 移除常见 Markdown 行内标记，生成适合索引和标题展示的文本。
 * @param {string} value 原始文本
 * @returns {string} 清理后的文本
 */
function cleanInline(value) {
    return String(value || '')
        .replace(/<!--([\s\S]*?)-->/g, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~]/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 生成与浏览器端一致的稳定章节锚点。
 * @param {string} value 标题文本
 * @returns {string} 锚点
 */
function slugify(value) {
    var slug = cleanInline(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-');

    return slug || 'section';
}

/**
 * 解析 OpenSpec Markdown 的结构信息。
 * @param {string} markdown Markdown 正文
 * @returns {object} 标题、任务和检索元数据
 */
function parseMarkdown(markdown) {
    var normalized = String(markdown || '').replace(/\r\n?/g, '\n');
    var lines = normalized.split('\n');
    var headings = [];
    var requirements = [];
    var scenarios = [];
    var warnings = [];
    var completedTasks = 0;
    var totalTasks = 0;
    var taskItems = [];
    var taskGroups = [];
    var currentTaskGroup = null;
    var inFence = false;
    var fenceMarker = '';
    var summary = '';
    var plainLines = [];

    lines.forEach(function (line, index) {
        var fenceMatch = line.match(/^\s*(```+|~~~+)/);
        var headingMatch;
        var taskMatch;
        var text;

        if (fenceMatch) {
            if (!inFence) {
                inFence = true;
                fenceMarker = fenceMatch[1].charAt(0);
            } else if (fenceMatch[1].charAt(0) === fenceMarker) {
                inFence = false;
                fenceMarker = '';
            }
            return;
        }

        if (inFence) {
            plainLines.push(line);
            return;
        }

        headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (headingMatch) {
            text = cleanInline(headingMatch[2]);
            headings.push({
                level: headingMatch[1].length,
                text: text,
                anchor: slugify(text),
                line: index + 1
            });
            if (/^Requirement:\s*/i.test(text)) {
                requirements.push(text.replace(/^Requirement:\s*/i, ''));
            }
            if (/^Scenario:\s*/i.test(text)) {
                scenarios.push(text.replace(/^Scenario:\s*/i, ''));
            }
            if (headingMatch[1].length === 2) {
                var groupMatch = text.match(/^(\d+)\.?\s*(.*)$/);
                currentTaskGroup = {
                    id: groupMatch ? groupMatch[1] : slugify(text),
                    title: groupMatch && groupMatch[2] ? groupMatch[2] : text,
                    completed: 0,
                    total: 0,
                    percent: 0
                };
                taskGroups.push(currentTaskGroup);
            }
            plainLines.push(text);
            return;
        }

        taskMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);
        if (taskMatch) {
            var completed = taskMatch[1].toLowerCase() === 'x';
            var taskText = cleanInline(taskMatch[2]);
            var taskIdMatch = taskText.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
            var group = currentTaskGroup;
            if (!group) {
                group = { id: 'ungrouped', title: '未分组', completed: 0, total: 0, percent: 0 };
                taskGroups.push(group);
                currentTaskGroup = group;
            }
            totalTasks += 1;
            group.total += 1;
            if (completed) {
                completedTasks += 1;
                group.completed += 1;
            }
            taskItems.push({
                id: taskIdMatch ? taskIdMatch[1] : String(totalTasks),
                text: taskIdMatch ? taskIdMatch[2] : taskText,
                completed: completed,
                groupId: group.id,
                groupTitle: group.title,
                line: index + 1
            });
        }

        text = cleanInline(line.replace(/^\s*[-*+]\s+/, ''));
        if (text) {
            plainLines.push(text);
            if (!summary && !/^\[?[A-Z]+\]?\s*:/.test(text)) {
                summary = text;
            }
        }
    });

    if (inFence) {
        warnings.push('存在未闭合的代码块');
    }
    taskGroups = taskGroups.filter(function (group) { return group.total > 0; });
    taskGroups.forEach(function (group) {
        group.percent = group.total ? Math.round(group.completed / group.total * 100) : 0;
    });

    return {
        title: headings.length ? headings[0].text : '',
        summary: summary,
        headings: headings,
        requirements: requirements,
        scenarios: scenarios,
        tasks: {
            completed: completedTasks,
            total: totalTasks,
            percent: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0,
            items: taskItems,
            groups: taskGroups
        },
        warnings: warnings,
        searchText: plainLines.join(' ').slice(0, 160000)
    };
}

export default {
    cleanInline: cleanInline,
    parseMarkdown: parseMarkdown,
    slugify: slugify
};
