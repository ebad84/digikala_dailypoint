import {claimDigikalaDailyPoint} from './digikala.ts';
import {getTehranNow, loadStore} from './storage.ts';
import {sendTelegramNotification} from './telegramBot.ts';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerRunning = false;

export async function runScheduledClaimsPass(): Promise<{
  checked: number;
  triggered: number;
}> {
  if (schedulerRunning) {
    return {checked: 0, triggered: 0};
  }
  schedulerRunning = true;
  let triggered = 0;

  try {
    const store = loadStore();
    const tehran = getTehranNow();
    const eligible = store.accounts.filter(
      (acc) =>
        acc.autoClaimEnabled &&
        acc.lastClaimDateTehran !== tehran.dateStr &&
        tehran.hour >= acc.autoClaimHourTehran,
    );

    for (const acc of eligible) {
      const result = await claimDigikalaDailyPoint(acc.id, 'scheduler');
      triggered += 1;
      if (acc.telegramChatId) {
        const ptsText =
          result.totalPoints !== null ? `\nموجودی کل دیجی‌کلاب: ${result.totalPoints} امتیاز` : '';
        await sendTelegramNotification(
          acc.telegramChatId,
          `⏰ گزارش دریافت خودکار روزانه (${acc.phone}):\n${result.message}${ptsText}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return {checked: store.accounts.length, triggered};
  } finally {
    schedulerRunning = false;
  }
}

export function startDailyScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    void runScheduledClaimsPass();
  }, 60_000);
}
