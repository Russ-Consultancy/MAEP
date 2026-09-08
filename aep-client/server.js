/**
 * aep-client — drop-in SSO wrapper for the AEP/MAEP broker.
 *
 * Configuration: edit `config.json` next to the binary (see `config.example.json`).
 * Logging: append-only JSON-per-line log at `config.logFile`.
 *
 * The three browser scripts (aep-auth.js, aep-guard.js, aep-signin.js) live
 * as plain files in `browser/` for development, get base64-encoded into
 * `assets.js` (run `npm run rebuild-assets`), and `pkg` bundles `assets.js`
 * into the binary. The binary then serves them at:
 *   /aep-auth.js, /aep-guard.js, /aep-signin.js
 * so the consuming app can `<script src="http://<wrapper-host>:<port>/aep-guard.js">`
 * and not ship any source.
 */
const fs     = require('fs');
const path   = require('path');
const express= require('express');
const cors   = require('cors');
const jwt    = require('jsonwebtoken');

const { AEP_AUTH_JS, AEP_GUARD_JS, AEP_SIGNIN_JS } = require('./assets');

const CFG_PATH = (() => {
  if (process.env.AEP_CONFIG) return process.env.AEP_CONFIG;
  const cwdCfg = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(cwdCfg)) return cwdCfg;
  return path.join(__dirname, 'config.json');
})();

function loadConfig() {
  if (!fs.existsSync(CFG_PATH)) {
    console.error('config.json not found at', CFG_PATH);
    console.error('Searched: AEP_CONFIG env var, then ./config.json next to the binary.');
    console.error('Copy config.example.json to config.json and edit it.');
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  const t = cfg.compositeToken || {};
  if (t.enabled) {
    const total = (t.appIdPrefixLen || 0) + (t.appNamePrefixLen || 0) + (t.randomLen || 0)
                + (t.separator ? 2 : 0);
    if (total !== 14) {
      console.error(`compositeToken length is ${total}, expected 14. Adjust appIdPrefixLen/appNamePrefixLen/randomLen/separator.`);
      process.exit(1);
    }
  }
  return cfg;
}

const cfg = loadConfig();
const PORT                = cfg.port || 5001;
const BROKER_ORIGIN       = cfg.brokerOrigin || 'http://localhost:4200';
const APP_ID              = cfg.appId || 'my-app';
const APP_NAME            = cfg.appName || APP_ID;
const APP_JWT_SECRET      = cfg.appJwtSecret || 'change-me-in-prod';
const LOG_FILE            = cfg.logFile || 'aep-client.log';
const BROKER_ACTIVITIES   = cfg.brokerActivitiesUrl || '';
const TOKEN_TTL_MIN       = Math.max(1, Math.min(60, parseInt(cfg.tokenExpiresInMinutes, 10) || 10));
const TOKEN_CFG           = cfg.compositeToken || { enabled: false };

const logStream = fs.createWriteStream(path.resolve(process.cwd(), LOG_FILE), { flags: 'a' });
function logActivity(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
  logStream.write(line);
  if (BROKER_ACTIVITIES) {
    fetch(BROKER_ACTIVITIES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch((e) => console.error('activity push failed:', e.message));
  }
}

function randomChars(n, alphabet) {
  let out = '';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function buildCompositeToken(appId, appName) {
  if (!TOKEN_CFG.enabled) return null;
  const a = (appId || '').slice(0, TOKEN_CFG.appIdPrefixLen).padEnd(TOKEN_CFG.appIdPrefixLen, 'x');
  const b = (appName || '').replace(/\s+/g, '').slice(0, TOKEN_CFG.appNamePrefixLen).padEnd(TOKEN_CFG.appNamePrefixLen, 'x');
  const c = randomChars(TOKEN_CFG.randomLen, TOKEN_CFG.randomAlphabet || 'abcdefghijklmnopqrstuvwxyz0123456789');
  return TOKEN_CFG.separator ? [a, b, c].join(TOKEN_CFG.separator) : a + b + c;
}

async function mapClaimsToUser({ username, email, company }) {
  return {
    id: email || username,
    username: username || email,
    email,
    company,
    role: 'employee'
  };
}

const app = express();
app.use(express.json());

app.use(cors({
  origin: BROKER_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/aep-auth.js',   (_req, res) => res.type('application/javascript').send(AEP_AUTH_JS));
app.get('/aep-guard.js',  (_req, res) => res.type('application/javascript').send(AEP_GUARD_JS));
app.get('/aep-signin.js', (_req, res) => res.type('application/javascript').send(AEP_SIGNIN_JS));

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ detail: 'No token' });
  try {
    res.json(jwt.verify(token, APP_JWT_SECRET));
  } catch {
    res.status(401).json({ detail: 'Invalid token' });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, appId: APP_ID, name: APP_NAME }));

app.post('/api/auth/sso-login', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  const claims = req.body || {};
  try {
    const user = await mapClaimsToUser(claims);
    if (!user) {
      logActivity({ appId: APP_ID, appName: APP_NAME, status: 'unknown_user', ip, userAgent: ua, claims });
      return res.status(401).json({ detail: 'Unknown user.' });
    }

    const access_token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role, company: user.company },
      APP_JWT_SECRET,
      { expiresIn: `${TOKEN_TTL_MIN}m` }
    );
    const compositeToken = buildCompositeToken(APP_ID, APP_NAME);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MIN * 60_000).toISOString();

    logActivity({
      appId: APP_ID, appName: APP_NAME,
      username: user.username, email: user.email, company: user.company,
      ip, userAgent: ua, status: 'success'
    });

    res.json({
      access_token,
      compositeToken,
      token_type:  'Bearer',
      expires_in:  TOKEN_TTL_MIN * 60,
      expires_at:  expiresAt,
      username:    user.username,
      role:        user.role,
      company:     user.company,
      lastLogin:   new Date().toISOString()
    });
  } catch (e) {
    logActivity({ appId: APP_ID, appName: APP_NAME, status: 'error', error: e.message, ip, userAgent: ua, claims });
    res.status(500).json({ detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`aep-client SSO endpoint on :${PORT}`);
  console.log(`  trusting broker: ${BROKER_ORIGIN}`);
  console.log(`  appId:           ${APP_ID}`);
  console.log(`  appName:         ${APP_NAME}`);
  console.log(`  compositeToken:  ${TOKEN_CFG.enabled ? 'enabled (' + (TOKEN_CFG.appIdPrefixLen + TOKEN_CFG.appNamePrefixLen + TOKEN_CFG.randomLen + 2) + ' chars)' : 'disabled'}`);
  console.log(`  log file:        ${LOG_FILE}`);
  if (BROKER_ACTIVITIES) console.log(`  activity push:   ${BROKER_ACTIVITIES}`);
  console.log(`  browser scripts: http://localhost:${PORT}/aep-{auth,guard,signin}.js`);
});
