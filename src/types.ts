export type ClaimSource = 'manual' | 'scheduler' | 'telegram' | 'sandbox';
export type ClaimOutcome = 'claimed' | 'already_claimed' | 'expired' | 'error';

export interface PublicAccountView {
  id: string;
  phone: string;
  label: string;
  telegramChatId: string | null;
  sandbox: boolean;
  hasSession: boolean;
  createdAt: string;
  lastClaimAt: string | null;
  lastClaimDateTehran: string | null;
  lastClaimStatus: ClaimOutcome | null;
  lastClaimMessage: string | null;
  totalPoints: number | null;
  autoClaimEnabled: boolean;
  autoClaimHourTehran: number;
}

export interface ClaimLog {
  id: string;
  accountId: string;
  phone: string;
  telegramChatId: string | null;
  timestamp: string;
  tehranDate: string;
  source: ClaimSource;
  status: ClaimOutcome;
  gainedPoints: number;
  totalPoints: number | null;
  message: string;
}

export interface TelegramBotStatus {
  configured: boolean;
  fromEnv: boolean;
  pollingActive: boolean;
  botEnabled: boolean;
  botUsername: string | null;
  botFirstName: string | null;
  maskedToken: string | null;
  lastPollingError: string | null;
  defaultAutoClaimHourTehran: number;
  sandboxModeDefault: boolean;
}

export interface TehranClock {
  dateStr: string;
  hour: number;
  minute: number;
  formatted: string;
}

export interface DashboardPayload {
  ok: boolean;
  tehran: TehranClock;
  bot: TelegramBotStatus;
  accounts: PublicAccountView[];
  logs: ClaimLog[];
}

export interface BotInlineButton {
  text: string;
  callback_data: string;
}

export interface BotMessageReply {
  id: string;
  text: string;
  inlineKeyboard?: BotInlineButton[][];
  timestamp: string;
}

export interface ExportedFile {
  path: string;
  language: string;
  description: string;
  content: string;
}
