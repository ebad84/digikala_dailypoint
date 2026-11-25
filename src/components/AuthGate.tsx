import {KeyRound, Lock, ShieldCheck} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {apiFetch} from '../api.ts';

interface AuthGateProps {
  needsSetup: boolean;
  onAuthenticated: (token: string) => void;
}

export function AuthGate({needsSetup, onAuthenticated}: AuthGateProps) {
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (needsSetup) {
      if (passcode.trim().length < 6) {
        setError('رمز عبور مدیر باید حداقل ۶ کاراکتر باشد.');
        return;
      }
      if (passcode !== confirmPasscode) {
        setError('تکرار رمز عبور مطابقت ندارد.');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = needsSetup ? '/api/auth/setup' : '/api/auth/login';
      const res = await apiFetch<{ok: boolean; token: string}>(endpoint, {
        method: 'POST',
        body: {passcode},
      });
      onAuthenticated(res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در احراز هویت');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            {needsSetup ? <ShieldCheck className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">دیجی کالا دیلی پوینت</h1>
            <p className="text-sm text-slate-500">
              {needsSetup
                ? 'تنظیم رمز عبور مدیر برای محافظت از نشست‌ها و توکن ربات'
                : 'برای مدیریت ربات تلگرام و حساب‌های دیجی‌کالا وارد شوید'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-passcode" className="block text-sm font-medium text-slate-700 mb-1.5">
              {needsSetup ? 'رمز عبور جدید مدیر (حداقل ۶ کاراکتر)' : 'رمز عبور مدیر'}
            </label>
            <input
              id="admin-passcode"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              required
              autoFocus
              dir="ltr"
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600 font-mono"
            />
          </div>

          {needsSetup && (
            <div>
              <label htmlFor="admin-passcode-confirm" className="block text-sm font-medium text-slate-700 mb-1.5">
                تکرار رمز عبور
              </label>
              <input
                id="admin-passcode-confirm"
                type="password"
                value={confirmPasscode}
                onChange={(e) => setConfirmPasscode(e.target.value)}
                required
                dir="ltr"
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-600 font-mono"
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            <span>{loading ? 'در حال بررسی...' : needsSetup ? 'ثبت رمز و ورود به پنل' : 'ورود به پنل مدیریت'}</span>
          </button>
        </form>

        <p className="mt-5 text-xs text-slate-500 leading-relaxed">
          نشست شما تنها در حافظه مرورگر نگهداری می‌شود و توکن ربات تلگرام و کوکی‌های دیجی‌کالا روی سرور باقی می‌مانند.
        </p>
      </div>
    </div>
  );
}
