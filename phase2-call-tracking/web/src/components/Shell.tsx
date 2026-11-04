import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Building2, Code2, LayoutGrid, LogOut, Moon, Phone, PlugZap, Search, Settings, Sun, Users, BarChart3 } from 'lucide-react';
import { api, qs, type Call } from '../lib/api';
import { useHotkey, useLoad, useSession, useTheme } from '../lib/hooks';
import { channel, phone, when } from '../lib/format';

export function Shell({ children }: { children: ReactNode }) {
  const { me, canEdit, isOwner } = useSession();
  const [theme, toggleTheme] = useTheme();
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => setSearching(true), []);
  useHotkey('k', openSearch);
  // The open call-back queue, shown as a count on Calls. Refreshed on every page change.
  const loc = useLocation();
  const { data: queue } = useLoad<{ total: number }>(`/calls${qs({ status: 'to_call_back', limit: 1 })}&_=${loc.pathname}`);

  const nav = [
    { to: '/', label: 'Overview', end: true },
    { to: '/calls', label: 'Calls', count: queue?.total || 0 },
    ...(canEdit ? [{ to: '/clients', label: 'Clients' }] : []),
    { to: '/reports', label: 'Reports' }
  ];

  return (
    <div className="ground min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-glass-solid focus:px-4 focus:py-2">Skip to content</a>
      <div className="mx-auto max-w-app px-4 pb-28 pt-4 md:px-6 md:pb-10">
        <header className="flex h-14 items-center gap-4">
          <Link to="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap rounded-full md:min-w-[64px]" aria-label={`${me.brand.company}, calls overview`}>
            <Wordmark />
            <span className="text-[13px] text-ink-3 md:hidden">Calls</span>
          </Link>
          <nav className="pill-nav tile hidden !shadow-none md:flex" aria-label="Main">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}>
                {n.label}
                {!!n.count && <span className="count" aria-label={`${n.count} to call back`}>{n.count}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="flex-1" />
          <button className="tile hidden h-10 items-center gap-6 rounded-full !shadow-none pl-4 pr-2 text-[13px] text-ink-3 lg:flex" onClick={openSearch}>
            <span className="flex items-center gap-2"><Search className="h-[17px] w-[17px]" strokeWidth={1.5} />Search calls and clients</span>
            <kbd className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-2">{navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <button className="icon-btn lg:hidden" onClick={openSearch} aria-label="Search"><Search /></button>
          <button className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>
          <AccountMenu />
        </header>

        <div className="mt-6 flex gap-5">
          <aside className="hidden w-[64px] shrink-0 flex-col items-center gap-2.5 pt-1 md:flex" aria-label="More places">
            <button className="icon-btn !bg-ink !text-ground !border-transparent" onClick={openSearch} aria-label="Search" title="Search">
              <Search />
            </button>
            <div className="h-6" />
            {canEdit && <RailLink to="/clients" label="Clients" icon={<Building2 />} />}
            <RailLink to="/settings/api" label="API and MCP" icon={<PlugZap />} />
            {canEdit && <RailLink to="/settings/install" label="Website code" icon={<Code2 />} />}
            {isOwner && <RailLink to="/settings/team" label="Team and client logins" icon={<Users />} />}
            <RailLink to="/settings" label="Settings" icon={<Settings />} end />
          </aside>
          <main id="main" className="min-w-0 flex-1" tabIndex={-1}>{children}</main>
        </div>
      </div>

      <nav className="tile fixed inset-x-3 bottom-3 z-30 flex justify-between gap-1 rounded-full p-1.5 md:hidden" aria-label="Main">
        <TabLink to="/" end icon={<LayoutGrid />} label="Home" />
        <TabLink to="/calls" icon={<Phone />} label="Calls" count={queue?.total || 0} />
        {canEdit && <TabLink to="/clients" icon={<Building2 />} label="Clients" />}
        <TabLink to="/reports" icon={<BarChart3 />} label="Reports" />
        <TabLink to="/settings" icon={<Settings />} label="More" />
      </nav>

      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  );
}

function Wordmark() {
  // RULER with the last R mirrored, as in the Hub frame.
  return <span className="text-[22px] font-semibold tracking-[-0.02em] text-ink">RULE<span className="inline-block -scale-x-100">R</span></span>;
}

