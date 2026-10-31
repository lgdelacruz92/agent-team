# Frontend recovery handoff

Requires Node.js 20+ and npm. Run from `frontend/`:

```sh
npm install
npm run build
npx playwright install chromium
npm run test:e2e
npm run dev
```

Vite serves port **5173** (strict port), with `/api` and `/auth` proxied to
`http://localhost:3001`. The Google link navigates to `/auth/google`; the UI
does not manufacture a signed-in session. Both session checks and logout send
cookies. The homepage is a protected, explicitly labeled demo workspace.

Playwright runs mocked contract checks on desktop Chromium and a mobile
Chromium viewport. It checks guest login, horizontal overflow, Google endpoint
navigation, session cookies, personalized homepage, loading, logout, failed
logout and retry, network failure and retry, and the OAuth callback error.
The OAuth route is intercepted only by the test; real Google sign-in requires
the backend and valid Google credentials.

Recovery environment: `npm install`, `npm run build`, and `npm run test:e2e`
could not start (`npm: not found`); no Node.js executable or browser runtime
was available. Therefore neither compilation nor browser/visual checks were
verified here. Run the commands above in a Node-enabled environment.
