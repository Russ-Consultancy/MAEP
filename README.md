# MAEP — Modern Authentication Enablement Platform

A centrally-hosted **SSO broker** for PingOne. One shared OIDC client, many applications.

This repo contains:

- The broker itself — Angular UI on `:4200` and an Express + PostgreSQL backend on `:3000`.
- The broker itself — Angular UI on `:4200` and an Express + PostgreSQL backend on `:3000`.
- `aep-client/` — the operator's source/build folder for the wrapper. Contains `server.js`, the Node SEA build scripts, and the compiled `dist/`.
- `aep-wrapper/` — the **client deliverable**: the binary, browser scripts, config template, and a client-facing README. Ship this folder to consumers.

See the **Repo layout** and **aep-wrapper** sections below.

## How it works

```
 Consuming app (any origin)                 Central SSO broker (this app, :4200)
 ---------------------------------         -------------------------------------------
 User hits consuming app                     /login?app=<appId>&returnUrl=<its-own-url>
        |                                       |
        |  redirect                             v
        +----------------------------------->  AuthService.initForApp(appId)
                                               GET /api/app-configs/:appId   (from Postgres)
                                               oauthService.configure(shared OIDC client)
                                               initCodeFlow()  -> PingOne
                                               |
        <-----------------------------------  PingOne redirect /auth/callback?code&state
                                               completeLogin(): code -> tokens (PKCE)
                                               POST app.ssoLoginEndpoint {username,email,company}
                                               <- {access_token, role, ...}
                                               redirect back to returnUrl?token=<access_token>
        v
 App reads ?token= and establishes its own session
```

- Only **one** redirect URI is registered in PingOne — the broker's `/auth/callback`.
- The originating app + destination are carried in `?app=` and `?returnUrl=`.
- `returnUrl` is validated against the app's `allowedReturnUrls` to prevent open redirects.

## Run it

### Backend (PostgreSQL)

```bash
cd backend
cp .env.example .env            # fill DATABASE_URL
npm install
npm start                       # :3000, auto-migrates schema + seeds hr-portal
```

### Broker (Angular)

```bash
npm install
npm start                       # :4200, proxies /api -> :3000
```

Open `http://localhost:4200/admin/app-configs` to manage applications.

## App Config Editor — what's dynamic

The editor at `/admin/app-configs` is a fully dynamic Angular page:

- **Search/filter** by app id, name, or endpoint.
- **Create / edit / delete** application configs.
- **JSON import** — bulk-load configs from a JSON file.
- **JSON export** — download all configs as a timestamped JSON file.
- **Endpoint tester** — verifies each app's `ssoLoginEndpoint` is reachable (CORS preflight) and shows live status badges (Reachable / Unreachable / Testing…).
- **Form validation** with hints and required-field markers.

No page reloads; all state is reactive.

## Configure an application

Open `http://localhost:4200/admin/app-configs` and add a row. You only enter the
**app-specific** fields — the PingOne OIDC client is registered **once** and shared
by all applications, so it lives in `auth.config.ts`.

| Field | Purpose |
|-------|---------|
| `appId` | Unique key, used in the `?app=` redirect (e.g. `hr-portal`). |
| `appName` | Human-readable name shown on the login page. |
| `ssoLoginEndpoint` | **Required.** The broker POSTs Ping claims `{username,email,company}` here; the app's backend maps them to a user and returns an app token. |
| `defaultPostLoginRoute` | Where to land inside the app when no `returnUrl` is given (usually `/dashboard`). |
| `backendApiUrl` | Base URL of the app's own backend, if the broker must call it on the app's behalf (empty when proxied). |
| `allowedReturnUrls` | **Required for security.** Comma-separated origins the broker may redirect back to after login (prevents open redirects). |

> You do **not** create a new PingOne/ForgeRock client per application — only the single
> existing `OIDCLogin` client is used. Each new application just gets a row in the editor.

## What the consuming app must provide

The app does **not** talk to PingOne at all — the broker does. It only needs:

**Frontend**
- Redirect unauthenticated users to `https://<broker-host>/login?app=<appId>&returnUrl=<url-encoded-its-own-url>`
- On return, read `?token=<access_token>` and `?compositeToken=<14-char-token>` from the URL and store them as the session tokens.

