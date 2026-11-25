interface AuditItem {
  number: string;
  title: string;
  severity: string;
  fileLocation: string;
  problem: string;
  solution: string;
  beforeCode: string;
  afterCode: string;
}

const AUDIT_ITEMS: AuditItem[] = [
  {
    number: '۰۱',
    title: 'کرش فوری KeyError در اولین درخواست ثبت شماره',
    severity: 'بحرانی · خطای ۵۰۰',
    fileLocation: 'app.py -> initphone(phone) / expired(phone)',
    problem:
      'در روت /init/<phone> پیش از بررسی اینکه شماره اصلاً در دیکشنری catch_db وجود دارد یا نه، تابع expired(phone) صدا زده می‌شد و دسترسی مستقیم به catch_db[phone] باعث کرش فوری سرور می‌شد.',
    solution:
      'بررسی وجود کلید در Map/دیکشنری پیش از بررسی زمان انقضا، نرمال‌سازی ارقام فارسی و فرمت موبایل ایران (09xxxxxxxxx) و جداسازی نشست در حال انتظار بر اساس شناسه کاربر تلگرام.',
    beforeCode: `if expired(phone): # KeyError اگر شماره قبلاً ثبت نشده باشد\n    return "redo the initing. expire time passed"\nif phone in catch_db:\n    return "otp already sent"`,
    afterCode: `const entry = pendingOtps.get(key);\nif (entry && Date.now() > entry.expiresAt) {\n  pendingOtps.delete(key);\n}`,
  },
  {
    number: '۰۲',
    title: 'منطق معکوس در تابع expired() و حذف نشست معتبر',
    severity: 'بحرانی · شکست احراز هویت',
    fileLocation: 'app.py -> expired(phone)',
    problem:
      'در شاخه else (زمانی که کد هنوز منقضی نشده بود)، دستور del catch_db[phone] اجرا و False برگردانده می‌شد! در نتیجه در /auth/<phone>/<code> بلافاصله پس از عبور از شرط expired، دسترسی به catch_db[phone] با KeyError شکست می‌خورد و هنگام انقضا هم رکورد حذف نمی‌شد.',
    solution:
      'اصلاح شرط انقضا: تنها زمانی که زمان فعلی از expiresAt عبور کرده باشد رکورد حذف و منقضی اعلام می‌شود. در غیر این صورت نشست تا سقف ۵ بار تلاش اشتباه معتبر باقی می‌ماند.',
    beforeCode: `if catch_db[phone]['crtime'] + expire_time <= time.time():\n    return True # بدون حذف رکورد منقضی!\nelse:\n    del catch_db[phone] # حذف نشست معتبر!\n    return False`,
    afterCode: `function cleanupExpiredOtp(key: string) {\n  const entry = pendingOtps.get(key);\n  if (!entry) return null;\n  if (Date.now() > entry.expiresAt) {\n    pendingOtps.delete(key);\n    return null;\n  }\n  return entry;\n}`,
  },
  {
    number: '۰۳',
    title: 'ذخیره نشست نامعتبر هنگام وارد کردن کد اشتباه',
    severity: 'مهم · قفل شدن شماره',
    fileLocation: 'app.py -> auth_otp_code(phone, code)',
    problem:
      'پس از فراخوانی /v1/user/login/otp/ هیچ بررسی روی status پاسخ دیجی‌کالا یا دریافت کوکی ورود انجام نمی‌شد و حتی با کد اشتباه، نشست خالی ذخیره و شماره در phone_list به عنوان «موجود» قفل می‌شد.',
    solution:
      'بررسی دقیق status === 200 در JSON خروجی دیجی‌کالا و تایید وجود کوکی‌های نشست پیش از ذخیره دائمی؛ در صورت خطای کاربر، فرصت تلاش مجدد یا ارسال کد جدید بدون قفل شدن حساب فراهم می‌شود.',
    beforeCode: `resault, req = authonticate_phonenumber(phone, code, catch_db[phone]['req'])\nsave_session(phone, req)\nphone_list[phone] = req`,
    afterCode: `if (!loginRes.ok || apiStatus !== 200) {\n  entry.attempts += 1;\n  return { ok: false, message: extractDigikalaError(json) };\n}\n// ذخیره تنها پس از تایید موفق انجام می‌شود`,
  },
  {
    number: '۰۴',
    title: 'ذخیره‌سازی ناامن با pickle و آسیب‌پذیری مسیر فایل',
    severity: 'امنیتی · ریسک Path Traversal',
    fileLocation: 'app.py / main.py -> load_session / save_session',
    problem:
      'استفاده از pickle.load روی فایل‌هایی که نامشان مستقیماً با ورودی URL ساخته می‌شد (f"{name}.session") هم ریسک دستکاری مسیر فایل داشت و هم فایل‌های باینری pickle در نسخه‌های مختلف پایتون ناپایدارند.',
    solution:
      'جایگزینی کامل pickle با JSON استاندارد و محدودسازی مسیر فایل‌ها با path.resolve و اعتبارسنجی دقیق شماره موبایل (^09\\d{9}$).',
    beforeCode: `filename = f"{name}.session"\nwith open(filename, "rb") as f:\n    session = pickle.load(f)`,
    afterCode: `// اعتبارسنجی شماره 09xxxxxxxxx و ذخیره اتمی کوکی‌ها در JSON\nconst tmpPath = path.resolve(DATA_DIR, \`dailypoint-db.\${process.pid}.tmp\`);\nfs.renameSync(tmpPath, DB_FILE);`,
  },
  {
    number: '۰۵',
    title: 'هدرهای ناقص HTTP و عدم مدیریت انقضای سشن دیجی‌کالا',
    severity: 'عملکردی · خطای API دیجی‌کالا',
    fileLocation: 'app.py -> send_otpcode / get_daily_point',
    problem:
      'در نسخه قبلی از User-Agentهای تصادفی (گاه موبایل در کنار هدرهای دسکتاپ) بدون Origin و Referer استفاده می‌شد و در زمان دریافت امتیاز، کد ۴۰۱ (انقضای سشن) یا دریافت تکراری روزانه تشخیص داده نمی‌شد.',
    solution:
      'استفاده از هدرهای هماهنگ مرورگر دسکتاپ، Origin و Referer معتبر دیجی‌کالا، بازیابی موجودی امتیاز دیجی‌کلاب و تشخیص دقیق وضعیت ۴۰۱ یا دریافت قبلی.',
    beforeCode: `'User-Agent': ua.random\n# بدون Origin، Referer و بررسی status == 401`,
    afterCode: `Origin: 'https://www.digikala.com',\nReferer: 'https://www.digikala.com/users/login/',\n'x-web-client': 'desktop'`,
  },
  {
    number: '۰۶',
    title: 'نبود کنترل دسترسی و وابستگی به سرویس خارجی UptimeRobot',
    severity: 'معماری · تبدیل به ربات تلگرام',
    fileLocation: 'کل پروژه Flask و README.md',
    problem:
      'اندپوینت‌های /init/<phone> و /dailypoint/<phone> بدون هیچ احراز هویتی در دسترس عموم بودند و برای اجرای روزانه نیاز به سرویس خارجی UptimeRobot داشتید.',
    solution:
      'بازطراحی کامل به ربات تلگرام چندکاربره با ایزوله‌سازی شماره‌های هر کاربر بر اساس chat_id، منوی شیشه‌ای فارسی، زمان‌بند خودکار داخلی به وقت تهران و پنل مدیریت محافظت‌شده.',
    beforeCode: `@app.route("/dailypoint/<phone>") # دسترسی عمومی بدون احراز هویت`,
    afterCode: `// ایزوله‌سازی کامل بر اساس telegramChatId + زمان‌بند خودکار ساعت تهران`,
  },
];

