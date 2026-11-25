import {Check, Copy, Download} from 'lucide-react';
import {useEffect, useState} from 'react';
import {apiFetch} from '../api.ts';
import type {ExportedFile} from '../types.ts';

interface PythonExportViewProps {
  token: string;
  onUnauthorized: () => void;
}

export function PythonExportView({token, onUnauthorized}: PythonExportViewProps) {
  const [files, setFiles] = useState<ExportedFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<{ok: boolean; files: ExportedFile[]}>('/api/export/python-bot', {
      token,
      onUnauthorized,
    })
      .then((res) => {
        if (!active) return;
        setFiles(res.files);
        if (res.files.length > 0) {
          setSelectedPath(res.files[0].path);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, onUnauthorized]);

  const activeFile = files.find((f) => f.path === selectedPath) || files[0];

  async function handleCopy() {
    if (!activeFile) return;
    await navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload(file: ExportedFile) {
    const blob = new Blob([file.content], {type: 'text/plain;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.path;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-bold text-slate-900">
          خروجی نسخه پایتون اصلاح‌شده برای استقرار روی لیارا یا سرور شخصی
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed max-w-3xl">
          علاوه بر ربات تلگرامی که همین الان روی این سرور قابل اجراست، سورس‌کد پایتون اصلاح‌شده (با کتابخانه python-telegram-bot، زمان‌بند داخلی به وقت تهران و بدون باگ‌های نسخه Flask قبلی) را می‌توانید از اینجا کپی یا دانلود کنید.
        </p>
      </section>

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
          در حال آماده‌سازی فایل‌های پایتون...
        </div>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
              {files.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activeFile?.path === file.path
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {file.path}
                </button>
              ))}
            </div>

            {activeFile && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'کپی شد' : 'کپی کد'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDownload(activeFile)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>دانلود فایل</span>
                </button>
              </div>
            )}
          </div>

          {activeFile && (
            <div className="p-5">
              <p className="text-sm text-slate-600 mb-3">{activeFile.description}</p>
              <pre
                dir="ltr"
                className="p-4 rounded-lg bg-slate-900 text-slate-100 text-xs leading-relaxed overflow-x-auto max-h-[540px]"
              >
                <code>{activeFile.content}</code>
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
