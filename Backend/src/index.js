import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { requireAuth, authRouter } from './routes/auth.js';
import { mailboxesRouter, mailboxesOAuthPublicRouter } from './routes/mailboxes.js';
import { mailsRouter } from './routes/mails.js';
import { shareRouter } from './routes/share.js';
import { initScheduler } from './services/scheduler.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// 可选：托管前端静态产物（STATIC_DIR 为空时后端只提供 API）
const staticDir = config.staticDir;
let staticIndexFile = null;

if (staticDir) {
  staticIndexFile = path.join(staticDir, 'index.html');
  if (!fs.existsSync(staticIndexFile)) {
    throw new Error(
      `STATIC_DIR 已设置但目录中找不到 index.html：${staticDir}（请先构建前端，或清空 STATIC_DIR 只提供 API）`
    );
  }
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.use('/api/auth', authRouter);

app.use('/api/mailboxes/oauth', mailboxesOAuthPublicRouter);

app.use('/api/share', shareRouter);

app.use('/api', requireAuth);
app.use('/api/mailboxes', mailboxesRouter);
app.use('/api/mails', mailsRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

if (staticDir) {
  // 静态资源：Vite 产物中带 hash 的文件长缓存，其余（index.html 等）不缓存
  app.use(
    express.static(staticDir, {
      index: 'index.html',
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // SPA 回退：非 /api 的 GET/HEAD 请求一律返回 index.html，交给 vue-router 处理
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(staticIndexFile, (err) => {
      if (err) next(err);
    });
  });
}

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '单个附件不能超过 25MB' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(413).json({ error: '附件数量不能超过 10 个' });
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

app.listen(config.port, config.host || undefined, () => {
  const host = config.host || '0.0.0.0';
  console.log(`MailFlow 后端已启动: http://${host}:${config.port}`);
  console.log(`数据目录: ${config.dataDir}`);
  console.log(staticDir ? `前端静态目录: ${staticDir}` : '前端静态目录: 未配置（仅提供 /api）');
});

initScheduler();
