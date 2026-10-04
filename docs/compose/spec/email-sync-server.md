---
feature: email-sync-server
status: delivered
updated: 2026-10-03
branch: feature/email-sync
commits: e41abc0..d8c3b01
---

# MailFlow — 电子邮件同步服务器

## Report

**What was built** — MailFlow：单用户自托管邮件同步服务器。后端（Express 5 + node:sqlite + imapflow + nodemailer + openid-client v6）提供：密码与 OIDC 双登录（JWT）、邮箱管理（Gmail/Outlook 仅经 OAuth2 授权一键接入，零手填，服务器/账号/凭据全部自动生成且 API 层封死手工创建；自定义 IMAP/SMTP 邮箱走表单+授权码，token/密码 AES-256-GCM 加密落库并自动刷新）、IMAP 定时同步（每文件夹回填+增量，UIDVALIDITY 重置，附件落盘）、邮件查看/批量已读未读/移动/删除（Trash 规则 + permanent 强制删）、multipart 发送（XOAUTH2 支持，Sent 副本与 message_id 去重）、钉钉加签推送（`.env` 唯一配置源：填 `DINGTALK_WEBHOOK_URL` 即启用，按邮箱开关 + 关键词过滤 + 48h 窗口 + 队列限速）。前端（Vue 3 + Element Plus）提供登录/OIDC 回调、三栏邮件台、邮箱管理（OAuth 授权按钮常显未配置时禁用、OAuth 邮箱仅可编辑名称/同步/钉钉）；生产模式由后端静态托管并 SPA 回退。全局同步间隔仅来自 `.env SYNC_INTERVAL_SEC`，可按邮箱覆盖。全局同步经 promise 链串行（并发 1），每邮箱另有防重叠保护。

**Verification** — 全部命令在 worktree 内执行，均观察实际输出：
- `node --check`（后端 14 个文件，修复后复跑）— PASS
- 后端启动 + 冒烟（health/auth 401·200/mailboxes 401·200）— PASS（两轮）
- `npm run build`（Frontend）— PASS（仅 chunk 体积警告）
- 生产托管冒烟：root 200 HTML、SPA `/login`·`/mailboxes` 回退 200、API 不受影响 — PASS（`res.sendFile` 曾 404，已改 readFileSync）
- API 接线回归：partial PUT 200、batch permanent/move 404/附件 404、oauth 未配置 400、创建缺字段 400、中文 UTF-8 经 node fetch 写库读回逐字一致 — PASS
- OAuth 链路修复后冒烟 8/8：start 无 token 401、带 token 200 `{url}`（含 client_id/redirect_uri/state）、未配置服务商 400、公开 callback 伪造/缺失 state 302 至前端错误页、受保护路由不受影响 — PASS
- 移除 Web 设置页后回归：`node --check`（后端 13 文件）— PASS；`npm run build`（Frontend，1743 modules）— PASS；全库 grep `/api/settings|SettingsView|getSetting|setSetting|settingsRouter` — 零命中；DB `settings` 表 `DROP` + `VACUUM` 成功，剩余表 `attachments, folders, mailboxes, mails, sqlite_sequence`
- `PRE-EXISTING` 性质未验证项（需真实凭据，逻辑已经复审确认）：真实 IMAP 同步、真实 SMTP 发信、真实钉钉 webhook、Google/Microsoft/OIDC 真实 OAuth 流。

