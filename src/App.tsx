import {LogOut, Plus} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {apiFetch} from './api.ts';
import {AccountsDashboard} from './components/AccountsDashboard.tsx';
import {AuthGate} from './components/AuthGate.tsx';
import {CodeAuditView} from './components/CodeAuditView.tsx';
import {PythonExportView} from './components/PythonExportView.tsx';
import {TelegramStudio} from './components/TelegramStudio.tsx';
import type {DashboardPayload} from './types.ts';

type ActiveTab = 'dashboard' | 'telegram' | 'audit' | 'python';

export default function App() {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean>(false);
  const [checkingAuth, setCheckingAuth] = useState<boolean>(true);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loadingDash, setLoadingDash] = useState<boolean>(false);
  const [dashError, setDashError] = useState<string | null>(null);

  const handleUnauthorized = useCallback(() => {
    setAuthToken(null);
    setDashboard(null);
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<{ok: boolean; needsSetup: boolean}>('/api/auth/status')
      .then((res) => {
        if (active) setNeedsSetup(res.needsSetup);
      })
      .catch(() => {
        // Handled when auth gate submits
      })
      .finally(() => {
        if (active) setCheckingAuth(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshDashboard = useCallback(async () => {
    if (!authToken) return;
    setLoadingDash(true);
    setDashError(null);
    try {
      const data = await apiFetch<DashboardPayload>('/api/dashboard', {
        token: authToken,
        onUnauthorized: handleUnauthorized,
      });
      setDashboard(data);
    } catch (err) {
      setDashError(err instanceof Error ? err.message : 'خطا در دریافت اطلاعات');
    } finally {
      setLoadingDash(false);
    }
  }, [authToken, handleUnauthorized]);

  useEffect(() => {
    if (authToken) {
      void refreshDashboard();
    }
  }, [authToken, refreshDashboard]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">
        در حال بارگذاری...
      </div>
    );
  }

  if (!authToken) {
    return (
      <AuthGate
        needsSetup={needsSetup}
        onAuthenticated={(tok) => {
          setNeedsSetup(false);
          setAuthToken(tok);
        }}
      />
    );
  }

  const navItems: Array<{id: ActiveTab; label: string}> = [
    {id: 'dashboard', label: 'حساب‌ها و زمان‌بندی'},
    {id: 'telegram', label: 'ربات تلگرام و شبیه‌ساز'},
    {id: 'audit', label: 'بررسی کد و باگ‌ها'},
    {id: 'python', label: 'کد پایتون آماده'},
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Strict 3-zone single-row header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark only */}
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            دیجی کالا دیلی پوینت
          </button>

          {/* Zone 2: Clean single-line text navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  activeTab === item.id
                    ? 'border-rose-600 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single primary action */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('dashboard');
                setShowAddForm(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>افزودن شماره</span>
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <div className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 border-b-2 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === item.id
                  ? 'border-rose-600 text-slate-900'
                  : 'border-transparent text-slate-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 max-w-[1200px] w-full mx-auto px-4 sm:px-6 py-8">
        {dashError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800">
            {dashError}
          </div>
        )}

        {!dashboard && loadingDash ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            در حال دریافت اطلاعات حساب‌ها و وضعیت ربات...
          </div>
        ) : dashboard ? (
          <>
            {activeTab === 'dashboard' && (
              <AccountsDashboard
                token={authToken}
                accounts={dashboard.accounts}
                logs={dashboard.logs}
                bot={dashboard.bot}
                tehran={dashboard.tehran}
                showAddForm={showAddForm}
                onToggleAddForm={setShowAddForm}
                onRefresh={refreshDashboard}
                onUnauthorized={handleUnauthorized}
              />
            )}

            {activeTab === 'telegram' && (
              <TelegramStudio
                token={authToken}
                bot={dashboard.bot}
                onRefresh={refreshDashboard}
                onUnauthorized={handleUnauthorized}
              />
            )}

            {activeTab === 'audit' && <CodeAuditView />}

            {activeTab === 'python' && (
              <PythonExportView token={authToken} onUnauthorized={handleUnauthorized} />
            )}
          </>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>دیجی کالا دیلی پوینت · بازنویسی و تبدیل به ربات تلگرام</span>
          <button
            type="button"
            onClick={handleUnauthorized}
            className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>خروج از پنل مدیریت</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
