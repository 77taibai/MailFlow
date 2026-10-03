---
feature: mobile-responsive
status: delivered
updated: 2026-10-03
branch: feature/mobile-responsive
commits: 00cfbec..f741df0
---

# 窄屏（手机端）UI 适配

## Report

**What was built** — 为前端加入 ≤768px 窄屏适配：新增 `composables/useIsMobile.js`（`matchMedia('(max-width:767.98px)')` 的响应式断点，`onBeforeUnmount` 移除监听），供只能用属性切换的场景使用。邮件台 `MailView` 抽出无状态 `MailSidebar` 组件：桌面仍为 250px `el-aside`，窄屏改为汉堡触发的 `el-drawer`（80% 宽，选择后自动关闭），主区在列表与阅读窗之间两步切换并带返回按钮。邮箱管理 `MailboxesView` 桌面保留原表格，窄屏改为两级菜单（一级 name+email+状态，二级详情行 + 测试/同步/编辑/删除）。`ComposeDialog`/`MailboxFormDialog` 窄屏 `fullscreen` 且标签置顶，服务器行的输入/端口/SSL 纵向堆叠，嵌套文件夹表改为行式开关列表。登录卡片改用 `min(380px, calc(100vw - 32px))`，阅读窗/列表、Quill 编辑器做窄屏收敛，全局加入 `box-sizing:border-box` 与去横向滚动。桌面端三栏结构、表格与弹窗宽度不变。

**Verification** — 全部命令在 worktree 内执行，均观察实际输出：
- `npm ci`（Frontend，lockfile）— PASS
- `npm run build`（改动前基线 1741 modules / 改动后 1744 modules）— PASS（chunk >500kB 警告 PRE-EXISTING）
- 无头 Playwright（375×812，拦截 `/api` 返回假数据）：`/login` 卡片 x=16 w=343、docScrollWidth=375；`/` 无 aside、列表满宽 375、阅读窗隐藏、顶栏“合并账户/撰写”；抽屉宽 300、body padding=0、侧栏填满 300×812、选后关闭；选邮箱→文件夹 收件箱/已发送、点信→阅读窗满宽+返回、返回→列表；`/mailboxes` 表格 0、两级列表/详情与四个操作按钮；编辑弹窗 `is-fullscreen` 375×812、label-top、host-row 三项堆叠；撰写弹窗 fullscreen、Quill 341×160 — 均 PASS，全程无横向溢出
- 桌面回归（1280×800）：aside 250 + list 400 + 阅读窗可见、无移动顶栏/返回；`/mailboxes` 为表格、无移动列表；编辑弹窗 640px 非 fullscreen；docScrollWidth=1280 — PASS
- 复审后修复复验：单封删除后阅读窗关闭回到列表；侧栏项高 40–41.7px；缩放到桌面时抽屉自动关闭 — PASS
- 临时 dev 服务器已关闭、端口释放、无残留进程；日志/状态文件/截图已清理

**Journey log** —
- 被 teleport 的 `el-drawer` 无法被父组件 scoped 样式命中：`.mail-drawer :deep(.el-drawer__body){padding:0}` 不生效（scope 属性落在 overlay 而非 `.el-drawer`），抽屉内容仍被默认 20px padding 内缩。修正：在 `MailView.vue` 增加非 scoped 全局块 `.mail-drawer .el-drawer__body{padding:0}`。
- 仅靠 CSS 无法控制 `el-dialog` 的 `fullscreen` 与 `label-position`，因此必须引入 JS 断点 composable；断点值 767.98px 与 CSS `@media` 严格对齐，避免边界不一致。
- 全局 `*{box-sizing:border-box}` 会改变 Element Plus 组件（默认 content-box）在桌面的细微尺寸；这是设计取舍，登录卡片总宽由 410→380px，不影响功能。
- 阅读窗单封删除原只 `emit('refresh')`，在窄屏“列表/阅读互斥”下会停留在已删邮件；改为新增 `deleted` 事件，由 `MailView` 清空 `currentMail` 并整体刷新。
- Playwright MCP 的相对路径截图/输出落在主工作区（非 worktree），需显式清理以免污染仓库。

## [S1] Problem

当前前端为桌面布局，未做任何响应式处理，在手机窄屏（< 768px）下不可用：