**Journey log** —
- Exchange/Outlook 通过 SMTP 发信后服务端会**自动**把已发送消息存入 Sent Items，且使用**自己生成的 Message-ID**（与客户端的不同），因此按 message_id 去重永远配不上对，客户端再 APPEND 会造成服务端永久双份。修正：gmail/outlook 不做 APPEND；Sent 文件夹入库时按"主题+发件人+±10 分钟"合并副本。
- Element Plus `el-scrollbar` 根元素默认 `height:100%`，放进 flex 纵向侧栏时会以整页高度参与 flex 分配：上面的列表（有 max-height 的）下方留大片空白，下面 `flex:1` 的列表被挤成 0 高——DOM 里节点都在（无头浏览器的可访问性树能看到）但视觉不可见。修复：`:deep(.el-scrollbar){height:auto}` + 滚动容器 `flex:1 1 0%; min-height:0`。调试这类"DOM 在但看不见"的问题，a11y 快照会误导，必须截图 + getBoundingClientRect 量高度。
- Microsoft 授权码换 token 必须显式带 scope（AADSTS28003），Google 则可省略——两种服务商的 token 请求参数差异要在 tokenRequest 层对齐；且 v2.0 端点的 access token audience 由 scope 的资源决定，授权阶段不应混用多个资源（如 outlook.office.com 与 graph.microsoft.com），否则 IMAP/SMTP 或 Graph 必有一端 401。修正模式：scope 收敛单资源 + openid email，邮箱从 id_token claims 取。
- 整页跳转的浏览器导航无法携带 axios 注入的 Bearer 头：OAuth start 曾被全局鉴权 401，callback 也曾因位于鉴权之后而必然失败。修复模式 = start 返回 JSON `{url}`（前端拿地址再跳转）+ callback 挂载到鉴权中间件之前（state JWT 防护）。所有"浏览器直接访问的 API 端点"都必须走这一模式或公开路由。
- 开发期 OAuth 回调地址三处必须一致：.env `APP_URL`（决定 redirect_uri）、Azure/Google 应用注册里登记的 redirect_uri、后端实际监听端口；`FRONTEND_ORIGIN` 决定回调后跳回的前端地址（Vite dev 为 5173）。
- Gmail 侧：普通密码登录已于 2025-03 全面停用，应用专用密码（2FA）仍可用；GCP 应用 Testing 状态下 refresh token 7 天过期，长期使用需发布应用或用应用专用密码（developers.google.com，访问 2026-10-02）。
- Microsoft 侧：IMAP 基本认证已停用、SMTP AUTH 退役中（2026 年底默认禁用）；OAuth scope 必须是 `outlook.office.com/IMAP.AccessAsUser.All + SMTP.Send + offline_access`，不能混用 graph 与 outlook 资源 scope 取 token（learn.microsoft.com，访问 2026-10-02）。
- nodemailer XOAUTH2 必须显式 `auth.type='OAuth2'`，只传 accessToken 会被当作密码认证（Context7 官方文档核对）。
- imapflow `fetch(range, query, {uid:true})` 的 uid 选项只影响 range 解释：回填用序号区间、增量用 UID 区间，混用会错拉数据。
- PS 5.1 `Invoke-RestMethod` 字符串 body 默认非 UTF-8 编码，中文 API 测试会被打成 `?`（服务端无关）；控制台乱码同理，验证须用 node fetch 直读 DB。
- Express 5 下 SPA 回退用 `res.sendFile` 曾对存在文件报 404，改为启动期 readFileSync 兜底后稳定。
- 单用户自用产品给"环境变量即可配置"的东西做 Web 设置页是过度设计：`.env` 已定义 `DINGTALK_WEBHOOK_URL` / `SYNC_INTERVAL_SEC`，再叠一层 settings 表 + `/api/settings` + SettingsView 只带来三处一致性问题（env 兜底 / 表覆盖 / UI 展示），且"改完要重启"的语义在 Web 上更模糊（Web 改的是运行时状态，但改 env 又要重启）。收敛模式：`.env` 是唯一源，Web 只暴露"必须运行时可变"的东西（当前是邮箱/文件夹/邮件本身）。移除后 `settings` 表可直接 DROP，`getSetting/setSetting` 一并删除，无迁移系统下用一次 `VACUUM + wal_checkpoint(TRUNCATE)` 收口。

## [S1] Problem

用户需要一个部署在 Ubuntu Server 上的自托管邮件中心：自动定时同步多个邮箱服务商（QQ/163/企业自建/Gmail/Outlook）的邮件到本地 SQLite，通过 Web 界面查看（含附件）、发送（含附件）、管理邮件（已读/删除/移动），并在新邮件到达时推送到钉钉机器人。单用户自用，支持密码登录与自有 OIDC 单点登录，密钥统一放 .env。

## [S2] Design

### 技术栈与部署形态

- 后端 Node.js >= 22.5（Ubuntu），ESM，Express 5，数据库用内置 `node:sqlite`（零原生编译），端口 `PORT`（默认 3000）。
- IMAP 库 imapflow（支持 XOAUTH2），发送用 nodemailer（支持 XOAUTH2），解析用 mailparser，OIDC 用 openid-client v6，上传用 multer（内存存储）。
- 前端 Vue 3 + Vite + Vue Router + Pinia + Element Plus（zh-cn），开发期 Vite 代理 `/api`；生产期后端静态托管 `FRONTEND_DIST`（默认 `./static`，相对后端工作目录）并 SPA 回退，开发模式由 `npm run dev` 脚本的 `--dev` 标记、固定不托管。
- 运行时数据：`DATA_DIR`（默认 `Backend/data/`，git 忽略）下 `mailflow.db` 与 `attachments/<mailId>/`。

### 认证（单用户）

