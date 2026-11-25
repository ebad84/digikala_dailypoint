import crypto from 'crypto';
import {claimDigikalaDailyPoint, sendDigikalaOtp, verifyDigikalaOtp} from './digikala.ts';
import {loadStore, saveStore} from './storage.ts';
import type {BotInlineButton, BotMessageReply} from './types.ts';

type ConversationState =
  | {step: 'idle'}
  | {step: 'awaiting_phone'; sandbox?: boolean}
  | {step: 'awaiting_otp'; phone: string; sandbox?: boolean};

const chatStates = new Map<string, ConversationState>();

let pollingActive = false;
let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let pollingOffset = 0;
let pollingAbort: AbortController | null = null;
let lastPollingError: string | null = null;

function getEffectiveToken(): string {
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (envToken) return envToken;
  const store = loadStore();
  return store.bot.telegramBotToken?.trim() || '';
}

function mainMenuKeyboard(): BotInlineButton[][] {
  return [
    [
      {text: '➕ افزودن شماره جدید', callback_data: 'action:add'},
      {text: '🎯 دریافت امتیاز امروز', callback_data: 'action:claim_all'},
    ],
    [
      {text: '📋 حساب‌های من', callback_data: 'action:accounts'},
      {text: '⏰ زمان‌بندی خودکار', callback_data: 'action:schedule'},
    ],
    [{text: '❓ راهنما و وضعیت', callback_data: 'action:help'}],
  ];
}

function cancelKeyboard(): BotInlineButton[][] {
  return [[{text: '❌ انصراف و بازگشت', callback_data: 'action:cancel'}]];
}

function formatBotReply(text: string, inlineKeyboard?: BotInlineButton[][]): BotMessageReply {
  return {
    id: crypto.randomUUID(),
    text,
    inlineKeyboard,
    timestamp: new Date().toISOString(),
  };
}

