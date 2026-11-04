'use strict';
/**
 * A demo database for trying the app and checking screens: five made-up businesses and about a year of calls.
 * It refuses to touch any database that already has calls, so it never mixes with real data.
 *   DB_PATH=./data/demo.db node tools/demo.js
 *   DB_PATH=./data/demo.db npm start        → sign in as admin / demo-password-1
 * Logins: admin (owner), maria@ruler.demo (member), lyra@client.demo (client of Lyra Dental only); all demo-password-1.
 */
if (!process.env.DB_PATH || /calls\.db$/.test(process.env.DB_PATH)) {
  console.error('Set DB_PATH to a separate file, e.g. DB_PATH=./data/demo.db. The demo never writes to calls.db.');
  process.exit(1);
}
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo-password-1';
const { db, migrate } = require('../src/db');
const users = require('../src/users');
const { regionForPhone } = require('../src/geo');

async function main() {
await migrate();
if ((await db.prepare('SELECT COUNT(*) n FROM calls').get()).n > 0) {
  console.error('This database already has calls. Point DB_PATH at a new file.');
  process.exit(1);
}

// A seeded random, so every run makes the same demo.
let seed = 20261104;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const weighted = (pairs) => { let r = rnd() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };

const CLIENTS = [
  { id: 'acme-kitchens', name: 'Acme Kitchens', fwd: '+302101111111', value: 60, rate: 0.9, volume: 1.4, campaigns: ['kitchens-athens', 'brand', 'wardrobes'], keywords: ['κουζίνες αθήνα', 'kitchen renovation', 'ντουλάπες', 'acme kitchens'] },
  { id: 'lyra-dental', name: 'Lyra Dental Clinic', fwd: '+302310222222', value: 120, rate: 0.62, volume: 1.1, campaigns: ['implants', 'whitening', 'brand'], keywords: ['οδοντικά εμφυτεύματα', 'λεύκανση δοντιών', 'dentist thessaloniki'] },
  { id: 'aegean-villas', name: 'Aegean Villas', fwd: '+302284033333', value: 300, rate: 0.85, volume: 0.6, campaigns: ['summer-villas', 'brand'], keywords: ['villa paros', 'βίλες πάρος', 'paros villa with pool'] },
  { id: 'kastro-law', name: 'Kastro Law Office', fwd: '+302610444444', value: 90, rate: 0.93, volume: 0.45, campaigns: ['family-law', 'brand'], keywords: ['δικηγόρος πάτρα', 'διαζύγιο δικηγόρος'] },
  { id: 'meltemi-auto', name: 'Meltemi Auto Service', fwd: '+302810555555', value: 45, rate: 0.8, volume: 0.9, campaigns: ['service-offer', 'tyres', 'brand'], keywords: ['service αυτοκινήτου ηράκλειο', 'λάστιχα', 'συνεργείο'] }
];
const LANDLINES = ['210', '210', '210', '211', '213', '2310', '2310', '2410', '2421', '2610', '2810', '2821', '2651', '2661', '2710', '2721', '2251', '2284', '2241', '2510', '2221', '2462'];
const TRANSCRIPTS = [
  'Καλησπέρα, είδα τη διαφήμισή σας και θα ήθελα μια προσφορά. Μπορείτε να με καλέσετε αύριο το πρωί;',
  'Hello, I am calling about availability for the first week of July, for four people.',
  'Ήθελα να κλείσω ένα ραντεβού για την επόμενη εβδομάδα, αν υπάρχει κάτι διαθέσιμο.',
  'Γεια σας, ρωτάω για τις τιμές. Είναι η προσφορά ακόμη σε ισχύ;',
  'I would like to know if you can come and measure the space this Saturday.'
];

const insClient = (`INSERT INTO clients (id, name, forward_number, lead_value, currency, recording_enabled, qualified_duration_sec, config_json)
  VALUES (?, ?, ?, ?, 'EUR', 1, 30, '{}')`);
const insNumber = ('INSERT INTO numbers (phone, client_id, label) VALUES (?, ?, ?)');
const insCall = (`INSERT INTO calls (call_sid, client_id, tracking_number, caller, started_at, answered, status, duration_sec,
    qualified, first_time, channel, utm_source, utm_medium, utm_campaign, utm_term, landing_page, gclid, fbclid, region, lead_status, value, transcript, called_back_at)
  VALUES (@sid, @client, @tracking, @caller, @at, @answered, @status, @dur, @q, @first, @channel, @src, @med, @campaign, @term, @landing, @gclid, @fbclid, @region, @lead, @value, @transcript, @called_back)`);
const insTag = ('INSERT OR IGNORE INTO call_tags (call_sid, tag) VALUES (?, ?)');
const insNote = ('INSERT INTO call_notes (call_sid, user_id, body, created_at) VALUES (?, ?, ?, ?)');

const owner = await users.bootstrapOwner();
const member = await users.createUser({ login: 'maria@ruler.demo', name: 'Maria Papadaki', password: 'demo-password-1', role: 'member' });

const now = Date.now();
let n = 0;
await db.tx(async (t) => {
  for (const c of CLIENTS) {
    await t.prepare(insClient).run(c.id, c.name, c.fwd, c.value);
    const pool = [1, 2, 3, 4].map((i) => `+30${c.fwd.slice(3, 6)}99${CLIENTS.indexOf(c)}000${i}`);
    for (const [i, p] of pool.entries()) await t.prepare(insNumber).run(p, c.id, `Pool ${i + 1}`);
    const seen = new Set();
    for (let day = 400; day >= 0; day--) {
      const season = c.id === 'aegean-villas' ? 0.4 + Math.max(0, Math.sin(((day + 90) / 365) * Math.PI * 2)) : 1;
      const weekday = new Date(now - day * 86400000).getUTCDay();
      const base = (weekday === 0 ? 0.3 : weekday === 6 ? 0.6 : 1) * c.volume * season * (day < 30 ? 1.15 : 1) * 3.2;
      const count = Math.floor(base + rnd() * base);
      for (let k = 0; k < count; k++) {
        const channel = weighted([['google_ads', 45], ['meta_ads', 16], ['google_organic', 18], ['direct', 13], ['referral', 5], ['microsoft_ads', 3]]);
        const mobile = rnd() < 0.58;
        const repeat = seen.size > 10 && rnd() < 0.18;
        const caller = repeat ? pick([...seen]) : mobile
          ? `+3069${Math.floor(10000000 + rnd() * 89999999)}`
          : (() => { const ac = pick(LANDLINES); return `+30${ac}${String(Math.floor(rnd() * 1e8)).padStart(10 - ac.length, '0')}`.slice(0, 13); })();
        const answered = rnd() < c.rate - (day < 20 && c.id === 'lyra-dental' ? 0.1 : 0) ? 1 : 0;
        const dur = answered ? Math.floor(rnd() < 0.2 ? 8 + rnd() * 20 : 35 + rnd() * 420) : 0;
        const at = new Date(now - day * 86400000);
        at.setUTCHours(6 + Math.floor(rnd() * 11), Math.floor(rnd() * 60), Math.floor(rnd() * 60));
        if (at.getTime() > now) at.setTime(now - Math.floor(rnd() * 3600000));
        const paid = ['google_ads', 'meta_ads', 'microsoft_ads'].includes(channel);
        const campaign = paid ? pick(c.campaigns) : null;
        const lead = answered && dur >= 30 ? weighted([['new', 70], ['good', 18], ['customer', 6], ['not_lead', 5], ['spam', 1]]) : (answered ? weighted([['new', 90], ['spam', 6], ['not_lead', 4]]) : 'new');
        const sid = 'CA' + (++n).toString(16).padStart(30, '0');
        const recent = day <= 10;
        await t.prepare(insCall).run({
          sid, client: c.id, tracking: pick(pool), caller, at: at.toISOString().slice(0, 19).replace('T', ' '),
          answered, status: answered ? 'answered' : 'missed', dur, q: answered && dur >= 30 ? 1 : 0, first: seen.has(caller) ? 0 : 1,
          channel, src: channel.startsWith('google') ? 'google' : channel.startsWith('meta') ? 'facebook' : channel === 'microsoft_ads' ? 'bing' : null,
          med: paid ? 'cpc' : channel === 'google_organic' ? 'organic' : null, campaign,
          term: channel === 'google_ads' ? pick(c.keywords) : null,
          landing: `https://${c.id.replace(/-/g, '')}.example/${campaign || ''}`,
          gclid: channel === 'google_ads' ? 'Cj0KCQjw' + sid.slice(-12) : null, fbclid: channel === 'meta_ads' ? 'IwAR' + sid.slice(-12) : null,
          region: regionForPhone(caller), lead, value: lead === 'customer' ? c.value * (2 + Math.floor(rnd() * 4)) : null,
          transcript: answered && dur > 60 && rnd() < 0.35 ? pick(TRANSCRIPTS) : null,
          called_back: !answered && !recent && rnd() < 0.7 ? at.toISOString().slice(0, 19).replace('T', ' ') : null
        });
        seen.add(caller);
        if (lead === 'customer') await t.prepare(insTag).run(sid, 'booked');
        if (lead === 'good' && rnd() < 0.4) await t.prepare(insTag).run(sid, pick(['quote sent', 'call again', 'price question']));
        if (lead === 'customer' && rnd() < 0.5) await t.prepare(insNote).run(sid, member.id, pick(['Booked for next week.', 'Sent the quote by email, accepted.', 'Came in on Saturday, paid the deposit.']), at.toISOString().slice(0, 19).replace('T', ' '));
      }
    }
  }
});

await users.createUser({ login: 'lyra@client.demo', name: 'Lyra Dental reception', password: 'demo-password-1', role: 'client', client_ids: ['lyra-dental'] });
console.log(`demo: ${CLIENTS.length} clients, ${n} calls in ${process.env.DB_PATH}; owner "${owner.login}", member maria@ruler.demo, client lyra@client.demo (demo-password-1)`);
db.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
