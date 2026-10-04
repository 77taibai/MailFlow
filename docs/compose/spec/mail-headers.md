---
feature: mail-headers
status: delivered
updated: 2026-10-04
branch: feat/mail-headers
commits:
---

# 邮件头字段适配（接收与发送）

## Report

**What was built** — 收发两侧统一适配 `Date / From / Sender / Reply-To / To / Cc / Message-ID / In-Reply-To / References / Subject`。接收侧新增 `mailHeaders.js` 纯函数模块，以 `extractMailHeaders(parsed)` 集中做防御式归一（地址组/嵌套组/字符串、`References` 字符串或数组、非法日期、缺 `Message-ID`、`mailparser` 未在顶层暴露 `Sender` 时回退 `headers` Map 等），任何畸形头都降级为 null/空而不中断同步；`mails` 表新增 `sender_name/sender_addr/reply_to_name/reply_to_addr/reference_ids`（`references` 是 SQLite 保留字，故列名用 `reference_ids`），并以 `PRAGMA table_info`+`ALTER TABLE ADD COLUMN` 幂等迁移老库。发送侧 `sendMail` 支持 `replyTo/inReplyTo/references/sender/messageId/date`，`Date`/`Message-ID` 缺省自动生成、`Sender` 与 `From` 相同则省略、信封不变；本地已发送副本同步落这些列。`GET /api/mails/:id` 暴露 `sender*`/`replyTo*`/`inReplyTo`/`references[]`；前端阅读窗按需显示发送者/回复至/抄送，回复时收件人取 `Reply-To || From` 并自动填 `In-Reply-To` 与 `References`（原引用链 + 原 `Message-ID`，去重保序），未新增任何撰写输入框。补充修复发送端 `From` 缺少显示名的问题：`mailboxes` 新增 `sender_name`，邮箱表单与 API 可编辑「发件人名称」，发送时写 `"显示名" <邮箱>`（留空则仅邮箱地址），收件端即可显示发件人名称。

**Verification** —
- 后端逐文件 `node --check`（15 个）— PASS；前端 `npm run build` — PASS（仅既有 chunk 体积警告）。
- `check-send.mjs` — PASS：真实 `simpleParser` 解析畸形/正常 EML 的 `extractMailHeaders` 结果；新库含新列；`sendMail` 原始报文含 `Reply-To/In-Reply-To/References/Sender/Message-ID/Date/To/Cc`；本地副本新列正确；`Sender` 等于 `From` 时省略。
- `check-migration.mjs` — PASS：预置旧 schema 库启动后自动补列，旧行与数据保留、新列为 null。
- `check-api.mjs` — PASS：进程内 Express（`127.0.0.1:0`，脚本内关闭）验证 `GET /api/mails/:id` 对 JSON `reference_ids`、旧式空白分隔字符串、缺失头分别返回 `references[]`/null；缺失 id 404。
- 复审子代理：代码无正确性缺陷；1 项 CRITICAL 为文档列名不一致（`references` vs `reference_ids`），已改为 `reference_ids`（接口字段仍为 `references`）并重新构建通过。

**Journey log** —
- `mailparser` 的 `simpleParser` **不**在顶层暴露 `sender`，必须从 `parsed.headers`（Map）取 `get('sender')`；地址头做 `parsed.x ?? headers.get(...)` 双路回退更稳。
- `REFERENCES` 是 SQLite 保留字，`CREATE TABLE ... references TEXT` 直接语法报错 → 列名改 `reference_ids`，接口字段保持 `references`。
- PowerShell 5.1 的 `Get-Content`/`Set-Content` 往返会把无 BOM 的 UTF-8 中文按 GBK 解码而损坏源码；本次改用 Read/Edit 工具重做，必要时用 `[System.IO.File]` 显式 UTF-8。
- 用 `app.listen(0,'127.0.0.1')` + `fetch` 在脚本内做 API 验证并在结束时 `close()`，可避免为验证起长驻服务。
- 把归一逻辑集中到纯函数 `extractMailHeaders`，使得“畸形头不抛异常”可在无 IMAP 服务器的情况下被直接断言。