export async function processBotInteraction(params: {
  chatId: string;
  firstName?: string;
  text?: string;
  callbackData?: string;
  sandboxOverride?: boolean;
}): Promise<BotMessageReply[]> {
  const chatId = String(params.chatId);
  const store = loadStore();
  const userAccounts = store.accounts.filter((a) => a.telegramChatId === chatId);
  const currentState = chatStates.get(chatId) || {step: 'idle'};

  if (params.callbackData) {
    const cb = params.callbackData;

    if (cb === 'action:cancel' || cb === 'action:menu') {
      chatStates.set(chatId, {step: 'idle'});
      return [
        formatBotReply(
          'منوی اصلی ربات دیجی کالا دیلی پوینت:\nیکی از گزینه‌های زیر را انتخاب کنید.',
          mainMenuKeyboard(),
        ),
      ];
    }

    if (cb === 'action:add') {
      chatStates.set(chatId, {step: 'awaiting_phone', sandbox: params.sandboxOverride});
      return [
        formatBotReply(
          'لطفاً شماره موبایل متصل به حساب دیجی‌کالای خود را وارد کنید:\nمثال: 09123456789',
          cancelKeyboard(),
        ),
      ];
    }

    if (cb.startsWith('action:resend:')) {
      const phone = cb.slice('action:resend:'.length);
      const res = await sendDigikalaOtp({
        rawPhone: phone,
        scope: `tg:${chatId}`,
        telegramChatId: chatId,
        sandbox: params.sandboxOverride,
      });
      if (res.ok && res.phone) {
        chatStates.set(chatId, {step: 'awaiting_otp', phone: res.phone, sandbox: res.sandbox});
        return [formatBotReply(res.message, cancelKeyboard())];
      }
      return [
        formatBotReply(res.message, [
          [{text: '🔄 تلاش مجدد ارسال کد', callback_data: `action:resend:${phone}`}],
          [{text: '❌ انصراف', callback_data: 'action:cancel'}],
        ]),
      ];
    }

    if (cb === 'action:accounts') {
      if (userAccounts.length === 0) {
        return [
          formatBotReply('هنوز هیچ شماره دیجی‌کالایی ثبت نکرده‌اید.', [
            [{text: '➕ افزودن اولین شماره', callback_data: 'action:add'}],
            [{text: '🏠 منوی اصلی', callback_data: 'action:menu'}],
          ]),
        ];
      }

      const lines = userAccounts.map((acc, idx) => {
        const pts = acc.totalPoints !== null ? `${acc.totalPoints} امتیاز` : 'نامشخص';
        const autoStr = acc.autoClaimEnabled
          ? `فعال (ساعت ${acc.autoClaimHourTehran}:00)`
          : 'غیرفعال';
        const statusText = acc.lastClaimMessage || 'ثبت‌شده';
        return `${idx + 1}. شماره ${acc.phone}\n   موجودی: ${pts} | خودکار: ${autoStr}\n   آخرین وضعیت: ${statusText}`;
      });

      const buttons: BotInlineButton[][] = userAccounts.map((acc) => [
        {text: `🎯 دریافت امتیاز ${acc.phone}`, callback_data: `action:claim_one:${acc.id}`},
        {text: `🗑 حذف`, callback_data: `action:delete_confirm:${acc.id}`},
      ]);
      buttons.push([
        {text: '➕ افزودن شماره', callback_data: 'action:add'},
        {text: '🏠 منوی اصلی', callback_data: 'action:menu'},
      ]);

      return [formatBotReply(`حساب‌های ثبت‌شده شما (${userAccounts.length}):\n\n${lines.join('\n\n')}`, buttons)];
    }

    if (cb.startsWith('action:claim_one:')) {
      const accId = cb.slice('action:claim_one:'.length);
      const owned = userAccounts.find((a) => a.id === accId);
      if (!owned) {
        return [formatBotReply('این حساب یافت نشد یا متعلق به شما نیست.', mainMenuKeyboard())];
      }
      const result = await claimDigikalaDailyPoint(owned.id, 'telegram');
      const ptsInfo = result.totalPoints !== null ? `\nموجودی کل دیجی‌کلاب: ${result.totalPoints} امتیاز` : '';
      return [
        formatBotReply(`نتیجه برای ${owned.phone}:\n${result.message}${ptsInfo}`, [
          [{text: '📋 بازگشت به حساب‌ها', callback_data: 'action:accounts'}],
          [{text: '🏠 منوی اصلی', callback_data: 'action:menu'}],
        ]),
      ];
    }

    if (cb === 'action:claim_all') {
      if (userAccounts.length === 0) {
        return [
          formatBotReply('حسابی برای دریافت امتیاز ثبت نشده است. ابتدا یک شماره اضافه کنید.', [
            [{text: '➕ افزودن شماره جدید', callback_data: 'action:add'}],
          ]),
        ];
      }

      const reports: string[] = [];
      for (const acc of userAccounts) {
        const res = await claimDigikalaDailyPoint(acc.id, 'telegram');
        const pts = res.totalPoints !== null ? ` (موجودی: ${res.totalPoints})` : '';
        reports.push(`• ${acc.phone}: ${res.message}${pts}`);
      }

      return [
        formatBotReply(`گزارش دریافت امتیاز روزانه:\n\n${reports.join('\n')}`, mainMenuKeyboard()),
      ];
    }

    if (cb.startsWith('action:delete_confirm:')) {
      const accId = cb.slice('action:delete_confirm:'.length);
      const owned = userAccounts.find((a) => a.id === accId);
      if (!owned) {
        return [formatBotReply('حساب یافت نشد.', mainMenuKeyboard())];
      }
      return [
        formatBotReply(`آیا از حذف شماره ${owned.phone} مطمئن هستید؟`, [
          [
            {text: '✅ بله، حذف شود', callback_data: `action:delete_yes:${owned.id}`},
            {text: 'خیر، بازگشت', callback_data: 'action:accounts'},
          ],
        ]),
      ];
    }

    if (cb.startsWith('action:delete_yes:')) {
      const accId = cb.slice('action:delete_yes:'.length);
      const freshStore = loadStore();
      const targetIdx = freshStore.accounts.findIndex(
        (a) => a.id === accId && a.telegramChatId === chatId,
      );
      if (targetIdx < 0) {
        return [formatBotReply('حساب یافت نشد.', mainMenuKeyboard())];
      }
      const removedPhone = freshStore.accounts[targetIdx].phone;
      freshStore.accounts.splice(targetIdx, 1);
      saveStore(freshStore);
      return [
        formatBotReply(`حساب ${removedPhone} با موفقیت حذف شد.`, [
          [{text: '📋 حساب‌های من', callback_data: 'action:accounts'}],
          [{text: '🏠 منوی اصلی', callback_data: 'action:menu'}],
        ]),
      ];
    }

    if (cb === 'action:schedule') {
      if (userAccounts.length === 0) {
        return [
          formatBotReply('برای تنظیم زمان‌بندی خودکار، ابتدا یک حساب دیجی‌کالا اضافه کنید.', [
            [{text: '➕ افزودن شماره جدید', callback_data: 'action:add'}],
          ]),
        ];
      }
      const enabledCount = userAccounts.filter((a) => a.autoClaimEnabled).length;
      const sampleHour = userAccounts[0]?.autoClaimHourTehran ?? 9;
      return [
        formatBotReply(
          `تنظیمات زمان‌بندی خودکار (به وقت تهران):\nوضعیت فعلی: ${enabledCount > 0 ? `فعال (${enabledCount} حساب)` : 'غیرفعال'}\nساعت اجرا: ${String(sampleHour).padStart(2, '0')}:00\n\nساعت دریافت خودکار روزانه را انتخاب کنید:`,
          [
            [
              {text: enabledCount > 0 ? '⏸ غیرفعال کردن خودکار' : '▶️ فعال کردن خودکار', callback_data: 'action:sched_toggle'},
            ],
            [
              {text: '00:00 بامداد', callback_data: 'action:sched_hour:0'},
              {text: '08:00 صبح', callback_data: 'action:sched_hour:8'},
              {text: '09:00 صبح', callback_data: 'action:sched_hour:9'},
            ],
            [
              {text: '14:00 ظهر', callback_data: 'action:sched_hour:14'},
              {text: '20:00 شب', callback_data: 'action:sched_hour:20'},
              {text: '🏠 منوی اصلی', callback_data: 'action:menu'},
            ],
          ],
        ),
      ];
    }

    if (cb === 'action:sched_toggle') {
      const freshStore = loadStore();
      const owned = freshStore.accounts.filter((a) => a.telegramChatId === chatId);
      const anyEnabled = owned.some((a) => a.autoClaimEnabled);
      for (const acc of owned) {
        acc.autoClaimEnabled = !anyEnabled;
      }
      saveStore(freshStore);
      return [
        formatBotReply(
          !anyEnabled
            ? 'زمان‌بندی خودکار روزانه برای همه حساب‌های شما فعال شد.'
            : 'زمان‌بندی خودکار روزانه غیرفعال شد.',
          [
            [{text: '⏰ تنظیم ساعت اجرا', callback_data: 'action:schedule'}],
            [{text: '🏠 منوی اصلی', callback_data: 'action:menu'}],
          ],
        ),
      ];
    }

    if (cb.startsWith('action:sched_hour:')) {
      const hour = Number(cb.slice('action:sched_hour:'.length));
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        return [formatBotReply('ساعت نامعتبر است.', mainMenuKeyboard())];
      }
      const freshStore = loadStore();
      for (const acc of freshStore.accounts) {
        if (acc.telegramChatId === chatId) {
          acc.autoClaimEnabled = true;
          acc.autoClaimHourTehran = hour;
        }
      }
      saveStore(freshStore);
      return [
        formatBotReply(
          `ساعت دریافت خودکار روزانه روی ${String(hour).padStart(2, '0')}:00 به وقت تهران تنظیم و فعال شد.`,
          mainMenuKeyboard(),
        ),
      ];
    }

    if (cb === 'action:help') {
      return [
        formatBotReply(
          'راهنمای ربات دیجی کالا دیلی پوینت:\n\n' +
            '۱. با دکمه «افزودن شماره جدید» شماره موبایل خود را ثبت و کد پیامکی را تایید کنید.\n' +
            '۲. هر کاربر فقط به شماره‌های خودش دسترسی دارد.\n' +
            '۳. ربات هر روز در ساعت مشخص‌شده به‌صورت خودکار امتیاز روزانه دیجی‌کلاب را دریافت و نتیجه را به شما اطلاع می‌دهد.\n' +
            '۴. دستورات سریع: /start ، /add ، /claim ، /accounts ، /schedule',
          mainMenuKeyboard(),
        ),
      ];
    }
  }

  const rawText = (params.text || '').trim();
  const command = rawText.split(/\s+/)[0]?.toLowerCase() || '';

  if (command === '/start' || command === '/menu' || rawText === 'منوی اصلی') {
    chatStates.set(chatId, {step: 'idle'});
    const name = params.firstName ? ` ${params.firstName}` : '';
    return [
      formatBotReply(
        `سلام${name}!\nبه ربات دیجی کالا دیلی پوینت خوش آمدید.\n\nبا این ربات می‌توانید حساب‌های دیجی‌کالای خود را متصل کنید تا امتیاز روزانه دیجی‌کلاب به‌صورت خودکار یا با یک کلیک دریافت شود.`,
        mainMenuKeyboard(),
      ),
    ];
  }

  if (command === '/cancel' || rawText === 'انصراف') {
    chatStates.set(chatId, {step: 'idle'});
    return [formatBotReply('عملیات لغو شد.', mainMenuKeyboard())];
  }

  if (command === '/add') {
    return processBotInteraction({
      chatId,
      callbackData: 'action:add',
      sandboxOverride: params.sandboxOverride,
    });
  }

  if (command === '/claim') {
    return processBotInteraction({chatId, callbackData: 'action:claim_all'});
  }

  if (command === '/accounts') {
    return processBotInteraction({chatId, callbackData: 'action:accounts'});
  }

  if (command === '/schedule') {
    return processBotInteraction({chatId, callbackData: 'action:schedule'});
  }

  if (command === '/help') {
    return processBotInteraction({chatId, callbackData: 'action:help'});
  }

  if (currentState.step === 'awaiting_phone') {
    const res = await sendDigikalaOtp({
      rawPhone: rawText,
      scope: `tg:${chatId}`,
      telegramChatId: chatId,
      sandbox: currentState.sandbox ?? params.sandboxOverride,
    });
    if (res.ok && res.phone) {
      chatStates.set(chatId, {
        step: 'awaiting_otp',
        phone: res.phone,
        sandbox: res.sandbox,
      });
      return [formatBotReply(res.message, cancelKeyboard())];
    }
    return [
      formatBotReply(res.message, [
        ...(res.phone ? [[{text: '🔄 تلاش مجدد ارسال کد', callback_data: `action:resend:${res.phone}`}]] : []),
        [{text: '❌ انصراف', callback_data: 'action:cancel'}],
      ]),
    ];
  }

  if (currentState.step === 'awaiting_otp') {
    const res = await verifyDigikalaOtp({
      rawPhone: currentState.phone,
      rawCode: rawText,
      scope: `tg:${chatId}`,
      telegramChatId: chatId,
    });

    if (res.ok && res.account) {
      chatStates.set(chatId, {step: 'idle'});
      return [
        formatBotReply(res.message, [
          [{text: '🎯 دریافت امتیاز الان', callback_data: `action:claim_one:${res.account.id}`}],
          [{text: '⏰ تنظیم ساعت خودکار', callback_data: 'action:schedule'}],
          [{text: '🏠 منوی اصلی', callback_data: 'action:menu'}],
        ]),
      ];
    }

    return [
      formatBotReply(res.message, [
        [{text: '🔄 ارسال مجدد کد تایید', callback_data: `action:resend:${currentState.phone}`}],
        [{text: '❌ انصراف', callback_data: 'action:cancel'}],
      ]),
    ];
  }

  return [
    formatBotReply(
      'دستور نامشخص بود. لطفاً از دکمه‌های منوی زیر استفاده کنید:',
      mainMenuKeyboard(),
    ),
  ];
}

