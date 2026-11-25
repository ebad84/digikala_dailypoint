import {Clock, Play, Plus, RefreshCw, Search, Trash2} from 'lucide-react';
import {useMemo, useState, type FormEvent} from 'react';
import {apiFetch} from '../api.ts';
import type {ClaimLog, ClaimOutcome, PublicAccountView, TehranClock, TelegramBotStatus} from '../types.ts';

interface AccountsDashboardProps {
  token: string;
  accounts: PublicAccountView[];
  logs: ClaimLog[];
  bot: TelegramBotStatus;
  tehran: TehranClock;
  showAddForm: boolean;
  onToggleAddForm: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onUnauthorized: () => void;
}

function outcomeLabel(status: ClaimOutcome | null): {text: string; toneClass: string} {
  switch (status) {
    case 'claimed':
      return {text: 'موفق · امتیاز دریافت شد', toneClass: 'text-emerald-700'};
    case 'already_claimed':
      return {text: 'تکمیل · امروز دریافت شده', toneClass: 'text-slate-700'};
    case 'expired':
      return {text: 'منقضی‌شده · نیاز به ورود مجدد', toneClass: 'text-amber-700'};
    case 'error':
      return {text: 'خطا در دریافت', toneClass: 'text-rose-700'};
    default:
      return {text: 'آماده دریافت', toneClass: 'text-slate-600'};
  }
}

function sourceLabel(source: ClaimLog['source']): string {
  switch (source) {
    case 'telegram':
      return 'ربات تلگرام';
    case 'scheduler':
      return 'زمان‌بند خودکار';
    case 'sandbox':
      return 'شبیه‌ساز آزمایشی';
    default:
      return 'اجرای دستی پنل';
  }
}

