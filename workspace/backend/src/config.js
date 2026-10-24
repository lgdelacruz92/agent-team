const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function loadConfig(env = process.env) {
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'GOOGLE_CALLBACK_URL', 'FRONTEND_URL']) {
    if (!env[key]) throw new Error(`Missing required configuration: ${key}`);
  }
  const callback = new URL(env.GOOGLE_CALLBACK_URL);
  const frontend = new URL(env.FRONTEND_URL);
  for (const url of [callback, frontend]) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('OAuth URLs must be HTTP(S) URLs without embedded credentials');
    }
  }
  const production = env.NODE_ENV === 'production';
  if (production && (env.SESSION_SECRET.startsWith('dummy-') || env.SESSION_SECRET.length < 32 || env.GOOGLE_CLIENT_ID.startsWith('dummy-') || env.GOOGLE_CLIENT_SECRET.startsWith('dummy-'))) {
    throw new Error('Production requires real OAuth credentials and a strong session secret');
  }
  if (production && (callback.protocol !== 'https:' || frontend.protocol !== 'https:')) {
    throw new Error('Production requires HTTPS OAuth and frontend URLs');
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return {
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    sessionSecret: env.SESSION_SECRET,
    callbackUrl: callback.href,
    frontendUrl: frontend.origin,
    port,
    production,
    trustProxy: env.TRUST_PROXY === '1'
  };
}

module.exports = { loadConfig };
