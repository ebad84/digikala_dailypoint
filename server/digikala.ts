import crypto from 'crypto';
import {addClaimLog, getTehranNow, loadStore, saveStore, toPublicAccount} from './storage.ts';
import type {AccountRecord, ClaimOutcome, ClaimSource, PublicAccountView} from './types.ts';

const OTP_TTL_MS = 150_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_OTP_ATTEMPTS = 5;

const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface PendingOtpEntry {
  phone: string;
  scope: string;
  cookies: Record<string, string>;
  createdAt: number;
  resendAt: number;
  expiresAt: number;
  attempts: number;
  sandbox: boolean;
}

const pendingOtps = new Map<string, PendingOtpEntry>();

export function normalizeDigits(input: string): string {
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  return input
    .replace(/[۰-۹]/g, (d) => String(persian.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(arabic.indexOf(d)));
}

export function normalizeIranPhone(raw: string): {ok: true; phone: string} | {ok: false; error: string} {
  let cleaned = normalizeDigits(String(raw || '').trim()).replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+98')) {
    cleaned = '0' + cleaned.slice(3);
  } else if (cleaned.startsWith('0098')) {
    cleaned = '0' + cleaned.slice(4);
  } else if (cleaned.startsWith('98') && cleaned.length === 12) {
    cleaned = '0' + cleaned.slice(2);
  } else if (cleaned.startsWith('9') && cleaned.length === 10) {
    cleaned = '0' + cleaned;
  }

  if (!/^09\d{9}$/.test(cleaned)) {
    return {
      ok: false,
      error: 'شماره موبایل معتبر نیست. شماره باید ۱۱ رقم و با 09 شروع شود (مثلاً 09123456789).',
    };
  }
  return {ok: true, phone: cleaned};
}

function getPendingKey(scope: string, phone: string): string {
  return `${scope}:${phone}`;
}

function cleanupExpiredOtp(key: string): PendingOtpEntry | null {
  const entry = pendingOtps.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pendingOtps.delete(key);
    return null;
  }
  return entry;
}

function mergeSetCookies(jar: Record<string, string>, headers: Headers): Record<string, string> {
  const next = {...jar};
  const setCookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];

  for (const rawCookie of setCookies) {
    const firstPart = rawCookie.split(';')[0]?.trim();
    if (!firstPart) continue;
    const eqIndex = firstPart.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = firstPart.slice(0, eqIndex).trim();
    const value = firstPart.slice(eqIndex + 1).trim();
    if (name) {
      if (value === 'deleted' || value === '') {
        delete next[name];
      } else {
        next[name] = value;
      }
    }
  }
  return next;
}

function buildCookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function buildPageHeaders(jar: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  const cookieStr = buildCookieHeader(jar);
  if (cookieStr) headers.Cookie = cookieStr;
  return headers;
}

function buildApiHeaders(jar: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
    'Content-Type': 'application/json',
    Origin: 'https://www.digikala.com',
    Referer: 'https://www.digikala.com/users/login/',
    'x-web-client': 'desktop',
    'x-web-optimize-response': '1',
  };
  const cookieStr = buildCookieHeader(jar);
  if (cookieStr) headers.Cookie = cookieStr;
  return headers;
}

async function safeParseJson(response: Response): Promise<{json: Record<string, unknown> | null; text: string}> {
  const text = await response.text();
  try {
    return {json: JSON.parse(text) as Record<string, unknown>, text};
  } catch {
    return {json: null, text};
  }
}

function extractDigikalaError(json: Record<string, unknown> | null, fallback: string): string {
  if (!json) return fallback;
  if (typeof json.message === 'string' && json.message.trim()) return json.message.trim();
  const data = json.data as Record<string, unknown> | undefined;
  if (data && typeof data.message === 'string' && data.message.trim()) return data.message.trim();
  const errors = json.errors as Record<string, unknown> | string[] | undefined;
  if (Array.isArray(errors) && typeof errors[0] === 'string') return errors[0];
  if (errors && typeof errors === 'object') {
    const firstVal = Object.values(errors)[0];
    if (typeof firstVal === 'string') return firstVal;
    if (Array.isArray(firstVal) && typeof firstVal[0] === 'string') return firstVal[0];
  }
  return fallback;
}

