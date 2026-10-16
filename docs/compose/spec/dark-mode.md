---
feature: dark-mode
status: delivered
updated: 2026-10-16
branch: feature/dark-mode
commits: 9c744c1..ea44768
---

# 暗色模式适配

## Report

**What was built** — 前端全面适配暗色模式。引入 Element Plus 官方暗色变量（`element-plus/theme-chalk/dark/css-vars.css`，挂在 `html.dark` 下并带 `color-scheme: dark`），新增单例组合式函数 `composables/useTheme.js` 提供三态主题（跟随系统 / 浅色 / 深色）：初值读 `localStorage['mailflow_theme']`，`watchEffect` 把解析结果同步到 `<html>` 的 `dark` 类，`matchMedia` 监听系统偏好，`setMode` 持久化。`index.html` 内联脚本在应用加载前按同一规则预设 `dark` 类以消除首屏闪烁；`App.vue` 挂载主题副作用（保证登录/分享/OIDC 等无侧栏页面也跟随系统），并定义 `--mf-brand-text`、`--mf-login-bg` 两个自定义变量。`MailSidebar.vue` 底部新增三态切换下拉，桌面 `el-aside` 与移动 `el-drawer` 共用同一组件，一处实现全端覆盖。

**What changed** — 将 10 个组件/视图里约 64 处硬编码颜色替换为 Element Plus 语义变量（`--el-border-color-*` / `--el-text-color-*` / `--el-fill-color-*` / `--el-color-primary-light-8|9` / `--el-bg-color` 等），一套变量自动适配两种主题；品牌深蓝与登录渐变保留为 `--mf-*` 变量分主题取值。Quill 编辑器（snow 主题自带 `#444` 图标 / `#ccc` 边框 / `#fff` 面板等硬编码色）在 `html.dark` 下追加覆盖，保证深色工具栏图标可见、下拉面板为暗色。默认（无 `type`）按钮在深色下背景取 `--el-fill-color-blank`（= `--el-bg-color` = `#141414`），与页面底色相同、只剩细边框、缺乏层次；在 `html.dark` 下为默认按钮（排除 `primary/success/warning/danger/info` 与 `text/link`，保留 `--small/--large` 尺寸修饰符）设 `--el-button-bg-color` 为 `--el-fill-color-light`（#262727），并给出 hover/active 反馈。邮件正文 iframe 按设计保持原样。浅色下外观与改动前一致。

**Verification** — 全部命令在 worktree 内执行并读取实际输出：
- `npm ci`（Frontend，lockfile）— PASS
- `npm run build` — PASS（改动前基线 1741 modules；chunk >500kB 警告 PRE-EXISTING）
- 无头 Playwright（Vite dev server + 拦截 `/api` 返回假数据）：浅色基线（body #fff/#303133、无 `dark` 类）；持久化 `dark` → `html.dark`、body #141414/#e5eaf3、品牌 #c8d6ea；`emulateMedia` 深/浅系统偏好均正确跟随；防闪烁（`<html>` 在 readystatechange/DOMContentLoaded/首帧 rAF 均已是 `dark`）；切换下拉三项且持久化到 localStorage、按钮标签随状态更新 — 均 PASS
- 深色逐页检查：邮件台（侧栏 #262727、边框 #414243、激活项 #1d3043）、邮箱管理表格、撰写（Quill 工具栏 #1d1d1d + 图标 stroke #cfd3dc + 下拉面板 #1d1e1f）、阅读窗、分享页（无侧栏仍跟随系统）— 均 PASS，全路由扫描无异常亮色块（仅 Quill 调色板色块为预期值）
- 浅色回归：品牌 #2b4c6f、边框 #e4e7ed/#ebeef5、激活 #d9ecff、文字 #303133/#606266/#c0c4cc、Quill #fafafa/#444 — PASS
- 移动端（375×812）：抽屉内深色侧栏 + 主题切换可用、无横向溢出 — PASS
- 复审修复复验：侧栏底部三控件在「跟随系统」最长标签下不再溢出（scrollWidth=clientWidth=249，桌面与抽屉均单行）— PASS
- 人工评审后调整：深色默认按钮背景 #262727（vs 页面 #141414）、hover #303030、彩色/text 按钮不变；浅色下默认按钮仍为 #fff（无回归）— PASS
- 临时 dev server 已关闭、端口释放、无残留进程；截图/日志/`.playwright-mcp` 已清理