export function AccountsDashboard({
  token,
  accounts,
  logs,
  bot,
  tehran,
  showAddForm,
  onToggleAddForm,
  onRefresh,
  onUnauthorized,
}: AccountsDashboardProps) {
  const [search, setSearch] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phoneInput, setPhoneInput] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [chatIdInput, setChatIdInput] = useState('');
  const [useSandbox, setUseSandbox] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{ok: boolean; text: string} | null>(null);
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.phone.includes(q) ||
        a.label.toLowerCase().includes(q) ||
        (a.telegramChatId || '').toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const totalPointsSum = useMemo(() => {
    return accounts.reduce((sum, acc) => sum + (acc.totalPoints || 0), 0);
  }, [accounts]);

  const claimedTodayCount = useMemo(() => {
    return accounts.filter(
      (a) =>
        a.lastClaimDateTehran === tehran.dateStr &&
        (a.lastClaimStatus === 'claimed' || a.lastClaimStatus === 'already_claimed'),
    ).length;
  }, [accounts, tehran.dateStr]);

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormFeedback(null);
    try {
      const res = await apiFetch<{ok: boolean; phone?: string; message: string}>(
        '/api/digikala/send-otp',
        {
          method: 'POST',
          token,
          body: {phone: phoneInput, sandbox: useSandbox},
          onUnauthorized,
        },
      );
      setNormalizedPhone(res.phone || phoneInput);
      setStep('otp');
      setFormFeedback({ok: true, text: res.message});
    } catch (err) {
      setFormFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'خطا در ارسال کد تایید',
      });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormFeedback(null);
    try {
      const res = await apiFetch<{ok: boolean; message: string}>('/api/digikala/verify-otp', {
        method: 'POST',
        token,
        body: {
          phone: normalizedPhone || phoneInput,
          code: otpInput,
          label: labelInput,
          telegramChatId: chatIdInput,
        },
        onUnauthorized,
      });
      setFormFeedback({ok: true, text: res.message});
      setPhoneInput('');
      setOtpInput('');
      setLabelInput('');
      setChatIdInput('');
      setStep('phone');
      await onRefresh();
    } catch (err) {
      setFormFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'خطا در تایید کد',
      });
    } finally {
      setFormBusy(false);
    }
  }

  async function handleClaimNow(accountId: string) {
    setBusyAccountId(accountId);
    setActionFeedback(null);
    try {
      const res = await apiFetch<{message: string}>(`/api/accounts/${accountId}/claim`, {
        method: 'POST',
        token,
        onUnauthorized,
      });
      setActionFeedback(res.message);
      await onRefresh();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'خطا در دریافت امتیاز');
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleToggleAuto(acc: PublicAccountView) {
    setBusyAccountId(acc.id);
    try {
      await apiFetch(`/api/accounts/${acc.id}`, {
        method: 'PATCH',
        token,
        body: {autoClaimEnabled: !acc.autoClaimEnabled},
        onUnauthorized,
      });
      await onRefresh();
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleHourChange(acc: PublicAccountView, hour: number) {
    setBusyAccountId(acc.id);
    try {
      await apiFetch(`/api/accounts/${acc.id}`, {
        method: 'PATCH',
        token,
        body: {autoClaimHourTehran: hour, autoClaimEnabled: true},
        onUnauthorized,
      });
      await onRefresh();
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleDelete(acc: PublicAccountView) {
    setBusyAccountId(acc.id);
    try {
      await apiFetch(`/api/accounts/${acc.id}`, {
        method: 'DELETE',
        token,
        onUnauthorized,
      });
      await onRefresh();
    } finally {
      setBusyAccountId(null);
    }
  }

  async function handleRunSchedulerNow() {
    setSchedulerBusy(true);
    setActionFeedback(null);
    try {
      const res = await apiFetch<{checked: number; triggered: number}>('/api/scheduler/run-now', {
        method: 'POST',
        token,
        onUnauthorized,
      });
      setActionFeedback(
        `بررسی زمان‌بند انجام شد: ${res.checked} حساب بررسی و ${res.triggered} حساب اجرا شد.`,
      );
      await onRefresh();
    } catch (err) {
      setActionFeedback(err instanceof Error ? err.message : 'خطا در اجرای زمان‌بند');
    } finally {
      setSchedulerBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* 4-column summary strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">حساب‌های متصل</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{accounts.length}</div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {claimedTodayCount} حساب امروز دریافت شده
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">مجموع امتیاز ثبت‌شده</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {totalPointsSum.toLocaleString('fa-IR')}
          </div>
          <div className="mt-1 text-xs text-slate-500">دیجی‌کلاب در حساب‌های فعال</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">وضعیت ربات تلگرام</div>
          <div className="mt-2 text-lg font-bold text-slate-900">
            {bot.pollingActive ? 'متصل و فعال' : bot.configured ? 'متوقف‌شده' : 'تنظیم‌نشده'}
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono" dir="ltr">
            {bot.botUsername ? `@${bot.botUsername}` : 'توکن @BotFather متصل نشده'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="text-xs font-medium text-slate-500">زمان رسمی تهران</div>
          <div className="mt-2 text-lg font-bold text-slate-900 tabular-nums font-mono" dir="ltr">
            {String(tehran.hour).padStart(2, '0')}:{String(tehran.minute).padStart(2, '0')}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">{tehran.dateStr} · زمان‌بند فعال</div>
        </div>
      </section>

      {/* Add account drawer/section */}
      {showAddForm && (
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-base font-bold text-slate-900">افزودن یا تمدید نشست حساب دیجی‌کالا</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                جریان ورود دو مرحله‌ای با مدیریت صحیح انقضای کد و ذخیره امن نشست JSON
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onToggleAddForm(false);
                setStep('phone');
                setFormFeedback(null);
              }}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              بستن فرم
            </button>
          </div>

          {step === 'phone' ? (
            <form onSubmit={handleSendOtp} className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div className="md:col-span-4">
                <label htmlFor="dk-phone" className="block text-xs font-medium text-slate-700 mb-1.5">
                  شماره موبایل دیجی‌کالا
                </label>
                <input
                  id="dk-phone"
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="09123456789"
                  dir="ltr"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
                />
              </div>

              <div className="md:col-span-3">
                <label htmlFor="dk-label" className="block text-xs font-medium text-slate-700 mb-1.5">
                  نام دلخواه (اختیاری)
                </label>
                <input
                  id="dk-label"
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  placeholder="مثلاً خط شخصی"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
                />
              </div>

              <div className="md:col-span-3">
                <label className="flex items-center gap-2 text-xs text-slate-700 py-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useSandbox}
                    onChange={(e) => setUseSandbox(e.target.checked)}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  <span>حالت تست شبیه‌ساز (کد آزمایشی 12345)</span>
                </label>
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={formBusy}
                  className="w-full px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {formBusy ? 'در حال ارسال...' : 'ارسال کد تایید'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="mt-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
              <div className="md:col-span-3">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">شماره ثبت‌شده</label>
                <input
                  type="text"
                  value={normalizedPhone || phoneInput}
                  disabled
                  dir="ltr"
                  className="w-full px-3.5 py-2 text-sm border border-slate-200 bg-slate-100 text-slate-700 rounded-lg font-mono"
                />
              </div>

              <div className="md:col-span-3">
                <label htmlFor="dk-otp" className="block text-xs font-medium text-slate-700 mb-1.5">
                  کد تایید پیامکی
                </label>
                <input
                  id="dk-otp"
                  type="text"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  placeholder={useSandbox ? '12345' : 'کد تایید'}
                  dir="ltr"
                  required
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
                />
              </div>

              <div className="md:col-span-3">
                <label htmlFor="dk-chatid" className="block text-xs font-medium text-slate-700 mb-1.5">
                  شناسه تلگرام کاربر (اختیاری)
                </label>
                <input
                  id="dk-chatid"
                  type="text"
                  value={chatIdInput}
                  onChange={(e) => setChatIdInput(e.target.value)}
                  placeholder="مثلاً 123456789"
                  dir="ltr"
                  className="w-full px-3.5 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600"
                />
              </div>

              <div className="md:col-span-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={formBusy}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {formBusy ? 'در حال بررسی...' : 'تایید و ذخیره'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setOtpInput('');
                    setFormFeedback(null);
                  }}
                  className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  تغییر شماره
                </button>
              </div>
            </form>
          )}

          {formFeedback && (
            <div
              className={`mt-4 p-3 rounded-lg border text-sm ${
                formFeedback.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              {formFeedback.text}
            </div>
          )}
        </section>
      )}

      {/* Accounts table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">حساب‌های دیجی‌کالا و زمان‌بندی روزانه</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              حساب‌هایی که از ربات تلگرام یا فرم پنل متصل شده‌اند در این جدول مدیریت می‌شوند.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جستجوی شماره یا برچسب..."
                className="pr-9 pl-3 py-1.5 text-sm border border-slate-200 rounded-lg w-56 focus:outline-none focus:border-slate-400"
              />
            </div>

            <button
              type="button"
              onClick={handleRunSchedulerNow}
              disabled={schedulerBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{schedulerBusy ? 'در حال اجرا...' : 'اجرای زمان‌بند الان'}</span>
            </button>

            <button
              type="button"
              onClick={() => onRefresh()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>بروزرسانی</span>
            </button>
          </div>
        </div>

        {actionFeedback && (
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 text-sm text-slate-800">
            {actionFeedback}
          </div>
        )}

        {filteredAccounts.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-600">
              {accounts.length === 0
                ? 'هنوز هیچ حساب دیجی‌کالایی ثبت نشده است. می‌توانید از دکمه زیر یا از داخل تب ربات تلگرام اولین شماره را اضافه کنید.'
                : 'حسابی با این عبارت جستجو یافت نشد.'}
            </p>
            {accounts.length === 0 && (
              <button
                type="button"
                onClick={() => onToggleAddForm(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ثبت اولین شماره دیجی‌کالا</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">شماره و برچسب</th>
                  <th className="py-3 px-4">مالک تلگرام</th>
                  <th className="py-3 px-4">امتیاز دیجی‌کلاب</th>
                  <th className="py-3 px-4">وضعیت آخرین اجرا</th>
                  <th className="py-3 px-4">زمان‌بند خودکار</th>
                  <th className="py-3 px-4 text-left">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredAccounts.map((acc) => {
                  const status = outcomeLabel(acc.lastClaimStatus);
                  const isBusy = busyAccountId === acc.id;
                  return (
                    <tr key={acc.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-slate-900 tabular-nums" dir="ltr">
                          {acc.phone}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {acc.label}
                          {acc.sandbox ? ' · شبیه‌ساز' : ' · واقعی'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums" dir="ltr">
                        {acc.telegramChatId || 'مدیر پنل'}
                      </td>
                      <td className="py-3 px-4 font-mono font-semibold text-slate-900 tabular-nums">
                        {acc.totalPoints !== null ? acc.totalPoints.toLocaleString('fa-IR') : '—'}
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className={`text-xs font-medium ${status.toneClass}`}>{status.text}</div>
                        {acc.lastClaimMessage && (
                          <div className="text-xs text-slate-500 truncate mt-0.5" title={acc.lastClaimMessage}>
                            {acc.lastClaimMessage}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleToggleAuto(acc)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap shrink-0 cursor-pointer ${
                              acc.autoClaimEnabled
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-slate-50 border-slate-200 text-slate-600'
                            }`}
                          >
                            {acc.autoClaimEnabled ? 'فعال' : 'خاموش'}
                          </button>
                          <select
                            value={acc.autoClaimHourTehran}
                            disabled={isBusy}
                            onChange={(e) => handleHourChange(acc, Number(e.target.value))}
                            className="px-2 py-1 text-xs font-mono border border-slate-200 rounded-md bg-white text-slate-700 tabular-nums"
                          >
                            {[0, 6, 8, 9, 10, 12, 14, 18, 20, 22].map((h) => (
                              <option key={h} value={h}>
                                {String(h).padStart(2, '0')}:00
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-left">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleClaimNow(acc.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                            <span>{isBusy ? '...' : 'دریافت امتیاز'}</span>
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDelete(acc)}
                            aria-label={`حذف ${acc.phone}`}
                            className="p-1.5 text-slate-400 hover:text-rose-600 border border-slate-200 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Activity logs */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-900">تاریخچه دریافت امتیازها</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            گزارش آخرین تلاش‌های دستی، تلگرامی و زمان‌بند روزانه
          </p>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            هنوز گزارشی ثبت نشده است. با دریافت اولین امتیاز، جزئیات آن اینجا نمایش داده می‌شود.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">شماره</th>
                  <th className="py-2.5 px-4">منبع</th>
                  <th className="py-2.5 px-4">نتیجه</th>
                  <th className="py-2.5 px-4">امتیاز کسب‌شده</th>
                  <th className="py-2.5 px-4">تاریخ تهران</th>
                  <th className="py-2.5 px-4">پیام سرور</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {logs.slice(0, 20).map((log) => {
                  const st = outcomeLabel(log.status);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-mono text-slate-900 tabular-nums" dir="ltr">
                        {log.phone}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600">{sourceLabel(log.source)}</td>
                      <td className={`py-2.5 px-4 font-medium ${st.toneClass}`}>{st.text}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-900 tabular-nums">
                        {log.gainedPoints > 0 ? `+${log.gainedPoints}` : '0'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-500 tabular-nums" dir="ltr">
                        {log.tehranDate}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 max-w-sm truncate" title={log.message}>
                        {log.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
