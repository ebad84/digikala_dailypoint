export interface ExportedFile {
  path: string;
  language: string;
  description: string;
  content: string;
}

export function getFixedPythonBotFiles(): ExportedFile[] {
  const digikalaClientPy = `import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import requests

OTP_TTL_SECONDS = 150
RESEND_COOLDOWN_SECONDS = 60
MAX_OTP_ATTEMPTS = 5
SESSIONS_DIR = Path(os.getenv("SESSIONS_DIR", "./data/sessions")).resolve()

DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def normalize_digits(text: str) -> str:
    trans = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")
    return text.translate(trans)


def normalize_iran_phone(raw: str) -> Optional[str]:
    cleaned = re.sub(r"[\\s\\-().]", "", normalize_digits(raw.strip()))
    if cleaned.startswith("+98"):
        cleaned = "0" + cleaned[3:]
    elif cleaned.startswith("0098"):
        cleaned = "0" + cleaned[4:]
    elif cleaned.startswith("98") and len(cleaned) == 12:
        cleaned = "0" + cleaned[2:]
    elif cleaned.startswith("9") and len(cleaned) == 10:
        cleaned = "0" + cleaned
    if not re.fullmatch(r"09\\d{9}", cleaned):
        return None
    return cleaned


@dataclass
class PendingOtp:
    phone: str
    session: requests.Session
    created_at: float
    resend_at: float
    expires_at: float
    attempts: int = 0


class DigikalaClient:
    def __init__(self) -> None:
        SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
        self.pending: Dict[Tuple[int, str], PendingOtp] = {}

    def _session_path(self, chat_id: int, phone: str) -> Path:
        safe_phone = normalize_iran_phone(phone)
        if not safe_phone:
            raise ValueError("Invalid phone format")
        target = (SESSIONS_DIR / f"{int(chat_id)}_{safe_phone}.json").resolve()
        if not str(target).startswith(str(SESSIONS_DIR) + os.sep):
            raise ValueError("Invalid session path")
        return target

    def _build_session(self, cookies: Optional[Dict[str, str]] = None) -> requests.Session:
        s = requests.Session()
        s.headers.update({
            "User-Agent": DESKTOP_UA,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "fa-IR,fa;q=0.9,en-US;q=0.8",
            "Origin": "https://www.digikala.com",
            "Referer": "https://www.digikala.com/users/login/",
            "x-web-client": "desktop",
            "x-web-optimize-response": "1",
        })
        if cookies:
            s.cookies.update(cookies)
        return s

    def save_session(self, chat_id: int, phone: str, session: requests.Session) -> None:
        path = self._session_path(chat_id, phone)
        data = {
            "phone": phone,
            "chat_id": chat_id,
            "cookies": requests.utils.dict_from_cookiejar(session.cookies),
            "saved_at": time.time(),
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def load_session(self, chat_id: int, phone: str) -> Optional[requests.Session]:
        path = self._session_path(chat_id, phone)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return self._build_session(data.get("cookies", {}))

    def _get_valid_pending(self, chat_id: int, phone: str) -> Optional[PendingOtp]:
        key = (chat_id, phone)
        entry = self.pending.get(key)
        if not entry:
            return None
        if time.time() > entry.expires_at:
            del self.pending[key]
            return None
        return entry

    def send_otp(self, chat_id: int, raw_phone: str) -> Tuple[bool, str, Optional[str]]:
        phone = normalize_iran_phone(raw_phone)
        if not phone:
            return False, "شماره موبایل معتبر نیست (مثال: 09123456789).", None

        existing = self._get_valid_pending(chat_id, phone)
        now = time.time()
        if existing and now < existing.resend_at:
            wait = int(existing.resend_at - now)
            return False, f"کد قبلاً ارسال شده است. {wait} ثانیه دیگر صبر کنید.", phone

        session = self._build_session()
        try:
            session.get("https://www.digikala.com/users/login/", timeout=12)
            resp = session.post(
                "https://api.digikala.com/v1/user/authenticate/",
                json={"username": phone, "otp_call": False, "hash": None},
                timeout=12,
            )
            payload = resp.json()
        except Exception as exc:
            return False, f"خطا در ارتباط با دیجی‌کالا: {exc}", phone

        if resp.status_code != 200 or payload.get("status") != 200:
            msg = payload.get("message") or "ارسال کد تایید ناموفق بود."
            return False, str(msg), phone

        timer = (payload.get("data") or {}).get("timer") or OTP_TTL_SECONDS
        self.pending[(chat_id, phone)] = PendingOtp(
            phone=phone,
            session=session,
            created_at=now,
            resend_at=now + RESEND_COOLDOWN_SECONDS,
            expires_at=now + max(int(timer), OTP_TTL_SECONDS),
        )
        return True, f"کد تایید به شماره {phone} ارسال شد. لطفاً کد پیامکی را ارسال کنید.", phone

    def verify_otp(self, chat_id: int, phone: str, raw_code: str) -> Tuple[bool, str]:
        code = normalize_digits(raw_code.strip())
        if not re.fullmatch(r"\\d{4,8}", code):
            return False, "فرمت کد تایید صحیح نیست."

        entry = self._get_valid_pending(chat_id, phone)
        if not entry:
            return False, "کد تایید منقضی شده یا وجود ندارد. لطفاً دوباره تلاش کنید."

        if entry.attempts >= MAX_OTP_ATTEMPTS:
            del self.pending[(chat_id, phone)]
            return False, "تعداد تلاش اشتباه بیش از حد بود. دوباره کد بگیرید."

        try:
            resp = entry.session.post(
                "https://api.digikala.com/v1/user/login/otp/",
                json={"type": "otp", "username": phone, "code": code},
                timeout=12,
            )
            payload = resp.json()
        except Exception as exc:
            return False, f"خطای شبکه هنگام بررسی کد: {exc}"

        if resp.status_code != 200 or payload.get("status") != 200:
            entry.attempts += 1
            msg = payload.get("message") or "کد تایید نادرست است."
            return False, str(msg)

        self.save_session(chat_id, phone, entry.session)
        del self.pending[(chat_id, phone)]
        return True, f"شماره {phone} با موفقیت متصل و ذخیره شد."

    def claim_daily_point(self, chat_id: int, phone: str) -> Tuple[bool, str]:
        session = self.load_session(chat_id, phone)
        if not session:
            return False, "نشست این شماره یافت نشد."
        try:
            resp = session.post(
                "https://api.digikala.com/v1/digiclub/dynamic-daily-mission/",
                json={"mission_id": 1},
                timeout=12,
            )
            if resp.status_code == 401:
                return False, "نشست منقضی شده است؛ لطفاً دوباره شماره را اضافه کنید."
            payload = resp.json()
            self.save_session(chat_id, phone, session)
            if payload.get("status") == 200:
                gained = (payload.get("data") or {}).get("gained_point", 5)
                return True, f"امتیاز روزانه دریافت شد (+{gained} امتیاز)."
            return False, str(payload.get("message") or "دریافت امتیاز انجام نشد.")
        except Exception as exc:
            return False, f"خطا در دریافت امتیاز: {exc}"
`;

  const botPy = `import os
from datetime import time as dt_time
from zoneinfo import ZoneInfo

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from digikala_client import DigikalaClient, SESSIONS_DIR

ASK_PHONE, ASK_OTP = range(2)
TEHRAN_TZ = ZoneInfo("Asia/Tehran")
client = DigikalaClient()


def main_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("➕ افزودن شماره", callback_data="add"),
            InlineKeyboardButton("🎯 دریافت امتیاز امروز", callback_data="claim"),
        ],
        [InlineKeyboardButton("📋 حساب‌های من", callback_data="accounts")],
    ])


def list_user_phones(chat_id: int) -> list[str]:
    prefix = f"{int(chat_id)}_"
    phones = []
    for path in SESSIONS_DIR.glob(f"{prefix}*.json"):
        phones.append(path.stem.removeprefix(prefix))
    return sorted(phones)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text(
        "سلام! به ربات دیجی کالا دیلی پوینت خوش آمدید.",
        reply_markup=main_menu(),
    )


async def start_add(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if update.callback_query:
        await update.callback_query.answer()
    await update.effective_message.reply_text("شماره موبایل دیجی‌کالا را ارسال کنید (مثال: 09123456789):")
    return ASK_PHONE


async def receive_phone(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = update.effective_chat.id
    ok, msg, phone = client.send_otp(chat_id, update.message.text or "")
    await update.message.reply_text(msg)
    if ok and phone:
        context.user_data["pending_phone"] = phone
        return ASK_OTP
    return ASK_PHONE


async def receive_otp(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    chat_id = update.effective_chat.id
    phone = context.user_data.get("pending_phone", "")
    ok, msg = client.verify_otp(chat_id, phone, update.message.text or "")
    await update.message.reply_text(msg, reply_markup=main_menu() if ok else None)
    return ConversationHandler.END if ok else ASK_OTP


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.effective_message.reply_text("عملیات لغو شد.", reply_markup=main_menu())
    return ConversationHandler.END


async def claim_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.callback_query:
        await update.callback_query.answer()
    chat_id = update.effective_chat.id
    phones = list_user_phones(chat_id)
    if not phones:
        await update.effective_message.reply_text("شماره‌ای ثبت نشده است.", reply_markup=main_menu())
        return
    lines = []
    for phone in phones:
        _, msg = client.claim_daily_point(chat_id, phone)
        lines.append(f"• {phone}: {msg}")
    await update.effective_message.reply_text("\\n".join(lines), reply_markup=main_menu())


async def accounts_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.callback_query:
        await update.callback_query.answer()
    phones = list_user_phones(update.effective_chat.id)
    text = "حساب‌های ثبت‌شده:\\n" + "\\n".join(f"• {p}" for p in phones) if phones else "حسابی ثبت نشده است."
    await update.effective_message.reply_text(text, reply_markup=main_menu())


async def scheduled_daily_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    for path in SESSIONS_DIR.glob("*_*.json"):
        chat_str, phone = path.stem.split("_", 1)
        chat_id = int(chat_str)
        _, msg = client.claim_daily_point(chat_id, phone)
        try:
            await context.bot.send_message(chat_id=chat_id, text=f"⏰ گزارش خودکار ({phone}):\\n{msg}")
        except Exception:
            pass


def main() -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    app = Application.builder().token(token).build()

    conv = ConversationHandler(
        entry_points=[
            CommandHandler("add", start_add),
            CallbackQueryHandler(start_add, pattern="^add$"),
        ],
        states={
            ASK_PHONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_phone)],
            ASK_OTP: [MessageHandler(filters.TEXT & ~filters.COMMAND, receive_otp)],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(conv)
    app.add_handler(CommandHandler("claim", claim_command))
    app.add_handler(CommandHandler("accounts", accounts_command))
    app.add_handler(CallbackQueryHandler(claim_command, pattern="^claim$"))
    app.add_handler(CallbackQueryHandler(accounts_command, pattern="^accounts$"))

    app.job_queue.run_daily(scheduled_daily_job, time=dt_time(hour=9, minute=0, tzinfo=TEHRAN_TZ))
    app.run_polling()


if __name__ == "__main__":
    main()
`;

  const requirementsTxt = `python-telegram-bot[job-queue]==21.10
requests==2.32.4
tzdata==2025.1
`;

  const envExample = `TELEGRAM_BOT_TOKEN=your_botfather_token_here
SESSIONS_DIR=./data/sessions
`;

  const liaraJson = `{
  "platform": "docker",
  "disks": [
    {
      "name": "sessions-data",
      "mountTo": "/app/data"
    }
  ]
}
`;

  const dockerfile = `FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "bot.py"]
`;

  const readmeMd = `# ربات تلگرام دیجی کالا دیلی پوینت (نسخه پایتون)

## راه‌اندازی سریع روی سرور یا سیستم شخصی
\`\`\`bash
pip install -r requirements.txt
export TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN"
python bot.py
\`\`\`

## دیپلوی روی لیارا (Liara)
1. در پنل لیارا یک برنامه **Docker** بسازید (فایل \`liara.json\` دیسک \`/app/data\` را خودکار می‌سازد).
2. در بخش **متغیرهای محیطی** مقدار \`TELEGRAM_BOT_TOKEN\` را تنظیم کنید.
3. دستور زیر را اجرا کنید:
\`\`\`bash
liara deploy --platform docker
\`\`\`
`;

  return [
    {
      path: 'digikala_client.py',
      language: 'python',
      description: 'کلاینت اصلاح‌شده دیجی‌کالا (رفع باگ KeyError، منطق معکوس expired، جایگزینی pickle با JSON و جلوگیری از Path Traversal)',
      content: digikalaClientPy,
    },
    {
      path: 'bot.py',
      language: 'python',
      description: 'ربات تلگرام با python-telegram-bot v21 و زمان‌بند روزانه خودکار به وقت تهران',
      content: botPy,
    },
    {
      path: 'requirements.txt',
      language: 'text',
      description: 'وابستگی‌های نسخه پایتون (بدون نیاز به Flask و UptimeRobot)',
      content: requirementsTxt,
    },
    {
      path: 'liara.json',
      language: 'json',
      description: 'تنظیمات استقرار روی لیارا با دیسک ماندگار برای نشست‌ها',
      content: liaraJson,
    },
    {
      path: 'Dockerfile',
      language: 'dockerfile',
      description: 'فایل داکر برای اجرای دائمی ربات',
      content: dockerfile,
    },
    {
      path: '.env.example',
      language: 'text',
      description: 'نمونه متغیرهای محیطی مورد نیاز',
      content: envExample,
    },
    {
      path: 'README.md',
      language: 'markdown',
      description: 'راهنمای سریع نصب و دیپلوی نسخه پایتون روی لیارا و سرور',
      content: readmeMd,
    },
  ];
}
