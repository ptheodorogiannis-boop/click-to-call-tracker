import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api';

// Load a GET path; re-runs when the path changes. Keeps the last data while a refresh is in flight.
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setError(null);
    api.get<T>(path)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e : new ApiError(0, String(e))); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { data, error, loading, reload, setData };
}

// ── the signed-in person ───────────────────────────────
interface Session { me: Me; reload: () => void; canEdit: boolean; isOwner: boolean }
const SessionCtx = createContext<Session | null>(null);
export const SessionProvider = SessionCtx.Provider;
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

// ── theme: light, dark, remembered per browser, the system's by default ──
export type Theme = 'light' | 'dark';
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('ctc-theme', next); } catch { /* private mode: the choice lasts this visit */ }
      return next;
    });
  }, []);
  return [theme, toggle];
}

// ── toasts: one line, bottom centre, gone after four seconds ──
type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'error') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const id = useRef(0);
  const push = useCallback((text: string, tone: 'ok' | 'error' = 'ok') => {
    const t = { id: ++id.current, text, tone };
    setList((l) => [...l.slice(-2), t]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 md:bottom-6" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`overlay rounded-full px-4 py-2 text-[13px] font-medium ${t.tone === 'error' ? 'text-down' : 'text-ink'}`} style={{ animation: 'rise var(--dur-short) var(--ease-brand) both' }}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// Keyboard shortcut helper (⌘K / Ctrl+K).
export function useHotkey(key: string, fn: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === key) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [key, fn]);
}