**Journey log** —
- 首版 `useTheme.js` 用 `apply()` 直接读 `computed`，`resolved` 变化不会触发重新应用；改为模块级 `watchEffect` 跟踪 `resolved`，任一输入（mode / 系统偏好）变化都会同步 `<html>`。
- `el-dropdown` 菜单被 teleport 到 `body`，`scoped` 的 `:deep()` 命中不到，需在 `MailSidebar.vue` 加非 scoped 全局块（`.theme-dropdown .el-dropdown-menu__item.active`）标注当前项——与 `mobile-responsive` 中 `el-drawer` 的同类问题一致。
- Quill snow 主题的工具栏图标 stroke 为硬编码 `#444`、面板为 `#fff`，深色下不可见/刺眼，必须显式覆盖；仅靠引入 Element Plus 暗色变量无法覆盖第三方 CSS。
- 复审发现侧栏 footer 加入第三个控件后在 250px 宽下溢出 3px（「跟随系统」标签最长）；收紧内边距/字号并加 `flex-wrap` 兜底后复验通过。
- 部分 Element Plus 变量与原硬编码色存在肉眼难辨的近似差（侧栏底 `#f7f8fa`→`#f5f7fa`、列表行分隔 `#f0f0f0`→`#ebeef5`、加载药丸半透明→不透明）；已记录在 S2 映射表中，属可接受取舍。
- 人工评审指出深色下默认按钮与页面底色同为 `#141414`、无层次；根因是 Element Plus 默认按钮背景取 `--el-fill-color-blank`。修正时首版选择器用 `:not([class*="el-button--"])` 误伤了 `--small/--large` 尺寸修饰符，导致工具栏小按钮未生效；改为显式排除五个 type 修饰符后覆盖正确。

## [S1] Problem

前端目前只有浅色主题：

- `main.js` 只引入 `element-plus/dist/index.css`（浅色变量），未引入官方暗色变量 `element-plus/theme-chalk/dark/css-vars.css`，`html.dark` 类切换完全不可用。
- 10 个组件/视图的 scoped 样式里散落约 64 处硬编码颜色（`#e4e7ed` 边框、`#909399`/`#303133`/`#606266`/`#c0c4cc` 文字、`#f7f8fa` 侧栏底、`#ecf5ff`/`#d9ecff` 选中底、`#fff` 页面底、`#2b4c6f` 品牌字、登录页深色渐变、加载条半透明白药丸等），这些颜色不随主题变化，深色下会出现白底黑字、亮块、看不清等问题。
- 无任何主题状态、持久化或切换入口；用户无法选择主题，也不跟随操作系统。

目标：在**不改变浅色外观**的前提下，为整个前端加入可跟随系统、也可手动三态覆盖的暗色模式，覆盖登录、邮件台、邮箱管理、撰写、分享、OIDC 回调等全部页面与 Element Plus 组件。

## [S2] Design

### 主题机制

- 引入 Element Plus 官方暗色变量：`main.js` 在 `import 'element-plus/dist/index.css'` 之后追加 `import 'element-plus/theme-chalk/dark/css-vars.css'`。该文件把暗色变量挂在 `html.dark` 下（含 `color-scheme: dark`，让原生滚动条/表单控件一并变暗）。
- 通过切换 `<html>` 的 `dark` 类来切换主题，不引入 `@vueuse/core`、不引入新依赖。
- 新增 `Frontend/src/composables/useTheme.js`，导出单例 `useTheme()`，返回：
  - `mode`：`ref<'system' | 'light' | 'dark'>`，初值取 `localStorage['mailflow_theme']`，非法值回退 `'system'`。
  - `resolved`：`computed<'light' | 'dark'>`，`mode==='system'` 时由 `matchMedia('(prefers-color-scheme: dark)')` 决定，否则等于 `mode`。
  - `setMode(next)`：写入 `mode` 并持久化到 `localStorage`。
  - `themeIcon` / `themeLabel`：`computed`，`system→Monitor/跟随系统`、`light→Sunny/浅色`、`dark→Moon/深色`。
