# MailFlow

单用户自托管邮件同步服务器。把多个邮箱（QQ / 163 / 企业自建 / Gmail / Outlook）的邮件定时同步到本地 SQLite，通过 Web 界面查看、收发、管理，并可将新邮件推送到钉钉机器人。

面向"部署在一台自己的服务器上、自己用"的场景，单文件 SQLite + 单目录附件，零外部数据库依赖。

## 功能特性

- **多邮箱同步**：IMAP 增量同步，按 UID 追踪游标，感知 `UIDVALIDITY` 变化自动重建；首次同步回填每文件夹最新 N 封（默认 50）。
- **任意 IMAP/SMTP 邮箱**：表单手填服务器与授权码，保存前可测试 IMAP 登录 + SMTP 连通。
- **Gmail / Outlook 一键授权**：OAuth2 全链路（IMAP + SMTP 双通道），服务器地址、账号、凭据自动生成，无需手填；access token 到期前自动用 refresh token 刷新。
- **邮件收发**：滚动自动加载（向下续载更早、向上续载更新）、正文沙箱渲染、附件下载、批量已读/未读、一键全部已读、移动、删除（按 Trash 规则，支持强制永久删）、富文本撰写（Quill，正文编辑器支持全屏编辑）、标签式收件人/抄送输入（空格/逗号/分号分隔，粘贴可批量拆分、标签可就地编辑）与 multipart 发送（同时生成纯文本备选；附件 ≤10 个 / 单个 ≤25MB）。接收侧规范解析并展示 `Sender` / `Reply-To` / `References` 等标准头，发送侧自动生成 `Date` / `Message-ID` 并支持 `Reply-To` / `In-Reply-To` / `References`，回复时自动写线程链；发件 `From` 支持按邮箱配置**发件人显示名**（`mailboxes.sender_name`，留空则收件人只看到邮箱地址）；对缺失/畸形/非标头做防御式降级，保证邮件仍可入库。左侧提供虚拟**合并账户**（默认进入），按时间聚合所有邮箱的收件箱（其它文件夹不聚合），并在列表中标注来源邮箱。
- **登录**：单用户密码登录与自有 OIDC 单点登录二选一，JWT 会话（默认 7 天），登录接口内存限速 10 次/分钟/IP。
- **邮件地址化浏览**：打开某封邮件时地址栏变为 `/mail/<id>`，可复制该地址直达或刷新后仍停在该邮件；合并账户下点击邮件不会把左侧邮箱切换成该邮件所属邮箱。
- **免登录分享**：登录后可为某封邮件生成带签名密钥的分享链接（`/share/<token>`）。收件人无需登录即可查看该封邮件正文与该邮件附件，看不到其它邮件、也不能改动任何设置；分享令牌与登录令牌密钥隔离、类型互斥，不能互相冒用。密钥生成与令牌格式见下文「免登录分享」。
- **钉钉推送**：全局 `.env` 配置（填 webhook 即启用），每邮箱独立开关，主题关键词白/黑名单，最大年龄窗口（默认 48h，防止首次回填轰炸），加签、队列限速防频控。
- **敏感数据加密**：邮箱密码、OAuth token、钉钉 secret 全部 AES-256-GCM 加密落库。
- **同源单端口部署**：生产模式后端直接托管前端构建产物并做 SPA 回退。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js **≥ 22.5.0**（后端使用内置 `node:sqlite`） |
| 后端 | Express 5（ESM）、imapflow、mailparser、nodemailer、openid-client v6、jsonwebtoken、multer、dotenv |
| 数据库 | Node 内置 `node:sqlite`（`DatabaseSync`，WAL 模式，文件式） |
| 前端 | Vue 3.5（`<script setup>`，纯 JS）、Vite 8、Element Plus（zh-cn）、Pinia 4、vue-router 5、axios、Quill 2（富文本编辑） |
| 加密 | `node:crypto`：AES-256-GCM + scrypt 派生密钥 |

依赖极少（后端 8 个包），无原生编译模块、无全局安装、无需 Docker。

## 目录结构

