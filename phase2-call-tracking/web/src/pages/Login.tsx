import { useState, type FormEvent } from 'react';
import { api, type User } from '../lib/api';

// Sign-in: one glass panel on the ground. The Marketing Hub's single sign-on replaces this later.
export default function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post<{ user: User }>('/auth/login', { login, password }); onSignedIn(r.user); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="ground grid min-h-screen place-items-center px-4">
      <main className="w-full max-w-[400px]">
        <p className="mb-8 text-[22px] font-semibold tracking-[-0.02em]">RULE<span className="inline-block -scale-x-100">R</span> <span className="text-[15px] font-normal text-ink-3">Calls</span></p>
        <form className="overlay rise rounded-tile p-7" onSubmit={submit}>
          <h1 className="mb-1 text-[28px] font-normal tracking-[-0.02em]">Sign in</h1>
          <p className="mb-6 text-[14px] text-ink-2">Calls, the campaigns behind them, and who to call back</p>
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="login">Email or username</label>
              <input id="login" className="input" autoComplete="username" required autoFocus value={login} onChange={(e) => setLogin(e.target.value)} aria-invalid={!!err} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!err} />
            </div>
          </div>
          {err && <p className="mt-4 text-[13px] text-down" role="alert">{err}</p>}
          <button className="btn mt-6 w-full" disabled={busy}>{busy ? 'Signing in' : 'Sign in'}</button>
        </form>
        <p className="mt-6 text-[12px] text-ink-3">Ruler Agency</p>
      </main>
    </div>
  );
}