- 邮件台 `MailView.vue` 是固定三栏：侧栏 250px + 列表 360–460px + 阅读窗；窄屏下右侧阅读窗被挤出视口，无法查看邮件。
- 邮箱管理页 `MailboxesView.vue` 的 `el-table` 各列固定宽度合计约 1200px，且操作列 `fixed="right"`（300px），窄屏下表格横向溢出、固定列遮盖内容。
- `ComposeDialog`（760px）、`MailboxFormDialog`（640px）为固定宽度弹窗，手机上溢出屏幕；表单 `label-width` 占用 70/110px，`host-row`（输入+端口+SSL）默认不换行。
- `LoginView` 登录卡片固定 380px，窄于 380px 的视口会横向溢出。
- `RichTextEditor` 工具栏分组、`MailReader` 元信息、`MailList` 角标等缺少窄屏收敛，存在换行错位/拥挤。
- 全局无任何媒体查询。

目标：在 ≤768px 视口下让登录、邮件台、邮箱管理、撰写/编辑弹窗全部可正常操作，同时不改变桌面端现有外观与行为。

## [S2] Design

### 断点与检测（useIsMobile）

- 断点统一为 **768px**：窄屏条件 `(max-width: 767.98px)`。
- 新增 `Frontend/src/composables/useIsMobile.js`，返回响应式 `ref<boolean>`：
  - 用 `window.matchMedia(query)` 初始化，`addEventListener('change')` 监听，`onBeforeUnmount` 移除监听。
  - 供“只能用属性切换”的场景使用：`el-dialog` 的 `fullscreen`、`label-position`，以及邮件台/邮箱管理页的结构切换。
- 需纯样式能解决的地方仍用 `@media (max-width: 767.98px)`，不引入 JS 分支。

### 邮件台 MailView（抽屉侧栏 + 列表/阅读两步切换）

- 提取侧栏内容为 `Frontend/src/components/MailSidebar.vue`（品牌、邮箱列表含“合并账户”、文件夹列表、底部“邮箱管理/退出”），props：`mailboxes`、`mergedSelected`、`mergedUnread`、`selectedMailboxId`、`folders`、`selectedFolderId`；events：`select-merged`、`select-mailbox`、`select-folder`、`logout`。
- 桌面（`!isMobile`）：保持 `<el-aside class="sidebar">` + `<mail-sidebar>`，外观与行为不变。
- 窄屏（`isMobile`）：不渲染 `el-aside`，改由 `<el-drawer v-model="sidebarOpen" direction="ltr" size="80%" :with-header="false">` 包裹 `<mail-sidebar>`；侧栏内任一点击后关闭抽屉。
- 主区两步切换：
  - 列表 `el-main.list-pane`：`v-show="!isMobile || !currentMail"`；顶部新增窄屏专用 `.mobile-bar`：汉堡按钮（打开抽屉）+ 当前邮箱/文件夹标题 + 撰写按钮。
  - 阅读 `el-main.reader-pane`：`v-show="!isMobile || currentMail"`；窄屏时顶部显示返回按钮，点击后 `currentMail = null` 回到列表。
  - `openMail` 成功后置 `currentMail`；批量删除/移动已会将 `currentMail = null`，自动回到列表。
- 列表工具栏：允许换行（`flex-wrap: wrap`）；分页在窄屏下保留（`layout="prev, pager, next"` 已较紧凑），撰写按钮保留。
- 侧栏 title/未读角标、点击区域沿用现有样式，保证触控高度 ≥ 40px。

### 邮箱管理 MailboxesView（两级菜单）

- 桌面：保留现有 `el-table` 与列宽/`fixed="right"`，不变。
- 窄屏：`el-table` 不渲染，改为两级：
  - 一级列表：每个邮箱一行，主行显示 `name`（加粗），下方浅色小字显示 `email`；行可点击；保留状态色点（正常/错误）。
  - 二级详情：点击进入，标题为邮箱名 + 返回按钮；分行显示：地址、服务商、认证、状态（含 lastError tooltip）、未读/总数、最近同步、同步间隔、钉钉推送与关键词；操作按钮按行排列：测试 / 同步 / 编辑 / 删除。
  - `selectedMailbox`（ref）承载二级选中项；返回时置空。
