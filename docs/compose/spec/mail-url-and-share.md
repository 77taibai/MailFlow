---
feature: mail-url-and-share
status: delivered
updated: 2026-10-04
branch: main
commits: a4acfe6 (工作区未提交，待人工验证)
---

# 邮件地址化浏览与免登录分享

## Report

**What was built** — 邮件浏览地址化：主路由改为 `/mail/:id?`（`/` 重定向到 `/mail`），点击列表邮件 `push` 到 `/mail/<id>`，关闭回 `/mail`，直达/刷新保持当前邮件；合并账户下打开邮件不改变侧栏选中。免登录分享：登录后 `POST /api/mails/:id/share` 用独立密钥签发 HS256 分享令牌（`typ:'share'`、`mid`、可选 `exp`），公开 `GET /api/share/:token` 与附件下载仅返回该封邮件的裁剪字段，页面只读、打开即把该邮件标记为已读、无任何设置入口。新增 `SHARE_SECRET`/`SHARE_TTL_HOURS` 配置，README 与 `.env.example` 写明密钥生成、推导公式与可复现的手工生成片段。会话与分享两侧密钥隔离且 `typ` 互斥、算法均钉死 HS256，互相不能冒用。

**Verification** — 均在 `main` 工作区实测：
- 后端 `node --check` 全部文件 — PASS；`npm run build`（Frontend，1750 modules）— PASS。
- 临时服务（`scripts/start-agent-server.ps1`，绑 `127.0.0.1:3100`）E2E 22/22 PASS：匿名分享 GET 200 且字段裁剪（无 mailboxId/folderId/uid/messageId）；分享令牌当 Bearer 访问 `/api/mailboxes` → 401；会话 JWT 当分享路径令牌 → 404；跨邮件附件 → 404；`/share/:token`、`/mail/:id` SPA 均返回 HTML。
- 无头浏览器：分享页只读渲染（无回复/删除/已读按钮、无侧栏），无效令牌显示「分享链接无效或已过期」且不跳登录。
- 按文档的推导公式独立复现出可用分享令牌（验证文档可复现性）。验证后已停止服务、释放端口、删除状态文件与日志。
- 复审子代理结论：无 CRITICAL；已修复其中 3 项非关键项（分享页 token 变化不刷新、邮件加载竞态、非法 id 残留 URL）。

**Journey log** —
- PowerShell 5.1 读取「无 BOM 的 UTF-8」`.ps1` 时按系统 ANSI(GBK) 解码，中文注释会破坏语法解析；封装脚本改为纯 ASCII 后正常。
- `/mail/:id?` 用**同一路由记录**（可选参数）而非常量多记录，`/mail` ↔ `/mail/<id>` 切换时组件实例复用，左侧列表上下文不丢；若拆成不同记录会重挂载。
- 前后端同源的 SPA 回退只排除 `/api`，因此 `/mail/:id`、`/share/:token` 无需任何后端页面路由即可直接访问。
- 分享与会话隔离用「独立 scrypt salt 派生不同密钥」+「两侧显式校验 `typ`」双重保险，并显式 `algorithms:['HS256']`；不能只依赖密钥不同，否则误配同一密钥时仍可能互通。
- 本地验证要绑 `127.0.0.1`，为此新增可选的 `HOST` 绑定项（默认空=所有网卡，不改变生产行为）。
- 打开分享页标记已读：钉钉 actionCard 的「阅读邮件」按钮指向的正是 `/share/:token`，因此把标记已读放在公开的 `GET /api/share/:token` 里，任何分享链接打开都会同步本地与 IMAP 已读状态。

## [S1] Problem

当前邮件阅读状态只存在前端内存里：点击一封邮件不会改变地址栏，刷新后当前打开的邮件丢失，也无法把某一封邮件做成链接直接打开。

同时，产品需要「把某一封邮件分享给别人看」的能力：收件人无需登录即可打开该邮件内容页，但**只能看这一封**，看不到其它邮件，也不能改动任何设置。分享不能成为登录后门——拿到分享链接的人不得冒充当已登录用户，登录校验必须与分享令牌互不相通。

## [S2] Design

### 邮件地址化浏览

