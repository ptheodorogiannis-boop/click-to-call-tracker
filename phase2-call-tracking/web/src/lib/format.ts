// Numbers, money, durations and dates in the viewer's own format (Greek 1.234,5 or English 1,234.5).
const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-GB';

export const int = (n: number | null | undefined) => (n == null ? 'No data' : new Intl.NumberFormat(locale).format(n));
export const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? 'No data' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits }).format(n);
export const money = (n: number, currency = 'EUR') =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) || n >= 1000 ? 0 : 2 }).format(n);
export const compact = (n: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function duration(sec: number) {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Server times are UTC "YYYY-MM-DD HH:MM:SS".
export const parseUtc = (s: string) => new Date(s.replace(' ', 'T') + 'Z');

export function when(s: string) {
  const d = parseUtc(s);
  const now = new Date();
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return time;
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) }) + ' ' + time;
}

export function ago(s: string) {
  const min = Math.round((Date.now() - parseUtc(s).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export const dayLabel = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });
export const monthLabel = (ym: string) => new Date(ym + '-01T00:00:00').toLocaleDateString(locale, { month: 'short' });
export const longDate = (d = new Date()) => d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

// "+30 210 123 4567" for Greek numbers, as written locally; anything else as given.
export function phone(e164: string | null | undefined) {
  if (!e164) return 'Hidden number';
  const m = e164.match(/^\+30(\d{10})$/);
  if (!m) return e164;
  const n = m[1];
  if (n.startsWith('69')) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (n.startsWith('21')) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

export const CHANNELS: Record<string, string> = {
  google_ads: 'Google Ads', meta_ads: 'Meta Ads', microsoft_ads: 'Microsoft Ads', other_paid: 'Other paid',
  google_organic: 'Google search', meta_organic: 'Facebook and Instagram', referral: 'Referral', direct: 'Direct',
  // fixed numbers (src/sources.js)
  google_business: 'Google Business Profile', print: 'Print', radio: 'Radio', tv: 'TV', outdoor: 'Outdoor',
  partner: 'Partner or directory', offline_other: 'Other offline'
};
export const channel = (c: string | null | undefined) => CHANNELS[c || 'direct'] || c || 'Direct';
// Short names for chart labels, where a column is narrow.
const SHORT: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', microsoft_ads: 'Microsoft', other_paid: 'Other paid', google_organic: 'Search', meta_organic: 'Social', referral: 'Referral', direct: 'Direct', google_business: 'Google listing', print: 'Print', radio: 'Radio', tv: 'TV', outdoor: 'Outdoor', partner: 'Partner', offline_other: 'Offline' };
export const channelShort = (c: string | null | undefined) => SHORT[c || 'direct'] || c || 'Direct';

export const LEAD_LABEL: Record<string, string> = { new: 'Not judged', good: 'Lead', not_lead: 'Not a lead', customer: 'Customer', spam: 'Spam' };

// Change against the previous period, or nothing when there is nothing to compare.
export function change(now: number | null, before: number | null) {
  if (now == null || before == null || before === 0) return null;
  return (now - before) / before;
}
