// The one door to the server. Same origin, session cookie; a 401 anywhere sends the app back to sign-in.

export type Role = 'owner' | 'member' | 'client';
export type LeadStatus = 'new' | 'good' | 'not_lead' | 'customer' | 'spam';

export interface User { id: number; login: string; name: string; role: Role; active: boolean; client_ids: string[] | null; created_at?: string; last_login_at?: string | null }
export interface ClientRef { id: string; name: string; active: boolean; currency: string }
export interface Me {
  user: User; brand: { name: string; company: string }; public_base_url: string; clients: ClientRef[]; lead_statuses: LeadStatus[];
  fixed_sources: Record<string, string>; features: { ai: boolean; email: boolean };
}

export interface Range { since: string; until: string; days: number; prev_since: string; prev_until: string }
export interface Totals { calls: number; answered: number; missed: number; leads: number; first_time: number; value: number; avg_duration: number; answer_rate: number | null }
export interface Day { date: string; calls: number; missed: number; leads: number; first_time: number }
export interface ChannelRow { channel: string; calls: number; answered: number; missed: number; leads: number; value: number }
export interface BoardRow extends Totals {
  id: string; name: string; active: boolean; currency: string; to_call_back: number; flags: string[]; trend: number[]; numbers: number;
  previous: { calls: number; leads: number; answer_rate: number | null };
}
export interface Geo { regions: { region: string; name: string; name_el: string; calls: number; leads: number }[]; mobile: number; unknown: number }
export interface Overview {
  range: Range; client: { id: string; name: string; currency: string } | null; totals: Totals; previous: Totals; daily: Day[];
  by_client: BoardRow[]; by_channel: ChannelRow[]; geo: Geo; to_call_back: { count: number; from_ads: number };
}
export interface Report {
  range: Range; client: { id: string; name: string; currency: string } | null; totals: Totals; previous: Totals; daily: Day[];
  monthly: { month: string; calls: number; answered: number; leads: number; answer_rate: number | null }[];
  by_channel: ChannelRow[]; by_campaign: (ChannelRow & { campaign: string })[];
  by_keyword: { keyword: string; calls: number; answered: number; leads: number }[];
  callers: { first_time: number; repeat: number }; geo: Geo;
}
export interface Call {
  call_sid: string; client_id: string; client_name: string; tracking_number: string; caller: string | null; started_at: string;
  answered: boolean; status: string; duration_sec: number; qualified: boolean; first_time: boolean | null; channel: string | null;
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null;
  landing_page: string | null; referrer: string | null; gclid: string | null; fbclid: string | null; msclkid: string | null;
  region: string | null; region_name: string | null; lead_status: LeadStatus; value: number | null; default_value: number; currency: string;
  value_effective: number; is_lead: boolean; to_call_back: boolean; called_back_at: string | null;
  conv_google: string | null; conv_meta: string | null; conv_ga4: string | null;
  has_recording: boolean; has_transcript: boolean; tags: string[];
  ai_summary: string | null; ai_label: 'good' | 'not_lead' | 'spam' | null; ai_score: number | null;
  transcript?: string | null; notes?: { id: number; body: string; created_at: string; author: string | null }[];
}
export interface CallList { total: number; limit: number; offset: number; calls: Call[] }
export interface ClientEditor {
  client: {
    id: string; name: string; forward_number: string; active: boolean; recording_enabled: boolean; qualified_duration_sec: number | null;
    lead_value: number; currency: string; consent_message: string | null; twilio_account_sid: string; twilio_auth_token_masked: string;
    alert_missed: boolean; alert_emails: string; alert_slack_url_masked: string;
    report_schedule: 'off' | 'weekly' | 'monthly'; report_emails: string; report_next_at: string | null;
    config: {
      googleAds: { customerId?: string; conversionActionId?: string };
      meta: { pixelId: string; capiToken_masked: string; testEventCode: string };
      ga4: { measurementId: string; apiSecret_masked: string };
    };
  };
  numbers: { phone: string; client_id: string; label: string | null; active: number; created_at: string; kind: 'pool' | 'fixed'; source: string | null }[];
  portal_users: { id: number; login: string; name: string; active: number }[];
}
export interface Blocked { pattern: string; note: string | null; created_at: string; blocked_calls: number }
export interface Webhook { id: number; client_id: string | null; url: string; events: string[]; active: boolean; created_at: string; last_status: string | null; last_at: string | null; failures: number }
export interface Token { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/v2' + path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError(0, 'The server did not answer. Check your connection and try again.');
  }
  const data = (r.headers.get('content-type') || '').includes('json') ? await r.json() : null;
  if (r.status === 401 && path !== '/auth/login') onUnauthorized();
  if (!r.ok) throw new ApiError(r.status, (data && data.error) || `The server answered ${r.status}.`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path)
};

export const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};