- 路由：把原 `path: '/'` 改为 `path: '/mail/:id?'`（`id` 可省略），并将其作为邮件台主路由；`'/'` 永久重定向到 `'/mail'`。保持同一路由记录，`/mail` ↔ `/mail/:id` 切换时组件实例复用，左侧列表上下文（合并账户 / 邮箱 / 文件夹 / 翻页）不丢失。后端 SPA 回退对 `/mail/:id` 这类非 `/api` GET 已生效，无需改动。
- 打开邮件：列表点击 `openMail(mail)` 只做 `router.push({ name: 'mail', params: { id: String(mail.id) } })`；`MailView` 监听 `route.params.id`，变化时按 id 拉取 `GET /api/mails/:id` 详情并展示（仍按现有逻辑标记已读）。
- 关闭邮件：移动端返回按钮 / 无 id 时，`router.push({ name: 'mail' })`（即 `/mail`），`id` 消失即清空阅读窗。
- 刷新 / 直达：访问 `/mail/<id>` 时列表按默认（合并账户收件箱）加载，阅读窗展示该邮件；**不**根据邮件反查并切换左侧邮箱。
- 合并账户规则（硬约束）：在合并账户下点击邮件，`mergedSelected` 与 `selectedMailboxId` 保持不变，侧栏不跳到该邮件所属邮箱；`/mail/:id` 的 id 只用于阅读窗，绝不作为侧栏选中依据。切换邮箱/文件夹/合并账户时清空阅读窗（`currentMail = null`）并把地址从 `/mail/:id` 收回 `/mail`。
- 地址栏只承载邮件 id。翻页、文件夹、邮箱上下文不写入 URL（新增邮件会让分页与列表变化，写入会失真）；这些状态在同一次会话内由组件内存保留，刷新回到默认合并账户 + 指定邮件，满足「刷新不丢当前邮件」。

### 免登录分享

- 密钥配置：新增 `.env` 项
  - `SHARE_SECRET`：分享 token 的签名密钥，可选。未设置时从 `APP_SECRET` 用独立 salt 派生兜底。
  - `SHARE_TTL_HOURS`：分享链接有效期（小时），默认 `168`；设为 `0` 表示永不过期。
- 分享密钥推导（docs 必须写清，见下）：
  `shareKey = scrypt(SHARE_SECRET || APP_SECRET, 'mailflow-share-v1', 32)`。
  会话密钥才使用 `APP_SECRET` 原始值，分享用 scrypt 派生值，两者不同。
- token 形态：JWT，`alg=HS256`，payload `{ typ: 'share', mid: <mailId>, iat, exp? }`（`SHARE_TTL_HOURS=0` 时无 `exp`）。用 `shareKey` 签名，`jsonwebtoken` 显式限定 `algorithms: ['HS256']`。
- 生成：登录后 `POST /api/mails/:id/share`（受鉴权保护），按上述规则签发 token，返回 `{ token, path, expiresAt }`，其中 `path = '/share/<token>'`（相对路径，前端用 `window.location.origin` 补全为绝对地址，开发/生产都对）。
- 查看（公开，挂载在 `requireAuth` 之前）：
  - `GET /api/share/:token`：校验 token（必须 `typ === 'share'` 且 `mid` 为有效邮件 id），仅返回该邮件只读字段：`subject / fromName / fromAddr / toList / ccList / date / bodyText / bodyHtml / attachments[{id,filename,contentType,size}]`；**不返回** mailboxId/folderId/uid/messageId 等可用于横向定位的字段。
  - `GET /api/share/:token/attachments/:attachmentId`：校验 token 且附件属于 `mid`，流式下载该附件。
  - 分享接口不提供设置类写操作；`GET /api/share/:token` 打开时会把该邮件标记为已读（本地 DB + IMAP `\Seen`，IMAP 失败不影响读取）。
- 前端：新增公开路由 `/share/:token` → `ShareView.vue`，只读渲染（复用 iframe 沙箱方式），无回复/删除/已读按钮、无侧栏、无设置入口；附件经分享下载接口下载。分享接口用独立 axios 实例（不注入 Bearer、不触发 401 跳登录），token 无效时展示「分享链接无效或已过期」。
- 登录后阅读窗（`MailReader`）新增「分享」动作：调用生成接口，把绝对链接展示/复制到剪贴板。