async function telegramApiCall(token: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = (await res.json()) as {ok: boolean; result?: unknown; description?: string};
  if (!data.ok) {
    throw new Error(data.description || `Telegram API error on ${method}`);
  }
  return data.result;
}

export async function sendTelegramNotification(chatId: string, text: string): Promise<boolean> {
  const token = getEffectiveToken();
  if (!token || !chatId || chatId.startsWith('sim-')) {
    return false;
  }
  try {
    await telegramApiCall(token, 'sendMessage', {
      chat_id: chatId,
      text,
    });
    return true;
  } catch {
    return false;
  }
}

async function dispatchRepliesToTelegram(token: string, chatId: string, replies: BotMessageReply[]) {
  for (const reply of replies) {
    await telegramApiCall(token, 'sendMessage', {
      chat_id: chatId,
      text: reply.text,
      reply_markup: reply.inlineKeyboard ? {inline_keyboard: reply.inlineKeyboard} : undefined,
    });
  }
}

interface RawTelegramUpdate {
  update_id: number;
  message?: {
    chat: {id: number};
    from?: {first_name?: string};
    text?: string;
    contact?: {phone_number?: string};
  };
  callback_query?: {
    id: string;
    from?: {first_name?: string};
    message?: {chat: {id: number}};
    data?: string;
  };
}

