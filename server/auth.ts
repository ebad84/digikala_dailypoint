import crypto from 'crypto';
import type {NextFunction, Request, Response} from 'express';
import {loadStore, saveStore} from './storage.ts';

const TOKEN_SECRET =
  process.env.SESSION_SECRET?.trim() ||
  process.env.ADMIN_SESSION_SECRET?.trim() ||
  crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexKey] = parts;
  if (!salt || !hexKey) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hexKey, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function getAuthStatus(): {
  configured: boolean;
  needsSetup: boolean;
  source: 'env' | 'stored' | 'none';
} {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    return {configured: true, needsSetup: false, source: 'env'};
  }
  const store = loadStore();
  if (store.adminHash) {
    return {configured: true, needsSetup: false, source: 'stored'};
  }
  return {configured: false, needsSetup: true, source: 'none'};
}

export function verifyAdminPasscode(passcode: string): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    return crypto.timingSafeEqual(sha256(passcode), sha256(envPass));
  }
  const store = loadStore();
  if (!store.adminHash) {
    return false;
  }
  return verifyPasswordHash(passcode, store.adminHash);
}

export function setupFirstAdminPasscode(passcode: string): {ok: boolean; error?: string} {
  if (process.env.ADMIN_PASSCODE?.trim()) {
    return {ok: false, error: 'رمز ادمین از طریق متغیر محیطی تنظیم شده است.'};
  }
  const store = loadStore();
  if (store.adminHash) {
    return {ok: false, error: 'رمز ادمین قبلاً ثبت شده است.'};
  }
  if (typeof passcode !== 'string' || passcode.trim().length < 6) {
    return {ok: false, error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.'};
  }
  store.adminHash = hashPassword(passcode);
  saveStore(store);
  return {ok: true};
}

export function signAdminToken(): string {
  const now = Date.now();
  const payload = {
    role: 'admin',
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifyAdminToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encodedPayload, sig] = parts;
  if (!encodedPayload || !sig) return false;
  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(encodedPayload)
    .digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      role?: string;
      exp?: number;
    };
    if (parsed.role !== 'admin') return false;
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) return false;
    return true;
  } catch {
    return false;
  }
}

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ok: false, error: 'نیاز به ورود مدیر سیستم دارید.'});
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!verifyAdminToken(token)) {
    res.status(401).json({ok: false, error: 'نشست شما منقضی یا نامعتبر است. لطفاً دوباره وارد شوید.'});
    return;
  }
  next();
}
