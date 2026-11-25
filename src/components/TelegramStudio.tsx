import {Bot, ExternalLink, Power, Send, Square, Trash2} from 'lucide-react';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {apiFetch} from '../api.ts';
import type {BotInlineButton, BotMessageReply, TelegramBotStatus} from '../types.ts';

interface TelegramStudioProps {
  token: string;
  bot: TelegramBotStatus;
  onRefresh: () => Promise<void>;
  onUnauthorized: () => void;
}

interface SimChatItem {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  inlineKeyboard?: BotInlineButton[][];
  timestamp: string;
}

export function TelegramStudio({token, bot, onRefresh, onUnauthorized}: TelegramStudioProps) {
  const [botTokenInput, setBotTokenInput] = useState('');
  const [botBusy, setBotBusy] = useState(false);
  const [botFeedback, setBotFeedback] = useState<{ok: boolean; text: string} | null>(null);

  const [simChatId] = useState('sim-user-1');
  const [simSandbox, setSimSandbox] = useState(false);
  const [simInput, setSimInput] = useState('');
  const [simBusy, setSimBusy] = useState(false);
  const [messages, setMessages] = useState<SimChatItem[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messages.length === 0) {
      void sendToSimulator({text: '/start', silentUserEcho: true});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({behavior: 'smooth'});
  }, [messages]);

  async function handleConnectBot(e: FormEvent) {
    e.preventDefault();
    setBotBusy(true);
    setBotFeedback(null);
    try {
      const res = await apiFetch<{ok: boolean; username?: string; error?: string}>(
        '/api/telegram/connect',
        {
          method: 'POST',
          token,
          body: {token: botTokenInput},
          onUnauthorized,
        },
      );
      setBotTokenInput('');
      setBotFeedback({
        ok: true,
        text: res.username
          ? `ربات @${res.username} با موفقیت متصل و دریافت پیام‌ها فعال شد.`
          : 'ربات تلگرام متصل و فعال شد.',
      });
      await onRefresh();
    } catch (err) {
      setBotFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'خطا در اتصال به ربات تلگرام',
      });
    } finally {
      setBotBusy(false);
    }
  }

  async function handleStopBot() {
    setBotBusy(true);
    try {
      await apiFetch('/api/telegram/stop', {method: 'POST', token, onUnauthorized});
      setBotFeedback({ok: true, text: 'دریافت پیام‌های ربات متوقف شد.'});
      await onRefresh();
    } finally {
      setBotBusy(false);
    }
  }

  async function handleClearBotToken() {
    setBotBusy(true);
    try {
      await apiFetch('/api/telegram/token', {method: 'DELETE', token, onUnauthorized});
      setBotFeedback({ok: true, text: 'توکن ربات از حافظه سرور پاک شد.'});
      await onRefresh();
    } finally {
      setBotBusy(false);
    }
  }

  async function handleSettingChange(patch: {
    defaultAutoClaimHourTehran?: number;
    sandboxModeDefault?: boolean;
  }) {
    await apiFetch('/api/telegram/settings', {
      method: 'PATCH',
      token,
      body: patch,
      onUnauthorized,
    });
    await onRefresh();
  }

  async function sendToSimulator(opts: {
    text?: string;
    callbackData?: string;
    buttonLabel?: string;
    silentUserEcho?: boolean;
  }) {
    const userText = opts.buttonLabel || opts.text || '';
    if (!opts.silentUserEcho && userText) {
      setMessages((prev) => [
        ...prev,
        {
          id: `u-${Date.now()}-${Math.random()}`,
          sender: 'user',
          text: userText,
          timestamp: new Date().toLocaleTimeString('fa-IR', {hour: '2-digit', minute: '2-digit'}),
        },
      ]);
    }

    setSimBusy(true);
    try {
      const res = await apiFetch<{ok: boolean; replies: BotMessageReply[]}>('/api/telegram/simulate', {
        method: 'POST',
        token,
        body: {
          chatId: simChatId,
          text: opts.text,
          callbackData: opts.callbackData,
          sandboxOverride: simSandbox,
        },
        onUnauthorized,
      });

      const mapped: SimChatItem[] = res.replies.map((r) => ({
        id: r.id,
        sender: 'bot',
        text: r.text,
        inlineKeyboard: r.inlineKeyboard,
        timestamp: new Date(r.timestamp).toLocaleTimeString('fa-IR', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      }));

      setMessages((prev) => [...prev, ...mapped]);
      await onRefresh();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'bot',
          text: err instanceof Error ? err.message : 'خطا در ارتباط با موتور ربات',
          timestamp: new Date().toLocaleTimeString('fa-IR', {hour: '2-digit', minute: '2-digit'}),
        },
      ]);
    } finally {
      setSimBusy(false);
    }
  }

  function handleSimSubmit(e: FormEvent) {
    e.preventDefault();
    if (!simInput.trim() || simBusy) return;
    const text = simInput.trim();
    setSimInput('');
    void sendToSimulator({text});
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Live Telegram Bot Connection */}
      <div className="lg:col-span-5 space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
            <div className="w-9 h-9 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">اتصال زنده به ربات تلگرام</h2>
              <p className="text-xs text-slate-500">
                با وارد کردن توکن @BotFather، ربات بلافاصله روی سرور فعال و پاسخگو می‌شود.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">وضعیت اتصال</span>
              <span className={bot.pollingActive ? 'font-medium text-emerald-700' : 'text-slate-700'}>
                {bot.pollingActive ? 'آنلاین · دریافت خودکار پیام‌ها' : bot.configured ? 'متوقف' : 'بدون توکن'}
              </span>
            </div>

            <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-500">نام کاربری ربات</span>
              {bot.botUsername ? (
                <a
                  href={`https://t.me/${bot.botUsername}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline"
                  dir="ltr"
                >
                  <span>@{bot.botUsername}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>

            <div className="flex items-center justify-between py-1.5">
              <span className="text-slate-500">توکن ثبت‌شده</span>
              <span className="font-mono text-xs text-slate-600 tabular-nums" dir="ltr">
                {bot.maskedToken || 'ثبت نشده'}
                {bot.fromEnv ? ' (ENV)' : ''}
              </span>
            </div>
          </div>

          {bot.lastPollingError && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
              آخرین خطای ارتباط با تلگرام: {bot.lastPollingError}
            </div>
          )}

          <form onSubmit={handleConnectBot} className="mt-5 space-y-3">
            <div>
              <label htmlFor="tg-token" className="block text-xs font-medium text-slate-700 mb-1.5">
                توکن ربات تلگرام (از @BotFather)
              </label>
              <input
                id="tg-token"
                type="password"
                value={botTokenInput}
                onChange={(e) => setBotTokenInput(e.target.value)}
                placeholder="123456789:ABCdefGHIjklMNO..."
                dir="ltr"
                className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={botBusy || (!botTokenInput.trim() && !bot.configured)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Power className="w-4 h-4" />
                <span>{botBusy ? 'در حال اتصال...' : bot.pollingActive ? 'بروزرسانی و راه‌اندازی مجدد' : 'اتصال و شروع ربات'}</span>
              </button>

              {bot.pollingActive && (
                <button
                  type="button"
                  disabled={botBusy}
                  onClick={handleStopBot}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>توقف</span>
                </button>
              )}

              {bot.configured && !bot.fromEnv && (
                <button
                  type="button"
                  disabled={botBusy}
                  onClick={handleClearBotToken}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>حذف توکن</span>
                </button>
              )}
            </div>
          </form>

          {botFeedback && (
            <div
              className={`mt-4 p-3 rounded-lg border text-xs ${
                botFeedback.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {botFeedback.text}
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">تنظیمات پیش‌فرض ربات</h3>

          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-800">ساعت پیش‌فرض دریافت خودکار</div>
              <div className="text-xs text-slate-500">برای حساب‌های جدیدی که از تلگرام ثبت می‌شوند</div>
            </div>
            <select
              value={bot.defaultAutoClaimHourTehran}
              onChange={(e) => handleSettingChange({defaultAutoClaimHourTehran: Number(e.target.value)})}
              className="px-3 py-1.5 text-sm font-mono border border-slate-200 rounded-lg bg-white tabular-nums"
            >
              {[0, 6, 8, 9, 10, 12, 14, 18, 20, 22].map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00 تهران
                </option>
              ))}
            </select>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-800">حالت شبیه‌ساز پیش‌فرض برای تست</div>
              <div className="text-xs text-slate-500">
                در صورت فعال بودن، ثبت شماره در تلگرام با کد 12345 شبیه‌سازی می‌شود
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSettingChange({sandboxModeDefault: !bot.sandboxModeDefault})}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 cursor-pointer ${
                bot.sandboxModeDefault
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              {bot.sandboxModeDefault ? 'فعال (آزمایشی)' : 'خاموش (API واقعی)'}
            </button>
          </div>
        </section>
      </div>

      {/* Interactive Telegram Chat Simulator */}
      <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col h-[640px]">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">محیط تست تعاملی ربات تلگرام</div>
            <div className="text-xs text-slate-300">
              متصل به موتور اصلی ربات · دکمه‌های شیشه‌ای و دستورات دقیقاً مثل تلگرام واقعی کار می‌کنند
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={simSandbox}
              onChange={(e) => setSimSandbox(e.target.checked)}
              className="rounded border-slate-500 text-sky-500"
            />
            <span>تست آفلاین (کد 12345)</span>
          </label>
        </div>

        {/* Quick commands */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto">
          {['/start', '/add', '/claim', '/accounts', '/schedule', '/cancel'].map((cmd) => (
            <button
              key={cmd}
              type="button"
              disabled={simBusy}
              onClick={() => void sendToSimulator({text: cmd})}
              dir="ltr"
              className="px-2.5 py-1 text-xs font-mono text-slate-700 bg-white border border-slate-200 hover:border-sky-400 hover:text-sky-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
            >
              {cmd}
            </button>
          ))}
        </div>

        {/* Messages viewport */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-100/70">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-start' : 'items-end'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                  msg.sender === 'user'
                    ? 'bg-sky-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                <div>{msg.text}</div>
                <div
                  className={`mt-1.5 text-[11px] font-mono tabular-nums ${
                    msg.sender === 'user' ? 'text-sky-100' : 'text-slate-400'
                  }`}
                >
                  {msg.timestamp}
                </div>
              </div>

              {msg.inlineKeyboard && msg.inlineKeyboard.length > 0 && (
                <div className="mt-2 max-w-[85%] w-full space-y-1.5">
                  {msg.inlineKeyboard.map((row, rIdx) => (
                    <div key={rIdx} className="flex flex-wrap gap-1.5">
                      {row.map((btn) => (
                        <button
                          key={btn.callback_data + btn.text}
                          type="button"
                          disabled={simBusy}
                          onClick={() =>
                            void sendToSimulator({
                              callbackData: btn.callback_data,
                              buttonLabel: btn.text,
                            })
                          }
                          className="flex-1 min-w-[120px] px-3 py-2 text-xs font-medium text-sky-900 bg-white hover:bg-sky-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                        >
                          {btn.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input bar */}
        <form onSubmit={handleSimSubmit} className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
          <input
            type="text"
            value={simInput}
            onChange={(e) => setSimInput(e.target.value)}
            placeholder="پیام یا شماره موبایل یا کد تایید را اینجا بنویسید..."
            className="flex-1 px-3.5 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={simBusy || !simInput.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>ارسال</span>
          </button>
        </form>
      </section>
    </div>
  );
}
