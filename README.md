# dsh-plugin-openspec

English | [简体中文](<docs/zh.md>)

npm: `@fegnze/dsh-plugin-openspec`. The unscoped npm package `dsh-openspec` belongs to another maintainer and is not this port. Existing conversation/sidebar IDs remain `dsh-openspec`; replace an old local bundle rather than enabling both identities.

OpenSpecGUI port for DSH Desktop. The original HTML/CSS/JavaScript renderer, progress component, router, Markdown parser and workspace business model are retained, not recreated as a document browser. Open **SPEC** beside Chat / Trajectory / Context or from the right sidebar's new-tab guide.

## Features

- Compact top navigation replaces the plugin sidebar, without a redundant project picker or initiative back/title row. Each initiative has a direct entry, separated from execution/spec/archive navigation by a divider. No directory-page detour or project-wide proposal table; the group is hidden when empty.
- Original execution board: active / in-progress / ready-to-archive / attention metrics and grouped proposal cards.
- Original task phases, current-task navigation, contextual documents, specification/archive collections, full-text search, type/status filters and in-page search.
- Original Marked-based document reader, table of contents and source mode; stronger HTML allowlisting prevents scripts, remote images, injected controls and delegated data attributes.
- Automatic binding to the receiving session's registered workspace, falling back to its original project directory. No duplicate project registry or project picker.
- The same renderer adapts to the available pane width. Original content and interactions are kept; colors inherit DSH theme tokens. While the main view is mounted, the official composer slot hides only that session's ordinary composer; disposal releases the override. Pending approvals/questions retain their shipped interaction, and the right panel does not hide the composer. No composer-height gap is reserved. A theme-token surface with a 16px radius and outer gutters matches the host panels; the sidebar uses smaller gutters. Navigation/tools stay fixed above a bounded content scroller; embedded apps scroll inside their sandbox. Narrow-pane navigation scrolls horizontally.

## Install and lifecycle

Requires DSH Desktop 0.2.1-rc.2 and Node 22+. Install this directory through the official Plugin Manager `install_bundle` action in the desktop profile. No separate HTTP server, Electron process or project executable is started.

Host changes require reloading the plugin through Plugin Manager; refresh the existing DSH page for Client changes. The original renderer lives inside a React-owned shadow root: DOM queries, event listeners, library globals, route history and timers are local and disposed on unmount. There is no mutation of DSH's URL/title or global document.

## Host differences

- Project management belongs to DSH; the original desktop project's add/scan/remove/relink UI is not exposed.
- Status uses the original file-inferred fallback. Automatic execution of a project's `node_modules/.bin/openspec` is deliberately disabled.
- Refresh is explicit; no second background polling loop is added.
- DSH's inspected filesystem does not expose modification times. The UI says time unknown rather than fabricating original file timestamps.
- Generic initiatives support original YAML/JSON manifests, owned/related changes and bounded text artifacts. Original `initiative-app.json` HTML apps open inside the existing initiative content pane using an opaque-origin `sandbox="allow-scripts"` iframe. Inline styles/scripts and local fragment navigation work. CSP blocks external requests and the frame receives no DSH API, credentials, parent DOM, popups, downloads, forms or host actions. Local classic JS and CSS files under the declared webRoot are read through the same session filesystem and inlined (64 files, 512 KiB/file); missing/external references fail explicitly. Image files, module scripts, CSS imports/URLs and Electron host actions are not served. Source hashes bind opening to the discovered manifest, entry and assets; refresh before reopening changed content.
- Read-only: no task writeback, archive mutation or AI implementation.

UI reads use the official Typert Gateway `openspec/read` RPC with receiving-Agent lookup, session authorization and cancellation, not the Commands API; automatic reads do not append command records. The main view is mounted only when selected; sidebar IO follows its official visibility state. Initial project listing and workspace load share one read; explicit refresh reads again. The optional human `/openspec-view` command remains available and, only when deliberately executed, still uses DSH's normal command logging, so everything it returns is persisted verbatim into the session transcript. The command therefore answers with a human-readable text report, not JSON: project totals, in-progress changes with task progress, specs with requirement/scenario counts and document paths, recent archives, pending tasks and warnings, plus the exact `{"action":"document","path":"openspec/..."}` call for a single document. The report is capped at 32 KiB by dropping trailing lines, and a `document` reply is clipped with an explicit `…（已截断：原文 N 字符）` marker. The Typert UI path returns the unbounded JSON payload and is not persisted. Existing history records are not removed. Only canonical paths inside both the project and OpenSpec roots are accepted. Bounds: 500 document candidates, 512 KiB per file, 8 MiB aggregate and depth 12. Partial scans expose warnings.

## Source provenance and licensing

The checked-in upstream renderer and notices are under `src/upstream`; `provenance.json` records SHA-256 hashes. `scripts/import-renderer.mjs` is an explicit maintainer import, not an install hook. `scripts/build-client.mjs` applies the documented DSH adaptations; `src/client-adapter.js` and `src/renderer-scope.js` own host integration. The generated Client is checked in because the plugin runtime does not run a build.

OpenSpecGUI is MIT-licensed by fegnze and OpenSpec GUI Contributors. The complete upstream grant is retained in `src/upstream/LICENSE`; `provenance.json` records its source repository, license commit and SHA-256. The DSH integration is also MIT-licensed. Source and npm releases use this repository's reviewed publishing workflow. Unverified artwork is not copied. Marked and Lucide notices and complete license texts are retained with their sources; the actual vendored Marked header is 16.4.2 (the upstream notice's 16.2.1 is stale).

## Development

```sh
npm run build
npm test
node --check src/client.js
npm pack --dry-run --json --ignore-scripts
```

The real-browser sandbox regression is opt-in and uses an existing Playwright/browser installation (no downloads):

```sh
DSH_TEST_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
DSH_TEST_CHROME_BIN=/absolute/path/to/chrome \
node --test test/sandbox-browser.test.mjs
```

Without `DSH_TEST_PLAYWRIGHT_MODULE`, browser cases are explicitly skipped. `DSH_TEST_CHROME_BIN` is optional when Playwright already has a browser. Set `DSH_TEST_INITIATIVE_SAMPLE_DIR` to the read-only DH dashboard directory (containing `index.html` and `styles.css`) to additionally exercise the original W1, directory and source links; no business files are copied or modified. The generic cases cover keyboard activation, encoded/missing/malformed fragments, nested details, unchanged host URL and sandbox/CSP isolation. Fragment links are handled inside the frame without URL navigation; targets and enclosing details are opened, scrolled to and focused.

Use workspace dsh-plugin-devkit `guide → inspect → validate → commit-plan → commit`. Test the installed existing DSH URL; isolated fixtures and slot registration do not prove real GUI acceptance.