export async function handleIncomingTelegramUpdate(update: RawTelegramUpdate, tokenOverride?: string) {
  const token = tokenOverride || getEffectiveToken();
  if (!token) return;

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id;
    try {
      await telegramApiCall(token, 'answerCallbackQuery', {callback_query_id: cq.id});
    } catch {
      // Ignore expired callback query ack errors
    }
    if (chatId) {
      const replies = await processBotInteraction({
        chatId: String(chatId),
        firstName: cq.from?.first_name,
        callbackData: cq.data,
      });
      await dispatchRepliesToTelegram(token, String(chatId), replies);
    }
    return;
  }

  if (update.message) {
    const msg = update.message;
    const chatId = String(msg.chat.id);
    const inputText = msg.text || msg.contact?.phone_number || '';
    if (!inputText) return;
    const replies = await processBotInteraction({
      chatId,
      firstName: msg.from?.first_name,
      text: inputText,
    });
    await dispatchRepliesToTelegram(token, chatId, replies);
  }
}

async function pollLoop() {
  if (!pollingActive) return;
  const token = getEffectiveToken();
  if (!token) {
    pollingActive = false;
    return;
  }

  pollingAbort = new AbortController();
  try {
    const updates = (await telegramApiCall(
      token,
      'getUpdates',
      {
        offset: pollingOffset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      },
      pollingAbort.signal,
    )) as RawTelegramUpdate[];

    lastPollingError = null;
    for (const upd of updates) {
      pollingOffset = Math.max(pollingOffset, upd.update_id + 1);
      await handleIncomingTelegramUpdate(upd, token);
    }
  } catch (err) {
    if (pollingActive) {
      const msg = err instanceof Error ? err.message : 'Polling error';
      if (!msg.includes('aborted')) {
        lastPollingError = msg;
      }
    }
  }

  if (pollingActive) {
    pollingTimer = setTimeout(pollLoop, 1000);
  }
}

