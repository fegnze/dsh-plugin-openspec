# dsh-plugin-openspec

[English](<../README.md>) | 简体中文

npm 包名：`@fegnze/dsh-plugin-openspec`。无 scope 的 `dsh-openspec` 属于其他维护者，不是本移植版。保留既有会话／侧栏 ID `dsh-openspec`；旧本地 bundle 应替换，不能同时启用两种包身份。

OpenSpecGUI 的 DSH Desktop 移植版。保留原 HTML/CSS/JavaScript 渲染器、进度组件、路由、Markdown 解析及工作区业务模型，不再另造文档浏览器。会话「对话／轨迹／上下文」旁和右侧边栏新标签页均有 **SPEC** 入口。

## 功能

- 使用紧凑顶栏代替插件左栏，不重复显示项目选择块与专项返回标题栏；每个专项在顶栏拥有独立入口，与执行台／规范／归档通过分隔线区分；点击直达专项，无需经过目录页。无专项时隐藏整组入口，不在专项视图混入项目级提案表。
- 原版执行台：活跃／进行中／待归档／需要处理指标，以及按状态分组的提案卡片。
- 原版任务阶段、当前任务定位、上下文文档、规范／归档集合、全文搜索、类型／状态筛选与页内查找。
- 原版 Marked 阅读器、目录及源码模式；增加严格 HTML 白名单，禁止脚本、远程图片、注入控件与伪造操作属性。
- 自动关联接收会话所属工作区，回退会话原始项目目录；不维护第二项目注册表或独立项目选择器。
- 两个入口使用同一渲染器并按容器宽度适配；保留原内容与交互，颜色接入 DSH 主题变量。主视图挂载时经官方 composer 插槽隐藏本会话普通输入框，退出后释放覆盖；待处理审批／问答保留原输入交互，右侧面板不隐藏输入框。主视图不预留输入框高度。主容器使用主题背景、16px 圆角和外侧留白，与宿主面板风格一致；侧栏使用较小留白。导航与工具区固定，普通正文在独立内容区滚动，专项 HTML 在沙箱内滚动；窄面板导航横向滚动。

## 安装与生命周期

要求 DSH Desktop 0.2.1-rc.2、Node 22+。通过官方 Plugin Manager 的 `install_bundle` 在 desktop profile 安装目录。不启动独立 HTTP 服务、Electron 进程或项目可执行文件。

Host 变更须经 Plugin Manager 重载；Client 变更刷新现用 DSH 页面。原渲染器挂载于 React 所有的 shadow root，DOM 查询、事件、库全局变量、路由和计时器均限制在组件内，卸载时清理，不修改 DSH 的 URL、标题和全局 DOM。

## 宿主差异

- 项目管理由 DSH 负责，不暴露原独立桌面的添加／扫描／移除／修复项目操作。
- 状态采用原版文件推断兜底逻辑，故意不自动执行项目的 `node_modules/.bin/openspec`。
- 手动刷新，不引入第二套后台轮询。
- 已自省的 DSH 文件系统不提供修改时间，界面显示时间未知，不伪造原文件时间。
- 通用专项支持原 YAML／JSON 清单、owned／related 变更和有界文本成果。原 `initiative-app.json` 声明的 HTML 应用在现有专项内容区用不透明来源的 `sandbox="allow-scripts"` iframe 打开，支持页内样式、脚本与锚点。CSP 阻止外部请求，不授予 DSH API、凭据、父页面 DOM、弹窗、下载、表单或宿主动作。声明的 webRoot 内本地经典 JS／CSS 经同一会话文件系统读取后内联（最多 64 个文件、每个 512 KiB）；缺失或外部引用明确报错。不提供图片文件、模块脚本、CSS import／URL 与 Electron 宿主动作。打开时校验清单、入口正文与资源哈希；内容变更后先刷新再打开。
- 保持只读，不提供任务写回、自动归档或 AI 实施。

界面读取经官方 Typert Gateway 的 `openspec/read` RPC，保留接收 Agent 解析、会话授权与取消，不再调用 Commands API，因此自动读取不追加命令记录。主视图仅在选中时挂载，侧栏按官方可见状态启动／取消读取；初始化项目列表与工作区共享一次读取，显式刷新重新读取。保留可选的人工 `/openspec-view` 命令，仅主动执行时按 DSH 正常规则留痕；由于命令输出会被原文写进会话转录，该命令改为返回**给人看的文本报告**而非 JSON：项目总量、进行中变更及任务进度、规格的需求／场景计数与文档路径、最近归档、待办任务与告警，并给出查看单篇全文的 `{"action":"document","path":"openspec/..."}` 调用。报告上限 32 KiB，超出时从尾部裁行；`document` 正文截断处显式标注 `…（已截断：原文 N 字符）`。经 Typert 的界面读取仍返回不设上限的 JSON，且不落盘。不删除已有历史记录。只允许 canonical 项目及 OpenSpec 双重根内路径。上限：500 个文档候选、单文件 512 KiB、总量 8 MiB、深度 12；部分读取附带告警。

## 来源与许可

`src/upstream` 保留原渲染器和第三方通告，`provenance.json` 记录源文件 SHA-256。`scripts/import-renderer.mjs` 仅供维护者明确导入，不在安装时执行。`scripts/build-client.mjs` 应用 DSH 适配；`src/client-adapter.js` 和 `src/renderer-scope.js` 管理宿主接缝。生成 Client 入库，因为插件运行时不执行构建。

OpenSpecGUI 由 fegnze 与 OpenSpec GUI Contributors 以 MIT 授权，完整上游许可保留在 `src/upstream/LICENSE`；`provenance.json` 记录来源仓库、许可提交与 SHA-256。DSH 集成同样采用 MIT。源码与 npm 发布使用本仓库经审查的发布工作流。不复制来源未核实的美术。保留 Marked、Lucide 完整许可证；实际 Marked 文件头为 16.4.2，上游通告中的 16.2.1 已过时。

## 开发验证

```sh
npm run build
npm test
node --check src/client.js
npm pack --dry-run --json --ignore-scripts
```

沙箱真实浏览器回归需显式启用，复用已有 Playwright／浏览器，不下载依赖：

```sh
DSH_TEST_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
DSH_TEST_CHROME_BIN=/absolute/path/to/chrome \
node --test test/sandbox-browser.test.mjs
```

未设置 `DSH_TEST_PLAYWRIGHT_MODULE` 时，浏览器用例明确跳过。Playwright 已有浏览器时可省略 `DSH_TEST_CHROME_BIN`。将 `DSH_TEST_INITIATIVE_SAMPLE_DIR` 指向只读的 DH dashboard 目录（含 `index.html`、`styles.css`），可额外验证原始 W1、目录和来源链接，不复制或修改业务文件。通用用例覆盖键盘激活、编码／缺失／异常片段、嵌套 details、宿主 URL 不变及 sandbox／CSP 隔离。页内链接在 iframe 内处理，不触发 URL 导航；目标及其祖先 details 自动展开，并滚动、聚焦到目标。

遵循工作区 dsh-plugin-devkit 的 `guide → inspect → validate → commit-plan → commit`。验收安装后的现用 DSH URL；测试 fixture 与槽位注册均不能替代真实界面验收。