**Backend** (one endpoint the broker calls)
```
POST <app-backend>/api/auth/sso-login
```
- **Request:** `{ "username": "user@company.com", "email": "user@company.com", "company": "COMPANY" }`
- **Response 200:** `{ "access_token": "...", "compositeToken": "...", "token_type": "Bearer", "username": "...", "role": "...", "company": "...", "lastLogin": "..." }`
- Must allow CORS `POST` from the broker origin.

> **Recommended:** ship the `aep-wrapper/` folder to the consuming app's team.
> It contains the binary, the config template, the browser scripts, and a
> step-by-step client-facing README. The wrapper handles the broker's
> `POST /api/auth/sso-login` call, the JWT, the 14-char composite token, and the
> login activity log — no source code is shared.

## Admin login (broker operators only)

The broker admin UI (`/admin/app-configs`, `/admin/activities`) is protected by a
**simple DB-backed login** (not PingOne). On first start the backend seeds an
`admin` user with password `admin` — change it immediately.

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/login` | `{username, password}` → `{token, username}`. JWT in `Authorization: Bearer ...`. |
| `POST /api/admin/logout` | Client-side token discard. |
| `GET  /api/admin/me` | Current admin. |
| `POST /api/admin/password` | Rotate own password. |

Open `http://localhost:4200/admin/login` to sign in.

## Backend API

```
# App configs (admin)
GET    /api/app-configs
GET    /api/app-configs/:appId
POST   /api/app-configs
PUT    /api/app-configs/:appId
DELETE /api/app-configs/:appId

# Login activities (admin)
GET  /api/activities?appId=&status=&limit=
GET  /api/activities/summary
POST /api/activities                  (called by the aep-wrapper binary)

# Admin auth
POST /api/admin/login
POST /api/admin/logout
GET  /api/admin/me
POST /api/admin/password
```

`backend/server.js` uses PostgreSQL via `pg`. The schema is auto-migrated on startup
(`CREATE TABLE IF NOT EXISTS` + trigger for `updated_at`). Three tables:
`app_configs`, `login_activities`, `admin_users`. A seed `admin` user (password
`admin`) is created on first start.

## Repo layout

```
AEP-Authentication-Enablement-Platform/
├── aep-client/                 <-- OPERATOR's source/build folder (not shipped)
│   ├── server.js                  the wrapper's source code
│   ├── package.json               esbuild + Node SEA build scripts
│   ├── config.example.json        template (also copied into aep-wrapper)
│   ├── browser/                   the three browser scripts (also copied into aep-wrapper)
│   ├── .gitignore
│   └── dist/                      compiled binaries (aep-client.exe etc.)
│
├── aep-wrapper/                <-- CLIENT DELIVERABLE — ship this folder to consumers
│   ├── aep-client.exe             the wrapper binary
│   ├── config.example.json        client edits this into config.json
│   ├── README.md                  client-facing setup guide
│   ├── .gitignore                 ignores config.json (has the JWT secret) and *.log
│   └── browser/
│       ├── aep-auth.js
│       ├── aep-guard.js
│       └── aep-signin.js
│
├── backend/                    <-- broker's Express + PostgreSQL API
│   ├── server.js                  app-configs CRUD, admin auth, activities, schema auto-migration
│   ├── package.json
│   └── .env                       local config (DATABASE_URL, PORT, ADMIN_JWT_SECRET, …)
├── src/                        <-- broker Angular UI
│   ├── auth.config.ts             shared PingOne OIDC client config (one for all apps)
│   ├── auth.service.ts            loads per-app config from DB, reconfigures OAuth at runtime
│   ├── auth.guard.ts              blocks unauthenticated access to user routes
│   ├── token.interceptor.ts       attaches admin/Ping bearer tokens
│   ├── app-config.service.ts      DB-backed CRUD for application configs
│   ├── admin/
│   │   ├── admin-auth.service.ts  DB-backed admin session
│   │   └── db-admin.guard.ts      guard for /admin/* routes
│   └── pages/
│       ├── login/                 consuming-app login (reads ?app=<id>&returnUrl=<url>)
│       ├── auth-callback/         PingOne OIDC callback; redirects back with token + compositeToken
│       ├── admin-login/           DB-backed admin sign-in (broker root URL)
│       ├── app-config-editor/     ADMIN: search, CRUD, JSON import/export, endpoint tester
│       └── activities/            ADMIN: login_activities table viewer
├── angular.json / package.json / proxy.conf.json / tsconfig*.json  <-- broker Angular project
└── README.md
```