## [S1] Problem

MailFlow 目前只处理了邮件头的一部分。接收侧仅存/展示 `Date`、`From`、`To`、`Cc`、`Message-ID`、`In-Reply-To`、`Subject`；`Sender`、`Reply-To`、`References` 完全没有落库，`In-Reply-To` 虽落库但未在详情接口暴露，`To`/`Cc` 只保留解析后的文本。发送侧只设置 `From/To/Cc/Subject`，不生成 `Reply-To`，回复时也不写 RFC 5322 的 `In-Reply-To` / `References` 线程头。

后果：

- 收到的邮件看不到“实际发送者（Sender）”与“回复地址（Reply-To）”。
- 回复时收件人固定取 `From`，忽略对方指定的 `Reply-To`。
- 线程信息 `References` 丢失，回复无法正确串成会话。
- 对方发送**非标头 / 畸形头**（缺 `Message-ID`、`Date` 非法、`References` 为字符串、地址列表畸形、`From` 为空等）时，解析字段可能异常，缺少统一的防御降级。

## [S2] Design

### 头字段映射（接收 / 发送）

| 头字段 | 接收：解析并落库 | 发送：生成 |
|---|---|---|
| `Date` | `date`（已有，改为防御式解析） | 由 `MailComposer` 自动生成（可传入覆盖） |
| `From` | `from_name` / `from_addr`（已有，改为防御式解析） | `from` = 发件邮箱；若该邮箱配置了发件人显示名（`mailboxes.sender_name`）则写为 `"显示名" <邮箱>` |
| `Sender` | **新增** `sender_name` / `sender_addr` | 自动：默认与 `from` 相同则按 RFC 省略；调用方显式提供不同地址时才写 `Sender` |
| `Reply-To` | **新增** `reply_to_name` / `reply_to_addr` | 后端接受可选 `replyTo`（无界面输入；回复不设置） |
| `To` | `to_list`（已有，改为防御式文本归一化） | 表单 `to`（已有） |
| `Cc` | `cc_list`（已有，改为防御式文本归一化） | 表单 `cc`（已有） |
| `Message-ID` | `message_id`（已有，改为防御式解析） | 由 `MailComposer` 自动生成，沿用 `info.messageId` |
| `In-Reply-To` | `in_reply_to`（已有，改为防御式解析；**新增详情接口暴露**） | 回复时自动 = 原邮件 `Message-ID` |
| `References` | **新增** `reference_ids`（JSON 字符串，`<id>` 数组；接口字段名 `references`） | 回复时自动 = 原 `References` + 原 `Message-ID`（去重保序） |
| `Subject` | `subject`（已有，改为防御式解析） | 表单 `subject`（已有） |

约定：`reference_ids` 列以 `JSON.stringify(string[])` 存储（每项形如 `<id@host>`），与 `mailparser` 的 `references: string[]` 对齐；读取时再解析为数组返回。列名不用 `references`（SQLite 保留字），接口字段仍为 `references`。

### 接收：防御式规范化（非标头兼容）

新增纯函数模块 `Backend/src/services/mailHeaders.js`，集中做**不抛异常**的头字段归一化。任何非法输入都返回 `null` / 空，而非让 `simpleParser` 之后的字段访问中断整轮同步：

- `normalizeMessageId(value)`：接受 `string` / `string[]`（取第一个）/ 其它 → 非空字符串或 `null`；去首尾空白。
- `normalizeReferences(value)`：接受 `string`（按空白切分）或 `string[]`；去空、去重、保序；返回 `string[]`。
- `firstAddress(group)`：从 `mailparser` 地址组（`{ value: Address[], text, html }`）取首个 `{ name, address }`；兼容 `group` 为字符串、`value` 非数组、分组（group 项）、字段缺失等情况；失败返回 `{ name:null, address:null }`。
- `addressText(group)`：优先用 `group.text`；否则按 `"Name" <addr>` 拼接；无内容返回 `null`。
- `safeDate(value)`：`Date` 且有效 → 毫秒；否则 `null`（由调用方回退 `now`）。
- `safeSubject(value)`：`String(value ?? '')` 并折叠 CR/LF 为空格。