```
MailFlow/
├── Backend/
│   ├── src/
│   │   ├── index.js          # 入口：Express 装配、静态托管、错误处理、调度器启动
│   │   ├── config.js         # 环境变量解析与必填校验
│   │   ├── db.js             # SQLite 初始化、建表、通用查询
│   │   ├── crypto.js         # AES-256-GCM 加解密、JWT 签发/校验、常量时间比较
│   │   ├── routes/           # auth / mailboxes / mails / share
│   │   └── services/         # imap / smtp / scheduler / oauth / mailboxAuth / dingtalk
│   ├── .env.example          # 带注释的配置模板
│   └── package.json
├── Frontend/
│   ├── src/
│   │   ├── views/            # Login / OidcCallback / Mail / Compose / Mailboxes / Share
│   │   ├── components/       # RichTextEditor / TagInput / MailboxFormDialog / MailList / MailReader
│   │   ├── stores/auth.js    # 登录态（Pinia）
│   │   ├── router/index.js   # 路由表与 token 守卫
│   │   ├── api.js            # axios 封装（Bearer 注入、401 处理、blob 下载）
│   │   └── utils.js          # 日期/字节格式化
│   ├── vite.config.js        # dev 端口 5173，/api 代理到 localhost:3000
│   └── package.json
├── docs/compose/spec/email-sync-server.md   # 设计规格与实现记录
└── README.md
```

## 快速开始

### 1. 安装依赖

两个包各自独立，均使用 lockfile：

```powershell
cd Backend;  npm ci
cd ..\Frontend;  npm ci
```

### 2. 配置后端

```powershell
Copy-Item Backend\.env.example Backend\.env
```

至少改这几项（其余可留默认）：

```env
PORT=3000
APP_URL=http://localhost:3000
APP_SECRET=<长随机字符串，用于 JWT 签名与凭据加密>
AUTH_PASSWORD=<你的登录密码>
DATA_DIR=./data
```

### 3. 开发模式（两个终端）

```powershell
# 后端 :3000
cd Backend; npm run dev

# 前端 :5173（/api 自动代理到 :3000）
cd Frontend; npm run dev
```

浏览器打开 <http://localhost:5173>，用你在 `.env` 里设的 `AUTH_PASSWORD` 登录。

开发模式由 `npm run dev` 脚本里的 `--dev` 标记识别：后端**不托管**前端构建产物（即使已经构建过），只提供 API，前端由 Vite dev server 提供，`/api` 经代理转发到 `:3000`。

### 4. 生产模式（单端口）

```powershell
cd Frontend; npm run build          # 构建前端产物
cd ..\Backend; npm start            # 监听 :3000，托管 ./static 并 SPA 回退
```

`npm start`（脚本未带 `--dev`）时，只要 `./static/index.html`（相对后端工作目录）存在，后端就会接管前端静态资源并做 SPA 回退（`assets/` 等资源目录下缺失的文件仍返回 404）；否则仅提供 API。产物目录可用 `FRONTEND_DIST` 指定（例如 `../Frontend/dist`）。`DATA_DIR` 下的 `mailflow.db` 与 `attachments/` 是唯一需要备份的数据。

### 5. 一键构建（可选）

```powershell
# Windows PowerShell（根目录）
.\build.ps1

# Linux / macOS（首次先 chmod +x build.sh）
./build.sh
```

脚本按顺序执行：检查 `node` / `npm` 是否存在且 Node.js >= 22.5.0（缺失或过低只提示，需自行到 <https://nodejs.org> 安装）→ 前端运行库缺失时自动 `npm install` → 构建前端到 `MailFlowBuild/static` → 复制后端文件到 `MailFlowBuild`（不含 `node_modules`、`data`、`.env`）→ 询问是否创建 `.env` → 删除临时的 `Frontend/dist` → 打印产物路径。非交互环境用 `-CreateEnv` / `-NoEnv`（Linux 为 `--create-env` / `--no-env`）跳过 `.env` 交互询问；提示执行策略受限时用 `powershell -ExecutionPolicy Bypass -File .\build.ps1`。产物运行方式：`cd MailFlowBuild; npm install; npm start`。