- 页头操作区（Gmail/Outlook 授权、添加自定义邮箱、返回邮件）：窄屏下允许换行，按钮保持可点。

### 弹窗

- `ComposeDialog`：`el-dialog` 增加 `:fullscreen="isMobile"`（fullscreen 时 width 被忽略，保留桌面 760px）；表单 `:label-position="isMobile ? 'top' : 'right'"`，`:label-width="isMobile ? 'auto' : '70px'"`。
- `MailboxFormDialog`：`el-dialog` 增加 `:fullscreen="isMobile"`；表单同上（窄屏 `label-position="top"`）；`.host-row` 窄屏改为换行（`flex-wrap: wrap`，输入占满一行）；`.dialog-scroll` 的 `max-height` 在 fullscreen 下改为更宽裕的 `calc(100vh - 200px)`。
- `MailboxFormDialog` 内嵌“文件夹同步”`el-table`：窄屏改为行式列表（文件夹路径 + 开关），避免固定列宽溢出。
- `RichTextEditor`：`el-dialog` fullscreen 下编辑器高度自适应，窄屏媒体查询把 `.ql-editor` 的 `min-height` 降到 ~160px、工具栏分组去掉右边框以避免换行错位。

### 其它页面

- `LoginView`：`.login-card` 宽度改为 `min(380px, calc(100vw - 32px))`，窄屏不溢出。
- `MailReader`：窄屏减小 `.reader-header` 内边距；`.subject-line`/`.meta` 允许换行；附件标签可换行（已支持）。
- `MailList`：窄屏减小 `.mb-tag` 最大宽度，保证主题可见。
- `App.vue` 全局：`box-sizing: border-box`、`overflow-x: hidden`，避免横向滚动条。

### 约束

- 不改变任何 API、数据模型、路由。
- 桌面（≥768px）视觉与交互保持现状。
- 不引入新依赖；仅使用 Vue 3 + Element Plus（含 `el-drawer`）。
- 所有新增/修改组件使用 `<script setup>`，沿用项目现有风格，不添加注释。

## [S3] Out of Scope

- 平板横屏（768–1024px）的三栏重排（本设计以 768px 为界，以上按桌面处理）。
- 深色模式、字号缩放、横竖屏专门优化。
- 移动端手势（滑动切换、下拉刷新）。
- 邮件正文 iframe 内部的响应式（正文由发件方 HTML 决定，iframe 已等宽）。
- 更换 UI 框架或引入 CSS 预处理器。

## Tasks

- [x] T1: 新增 `composables/useIsMobile.js`；`App.vue` 增加全局 box-sizing/去横向滚动 — acceptance: 新增文件可被 import；`npm run build` 通过 (covers: S2)
- [x] T2: 提取 `MailSidebar.vue` 并改造 `MailView.vue`：抽屉侧栏、列表/阅读两步切换、返回按钮、移动顶栏、工具栏换行 — acceptance: 窄屏可打开/关闭抽屉；点邮件进入阅读窗、点返回回列表；桌面三栏不变 (covers: S2; depends: T1)
- [x] T3: `MailboxesView.vue` 窄屏两级菜单（一级列表 name+email、二级详情+操作按钮、返回） — acceptance: 窄屏下不出现横向溢出表格；可进入/返回详情；测试/同步/编辑/删除可用 (covers: S2; depends: T1)
- [x] T4: `ComposeDialog`/`MailboxFormDialog` fullscreen 与 label-position 自适应、host-row 换行、文件夹同步窄屏行式列表；`RichTextEditor` 窄屏高度/工具栏样式 — acceptance: 窄屏弹窗铺满且表单不溢出；host-row 纵向堆叠；文件夹开关可操作 (covers: S2; depends: T1)
- [x] T5: `LoginView` 卡片流式、`MailReader`/`MailList` 窄屏微调 — acceptance: 320–414px 视口登录卡片不溢出；阅读窗头部不拥挤 (covers: S2)
- [x] T6: 验证：`npm run build`；窄屏（375×812）逐页与弹窗检查、桌面（1280×800）回归 — acceptance: build PASS；窄屏各页无横向溢出、核心流程可操作；桌面无回归 (covers: S2; depends: T2,T3,T4,T5)