- 密码登录：仅 `AUTH_PASSWORD`（单用户，无用户名；常量时间比较，防时序攻击），登录内存限速（10 次/分钟/IP）。
- 两种登录成功均签发 HS256 JWT（`APP_SECRET`，TTL `JWT_TTL_HOURS` 默认 168h），前端存 localStorage，`Authorization: Bearer`；所有 `/api/*`（除 auth/login、auth/config、auth/oidc/*、health）需鉴权；401 统一 `{ error }`。
- OIDC：`.env` 配 `OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/OIDC_SCOPES`（默认 `openid`），回调固定为 `${APP_URL}/api/auth/oidc/callback`。Authorization Code Flow（openid-client v6 discovery/buildAuthorizationUrl/authorizationCodeGrant，state 用 APP_SECRET 签名 JWT 防 CSRF，10 分钟有效）。`OIDC_ALLOWED_SUB` 可选白名单（比对 IdP 返回的 `sub` claim）。登录成功重定向 `${FRONTEND_ORIGIN}/oidc-callback#token=...`。issuer 为 http:// 时需 `OIDC_INSECURE=1` 显式允许。
- `GET /api/auth/config`（公开）返回 `{ oidcEnabled }` 供登录页渲染按钮。

### 邮箱（mailboxes）

- 字段：name, email, provider(custom|gmail|outlook), auth_type(password|oauth2), IMAP host/port/secure, SMTP host/port/secure, username, password（AES-256-GCM 加密落库，密钥 scrypt 派生自 APP_SECRET）, sync_interval_sec（空=全局）, dingtalk_enabled, dingtalk_include/exclude（逗号分隔关键词）, status(ok|error), last_error, last_sync_at。
- 密码方式：表单手动添加（仅自定义 IMAP/SMTP 邮箱），测试连接（IMAP 登录 + SMTP verify）成功后保存。Gmail/Outlook 不提供任何手工创建入口：`POST /api/mailboxes` 对 `provider=gmail|outlook` 一律 400（OAuth 邮箱仅能经回调创建），`POST /mailboxes/test` 对其 password 尝试同样 400。
- OAuth2 双通道（gmail/outlook，二者唯一的添加途径）：
  - Google：scope `https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email`，`access_type=offline&prompt=consent` 强制取 refresh_token；端点 accounts.google.com / oauth2.googleapis.com/token。
  - Microsoft：tenant 取 `MICROSOFT_TENANT`（默认 common），scope `openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`（单资源，不含 Graph）；token 请求必须携带与授权一致的 scope（AADSTS28003）；access token 的 audience 即 outlook.office.com（IMAP/SMTP 可直接用），邮箱取自 id_token claims（email/preferred_username/upn），不走 Graph。
  - 流程：前端按钮经已登录的 `GET /api/mailboxes/oauth/:provider/start`（Bearer 头，JSON 返回 `{url}`，不做 302）拿到服务商授权地址后整页跳转；服务商重定向至**公开**的 `GET /api/mailboxes/oauth/:provider/callback`（挂载在鉴权中间件之前，由 state JWT 防护，与 OIDC 回调同模式）→ 换 token、取 email，按 email upsert 邮箱（存在则刷新 token，否则以服务商默认 host/port 建 mailbox，username=email），全程零手填，重定向 `FRONTEND_ORIGIN/mailboxes?oauth=...`。
  - OAuth 邮箱的编辑界面仅开放：名称、同步间隔、钉钉开关与关键词；服务器/账号/凭据字段不展示（更换账号 = 删除后重新授权）。
  - 刷新：IMAP/SMTP 使用前检查 `expires_at`，不足 120s 则 refresh_token 换新并加密回写；并发刷新按 mailbox 加锁去重。
- 删除邮箱：级联删 mails/attachments 行并删除附件目录。

### 文件夹与同步

- `folders`：mailbox_id, path, special_use, delimiter, uidvalidity, sync_enabled, last_uid。首次同步 list() 全量 upsert；默认仅 INBOX（及 `\Inbox` specialUse）启用，其余界面开关。UIDVALIDITY 变化则清空该 folder 邮件重新回填。
- 同步（按邮箱串行、全局并发 1，防重叠）：
  1. 建连（password 或 XOAUTH2）；
  2. upsert folders；
  3. 对每个 sync_enabled folder：首扫/回填补齐最新 `SYNC_BACKFILL_COUNT`（默认 50）封；增量取 `uid > last_uid`（过滤 `uid <= last_uid` 的 `n:*` 语义尾巴）；
  4. mailparser 解析 source，入库 mails（subject/from/sender/reply-to/to/cc/date/snippet/body_html/body_text/size/message_id/in_reply_to/reference_ids/flags/seen；头字段经 `mailHeaders.js` 防御式归一，畸形输入降级为 null 而不中断同步），附件写盘 `DATA_DIR/attachments/<mailId>/` 并登记 attachments 表；
  5. 更新 last_uid、last_sync_at、status。
- mails 唯一键 `(mailbox_id, folder_id, uid)`；本机代发副本 uid 允许 NULL（部分唯一索引 `WHERE uid IS NOT NULL`）。
- 调度：30s tick，`next = last_sync_at + (mailbox.sync_interval_sec || SYNC_INTERVAL_SEC)*1000`；启动后 30s 先跑一轮（`SYNC_ON_START=0` 可关）；提供手动立即同步接口。
- 不做服务端标记双向同步、不做远端删除探测（见 S3）。

### 查看/管理邮件

- 列表 `GET /api/mails?mailboxId&folder&seen&page&pageSize`：分页（默认 20，按 date desc），返回摘要字段。虚拟合并账户用 `scope=merged-inbox`（无需 mailboxId）：`mails JOIN folders`，仅取 `special_use='\Inbox' OR path='INBOX'`，跨邮箱按 date desc 合并分页，附 `mailbox_name`；`GET /api/mailboxes` 额外返回 `mergedUnread` 供角标。
- 详情 `GET /api/mails/:id`：body_html 在前端用 `sandbox`（无 allow-scripts/allow-same-origin）iframe 渲染，防脚本执行。
- 已读/未读：单个与批量 PATCH；同时 IMAP `messageFlagsAdd/Remove \Seen`（失败不影响本地状态，返回 warning）。
- 移动：本地改 folder_id + IMAP `messageMove`；删除：有 `\Trash` specialUse folder 则移入，否则本地+服务端永久删除；`permanent=1` 直接永久删（本地记录与附件一并清）。
- 附件：`GET /api/mails/:id/attachments/:attachmentId` 鉴权后从磁盘流式下载，Content-Disposition 编码文件名。

### 发送邮件

- `POST /api/mails/send`（multipart，multer 限制单文件 25MB、最多 10 个）：to/cc 用邮箱列表解析，subject/text/html + files → nodemailer SMTP（password 或 XOAUTH2 accessToken）。前端用 Quill 富文本编辑器生成 html 并附带纯文本；仅传 html 时后端由 html 兜底生成 text，产出 multipart/alternative。可选 `replyTo`/`inReplyTo`/`references`/`sender` 透传给 `MailComposer`，`Date`/`Message-ID` 未提供时自动生成；`sender` 与 `from` 相同则省略。
- 发送后 best-effort IMAP APPEND 到该邮箱 `\Sent` folder；失败则本地落一条 folder=已存在 Sent path（找不到则虚拟 `Sent`）的副本（uid NULL, \Seen），保证"已发送"可见。

### 钉钉推送

- 配置：仅 `.env` 生效。`DINGTALK_WEBHOOK_URL` 非空即视为启用推送（无单独开关字段）；`DINGTALK_SECRET` 用作加签密钥；`SYNC_INTERVAL_SEC` 为全局默认同步间隔（可被邮箱级 `sync_interval_sec` 覆盖）。原 `GET/PUT /api/settings`、`POST /api/settings/dingtalk/test` 与 `settings` 表已移除——单用户自用场景下没有必要通过 Web 配置这两项。
- 触发：同步中每插入一封新邮件，若 总开关 && webhook 非空 && 该邮箱 dingtalk_enabled && !seen && `mail.date` 距今 ≤ `PUSH_MAX_AGE_HOURS`（默认 48h，防首次回填轰炸） && 主题命中 include（非空时）且未命中 exclude → 推送。
- 消息：markdown（标题"新邮件"，正文含邮箱名/发件人/主题/时间/摘要）；加签 `sign=base64(hmac-sha256(secret, "ts\nsecret"))` urlencode；内置简单队列限速（≥3s/条）。

### 配置（.env）

`PORT, APP_URL, FRONTEND_ORIGIN, APP_SECRET, DATA_DIR, AUTH_PASSWORD, JWT_TTL_HOURS, SYNC_INTERVAL_SEC, SYNC_BACKFILL_COUNT, SYNC_ON_START, PUSH_MAX_AGE_HOURS, DINGTALK_WEBHOOK_URL, DINGTALK_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT, OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_SCOPES, OIDC_ALLOWED_SUB, OIDC_INSECURE` — 以 `.env.example` 形式交付（带注释）。

### 前端页面

- `/login`：密码表单（仅密码，无用户名）+ （若启用）OIDC 按钮；`/oidc-callback` 读 hash 存 token。
- `/`：三栏邮件台 —— 左：邮箱与文件夹树（仅显示已开启同步的文件夹；含未读数、管理入口；顶部“合并账户”聚合各邮箱收件箱，默认进入）；中：邮件列表（勾选批量、未读加粗、附件图标、合并时标注来源邮箱）；右：阅读窗（详情 iframe、附件下载、已读/未读/移动/删除/回复）；撰写对话框正文用 Quill 富文本（加粗/斜体/列表/链接等），回复时以引用块预填纯文本内容。合并账户下“移动”不可用，“同步”触发全部邮箱。
- `/mailboxes`：邮箱 CRUD、连接测试、立即同步、Gmail/Outlook OAuth 授权按钮、每邮箱钉钉开关与关键词、文件夹同步开关（在「编辑邮箱」弹窗内的「文件夹同步」区块）。
- 无 `/settings` 页面：钉钉推送与全局同步间隔只在 `.env` 中配置，重启后端生效。
- axios 拦截 401 → 清 token 回登录页；写信任 localStorage token。

## [S3] Out of Scope

- 多用户/多角色；邮件全文搜索与高级过滤；邮件模板/签名管理。
- IMAP IDLE 实时推送（仅按间隔轮询）；服务端标记/删除的双向同步。
- OAuth token 过期 7 天类平台策略的自动重授权引导（token 失效时报错并提示重新授权）。
- 钉钉推送的消息去重跨重启（重启后 last 状态以 DB 为准，不重复推已 push 邮件， dingtalk_pushed 标记）。

## Tasks

- [x] T1: 后端骨架 + .env.example + 数据库 schema（mailboxes/folders/mails/attachments）+ 加密与鉴权中间件 + 登录/OIDC 路由 — acceptance: `npm start` 启动无错；`/api/health` 200；密码登录换取 JWT，受保护接口无 token 401；OIDC 未配置时 auth/config.oidcEnabled=false (covers: S2)
- [x] T2: 邮箱 CRUD + 连接测试 + OAuth2 start/callback（gmail/outlook）+ token 刷新 + 文件夹列表与同步开关 — acceptance: 创建 password 邮箱入库且密码为密文；test 接口返回连通结果；oauth/start 302 到授权页；文件夹开关持久化 (covers: S2)
- [x] T3: IMAP 同步服务（回填+增量+UIDVALIDITY 重置）+ 调度器（全局间隔/每邮箱覆盖/手动触发/并发防护）+ 附件落盘 — acceptance: 对可连通邮箱手动同步后 mails/folders 有数据、附件文件生成；重复同步不产生重复行；断网时 status=error 且记录 last_error (covers: S2)
- [x] T4: 邮件 API：分页列表/详情/批量已读未读/移动/删除（Trash 规则/permanent 强制删）/附件下载/发送（multipart + Sent 副本） — acceptance: 全部接口在真实 IMAP 测试邮箱上行为正确；无附件邮件正常；发送后能在 Sent folder 同步回来 (covers: S2)
- [x] T5: 钉钉服务（加签、队列限速、测试接口已随 settings API 一同移除）+ 新邮件推送管线（开关/关键词/48h 窗口/dingtalk_pushed 去重） — acceptance: 符合条件的同步新邮件触发一次且仅一次推送；钉钉配置变更通过修改 `.env` 后重启后端生效 (covers: S2)
- [x] T6: 前端：登录/oidc 回调、三栏邮件台（列表/阅读/批量操作/附件/撰写）、邮箱管理页、路由守卫与 401 处理（无 `/settings` 页面）— acceptance: `npm run build` 成功；dev 模式下登录→同步→读信→发信→管理全流程可操作 (covers: S2)
- [x] T7: 生产托管（express 静态 + SPA 回退）+ 冒烟验证（后端启动、健康检查、登录、未配置邮箱时页面可打开）— acceptance: build 产物由后端 3000 端口可访问且前端路由刷新不 404；全部冒烟命令 PASS (covers: S2)
- [x] T8: Gmail/Outlook 收敛为仅 OAuth 授权添加：后端拒绝 `provider=gmail|outlook` 的手工创建（POST / 一律 400，含显式 oauth2；/test 拒绝 password 尝试）；前端表单仅用于自定义 IMAP/SMTP，OAuth 邮箱编辑仅展示名称/同步间隔/钉钉字段 — acceptance: 表单不再出现 gmail/outlook 手填路径；POST gmail+password 返回 400；OAuth 邮箱 partial PUT 保存成功且不触碰服务器字段 (covers: S2)
