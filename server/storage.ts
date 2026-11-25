import fs from 'fs';
import path from 'path';
import type {AccountRecord, ClaimLog, PublicAccountView, StoreData} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.resolve(DATA_DIR, 'dailypoint-db.json');

function createDefaultStore(): StoreData {
  return {
    adminHash: null,
    bot: {
      telegramBotToken: '',
      botUsername: null,
      botFirstName: null,
      botEnabled: false,
      defaultAutoClaimHourTehran: 9,
      sandboxModeDefault: false,
    },
    accounts: [],
    logs: [],
  };
}

let cachedStore: StoreData | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {recursive: true});
  }
}

export function loadStore(): StoreData {
  if (cachedStore) {
    return cachedStore;
  }
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    cachedStore = createDefaultStore();
    saveStore(cachedStore);
    return cachedStore;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    const defaults = createDefaultStore();
    cachedStore = {
      adminHash: typeof parsed.adminHash === 'string' ? parsed.adminHash : null,
      bot: {
        ...defaults.bot,
        ...(parsed.bot || {}),
      },
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs.slice(0, 300) : [],
    };
    return cachedStore;
  } catch {
    cachedStore = createDefaultStore();
    saveStore(cachedStore);
    return cachedStore;
  }
}

export function saveStore(store: StoreData): void {
  ensureDataDir();
  cachedStore = store;
  const tmpPath = path.resolve(DATA_DIR, `dailypoint-db.${process.pid}.tmp`);
  if (!tmpPath.startsWith(DATA_DIR + path.sep)) {
    throw new Error('Invalid storage path');
  }
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), {mode: 0o600});
  fs.renameSync(tmpPath, DB_FILE);
}

export function toPublicAccount(acc: AccountRecord): PublicAccountView {
  return {
    id: acc.id,
    phone: acc.phone,
    label: acc.label,
    telegramChatId: acc.telegramChatId,
    sandbox: Boolean(acc.sandbox),
    hasSession: Object.keys(acc.cookies || {}).length > 0 || Boolean(acc.sandbox),
    createdAt: acc.createdAt,
    lastClaimAt: acc.lastClaimAt,
    lastClaimDateTehran: acc.lastClaimDateTehran,
    lastClaimStatus: acc.lastClaimStatus,
    lastClaimMessage: acc.lastClaimMessage,
    totalPoints: acc.totalPoints,
    autoClaimEnabled: acc.autoClaimEnabled,
    autoClaimHourTehran: acc.autoClaimHourTehran,
  };
}

export function addClaimLog(entry: ClaimLog): void {
  const store = loadStore();
  store.logs.unshift(entry);
  if (store.logs.length > 300) {
    store.logs = store.logs.slice(0, 300);
  }
  saveStore(store);
}

export function getTehranNow(): {dateStr: string; hour: number; minute: number; formatted: string} {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(timeParts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(timeParts.find((p) => p.type === 'minute')?.value ?? '0');

  const formatted = new Intl.DateTimeFormat('fa-IR', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);

  return {dateStr, hour, minute, formatted};
}
