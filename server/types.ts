export type ClaimSource = 'manual' | 'scheduler' | 'telegram' | 'sandbox';

export type ClaimOutcome = 'claimed' | 'already_claimed' | 'expired' | 'error';

export interface AccountRecord {
  id: string;
  phone: string;
  label: string;
  telegramChatId: string | null;
  cookies: Record<string, string>;
  sandbox: boolean;
  createdAt: string;
  lastClaimAt: string | null;
  lastClaimDateTehran: string | null;
  lastClaimStatus: ClaimOutcome | null;
  lastClaimMessage: string | null;
  totalPoints: number | null;
  autoClaimEnabled: boolean;
  autoClaimHourTehran: number;
}

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

export interface BotSettings {
  telegramBotToken: string;
  botUsername: string | null;
  botFirstName: string | null;
  botEnabled: boolean;
  defaultAutoClaimHourTehran: number;
  sandboxModeDefault: boolean;
}

export interface StoreData {
  adminHash: string | null;
  bot: BotSettings;
  accounts: AccountRecord[];
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