export function CodeAuditView() {
  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-slate-900">
          گزارش بررسی مخزن ebad84/digikala_dailypoint و اصلاحات انجام‌شده
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed max-w-3xl">
          تمامی فایل‌های مخزن اصلی (app.py، main.py، blacked_app.py و README.md) بررسی شدند. ۶ مشکل کلیدی در مدیریت وضعیت کد تایید، امنیت ذخیره‌سازی نشست، ارتباط با API دیجی‌کالا و معماری اجرا شناسایی و در همین پروژه برطرف شده‌اند.
        </p>
      </section>

      <div className="space-y-4">
        {AUDIT_ITEMS.map((item) => (
          <article key={item.number} className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {item.number}. {item.title}
              </h3>
              <div className="text-xs text-slate-500 font-mono" dir="ltr">
                {item.fileLocation}
              </div>
            </div>

            <div className="mt-2 text-xs font-medium text-rose-700">{item.severity}</div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm leading-relaxed">
              <div>
                <div className="text-xs font-bold text-slate-700 mb-1">شرح مشکل در کد قبلی</div>
                <p className="text-slate-600">{item.problem}</p>
                <pre
                  dir="ltr"
                  className="mt-3 p-3.5 rounded-lg bg-slate-900 text-slate-100 text-xs overflow-x-auto leading-relaxed"
                >
                  <code>{item.beforeCode}</code>
                </pre>
              </div>

              <div>
                <div className="text-xs font-bold text-emerald-700 mb-1">راه‌حل پیاده‌سازی‌شده</div>
                <p className="text-slate-600">{item.solution}</p>
                <pre
                  dir="ltr"
                  className="mt-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-xs overflow-x-auto leading-relaxed"
                >
                  <code>{item.afterCode}</code>
                </pre>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