## 配置项

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `APP_URL` | `http://localhost:{PORT}` | 外部可访问基址，决定 OAuth/OIDC 的 `redirect_uri` |
| `FRONTEND_ORIGIN` | 空（用 `APP_URL`） | 授权回调后跳回的前端地址（dev 为 `http://localhost:5173`） |
| `FRONTEND_DIST` | `./static`（相对后端工作目录） | 前端构建产物目录 |
| `APP_SECRET` | **必填** | JWT 签名 + 凭据加密密钥（scrypt 派生） |
| `DATA_DIR` | `./data` | SQLite 与附件目录（相对进程工作目录） |
| `AUTH_PASSWORD` | **必填**（`DISABLE_PASSWORD_LOGIN=1` 时可空） | 单用户登录密码（明文存 env，不落库） |
| `DISABLE_PASSWORD_LOGIN` | `0` | 设 `1` 禁用密码登录，只允许 OIDC 登录（此时必须配置 OIDC 三项） |
| `JWT_TTL_HOURS` | `168` | 登录态有效期（小时） |
| `SHARE_SECRET` | 空 | 分享链接签名密钥；留空则从 `APP_SECRET` 用独立 salt 派生 |
| `SHARE_TTL_HOURS` | `168` | 分享链接有效期（小时），`0` 表示永不过期 |
| `SYNC_INTERVAL_SEC` | `300` | 全局默认同步间隔（秒，最小 30） |
| `SYNC_BACKFILL_COUNT` | `50` | 首次回填每文件夹最新邮件数 |
| `SYNC_ON_START` | `1` | 启动 30 秒后是否先跑一轮同步 |
| `PUSH_MAX_AGE_HOURS` | `48` | 只推送该小时内的新邮件 |
| `DINGTALK_WEBHOOK_URL` / `DINGTALK_SECRET` | 空 | 钉钉配置，`.env` 唯一来源；填 `DINGTALK_WEBHOOK_URL` 即视为启用推送，留空则关闭 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | 空 | 齐备才启用 Gmail OAuth |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT` | 空 / 空 / `common` | Outlook OAuth；tenant 用 `consumers` 或租户 ID |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | 空 | 三者齐备才启用 OIDC 登录 |
| `OIDC_SCOPES` | `openid` | OIDC 授权范围 |
| `OIDC_ALLOWED_SUB` | 空（不限） | 非空时仅允许该 `sub`（OIDC 用户标识）登录 |
| `OIDC_INSECURE` | `0` | issuer 为 `http://` 时必须设 `1` |

## 邮箱接入

**Gmail / Outlook** 只支持 OAuth 授权添加（不提供任何手工创建入口，`POST /api/mailboxes` 对这两家一律 400）：

- 回调地址：`{APP_URL}/api/mailboxes/oauth/gmail/callback`、`{APP_URL}/api/mailboxes/oauth/outlook/callback`
- Google scope：`https://mail.google.com/` + `https://www.googleapis.com/auth/userinfo.email`
- Microsoft scope（单资源，不含 Graph）：`openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send`

OAuth 邮箱的编辑界面只开放名称、发件人名称、同步间隔、钉钉开关与关键词；要换账号需删除后重新授权。

**自定义 IMAP/SMTP 邮箱**（QQ / 163 / 企业自建等）走界面表单，保存前会先测 IMAP 登录与 SMTP verify。注意 Gmail 已停用普通密码登录，需用应用专用密码；Outlook 的 IMAP 基本认证已停用，请用 OAuth。

开发期回调地址三处必须一致：`.env` 的 `APP_URL`、服务商应用注册里登记的 `redirect_uri`、后端实际监听端口。

## 主要 API

除标注"公开"外均需 `Authorization: Bearer <JWT>`；错误统一返回 `{ "error": "中文描述" }`。

**公开**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 存活探针 |
| GET | `/api/auth/config` | 返回 `{ oidcEnabled, passwordLoginEnabled }` 供登录页渲染按钮 |
| POST | `/api/auth/login` | 单用户密码登录，换取 JWT（密码登录被禁用时返回 403） |
| GET | `/api/auth/oidc/login` | 跳转 OIDC 授权页 |
| GET | `/api/auth/oidc/callback` | OIDC 回调，token 经 URL fragment 回传前端 |
| GET | `/api/mailboxes/oauth/:provider/callback` | 邮箱 OAuth 回调 |
| GET | `/api/share/:token` | 免登录只读查看单封邮件（字段裁剪，仅该邮件） |
| GET | `/api/share/:token/attachments/:attachmentId` | 免登录下载该邮件的附件 |

