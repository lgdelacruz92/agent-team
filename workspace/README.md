# Google OAuth login

Two independent apps: a Node/Express backend on **3001** and a Vite frontend on **5173**. Use Node.js 20 or newer.

## Configure Google

`backend/.env` and `backend/.env.example` contain clearly **dummy** credentials, not working Google secrets. The local `.env` is ignored by Git. If needed, copy `.env.example` to `.env`.

1. In Google Cloud Console, configure the OAuth consent screen and create an OAuth client of type **Web application**. Add test users if the consent screen is in testing mode.
2. Add the exact **Authorized redirect URI**: `http://localhost:3001/auth/google/callback`. For deployed environments, use your backend's HTTPS callback URL instead.
3. Replace `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env` with that client's credentials. Replace `SESSION_SECRET` with a long random secret (for example, generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Never commit real secrets.
4. Keep the local settings `GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback`, `FRONTEND_URL=http://localhost:5173`, and `PORT=3001`.

## Run both apps

From `/workspace/backend`:

```sh
npm install
npm run dev
# Or: npm start
```

In a separate terminal, from `/workspace/frontend`:

```sh
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Open `http://localhost:5173`. The frontend must proxy `/auth` and `/api` to `http://localhost:3001` using Vite and use relative browser URLs. API fetches use cookies (same-origin through the proxy); there is no frontend token storage. No direct cross-origin CORS setup is needed. Use `localhost` consistently, not a mixture of `localhost` and `127.0.0.1`.

## API contract

| Method | Path | Response |
| --- | --- | --- |
| GET | `/auth/google` | Browser redirect to Google's real OAuth authorization endpoint with random session-bound state and `openid email profile` scopes. |
| GET | `/auth/google/callback` | Validates and consumes state, exchanges the code server-side, requests trusted Google OpenID userinfo, regenerates the session, then redirects to `FRONTEND_URL/`. Failure redirects to `FRONTEND_URL/?authError=google_login_failed`. |
| GET | `/api/me` | Logged out: `401 {"user":null}`. Logged in: `200 {"user":{"id":"...","name":"...","email":"...","picture":"..."}}`. |
| POST | `/auth/logout` | Destroys the server session, clears its cookie, returns `200 {"ok":true}`. |

Sessions use HTTP-only, SameSite=Lax cookies; Secure is enabled only with `NODE_ENV=production`. Google tokens never reach the browser or get stored in the session. OAuth state expires after ten minutes. Redirect destinations come only from server configuration, never request parameters. There is no demo-login route or auth bypass.

## Tests

From `/workspace/backend`, run `npm test`. Jest + Supertest exercise the HTTP routes; Nock mocks Google's token and userinfo HTTPS responses. **Real Google OAuth cannot be end-to-end tested with the placeholder credentials**; after configuring real credentials, validate the complete browser login manually.

## Deployment notes

The default in-memory session store is appropriate only for local development: sessions disappear on restart and are not shared across processes. Before production, supply a persistent session store via `createApp(config, { sessionStore })`, use real credentials and a strong secret, and serve both apps behind the same HTTPS origin with `/auth` and `/api` routed to the backend. Production startup rejects dummy credentials, short secrets, and non-HTTPS URLs. Set `TRUST_PROXY=1` only behind a trusted, single reverse proxy that terminates TLS; this allows Express to issue Secure cookies through that proxy. Keep secrets out of source control.