`insertMail` 全部改用上述辅助函数填充 `from_* / sender_* / reply_to_* / to_list / cc_list / date / message_id / in_reply_to / reference_ids / subject`，保证一封畸形邮件仍能入库（最差为最小可用字段）。

**回退规则**（在消费点实现，不改写原始头）：

- `Reply-To` 缺失时，“回复收件人”回退 `From`。
- `Sender` 缺失时其“实际发送者”语义即为 `From`；界面仅在 `senderAddr` 存在且与 `fromAddr` 不同时才额外显示。

### 数据库：新增列与幂等迁移

当前无版本化迁移系统（README 已声明）。在 `db.js` 建表语句中为 `mails` 增列，并新增**幂等** `ALTER TABLE ADD COLUMN` 兜底（用 `PRAGMA table_info` 判断列是否存在），保证老库升级与全新库都可用：

- `sender_name TEXT`
- `sender_addr TEXT`
- `reply_to_name TEXT`
- `reply_to_addr TEXT`
- `reference_ids TEXT`（接口字段名 `references`）

不引入迁移版本表，保持最小侵入。

### 发件人显示名（`mailboxes.sender_name`）

- `mailboxes` 新增 `sender_name TEXT`，同样用幂等 `ALTER TABLE` 兜底；邮箱表单新增可选「发件人名称」字段，自定义与 OAuth 邮箱都可编辑。
- 发送时 `From` 头：`sender_name` 非空 → `"显示名" <邮箱>`；为空 → 仅邮箱地址（**不回退**到邮箱管理里的 `name`）。
- 该显示名不参与信封（envelope 仍为邮箱地址）与收发去重，仅在 `From` 头展示；已发送本地副本的 `from_name` 记录实际使用的显示名。
- `GET / POST / PUT /api/mailboxes` 增加 `senderName` 字段的读写。

### 发送：生成头字段

`sendMail` 增加可选入参 `{ replyTo, inReplyTo, references, sender, messageId, date }`，映射到 `MailComposer` 选项（`replyTo` / `inReplyTo` / `references` / `sender` / `messageId` / `date`）：

- `from` 恒为发件邮箱；`sender` 仅在调用方显式提供时写入（等于 `from` 则省略）。
- `date`、`messageId` 不传时由 `MailComposer` 自动生成（`compile()` 保证有 `Message-ID`）。
- `references` 支持 `string | string[]`，统一经 `normalizeReferences` 归一。
- 信封（envelope）仍只用 `mailbox.email` 与 `to+cc`，不受这些头影响。

发送后的本地副本 INSERT 同步写入 `in_reply_to`、`reference_ids`、`sender_*`、`reply_to_*`，与接收侧格式一致。

`POST /api/mails/send` 新增可选表单字段 `replyTo`、`inReplyTo`、`references`（JSON 数组字符串或空白分隔字符串）、`sender`，透传给 `sendMail`。

### 详情接口

`GET /api/mails/:id` 响应新增：`senderName`、`senderAddr`、`replyToName`、`replyToAddr`、`inReplyTo`（原已落库、现补暴露）、`references`（解析后的字符串数组）。`GET /api/share/:token` 维持现状不改（安全裁剪边界不变）。

### 前端（不新增界面输入字段）

- `MailReader.vue`：在 `From` 之后，当 `senderAddr` 存在且与 `fromAddr` 不同时显示“发送者”；当 `replyToAddr` 存在时显示“回复至”；`Cc` 有值时显示“抄送”。
- `ComposeView.vue` 回复流程（`loadReply`）：
  - 收件人 `To` = 原邮件 `replyToAddr || fromAddr`。
  - 主题沿用 `Re:` 逻辑。
  - 隐藏字段 `inReplyTo` = 原 `messageId`；`references` = 原 `references` 追加原 `messageId`（去重保序）。
  - `send()` 仅在存在值时追加 `inReplyTo` / `references`（`references` 以 JSON 字符串提交）。
