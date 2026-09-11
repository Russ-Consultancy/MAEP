# AEP Wrapper

The AEP (Authentication Enablement Platform) wrapper is a small program your
computer runs alongside your application. It works with the MAEP SSO broker
to sign users in.

You do **not** need Node.js, npm, or any developer tools. Everything you need
is in this folder.

---

## What you have

```
aep-wrapper/
├── aep-wrapper.exe            the wrapper program (also serves the three
│                               browser scripts you'll need)
├── config.example.json         a template — copy this to config.json and edit
└── README.md                   this file
```

That's it. Two files plus this README.

---

## Step 1 — Configure the wrapper

1. Open this folder.
2. Make a copy of `config.example.json` and rename it to `config.json`.
3. Open `config.json` in any text editor (Notepad is fine) and fill in:

   | Field | What to put |
   |-------|-------------|
   | `port` | A free port, e.g. `5001`. |
   | `brokerOrigin` | The URL of your MAEP broker, e.g. `http://localhost:4200`. |
   | `appId` | The application ID your broker admin gave you, e.g. `my-app`. |
   | `appName` | A display name for your app, e.g. `My App`. |
   | `appJwtSecret` | A random string. Use a long random value in production. |
   | `brokerActivitiesUrl` | The broker's activity endpoint, e.g. `http://localhost:3000/api/activities`. |
   | `tokenExpiresInMinutes` | How long a sign-in stays valid, in minutes (1–60). |

   Leave the `compositeToken` block as it is unless your broker admin tells you otherwise.

## Step 2 — Run the wrapper

**Windows:** double-click `aep-wrapper.exe`, or from a PowerShell window:
```powershell
cd C:\path\to\aep-wrapper
.\aep-wrapper.exe
```

**Linux / macOS:** make it executable and run it:
```bash
chmod +x aep-wrapper
./aep-wrapper
```

You should see something like:
```
aep-client SSO endpoint on :5001
  trusting broker: http://localhost:4200
  appId:           my-app
  compositeToken:  enabled (14 chars)
  browser scripts: http://localhost:5001/aep-{auth,guard,signin}.js
```

Leave this window open. The wrapper needs to keep running for sign-in to work.

## Step 3 — Tell your broker admin

Send these to the person who runs the MAEP broker:

- **App ID:** (the value you put in `appId`)
- **App name:** (the value you put in `appName`)
- **SSO endpoint URL:** `http://<your-computer>:<port>/api/auth/sso-login`
  (example: `http://localhost:5001/api/auth/sso-login`)
- **Allowed return URL:** the origin of your app, e.g. `http://localhost:3000`

They will register your app in the broker's admin panel.

## Step 4 — Wire your app's frontend

Your app loads the three browser scripts **directly from the wrapper**. You do
not copy any files. The wrapper serves them at fixed URLs.

In your `index.html`, inside `<head>`, add:
```html
<meta name="aep-broker" content="http://localhost:4200">
<meta name="aep-app"    content="my-app">
<script src="http://localhost:5001/aep-auth.js"></script>
<script src="http://localhost:5001/aep-guard.js"></script>
```

Replace `http://localhost:5001` with the wrapper's actual address. The values
must match the wrapper's `port` and the broker's `brokerOrigin` / `appId`.

In `<body>`, pick the option that matches your app:

### Option A — your app requires sign-in on every page (recommended)

```html
<aep-guard></aep-guard>
```
on every page that requires sign-in. The user never sees a sign-in button;
they are automatically sent to sign in if they aren't already.

### Option B — your app has public pages and a sign-in button

```html
<script src="http://localhost:5001/aep-signin.js"></script>
```
on pages where the sign-in button should appear, and:
```html
<aep-signin></aep-signin>
```
where the button should be rendered.

You can also mix: `<aep-signin>` on a public landing page, `<aep-guard>` on
every protected page.

## Step 5 — Test

1. Make sure the wrapper is running (Step 2) and the broker admin has
   registered your app (Step 3).
2. Open your app in a browser.
3. If you used `<aep-guard>`, the page will redirect you to sign in. If you
   used `<aep-signin>`, click the **Sign in with SSO** button.
4. Sign in. You should land back on your app, signed in.

## Troubleshooting

**The wrapper says "config.json not found"**
Copy `config.example.json` to `config.json` (Step 1).

**The browser says "Application not configured" after I click sign in**
The `appId` in your `config.json` doesn't match the one the broker admin
registered. Make sure they are identical (case-sensitive).

**Sign-in succeeds but the page is blank or still shows "not signed in"**
The broker admin needs to add your app's origin (e.g. `http://localhost:3000`)
to the **Allowed return URLs** list for your app.

**After I sign in, the browser bounces me straight back to the SSO sign-in page**
This is a redirect loop: your app is receiving the token in the return URL but
not saving it before checking again. Causes and fixes:

1. Make sure your `index.html` loads `aep-auth.js` **before** `aep-guard.js`
   (the order in the Step 4 example matters).
2. Make sure `aep-wrapper.exe` is the current version, and restart it after
   replacing the binary.
3. Hard-refresh your app page (Ctrl+F5) so the browser fetches the latest
   scripts from the wrapper instead of using a cached copy.

**The browser shows "Failed to load resource: net::ERR_CONNECTION_REFUSED" on the script tags**
The wrapper isn't running, or the URL in your `<script src="…">` doesn't match
the wrapper's actual address.

**The wrapper exits with "compositeToken length is N, expected 14"**
Open `config.json` and adjust the three numbers under `compositeToken` so they
add up to 14 (including the two dashes). For example, `7 + 4 + 1 + 2 = 14`.

**Where do I see the logs?**
In the same folder as the wrapper, a file called `aep-client.log` is created
automatically. It contains one line per sign-in attempt.

**How long is a sign-in valid?**
`tokenExpiresInMinutes` in `config.json` (default 10 minutes). After that, the
user is asked to sign in again.

**Antivirus flagged `aep-wrapper.exe`**
It is a **Node.js Single Executable Application** — the binary contains the
official Node.js runtime plus your wrapper code as a script blob. Some AV
products (Symantec, Defender) flag this as suspicious. To resolve:

1. **Add a security exception** for `aep-wrapper.exe` in your AV product.
2. **Code-sign the binary** if your organization has a code-signing
   certificate (run `signtool sign /fd SHA256 aep-wrapper.exe`).
3. **Use source mode** instead — if your server has Node.js 18+ installed,
   ask us for the `aep-wrapper-source/` folder and run it with
   `node server.js`.