- 副作用（模块级只装一次，幂等）：`watchEffect` 把 `resolved` 同步到 `document.documentElement.classList.toggle('dark', resolved==='dark')`；用 `matchMedia('change')` 监听系统主题变化（仅在 `mode==='system'` 时影响 `resolved`）。单例保证桌面侧栏与移动抽屉两个 `MailSidebar` 实例状态一致。
- 防首屏闪烁（FOUC）：`Frontend/index.html` 的 `<head>` 内加一段内联脚本，在样式/应用加载前读取 `localStorage['mailflow_theme']`，若解析结果为 dark 则立即给 `<html>` 加 `dark` 类；读取失败静默忽略。
- `App.vue` 在 `setup` 中调用一次 `useTheme()`，保证在无侧栏的页面（登录页、分享页、OIDC 回调）也能实时跟随系统主题。

### 颜色变量化

把组件内硬编码颜色替换为 Element Plus 语义变量，一套变量自动适配两种主题。映射（浅色值 → 变量 → 暗色值）：

| 现硬编码 | 浅色值 | 替换为 | 暗色值 |
|---|---|---|---|
| 边框 `#e4e7ed` | #e4e7ed | `--el-border-color-light` | #414243 |
| 边框 `#ebeef5` | #ebeef5 | `--el-border-color-lighter` | #363637 |
| 边框 `#f0f0f0` | #f0f0f0 | `--el-border-color-lighter` | #363637 |
| 边框 `#f2f6fc` | #f2f6fc | `--el-border-color-extra-light` | #2b2b2c |
| 文字 `#303133` | #303133 | `--el-text-color-primary` | #e5eaf3 |
| 文字 `#606266` | #606266 | `--el-text-color-regular` | #cfd3dc |
| 文字 `#909399` | #909399 | `--el-text-color-secondary` | #a3a6ad |
| 文字 `#c0c4cc` | #c0c4cc | `--el-text-color-disabled` | #6c6e72 |
| 悬停底 `#f5f7fa` | #f5f7fa | `--el-fill-color-light` | #262727 |
| 侧栏底 `#f7f8fa` | #f7f8fa | `--el-fill-color-light` | #262727 |
| 选中底 `#ecf5ff` | #ecf5ff | `--el-color-primary-light-9` | #18222b |
| 激活底 `#d9ecff` | #d9ecff | `--el-color-primary-light-8` | #1d3043 |
| 主色 `#409eff` | #409eff | `--el-color-primary` | #409eff |
| 主色浅 `#79bbff` | #79bbff | `--el-color-primary-light-3` | #3375b9 |
| 页面/卡片底 `#fff` | #fff | `--el-bg-color` | #141414 |
| 工具栏底 `#fafafa` | #fafafa | `--el-fill-color-lighter` | #1d1d1d |
| 警示色 `#e6a23c` | #e6a23c | `--el-color-warning` | #e6a23c |
| 药丸底 `rgba(255,255,255,.95)` | — | `--el-bg-color-overlay` | #1d1e1f |
| 药丸阴影 `rgba(0,0,0,.15)` | — | `--el-box-shadow-light` | 暗色阴影 |
| 进度槽 `rgba(64,158,255,.18)` | — | `color-mix(in srgb, var(--el-color-primary) 18%, transparent)` | 同左 |

- 两处无法用 Element Plus 变量表达、需要保留品牌/背景语义的，定义自定义变量于 `App.vue` 全局样式：
  - `--mf-brand-text`：品牌深蓝字。`:root` 为 `#2b4c6f`（用于侧栏品牌、二级标题、登录标题、列表激活标题、分享页标题），`html.dark` 为 `#c8d6ea`。
  - `--mf-login-bg`：登录页渐变。`:root` 为 `linear-gradient(135deg, #1f2d3d 0%, #2b4c6f 100%)`，`html.dark` 为 `linear-gradient(135deg, #0d1117 0%, #16202e 100%)`。