- 不新增 `Reply-To` / `Sender` 输入框（用户已确认“不加界面字段”）。

### 测试边界

无测试框架（README 已声明）。以 `node --check`、前端 `npm run build`、以及针对辅助函数与临时服务的端到端验证覆盖。辅助函数用 `node --input-type=module -e` 直接断言非标头输入不抛异常且归一正确。

## [S3] Out of Scope

- 撰写界面新增 `Reply-To` / `Sender` / `In-Reply-To` / `References` 输入框。
- `Bcc` 头（不在本需求列表）。
- `GET /api/share/:token` 增加新字段（保持既有安全裁剪）。
- 会话/线程视图、回复全部、草稿持久化。
- 自定义发件人（From 始终为所选邮箱）。
- 引入版本化数据库迁移框架。
- 修改 IMAP 标记/移动/删除等既有逻辑。

## Tasks

- [x] T1: 数据库新增列与幂等迁移 —— `db.js` 为 `mails` 增 `sender_name/sender_addr/reply_to_name/reply_to_addr/reference_ids`，建表语句与 `PRAGMA table_info`+`ALTER TABLE` 双路径 —— acceptance: 老库启动后新列存在且旧数据保留；新库建表即含新列 (covers: S2)
- [x] T2: 接收防御式规范化 —— 新增 `mailHeaders.js` 纯函数；`imap.js:insertMail` 改用辅助函数填充全部头字段 —— acceptance: 构造缺失/畸形头（无 Message-ID、非法 Date、References 为字符串、From 为空、To/Cc 非地址组）的邮件仍入库，字段降级为 null/空，不抛异常 (covers: S2)
- [x] T3: 发送生成头字段 —— `smtp.js:sendMail` 支持 `replyTo/inReplyTo/references/sender/messageId/date` 并写入本地副本；`POST /api/mails/send` 透传这些可选字段 —— acceptance: 发送带 `replyTo/inReplyTo/references` 的邮件，生成的原始报文含对应头；无输入时自动生成 Date 与 Message-ID (covers: S2)
- [x] T4: 详情接口暴露 —— `GET /api/mails/:id` 返回 `senderName/senderAddr/replyToName/replyToAddr/inReplyTo/references[]` —— acceptance: 接收含 Sender/Reply-To/References 的邮件后，详情接口返回对应字段 (covers: S2)
- [x] T5: 前端展示与回复 —— `MailReader` 显示发送者/回复至/抄送；`ComposeView` 回复时 To 取 `replyTo||from`、自动填 `inReplyTo/references` —— acceptance: 打开带 Reply-To 的邮件点回复，收件人为 Reply-To；发送表单带线程头 (covers: S2)
- [x] T6: 文档 —— 更新 README 的收发能力、API 字段与数据表列说明；必要时更新相关 spec —— acceptance: 文档与实现一致，无缺漏 (covers: S2)
- [x] T7: 验证 —— 后端逐文件 `node --check`；前端 `npm run build`；辅助函数非标头断言；临时本地服务 E2E（收发含新头字段、回复线程头）；验证后关闭服务并清理 —— acceptance: 全部命令 PASS，服务关闭无残留 (covers: S2)
- [x] T8: 发件人显示名 —— `mailboxes` 增 `sender_name`（幂等迁移）；邮箱表单增「发件人名称」；`smtp.js` 按显示名生成 `From: "名" <地址>`（空则仅地址）；`GET/POST/PUT /api/mailboxes` 读写 `senderName` —— acceptance: 配置显示名后发出邮件 `From` 含显示名、收件端可见；留空仅地址；表单可编辑并保存 (covers: S2)