**邮箱**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/auth/me` | 当前身份 |
| GET / POST | `/api/mailboxes` | 列表（含未读/总数、OAuth 可用性）/ 新增自定义邮箱 |
| PUT / DELETE | `/api/mailboxes/:id` | 局部更新 / 删除（级联清理邮件与附件目录） |
| POST | `/api/mailboxes/test` | 用请求体凭据试连 IMAP + SMTP |
| POST | `/api/mailboxes/:id/test` | 用库中凭据试连 |
| POST | `/api/mailboxes/:id/sync` | 手动触发一次同步（异步，立即返回） |
| GET | `/api/mailboxes/:id/folders` | 文件夹列表与未读/总数 |
| PUT | `/api/mailboxes/:id/folders` | 开关单文件夹同步 |
| GET | `/api/mailboxes/oauth/:provider/start` | 生成服务商授权 URL（JSON 返回 `{url}`） |

**邮件**

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mails` | 列表，query：`mailboxId`(默认必填)、`folderId?`、`seen?`、`page?`、`pageSize?`(默认 20，上限 100)。改用 `scope=merged-inbox` 时无需 `mailboxId`，聚合所有邮箱收件箱。滚动加载时可传游标 `before=<date>:<id>`（取更早）或 `after=<date>:<id>`（取更新），二者优先于 `page`，按 `date DESC, id DESC` 稳定排序 |
| GET | `/api/mails/:id` | 详情（含正文、附件元数据，以及 `messageId`/`inReplyTo`/`references[]`/`from`/`sender`/`replyTo`/`to`/`cc`/`date` 等头字段） |
| GET | `/api/mails/:id/attachments/:attachmentId` | 附件流式下载 |
| POST | `/api/mails/:id/share` | 生成该邮件的免登录分享链接，返回 `{ token, path, expiresAt }` |
| PATCH | `/api/mails/:id` | 改已读状态 |
| POST | `/api/mails/seen-all` | 一键全部已读。默认 body 传 `mailboxId`（可选 `folderId`）限定范围；传 `mailboxId` 不带 `folderId` 覆盖该邮箱所有文件夹，`scope=all` 覆盖所有邮箱所有文件夹（含垃圾邮件等），`scope=merged-inbox` 仅覆盖各邮箱收件箱；返回 `{ updated, warnings }` |
| POST | `/api/mails/batch` | 批量 `seen` / `unseen` / `move` / `delete`（`permanent` 强制永久删） |
| POST | `/api/mails/send` | multipart 发送（`to`/`cc`/`subject`/`text`/`html` + 附件，附件最多 10 个、单个 25MB；仅传 `html` 时后端自动生成纯文本备选）。可选 `replyTo`/`inReplyTo`/`references`（JSON 数组字符串或空白分隔）/`sender`；`Date` 与 `Message-ID` 未提供时自动生成 |

## 免登录分享

登录后在阅读窗点「分享」即可复制形如 `https://<你的域名>/share/<token>` 的链接。收件人无需登录，只能查看 token 对应的那一封邮件及其附件；页面只读，无法访问其它邮件或任何设置。

### 密钥生成（可自行复现）

分享 token 用独立密钥签名，与会话 JWT 的密钥分离：

- 推荐单独设置 `SHARE_SECRET`（留空时回退用 `APP_SECRET` 派生）。生成强随机值：

  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

  把输出填入 `Backend\.env` 的 `SHARE_SECRET`，重启后端生效。轮换该值会让所有旧分享链接立即失效。
- 分享密钥推导：`shareKey = scrypt(SHARE_SECRET || APP_SECRET, 'mailflow-share-v1', 32)`（Node `crypto.scryptSync`，默认参数，输出 32 字节）。
- token 结构：`HS256` JWT，payload `{ typ: 'share', mid: <mailId>, iat, exp? }`；`SHARE_TTL_HOURS=0` 时不带 `exp`。签名与校验都显式限定 `algorithms: ['HS256']`。

### 手工生成分享链接（不使用界面时）

在 `Backend/` 目录下执行（自动读取 `.env`）：

```powershell
node --input-type=module -e "import { signShareToken } from './src/crypto.js'; console.log('/share/' + signShareToken(123, 0));"
```

把 `123` 换成目标邮件 id、第二个参数换成有效期秒数（`0` 为永不过期），输出拼到站点根地址即可。

### 安全边界

- 分享 token 与登录 token 使用不同密钥（`scrypt(...,'mailflow-share-v1')` 对 `APP_SECRET` 原始值），且分别校验 `typ`：登录接口显式拒绝 `typ === 'share'` 的令牌，分享接口显式要求 `typ === 'share'`，二者不可互相冒用。
- 校验算法固定 `HS256`，不启用 `none`、不省略 `algorithms`。
- 分享链路只按 token 内的 `mid` 读取一封邮件；附件必须属于该邮件，否则 404。

## 同步机制

- 调度器每 **30 秒** 扫描一次，到点（`last_sync_at + 间隔`）才执行；间隔取「邮箱级覆盖 → `SYNC_INTERVAL_SEC`」，最小 30 秒。
- 全部邮箱共享一条 Promise 链，**全局任意时刻只有一个同步任务在跑**，同邮箱另有防重入保护。邮箱多时总耗时线性累加。
- 每个文件夹独立游标：`UIDVALIDITY` 变化即清空重建；首扫回填最新 N 封（按序列号），之后按 UID 增量；三重去重（游标、`(mailbox, folder, uid)` 唯一键、`message_id`）。
- 附件落盘 `DATA_DIR/attachments/<mailId>/`，文件名做了安全字符清理。
- 发送后 Gmail/Outlook 只写本地副本（服务端会自动存 Sent），其他服务商后台 IMAP APPEND 回填 UID，失败仅记日志、本地副本保留。

