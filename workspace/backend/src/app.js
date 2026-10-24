const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { getGoogleUser } = require('./google');

const SESSION_COOKIE = 'google_login.sid';
const STATE_MAX_AGE = 10 * 60 * 1000;
const sessionAction = (req, action) => new Promise((resolve, reject) => {
  req.session[action]((error) => error ? reject(error) : resolve());
});

function createApp(config, { sessionStore } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/' };
  app.use(session({
    name: SESSION_COOKIE,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    ...(sessionStore ? { store: sessionStore } : {}),
    cookie: { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 }
  }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/auth/google', async (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth = { state, createdAt: Date.now() };
    await sessionAction(req, 'save');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      state
    }).toString();
    res.redirect(url.href);
  });

  app.get('/auth/google/callback', async (req, res) => {
    const failureUrl = `${config.frontendUrl}/?authError=google_login_failed`;
    const oauth = req.session.oauth;
    delete req.session.oauth; // Consume state even on errors, preventing replay.
    try {
      await sessionAction(req, 'save');
      const { state, code, error } = req.query;
      if (error !== undefined || typeof state !== 'string' || typeof code !== 'string' || !code || !oauth ||
          Date.now() - oauth.createdAt > STATE_MAX_AGE ||
          Buffer.byteLength(state) !== Buffer.byteLength(oauth.state) ||
          !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(oauth.state))) {
        return res.redirect(failureUrl);
      }
      const user = await getGoogleUser(code, config);
      await sessionAction(req, 'regenerate'); // Prevent session fixation.
      req.session.user = user;
      await sessionAction(req, 'save');
      return res.redirect(`${config.frontendUrl}/`);
    } catch {
      // Never leak authorization codes, credentials, or provider error details.
      return res.redirect(failureUrl);
    }
  });

  app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.status(401).json({ user: null });
    return res.json({ user: req.session.user });
  });

  app.post('/auth/logout', async (req, res) => {
    await sessionAction(req, 'destroy');
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'internal_server_error' });
  });
  return app;
}

module.exports = { createApp };
