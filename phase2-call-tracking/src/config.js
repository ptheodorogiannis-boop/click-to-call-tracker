'use strict';
// Load .env from the project folder, wherever the process was started from.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const cfg = {
  port: parseInt(process.env.PORT || '8080', 10),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  dbPath: process.env.DB_PATH || './data/calls.db',

  // Account-level Twilio is now a FALLBACK only — each client carries its own creds in the DB.
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    validateSignature: String(process.env.VALIDATE_TWILIO_SIGNATURE || 'true') === 'true'
  },

  // Branding for the self-hosted UI (override here to re-skin / rename).
  brand: {
    name: process.env.BRAND_NAME || 'Ruler CallTrack',
    company: process.env.BRAND_COMPANY || 'Ruler Agency'
  },

  // Admin UI auth.
  admin: {
    user: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || '',           // REQUIRED to enable the UI
    sessionSecret: process.env.SESSION_SECRET || '',       // REQUIRED; random long string
    sessionHours: parseInt(process.env.SESSION_HOURS || '12', 10)
  },

  defaults: {
    qualifiedDurationSec: parseInt(process.env.DEFAULT_QUALIFIED_DURATION_SEC || '30', 10),
    sessionTtlMinutes: parseInt(process.env.SESSION_TTL_MINUTES || '60', 10),
    repeatCallerWindowDays: parseInt(process.env.REPEAT_CALLER_WINDOW_DAYS || '90', 10)
  },

  googleAds: {
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    clientId: process.env.GOOGLE_ADS_CLIENT_ID,
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  },

  transcription: {
    provider: process.env.TRANSCRIPTION_PROVIDER || 'twilio',
    openaiApiKey: process.env.OPENAI_API_KEY
  },

  // Default Greek GDPR consent announcement (played before connecting, if recording is on).
  defaultConsentMessageEl:
    'Η κλήση σας ηχογραφείται για λόγους ποιότητας και εξυπηρέτησης. ' +
    'Αν δεν επιθυμείτε την ηχογράφηση, μπορείτε να κλείσετε τώρα.'
};

module.exports = cfg;
