import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { requireAuth, authRouter } from './routes/auth.js';
import { mailboxesRouter, mailboxesOAuthPublicRouter } from './routes/mailboxes.js';
import { mailsRouter } from './routes/mails.js';
import { shareRouter } from './routes/share.js';
import { initScheduler } from './services/scheduler.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

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

const mountFrontend = () => {
  if (config.devMode) {
    console.log('开发模式：不托管前端构建产物，仅提供 API');
    return;
  }
  const distDir = config.frontendDist;
  const indexFile = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    console.log(`未找到前端构建产物: ${indexFile}，仅提供 API`);
    return;
  }

  const hashedAsset = /\.[0-9a-f]{8,}\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i;
  // dist 顶层目录（如 assets/）内的缺失文件应 404，而不是回退成 index.html
  const assetDirs = new Set(
    fs.readdirSync(distDir)
      .filter((name) => {
        try {
          return fs.statSync(path.join(distDir, name)).isDirectory();
        } catch {
          return false;
        }
      }),
  );

  app.use(express.static(distDir, {
    index: false,
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath === indexFile) res.setHeader('Cache-Control', 'no-cache');
      else if (hashedAsset.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  // SPA 回退：非资源路径的 GET/HEAD 请求返回 index.html，交给前端路由处理
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const firstSegment = req.path.split('/')[1] || '';
    if (assetDirs.has(firstSegment)) return next();
    try {
      const html = await fs.promises.readFile(indexFile);
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (err) {
      next(err);
    }
  });

  console.log(`前端静态资源: ${distDir}`);
};

mountFrontend();

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
});

initScheduler();