function RailLink({ to, label, icon, end }: { to: string; label: string; icon: ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end} title={label} aria-label={label} className="rounded-full">
      {({ isActive }) => <span className="icon-btn" aria-current={isActive ? 'page' : undefined}>{icon}</span>}
    </NavLink>
  );
}

function TabLink({ to, label, icon, end, count }: { to: string; label: string; icon: ReactNode; end?: boolean; count?: number }) {
  return (
    <NavLink to={to} end={end}
      className={({ isActive }) => `relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 text-[11px] font-medium [&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:stroke-[1.5] ${isActive ? 'bg-brand text-on-dark' : 'text-ink-2'}`}>
      {icon}{label}
      {!!count && <span className="count absolute right-[18%] top-0.5 !min-w-[16px] !text-[10px] !leading-4">{count}</span>}
    </NavLink>
  );
}

function AccountMenu() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [open]);
  const initials = me.user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const signOut = async () => { await api.post('/auth/logout').catch(() => {}); window.location.href = '/'; };
  return (
    <div className="relative" ref={ref}>
      <button className="grid h-10 w-10 place-items-center rounded-full bg-ink text-[12px] font-semibold text-ground" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="Account">
        {initials}
      </button>
      {open && (
        <div role="menu" className="overlay absolute right-0 top-12 z-40 w-64 rounded-pop p-2" style={{ animation: 'rise var(--dur-micro) var(--ease-brand) both' }}>
          <div className="px-3 py-2">
            <p className="truncate text-[14px] font-medium">{me.user.name}</p>
            <p className="truncate text-[12px] text-ink-3">{me.user.login}</p>
            <p className="mt-1"><span className="chip">{ROLE[me.user.role]}</span></p>
          </div>
          <div className="my-1 h-px bg-line" />
          <MenuItem onClick={() => { setOpen(false); navigate('/settings'); }} icon={<Settings />}>Settings</MenuItem>
          <MenuItem onClick={() => { setOpen(false); navigate('/settings/api'); }} icon={<PlugZap />}>API and MCP</MenuItem>
          <MenuItem onClick={signOut} icon={<LogOut />}>Sign out</MenuItem>
        </div>
      )}
    </div>
  );
}
const ROLE = { owner: 'Owner', member: 'Team member', client: 'Client' } as const;

function MenuItem({ children, icon, onClick }: { children: ReactNode; icon: ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[14px] text-ink hover:bg-paper [&_svg]:h-4 [&_svg]:w-4 [&_svg]:stroke-[1.5] [&_svg]:text-ink-3">
      {icon}{children}
    </button>
  );
}

// ⌘K: clients and calls in one list; arrows move, Enter opens.
function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 160); return () => clearTimeout(t); }, [q]);
  const { data, loading } = useLoad<{ clients: { id: string; name: string }[]; calls: Call[] }>(debounced.length >= 2 ? `/search${qs({ q: debounced })}` : null);
  const items = [
    ...(data?.clients || []).map((k) => ({ key: 'k' + k.id, title: k.name, sub: 'Client', go: `/calls?client_id=${encodeURIComponent(k.id)}` })),
    ...(data?.calls || []).map((c) => ({ key: c.call_sid, title: `${phone(c.caller)}, ${c.client_name}`, sub: `${when(c.started_at)}, ${channel(c.channel)}`, go: `/calls?call=${encodeURIComponent(c.call_sid)}` }))
  ];
  useEffect(() => setSel(0), [debounced]);
  const go = (i: number) => { const it = items[i]; if (it) { onClose(); navigate(it.go); } };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Search" className="overlay w-full max-w-[560px] overflow-hidden rounded-tile" style={{ animation: 'rise var(--dur-short) var(--ease-brand) both' }}>
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="h-[18px] w-[18px] text-ink-3" strokeWidth={1.5} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="A caller, campaign, client or words from a call"
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            aria-label="Search calls and clients"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter') go(sel);
            }} />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Results">
          {debounced.length < 2 && <li className="px-3 py-4 text-[13px] text-ink-3">Type two letters or more</li>}
          {debounced.length >= 2 && !loading && !items.length && <li className="px-3 py-4 text-[13px] text-ink-3">No matches for “{debounced}”.</li>}
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === sel}>
              <button className={`flex w-full flex-col items-start rounded-[12px] px-3 py-2 text-left ${i === sel ? 'bg-paper' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(i)}>
                <span className="text-[14px] text-ink">{it.title}</span>
                <span className="text-[12px] text-ink-3">{it.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