- `App.vue` 全局把 `html, body, #app` 的背景设为 `var(--el-bg-color)`、文字色设为 `var(--el-text-color-primary)`：浅色下 `--el-bg-color` 为 `#fff`（与现状一致），暗色下为 `#141414`。
- 默认按钮（无 `type`）的层次修正：Element Plus 默认按钮背景取 `--el-fill-color-blank`（暗色 = `#141414`，与 `--el-bg-color` 相同），深色下与页面融为一体、只剩细边框。在 `html.dark` 下用选择器 `.el-button:not(.el-button--primary):not(.el-button--success):not(.el-button--warning):not(.el-button--danger):not(.el-button--info):not(.el-button--text):not(.is-text):not(.is-link)` 覆盖 `--el-button-bg-color` 为 `--el-fill-color-light`（#262727）、`--el-button-border-color` 为 `--el-border-color`，并给出 hover（`--el-fill-color` #303030）/active（`--el-fill-color-dark`）反馈。显式排除五个 type 修饰符而非用 `[class*="el-button--"]`，以免误伤 `--small/--large` 尺寸修饰符。
- `OidcCallbackView` 中 `:color="#409eff"` 是图标组件属性，主色在两种主题下相同，保留不变。

### 切换控件

- 位置：`MailSidebar.vue` 底部 `.sidebar-footer`（桌面 `el-aside` 与移动 `el-drawer` 共用同一组件，一处实现全端覆盖）。
- 形式：`el-dropdown`（`trigger="click"`）包一个 `el-button text`，按钮显示当前 `themeIcon` 与 `themeLabel`；下拉含三项 `跟随系统 / 浅色 / 深色`，点击项调用 `setMode(command)`。当前模式项通过 `:class="{ active }"` 或 `el-dropdown-item` 的选中样式标注。
- 登录页/分享页无侧栏，不提供控件，但仍跟随系统主题（由 `App.vue` 的 `useTheme()` 保证）。

### 约束

- 不改变任何 API、数据模型、路由、后端。
- 浅色（`mode` 解析为 light 或系统为 light）下的视觉与现状保持一致。
- 不引入新依赖；仅使用 Vue 3 + Element Plus（含官方 dark css-vars）。
- 所有新增/修改使用 `<script setup>`，沿用现有风格。

## [S3] Out of Scope

- 邮件正文 iframe 内部的暗色适配：正文为发件人 HTML，在 `sandbox` iframe 中渲染，保持原样不改（已与用户确认）。
- 每页头部/全局浮层的切换入口、主题色自定义（accent 自定义）、高对比度/护眼等其它配色方案。
- 后端或邮件内容渲染逻辑的任何改动。
- Element Plus 之外的第三方（Quill 内容区）精细暗色微调，仅做背景/边框变量化。

## Tasks

- [x] T1: 新增 `composables/useTheme.js`（三态、持久化、`matchMedia` 监听、`html.dark` 同步）；`main.js` 引入 dark css-vars；`App.vue` 调用 `useTheme()` 并设置全局底色/文字色与 `--mf-*` 变量；`index.html` 加防闪烁内联脚本 — acceptance: `npm run build` 通过；`mode=dark` 或系统深色时 `<html>` 带 `dark` 类且首屏无浅色闪烁 (covers: S2)
- [x] T2: 变量化 10 个组件/视图的硬编码颜色（MailView/MailList/MailSidebar/MailReader/MailboxFormDialog/RichTextEditor/LoginView/ShareView/OidcCallbackView/GlobalLoadingBar）— acceptance: 这些文件不再残留上述硬编码色（自定义变量定义与图标属性除外）；`npm run build` 通过 (covers: S2)
- [x] T3: `MailSidebar.vue` 底部加入三态主题切换下拉，桌面与移动抽屉均可用 — acceptance: 切换「跟随系统/浅色/深色」即时生效并写入 `localStorage`，刷新后保持 (covers: S2; depends: T1)
- [x] T4: 验证：`npm run build`；浏览器逐页检查（登录/邮件台/邮箱管理/撰写/分享）浅色回归与深色观感、系统跟随、持久化 — acceptance: build PASS；深色下各页无白底黑字/亮块；浅色无回归 (covers: S2; depends: T2,T3)