export async function verifyAndStartTelegramBot(tokenInput?: string): Promise<{
  ok: boolean;
  username?: string;
  firstName?: string;
  error?: string;
}> {
  const store = loadStore();
  const token = (tokenInput ?? getEffectiveToken()).trim();
  if (!token) {
    return {ok: false, error: 'توکن ربات تلگرام وارد نشده است.'};
  }

  try {
    const me = (await telegramApiCall(token, 'getMe')) as {username?: string; first_name?: string};
    await telegramApiCall(token, 'setMyCommands', {
      commands: [
        {command: 'start', description: 'منوی اصلی ربات'},
        {command: 'add', description: 'افزودن شماره دیجی‌کالا'},
        {command: 'claim', description: 'دریافت امتیاز امروز'},
        {command: 'accounts', description: 'مدیریت حساب‌های من'},
        {command: 'schedule', description: 'تنظیم زمان‌بندی خودکار'},
        {command: 'help', description: 'راهنما'},
      ],
    });

    if (tokenInput !== undefined && !process.env.TELEGRAM_BOT_TOKEN?.trim()) {
      store.bot.telegramBotToken = token;
    }
    store.bot.botUsername = me.username || null;
    store.bot.botFirstName = me.first_name || null;
    store.bot.botEnabled = true;
    saveStore(store);

    stopTelegramBotPolling();
    pollingActive = true;
    lastPollingError = null;
    void pollLoop();

    return {
      ok: true,
      username: me.username,
      firstName: me.first_name,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'توکن نامعتبر یا خطا در اتصال به تلگرام';
    return {ok: false, error};
  }
}

export function stopTelegramBotPolling(): void {
  pollingActive = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  if (pollingAbort) {
    pollingAbort.abort();
    pollingAbort = null;
  }
}

export function disableAndClearBotToken(): void {
  stopTelegramBotPolling();
  const store = loadStore();
  store.bot.telegramBotToken = '';
  store.bot.botUsername = null;
  store.bot.botFirstName = null;
  store.bot.botEnabled = false;
  saveStore(store);
}

export function getTelegramBotStatus() {
  const store = loadStore();
  const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const effective = getEffectiveToken();
  const masked =
    effective.length > 10 ? `${effective.slice(0, 6)}••••${effective.slice(-4)}` : effective ? '••••' : null;
  return {
    configured: Boolean(effective),
    fromEnv: Boolean(envToken),
    pollingActive,
    botEnabled: store.bot.botEnabled,
    botUsername: store.bot.botUsername,
    botFirstName: store.bot.botFirstName,
    maskedToken: masked,
    lastPollingError,
    defaultAutoClaimHourTehran: store.bot.defaultAutoClaimHourTehran,
    sandboxModeDefault: store.bot.sandboxModeDefault,
  };
}

export async function bootTelegramBotIfConfigured(): Promise<void> {
  const store = loadStore();
  const token = getEffectiveToken();
  if (token && (process.env.TELEGRAM_BOT_TOKEN?.trim() || store.bot.botEnabled)) {
    await verifyAndStartTelegramBot(token);
  }
}
