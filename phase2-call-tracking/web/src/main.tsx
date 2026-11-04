import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/manrope';
import './styles.css';
import { api, ApiError, setUnauthorizedHandler, type Me } from './lib/api';
import { SessionProvider, ToastProvider } from './lib/hooks';
import { Shell } from './components/Shell';
import { ErrorState } from './components/ui';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Calls from './pages/Calls';
import Clients from './pages/Clients';
const Reports = lazy(() => import('./pages/Reports')); // carries the chart library
import Settings from './pages/Settings';

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'out' | 'in' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(() => {
    api.get<Me>('/me')
      .then((m) => { setMe(m); setState('in'); })
      .catch((e: ApiError) => { if (e.status === 401) setState('out'); else { setError(e); setState('error'); } });
  }, []);
  useEffect(() => { setUnauthorizedHandler(() => setState('out')); load(); }, [load]);

  if (state === 'loading') return <div className="ground min-h-screen" aria-busy="true" />;
  if (state === 'error') return <div className="ground grid min-h-screen place-items-center px-4"><div className="tile p-6"><ErrorState error={error} retry={load} /></div></div>;
  if (state === 'out' || !me) return <Login onSignedIn={load} />;

  const canEdit = me.user.role !== 'client';
  return (
    <SessionProvider value={{ me, reload: load, canEdit, isOwner: me.user.role === 'owner' }}>
      <Shell>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/calls" element={<Calls />} />
          {canEdit && <Route path="/clients" element={<Clients />} />}
          <Route path="/reports" element={<Suspense fallback={<div className="skel h-[420px] rounded-tile" />}><Reports /></Suspense>} />
          <Route path="/settings/*" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </SessionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