### Releasing a new wrapper

After editing `aep-client/server.js`:

```powershell
cd aep-client
npm run build:win          # produces dist\aep-client.exe
# copy the new binary + the three browser scripts + config.example.json
# into aep-wrapper\ and aep-wrapper\browser\
```

## aep-wrapper — what you ship to clients

`aep-wrapper/` is the entire deliverable. It contains:

1. **`aep-client.exe`** — the wrapper binary (no Node.js install needed on the
   client's machine). Exposes `POST /api/auth/sso-login`, `GET /api/auth/me`,
   `GET /healthz`. Issues a signed JWT, builds a 14-char composite token, and
   writes a local JSON-per-line activity log.
2. **`config.example.json`** — the only file the client needs to edit. Copy it
   to `config.json` next to the binary and fill in `port`, `brokerOrigin`,
   `appId`, `appName`, `appJwtSecret`, `brokerActivitiesUrl`,
   `tokenExpiresInMinutes`, and the `compositeToken` recipe.
3. **`browser/aep-auth.js`** — vanilla browser helper that exposes
   `window.AepAuth` (`getToken`, `getCompositeToken`, `signInWithBroker`,
   `signOut`, `requireAuth`). Extracts `?token=&compositeToken=&expires_at=`
   from the URL, stashes them in `sessionStorage`, fires `aep-auth-changed`.
4. **`browser/aep-guard.js`** — invisible Web Component (`<aep-guard>`) that
   silently redirects unauthenticated users to the broker and bounces them
   back to the originally-requested URL after sign-in.
5. **`browser/aep-signin.js`** — visible Web Component (`<aep-signin>`) for
   public pages that need a "Sign in with SSO" button.
6. **`README.md`** — the client-facing setup guide. No technical details,
   no source references, no build instructions.

### Register the consuming app in the broker

Open the broker at `http://localhost:4200/admin/login` (default `admin` /
`admin`, change after first login). At `/admin/app-configs` add a row:

| Field | Value (example) |
|---|---|
| `appId` | `my-angular-app` (must match `appId` in `aep-wrapper/config.json`) |
| `appName` | `My Angular App` |
| `ssoLoginEndpoint` | `http://localhost:5001/api/auth/sso-login` |
| `defaultPostLoginRoute` | `/dashboard` |
| `allowedReturnUrls` | `http://localhost:64101` (the origin of the consuming app) |

### End-to-end flow

1. Postgres running, `backend/` started, broker UI on `:4200`, the wrapper
   binary on `:5001`, consuming app on `:64101`.
2. Admin opens `http://localhost:4200/admin/login` (default `admin` / `admin`).
3. User visits `http://localhost:64101/environment-details`. `<aep-guard>`
   sees no token and redirects to
   `http://localhost:4200/login?app=my-angular-app&returnUrl=http://localhost:64101/environment-details`.
4. Broker handles PingOne → POSTs Ping claims to
   `http://localhost:5001/api/auth/sso-login`.
5. Wrapper maps claims to a user, signs a JWT, builds the 14-char composite
   token, returns both, and pushes a `success` activity row to the broker.
6. Broker redirects to
   `http://localhost:64101/environment-details?token=<jwt>&compositeToken=<14chars>&expires_at=...`.
7. `aep-auth.js` extracts, stashes them in `sessionStorage`, strips the URL.
8. `<aep-guard>` re-evaluates: token is valid, clears the loading state, lets
   the page render.
9. Admin views the activity at `http://localhost:4200/admin/activities`.

## Verification

- `npm run build` — Angular AOT build succeeds.
- Backend CRUD verified with curl against a live Postgres instance.
- Token-exchange contract verified: `POST <app>/api/auth/sso-login` must return the
  `{ access_token, token_type, username, role, company, lastLogin }` shape.

The only step that cannot run headless is the real browser→PingOne OIDC redirect; that
requires a browser and valid PingOne/ForgeRock credentials, exercised manually per app.

## Security notes

- `returnUrl` is validated against each app's `allowedReturnUrls` to prevent open redirects.
- The demo hands the app token back via `?token=`. For production prefer a short-lived token
  over HTTPS, or have the broker set a secure, http-only, same-site cookie / POST the token.
- Lock CORS on the consuming app's `ssoLoginEndpoint` to the broker's origin in production.
