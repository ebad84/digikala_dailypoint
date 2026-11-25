import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  getAuthStatus,
  requireAdminAuth,
  setupFirstAdminPasscode,
  signAdminToken,
  verifyAdminPasscode,
} from './server/auth.ts';
import {claimDigikalaDailyPoint, sendDigikalaOtp, verifyDigikalaOtp} from './server/digikala.ts';
import {getFixedPythonBotFiles} from './server/pythonExporter.ts';
import {runScheduledClaimsPass, startDailyScheduler} from './server/scheduler.ts';
import {getTehranNow, loadStore, saveStore, toPublicAccount} from './server/storage.ts';
import {
  bootTelegramBotIfConfigured,
  disableAndClearBotToken,
  getTelegramBotStatus,
  processBotInteraction,
  stopTelegramBotPolling,
  verifyAndStartTelegramBot,
} from './server/telegramBot.ts';

const PORT = Number(process.env.PORT) || 3000;

async function createServer() {
  const app = express();
  app.use(express.json({limit: '256kb'}));

  app.get('/api/health', (_req, res) => {
    res.json({ok: true, tehran: getTehranNow()});
  });

  app.get('/api/auth/status', (_req, res) => {
    res.json({ok: true, ...getAuthStatus()});
  });

  app.post('/api/auth/setup', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const result = setupFirstAdminPasscode(passcode);
    if (!result.ok) {
      res.status(400).json({ok: false, error: result.error});
      return;
    }
    const token = signAdminToken();
    res.json({ok: true, token});
  });

  app.post('/api/auth/login', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    if (!passcode || !verifyAdminPasscode(passcode)) {
      res.status(401).json({ok: false, error: 'رمز عبور مدیر نادرست است.'});
      return;
    }
    const token = signAdminToken();
    res.json({ok: true, token});
  });

  app.get('/api/dashboard', requireAdminAuth, (_req, res) => {
    const store = loadStore();
    res.json({
      ok: true,
      tehran: getTehranNow(),
      bot: getTelegramBotStatus(),
      accounts: store.accounts.map(toPublicAccount),
      logs: store.logs.slice(0, 80),
    });
  });

  app.post('/api/digikala/send-otp', requireAdminAuth, async (req, res) => {
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone : '';
    const sandbox = typeof req.body?.sandbox === 'boolean' ? req.body.sandbox : undefined;
    const result = await sendDigikalaOtp({
      rawPhone,
      scope: 'admin',
      sandbox,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/digikala/verify-otp', requireAdminAuth, async (req, res) => {
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone : '';
    const rawCode = typeof req.body?.code === 'string' ? req.body.code : '';
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 48) : undefined;
    const telegramChatId =
      typeof req.body?.telegramChatId === 'string' && req.body.telegramChatId.trim()
        ? req.body.telegramChatId.trim().slice(0, 32)
        : null;

    const result = await verifyDigikalaOtp({
      rawPhone,
      rawCode,
      scope: 'admin',
      label,
      telegramChatId,
    });
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/accounts/:id/claim', requireAdminAuth, async (req, res) => {
    const id = String(req.params.id || '');
    const result = await claimDigikalaDailyPoint(id, 'manual');
    res.status(result.status === 'error' && !result.account ? 404 : 200).json(result);
  });

  app.patch('/api/accounts/:id', requireAdminAuth, (req, res) => {
    const id = String(req.params.id || '');
    const store = loadStore();
    const idx = store.accounts.findIndex((a) => a.id === id);
    if (idx < 0) {
      res.status(404).json({ok: false, error: 'حساب یافت نشد.'});
      return;
    }

    const acc = store.accounts[idx];
    if (typeof req.body?.label === 'string') {
      acc.label = req.body.label.trim().slice(0, 48) || acc.label;
    }
    if (typeof req.body?.autoClaimEnabled === 'boolean') {
      acc.autoClaimEnabled = req.body.autoClaimEnabled;
    }
    if (typeof req.body?.autoClaimHourTehran === 'number') {
      const hour = Math.floor(req.body.autoClaimHourTehran);
      if (hour >= 0 && hour <= 23) {
        acc.autoClaimHourTehran = hour;
      }
    }
    if (typeof req.body?.telegramChatId === 'string') {
      acc.telegramChatId = req.body.telegramChatId.trim().slice(0, 32) || null;
    }

    store.accounts[idx] = acc;
    saveStore(store);
    res.json({ok: true, account: toPublicAccount(acc)});
  });

  app.delete('/api/accounts/:id', requireAdminAuth, (req, res) => {
    const id = String(req.params.id || '');
    const store = loadStore();
    const idx = store.accounts.findIndex((a) => a.id === id);
    if (idx < 0) {
      res.status(404).json({ok: false, error: 'حساب یافت نشد.'});
      return;
    }
    store.accounts.splice(idx, 1);
    saveStore(store);
    res.json({ok: true});
  });

  app.post('/api/scheduler/run-now', requireAdminAuth, async (_req, res) => {
    const summary = await runScheduledClaimsPass();
    res.json({ok: true, ...summary});
  });

  app.post('/api/telegram/connect', requireAdminAuth, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : undefined;
    const result = await verifyAndStartTelegramBot(token && token.length > 0 ? token : undefined);
    res.status(result.ok ? 200 : 400).json({
      ...result,
      bot: getTelegramBotStatus(),
    });
  });

  app.post('/api/telegram/stop', requireAdminAuth, (_req, res) => {
    stopTelegramBotPolling();
    const store = loadStore();
    store.bot.botEnabled = false;
    saveStore(store);
    res.json({ok: true, bot: getTelegramBotStatus()});
  });

  app.delete('/api/telegram/token', requireAdminAuth, (_req, res) => {
    disableAndClearBotToken();
    res.json({ok: true, bot: getTelegramBotStatus()});
  });

  app.patch('/api/telegram/settings', requireAdminAuth, (req, res) => {
    const store = loadStore();
    if (typeof req.body?.defaultAutoClaimHourTehran === 'number') {
      const hour = Math.floor(req.body.defaultAutoClaimHourTehran);
      if (hour >= 0 && hour <= 23) {
        store.bot.defaultAutoClaimHourTehran = hour;
      }
    }
    if (typeof req.body?.sandboxModeDefault === 'boolean') {
      store.bot.sandboxModeDefault = req.body.sandboxModeDefault;
    }
    saveStore(store);
    res.json({ok: true, bot: getTelegramBotStatus()});
  });

  app.post('/api/telegram/simulate', requireAdminAuth, async (req, res) => {
    const chatId =
      typeof req.body?.chatId === 'string' && req.body.chatId.trim()
        ? req.body.chatId.trim().slice(0, 32)
        : 'sim-user-1';
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined;
    const callbackData = typeof req.body?.callbackData === 'string' ? req.body.callbackData : undefined;
    const sandboxOverride =
      typeof req.body?.sandboxOverride === 'boolean' ? req.body.sandboxOverride : undefined;

    const replies = await processBotInteraction({
      chatId,
      firstName: 'کاربر آزمایشی',
      text,
      callbackData,
      sandboxOverride,
    });
    res.json({ok: true, replies});
  });

  app.get('/api/export/python-bot', requireAdminAuth, (_req, res) => {
    res.json({ok: true, files: getFixedPythonBotFiles()});
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Digikala DailyPoint server listening on http://0.0.0.0:${PORT}`);
    startDailyScheduler();
    void bootTelegramBotIfConfigured();
  });
}

void createServer();