## 数据与备份

- 全部数据在 `DATA_DIR` 下：`mailflow.db`（SQLite，WAL 模式）与 `attachments/`。
- 表：`mailboxes`、`folders`、`mails`、`attachments`；外键级联删除。`mails` 含 `sender_*` / `reply_to_*` / `reference_ids` 等头字段（`references` 头以 JSON 字符串存 `<id>` 数组；列名用 `reference_ids` 以避开 SQLite 保留字，接口字段仍为 `references`）；`mailboxes.sender_name` 为发件人显示名。
- 只有首次初始化时 `CREATE TABLE IF NOT EXISTS`；**没有版本化迁移系统**，新增列以幂等的 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` 兜底。
- 凭据以 `iv:tag:data` 三段 base64 存于 `password_enc` / `access_token_enc` / `refresh_token_enc` / `dingtalk_secret_enc`，密钥由 `APP_SECRET` 经 scrypt 派生。**更换 `APP_SECRET` 会导致所有已存凭据不可解密**，需重新授权/填密码。
- 没有用户表，应用是单用户模型；登录密码只存环境变量，改密码需重启进程。

## 前端

- 路由：`/login`、`/oidc-callback`、`/share/:token`（免鉴权）；`/` 重定向到 `/mail`，`/mail/:id?`（三栏邮件台，带 id 时打开该邮件；已加载列表与滚动位置留在组件内存，刷新回到合并账户 + 该邮件）、`/compose`（独立撰写页，`?mailbox=<id>` 预选发件邮箱、`?reply=<id>` 预填回复）、`/mailboxes`（邮箱管理）。守卫直接从 `localStorage.mailflow_token` 判断，401 统一清会话跳登录页；`/share` 页面用不带鉴权的独立 axios 实例，出错只提示不跳登录。
- 邮件正文用 `sandbox="allow-popups allow-popups-to-escape-sandbox"` 的 iframe + `srcdoc` 渲染，**不含** `allow-scripts` / `allow-same-origin`，脚本不执行、无法读取父页存储；正文里的链接（`<a>`/`<area>`）会被统一改写为 `target="_blank"` + `rel="noopener noreferrer"`（并注入 `<base target="_blank">` 兜底），点击后在新标签打开，不会在 iframe 内导航顶掉正文、也避免被仿冒站点伪装成应用自身；未使用 `v-html`，也未引入第三方净化库。
- Token 存 `localStorage`（非 sessionStorage），跨标签页共享。

## 已知限制

- **无 CORS**：后端未注册任何 CORS 中间件，前后端必须同源部署（生产托管或反向代理），`FRONTEND_ORIGIN` 只用于授权跳转，不提供跨域头。
- **单用户**：无用户表、无多租户、无 RBAC；登录限速计数器与 OAuth 刷新锁都在内存，进程重启清零、多实例不共享。
- **无迁移系统、无测试、无 lint、无 TypeScript**：前后端均纯 JS，API 契约无类型保障。
- **同步全局串行**、tick 粒度固定 30 秒；同步失败无重试，只记 `last_error` 等下一轮。
- IMAP/SMTP 操作失败时本地与远端可能不一致（已在响应 `warnings` 中提示）。
- 附件表存的是**绝对路径**，`DATA_DIR` 迁移或跨机搬迁后引用会失效。
- 附件上传使用 multer 内存存储，最坏单次请求约 250MB 内存。
- 不支持 IMAP IDLE 实时推送（仅轮询）、服务端标记/删除双向同步、邮件全文搜索、草稿持久化、多用户。
- 钉钉推送在入队前先置去重标记，队列消费前崩溃会**丢推送但不会重复推**。
- 无 HTTPS 终止与 CSP，TLS 需由外部反向代理处理；OIDC token 走 URL fragment，会进浏览器历史。

## 安全提示

- `APP_SECRET` 与 `AUTH_PASSWORD` 必须改为强随机值，二者决定会话签名与全部加密凭据。
- `SHARE_SECRET` 决定分享链接签名；未单独设置时会从 `APP_SECRET` 派生。分享密钥与会话密钥隔离，分享令牌无法用于登录。
- `.env` 已在 `.gitignore` 中，切勿提交；`DATA_DIR` 亦被忽略。
- 部署到公网前请确认：改默认密码、用 HTTPS 反代、限制 3000 端口的来源。

## 设计文档

完整设计、接口契约与实现记录见 [`docs/compose/spec/email-sync-server.md`](docs/compose/spec/email-sync-server.md)。