export async function sendDigikalaOtp(params: {
  rawPhone: string;
  scope: string;
  telegramChatId?: string | null;
  sandbox?: boolean;
}): Promise<{
  ok: boolean;
  phone?: string;
  message: string;
  ttlSeconds?: number;
  sandbox?: boolean;
}> {
  const normalized = normalizeIranPhone(params.rawPhone);
  if (!normalized.ok) {
    return {ok: false, message: normalized.error};
  }
  const phone = normalized.phone;
  const key = getPendingKey(params.scope, phone);
  const existing = cleanupExpiredOtp(key);
  const now = Date.now();

  if (existing && now < existing.resendAt) {
    const waitSec = Math.ceil((existing.resendAt - now) / 1000);
    return {
      ok: false,
      phone,
      message: `کد تایید قبلاً ارسال شده است. لطفاً ${waitSec} ثانیه دیگر صبر کنید یا کد ارسال‌شده را وارد نمایید.`,
    };
  }

  const store = loadStore();
  const useSandbox = params.sandbox ?? store.bot.sandboxModeDefault;

  if (useSandbox) {
    pendingOtps.set(key, {
      phone,
      scope: params.scope,
      cookies: {sandbox_session: crypto.randomUUID()},
      createdAt: now,
      resendAt: now + 10_000,
      expiresAt: now + OTP_TTL_MS,
      attempts: 0,
      sandbox: true,
    });
    return {
      ok: true,
      phone,
      sandbox: true,
      ttlSeconds: Math.round(OTP_TTL_MS / 1000),
      message: `حالت تست شبیه‌ساز فعال است. برای تایید شماره ${phone} کد آزمایشی 12345 را وارد کنید.`,
    };
  }

  try {
    let jar: Record<string, string> = {};
    const loginPageRes = await fetch('https://www.digikala.com/users/login/', {
      method: 'GET',
      headers: buildPageHeaders(jar),
      signal: AbortSignal.timeout(12_000),
    });
    jar = mergeSetCookies(jar, loginPageRes.headers);

    const authRes = await fetch('https://api.digikala.com/v1/user/authenticate/', {
      method: 'POST',
      headers: buildApiHeaders(jar),
      body: JSON.stringify({
        username: phone,
        otp_call: false,
        hash: null,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    jar = mergeSetCookies(jar, authRes.headers);
    const {json, text} = await safeParseJson(authRes);

    if (!json) {
      const blocked =
        authRes.status === 403 ||
        text.toLowerCase().includes('cloudflare') ||
        text.toLowerCase().includes('arvan');
      return {
        ok: false,
        phone,
        message: blocked
          ? `درخواست توسط فایروال دیجی‌کالا مسدود شد (کد ${authRes.status}). می‌توانید از حالت تست شبیه‌ساز استفاده کنید یا ربات پایتون خروجی را روی سرور ایران اجرا نمایید.`
          : `پاسخ غیرمنتظره از سرور دیجی‌کالا دریافت شد (کد ${authRes.status}).`,
      };
    }

    const apiStatus = Number(json.status);
    if (!authRes.ok || apiStatus !== 200) {
      return {
        ok: false,
        phone,
        message: extractDigikalaError(json, `ارسال کد تایید ناموفق بود (وضعیت ${apiStatus || authRes.status}).`),
      };
    }

    const dataObj = (json.data as Record<string, unknown>) || {};
    const timerSec = typeof dataObj.timer === 'number' && dataObj.timer > 0 ? dataObj.timer : 120;
    const ttlMs = Math.max(timerSec * 1000, OTP_TTL_MS);

    pendingOtps.set(key, {
      phone,
      scope: params.scope,
      cookies: jar,
      createdAt: now,
      resendAt: now + RESEND_COOLDOWN_MS,
      expiresAt: now + ttlMs,
      attempts: 0,
      sandbox: false,
    });

    return {
      ok: true,
      phone,
      sandbox: false,
      ttlSeconds: Math.round(ttlMs / 1000),
      message: `کد تایید پیامکی به شماره ${phone} ارسال شد. لطفاً کد را وارد کنید.`,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'خطای ارتباط با سرور';
    return {
      ok: false,
      phone,
      message: `خطا در ارتباط با API دیجی‌کالا: ${errMsg}`,
    };
  }
}

async function fetchDigiClubPoints(
  jar: Record<string, string>,
  sandbox: boolean,
  existingTotal: number | null,
): Promise<{ok: boolean; totalPoints: number | null; expired: boolean}> {
  if (sandbox) {
    return {ok: true, totalPoints: existingTotal ?? 120, expired: false};
  }
  try {
    const res = await fetch('https://api.digikala.com/v1/digiclub/', {
      method: 'GET',
      headers: buildApiHeaders(jar),
      signal: AbortSignal.timeout(10_000),
    });
    const {json} = await safeParseJson(res);
    if (!json) {
      return {ok: false, totalPoints: existingTotal, expired: res.status === 401};
    }
    const status = Number(json.status);
    if (res.status === 401 || status === 401) {
      return {ok: false, totalPoints: existingTotal, expired: true};
    }
    const data = (json.data as Record<string, unknown>) || {};
    const userObj = (data.user as Record<string, unknown>) || {};
    const pointsCandidate =
      typeof data.point === 'number'
        ? data.point
        : typeof data.points === 'number'
          ? data.points
          : typeof userObj.point === 'number'
            ? userObj.point
            : typeof userObj.points === 'number'
              ? userObj.points
              : null;
    return {ok: status === 200, totalPoints: pointsCandidate ?? existingTotal, expired: false};
  } catch {
    return {ok: false, totalPoints: existingTotal, expired: false};
  }
}

export async function verifyDigikalaOtp(params: {
  rawPhone: string;
  rawCode: string;
  scope: string;
  telegramChatId?: string | null;
  label?: string;
}): Promise<{
  ok: boolean;
  account?: PublicAccountView;
  message: string;
}> {
  const normalized = normalizeIranPhone(params.rawPhone);
  if (!normalized.ok) {
    return {ok: false, message: normalized.error};
  }
  const phone = normalized.phone;
  const code = normalizeDigits(String(params.rawCode || '').trim()).replace(/\s+/g, '');

  if (!/^\d{4,8}$/.test(code)) {
    return {ok: false, message: 'فرمت کد تایید صحیح نیست. لطفاً کد عددی پیامک‌شده را وارد کنید.'};
  }

  const key = getPendingKey(params.scope, phone);
  const entry = cleanupExpiredOtp(key);
  if (!entry) {
    return {
      ok: false,
      message: 'درخواست کد تایید یافت نشد یا منقضی شده است. لطفاً دوباره شماره را ثبت و کد جدید دریافت کنید.',
    };
  }

  if (entry.attempts >= MAX_OTP_ATTEMPTS) {
    pendingOtps.delete(key);
    return {
      ok: false,
      message: 'تعداد تلاش‌های اشتباه بیش از حد مجاز بود. لطفاً کد تایید جدیدی درخواست کنید.',
    };
  }

  let nextCookies = {...entry.cookies};
  let initialPoints: number | null = null;

  if (entry.sandbox) {
    if (code !== '12345') {
      entry.attempts += 1;
      return {
        ok: false,
        message: `کد تایید آزمایشی نادرست است (در حالت شبیه‌ساز کد 12345 را وارد کنید).`,
      };
    }
    initialPoints = 120;
    nextCookies = {
      sandbox_auth: crypto.randomBytes(12).toString('hex'),
    };
  } else {
    try {
      const loginRes = await fetch('https://api.digikala.com/v1/user/login/otp/', {
        method: 'POST',
        headers: buildApiHeaders(nextCookies),
        body: JSON.stringify({
          type: 'otp',
          username: phone,
          code,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      nextCookies = mergeSetCookies(nextCookies, loginRes.headers);
      const {json} = await safeParseJson(loginRes);

      if (!json) {
        entry.attempts += 1;
        return {
          ok: false,
          message: `خطا در خواندن پاسخ ورود دیجی‌کالا (کد ${loginRes.status}).`,
        };
      }

      const apiStatus = Number(json.status);
      if (!loginRes.ok || apiStatus !== 200) {
        entry.attempts += 1;
        return {
          ok: false,
          message: extractDigikalaError(json, 'کد تایید نادرست است یا منقضی شده است.'),
        };
      }

      if (Object.keys(nextCookies).length === 0) {
        return {
          ok: false,
          message: 'ورود تایید شد اما کوکی نشست از دیجی‌کالا دریافت نشد.',
        };
      }

      const clubInfo = await fetchDigiClubPoints(nextCookies, false, null);
      initialPoints = clubInfo.totalPoints;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'خطای شبکه';
      return {ok: false, message: `خطا در تایید کد با سرور دیجی‌کالا: ${errMsg}`};
    }
  }

  pendingOtps.delete(key);

  const store = loadStore();
  const existingIdx = store.accounts.findIndex(
    (a) => a.phone === phone && (a.telegramChatId || null) === (params.telegramChatId || null),
  );

  const nowIso = new Date().toISOString();
  let saved: AccountRecord;

  if (existingIdx >= 0) {
    const prev = store.accounts[existingIdx];
    saved = {
      ...prev,
      label: params.label?.trim() || prev.label,
      cookies: nextCookies,
      sandbox: entry.sandbox,
      totalPoints: initialPoints ?? prev.totalPoints,
      lastClaimMessage: 'نشست با موفقیت به‌روزرسانی شد',
    };
    store.accounts[existingIdx] = saved;
  } else {
    saved = {
      id: crypto.randomUUID(),
      phone,
      label: params.label?.trim() || `حساب ${phone.slice(-4)}`,
      telegramChatId: params.telegramChatId || null,
      cookies: nextCookies,
      sandbox: entry.sandbox,
      createdAt: nowIso,
      lastClaimAt: null,
      lastClaimDateTehran: null,
      lastClaimStatus: null,
      lastClaimMessage: 'آماده دریافت امتیاز روزانه',
      totalPoints: initialPoints,
      autoClaimEnabled: true,
      autoClaimHourTehran: store.bot.defaultAutoClaimHourTehran,
    };
    store.accounts.unshift(saved);
  }

  saveStore(store);

  return {
    ok: true,
    account: toPublicAccount(saved),
    message: `شماره ${phone} با موفقیت احراز هویت و ذخیره شد${initialPoints !== null ? ` (موجودی فعلی: ${initialPoints} امتیاز)` : ''}.`,
  };
}

export async function claimDigikalaDailyPoint(
  accountId: string,
  source: ClaimSource,
): Promise<{
  ok: boolean;
  status: ClaimOutcome;
  gainedPoints: number;
  totalPoints: number | null;
  message: string;
  account?: PublicAccountView;
}> {
  const store = loadStore();
  const idx = store.accounts.findIndex((a) => a.id === accountId);
  if (idx < 0) {
    return {
      ok: false,
      status: 'error',
      gainedPoints: 0,
      totalPoints: null,
      message: 'حساب مورد نظر یافت نشد.',
    };
  }

  const acc = store.accounts[idx];
  const tehran = getTehranNow();
  const nowIso = new Date().toISOString();

  let outcome: ClaimOutcome = 'error';
  let gainedPoints = 0;
  let totalPoints: number | null = acc.totalPoints;
  let message = '';
  let updatedCookies = {...acc.cookies};

  if (acc.sandbox) {
    if (acc.lastClaimDateTehran === tehran.dateStr && acc.lastClaimStatus === 'claimed') {
      outcome = 'already_claimed';
      gainedPoints = 0;
      totalPoints = acc.totalPoints ?? 120;
      message = `امتیاز روزانه شماره ${acc.phone} امروز قبلاً دریافت شده است (شبیه‌ساز).`;
    } else {
      outcome = 'claimed';
      gainedPoints = 5;
      totalPoints = (acc.totalPoints ?? 120) + gainedPoints;
      message = `امتیاز روزانه با موفقیت دریافت شد (+${gainedPoints} امتیاز در حالت شبیه‌ساز).`;
    }
  } else {
    try {
      const claimRes = await fetch('https://api.digikala.com/v1/digiclub/dynamic-daily-mission/', {
        method: 'POST',
        headers: buildApiHeaders(updatedCookies),
        body: JSON.stringify({mission_id: 1}),
        signal: AbortSignal.timeout(12_000),
      });
      updatedCookies = mergeSetCookies(updatedCookies, claimRes.headers);
      const {json, text} = await safeParseJson(claimRes);

      if (!json) {
        outcome = claimRes.status === 401 ? 'expired' : 'error';
        message =
          claimRes.status === 401
            ? 'نشست حساب منقضی شده است. لطفاً دوباره وارد شوید.'
            : `پاسخ نامعتبر از دیجی‌کلاب (کد ${claimRes.status}${text ? '' : ''}).`;
      } else {
        const apiStatus = Number(json.status);
        const dataObj = (json.data as Record<string, unknown>) || {};
        const apiMsg = extractDigikalaError(json, '');

        if (claimRes.status === 401 || apiStatus === 401 || apiMsg.includes('وارد شوید')) {
          outcome = 'expired';
          message = 'نشست دیجی‌کالا منقضی شده است. لطفاً شماره را دوباره تایید کنید.';
        } else if (claimRes.ok && apiStatus === 200) {
          outcome = 'claimed';
          const rawGained =
            typeof dataObj.gained_point === 'number'
              ? dataObj.gained_point
              : typeof dataObj.point === 'number'
                ? dataObj.point
                : typeof dataObj.points === 'number'
                  ? dataObj.points
                  : 5;
          gainedPoints = rawGained;
          const club = await fetchDigiClubPoints(updatedCookies, false, acc.totalPoints);
          totalPoints =
            club.totalPoints !== null
              ? club.totalPoints
              : acc.totalPoints !== null
                ? acc.totalPoints + gainedPoints
                : null;
          message =
            apiMsg ||
            `امتیاز روزانه دیجی‌کلاب دریافت شد (+${gainedPoints} امتیاز).`;
        } else if (
          apiMsg.includes('قبلا') ||
          apiMsg.includes('قبلاً') ||
          apiMsg.includes('تکراری') ||
          apiMsg.toLowerCase().includes('already')
        ) {
          outcome = 'already_claimed';
          const club = await fetchDigiClubPoints(updatedCookies, false, acc.totalPoints);
          totalPoints = club.totalPoints;
          message = apiMsg || 'امتیاز امروز قبلاً دریافت شده است.';
        } else {
          outcome = 'error';
          message = apiMsg || `دریافت امتیاز ناموفق بود (وضعیت ${apiStatus || claimRes.status}).`;
        }
      }
    } catch (err) {
      outcome = 'error';
      message = `خطا در ارتباط با دیجی‌کلاب: ${err instanceof Error ? err.message : 'خطای شبکه'}`;
    }
  }

  acc.cookies = updatedCookies;
  acc.lastClaimAt = nowIso;
  if (outcome === 'claimed' || outcome === 'already_claimed') {
    acc.lastClaimDateTehran = tehran.dateStr;
  }
  acc.lastClaimStatus = outcome;
  acc.lastClaimMessage = message;
  acc.totalPoints = totalPoints;
  store.accounts[idx] = acc;
  saveStore(store);

  addClaimLog({
    id: crypto.randomUUID(),
    accountId: acc.id,
    phone: acc.phone,
    telegramChatId: acc.telegramChatId,
    timestamp: nowIso,
    tehranDate: tehran.dateStr,
    source: acc.sandbox ? 'sandbox' : source,
    status: outcome,
    gainedPoints,
    totalPoints,
    message,
  });

  return {
    ok: outcome === 'claimed' || outcome === 'already_claimed',
    status: outcome,
    gainedPoints,
    totalPoints,
    message,
    account: toPublicAccount(acc),
  };
}
