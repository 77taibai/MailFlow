import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { requireAuth, authRouter } from './routes/auth.js';
import { mailboxesRouter, mailboxesOAuthPublicRouter } from './routes/mailboxes.js';
import { mailsRouter } from './routes/mails.js';
import { initScheduler } from './services/scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now() });
});

app.use('/api/auth', authRouter);

app.use('/api/mailboxes/oauth', mailboxesOAuthPublicRouter);

app.use('/api', requireAuth);
app.use('/api/mailboxes', mailboxesRouter);
app.use('/api/mails', mailsRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

const distDir = path.resolve(__dirname, '../../Frontend/dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    try {
      const html = fs.readFileSync(path.join(distDir, 'index.html'));
      res.type('html').send(html);
    } catch {
      res.status(500).send('Frontend build not found');
    }
  });
}

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

app.listen(config.port, () => {
  console.log(`MailFlow 后端已启动: http://localhost:${config.port}`);
  console.log(`数据目录: ${config.dataDir}`);
});

initScheduler();