### 安全边界（硬约束）

- 会话校验 `verifyToken` 限定 `algorithms: ['HS256']`，且 `requireAuth` 显式拒绝 `typ === 'share'` 的令牌（即使密钥被错误配置成同一值也拒绝）。
- 分享校验 `verifyShareToken` 限定 `algorithms: ['HS256']`，且显式要求 `typ === 'share'`；会话 JWT 缺少该 typ，必然被拒。
- 两侧密钥不同（原始 `APP_SECRET` vs `scrypt(...,'mailflow-share-v1')`）且 typ 互斥，二者不可互相冒用。
- 分享链路仅能按 token 中的 `mid` 读取一封邮件；无 token 或 token 指向的附件不属于该邮件时 404。
- 校验算法不放宽：不使用 `none`、不省略 `algorithms`、不接受 `typ` 缺省。

### 文档（可复现密钥生成）

README 与 `.env.example` 必须写明：

1. 生成强随机 `SHARE_SECRET`（示例）：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`（或 `openssl rand -hex 32`）。
2. 分享密钥推导：`scrypt(secret, 'mailflow-share-v1', 32)`。
3. token 结构：HS256 JWT，`{ typ:'share', mid, iat, exp? }`，`SHARE_TTL_HOURS=0` 无 exp。
4. 用该算法与密钥即可自行生成分享链接（附一段可复现的 node 片段）。

## [S3] Out of Scope

- 分享链接的撤销 / 列表管理（不落库，靠短期 `SHARE_TTL_HOURS` 或轮换 `SHARE_SECRET` 失效旧链接）。
- 分享页留言、下载全部附件打包、访问统计。
- 把列表上下文（邮箱/文件夹/分页）写进 URL。
- 多用户、权限分级、分享给特定账号。

## Tasks

- [x] T1: 路由地址化 —— `/` 重定向 `/mail`，`/mail/:id?` 复用 MailView；点击邮件 push `/mail/:id`，关闭回 `/mail`，刷新直达保持当前邮件；合并账户点击不切换侧栏 — acceptance: 点击邮件地址栏变 `/mail/<id>`；刷新仍在同一封；合并账户点击后侧栏仍高亮「合并账户」 (covers: S2)
- [x] T2: 分享配置与令牌 —— config 增加 `SHARE_SECRET` / `SHARE_TTL_HOURS`；crypto 增加 `shareKey` 推导、`signShareToken` / `verifyShareToken`（HS256 + typ 校验）；`verifyToken` 限定算法，`requireAuth` 显式拒绝 share 令牌 — acceptance: share token 调用受保护接口 401；session token 调用分享接口 401/404 (covers: S2)
- [x] T3: 分享读写接口 —— `POST /api/mails/:id/share` 返回 `{token,path,expiresAt}`；公开 `GET /api/share/:token` 与附件下载；字段裁剪、只读、不标记已读 — acceptance: 无鉴权打开 token 返回该邮件且不含 mailboxId/uid；换 id 或换附件 404 (covers: S2)
- [x] T4: 前端分享页 —— `/share/:token` 公开路由、独立无鉴权 api 实例、只读 ShareView、无效 token 提示；`MailReader` 分享按钮复制链接 — acceptance: 未登录打开分享链接可读内容且无任何操作按钮；无效 token 显示错误 (covers: S2)
- [x] T5: 文档 —— README 功能/API/配置/安全 + `.env.example` 注释写明密钥生成、推导、token 结构与手工生成片段 — acceptance: 照文档可生成链接与密钥，无遗漏 (covers: S2)
- [x] T6: 验证 —— `node --check` 后端；`npm run build` 前端；临时本地服务 E2E：登录态分享链接生成、未登录访问成功、分享 token 当 Bearer 访问 `/api/mailboxes` 被拒、session token 访问 `/api/share/:token` 被拒、附件仅限本邮件；验证后关闭服务并清理 — acceptance: 全部命令 PASS，服务关闭无残留 (covers: S2)
