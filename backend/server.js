/**
 * AEP broker backend.
 *
 * Persists application login configurations in PostgreSQL via the `pg` driver.
 * The API contract consumed by the Angular AppConfigService is unchanged:
 *   GET    /api/app-configs
 *   GET    /api/app-configs/:appId
 *   POST   /api/app-configs
 *   PUT    /api/app-configs/:appId
 *   DELETE /api/app-configs/:appId
 *
 * Environment:
 *   DATABASE_URL  postgres://user:pass@host:5432/dbname   (required)
 *   PORT          default 3000
 */
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'change-admin-jwt-secret-in-prod';
const ADMIN_TOKEN_TTL  = process.env.ADMIN_TOKEN_TTL || '8h';

const DATA_ENCRYPTION_KEY = process.env.DATA_ENCRYPTION_KEY
  ? Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64')
  : null;
const ENCRYPTION_PREFIX = 'v1::';

if (!DATA_ENCRYPTION_KEY || DATA_ENCRYPTION_KEY.length !== 32) {
  console.warn('WARNING: DATA_ENCRYPTION_KEY is missing or not 32 bytes (base64-encoded). ' +
    'Database fields will NOT be encrypted at rest. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
}

if (ADMIN_JWT_SECRET === 'change-admin-jwt-secret-in-prod') {
  console.warn('WARNING: ADMIN_JWT_SECRET is still the default. Set a strong secret via the ADMIN_JWT_SECRET environment variable.');
}

if (!DATABASE_URL) {
  console.warn('WARNING: DATABASE_URL is not set. Backend will start but DB calls will fail.');
}

const PII_KEYS = ['username', 'email', 'company', 'userAgent', 'ip'];

function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return plaintext;
  }
  if (!DATA_ENCRYPTION_KEY || DATA_ENCRYPTION_KEY.length !== 32) {
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DATA_ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const encrypted = Buffer.concat([iv, ciphertext, tag]);
  return ENCRYPTION_PREFIX + encrypted.toString('base64');
}

function decryptField(encrypted) {
  if (encrypted === null || encrypted === undefined || encrypted === '') {
    return encrypted;
  }
  if (typeof encrypted !== 'string' || !encrypted.startsWith(ENCRYPTION_PREFIX)) {
    return encrypted;
  }
  if (!DATA_ENCRYPTION_KEY || DATA_ENCRYPTION_KEY.length !== 32) {
    console.warn('Cannot decrypt field: DATA_ENCRYPTION_KEY not configured or invalid.');
    return '[ENCRYPTED]';
  }
  try {
    const data = Buffer.from(encrypted.slice(ENCRYPTION_PREFIX.length), 'base64');
    const iv = data.slice(0, 12);
    const tag = data.slice(data.length - 16);
    const ciphertext = data.slice(12, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', DATA_ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    console.error('Decryption failed:', e.message);
    return '[DECRYPTION FAILED]';
  }
}

function encryptPiiFields(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = { ...obj };
  for (const key of PII_KEYS) {
    if (result[key] !== undefined && result[key] !== null && result[key] !== '') {
      result[key] = encryptField(result[key]);
    }
  }
  return result;
}

const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_configs (
      app_id            TEXT PRIMARY KEY,
      app_name          TEXT NOT NULL,
      sso_login_endpoint TEXT NOT NULL,
      default_post_login_route TEXT NOT NULL DEFAULT '/dashboard',
      backend_api_url   TEXT NOT NULL DEFAULT '',
      allowed_return_urls TEXT[] DEFAULT '{}',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_activities (
      id          BIGSERIAL PRIMARY KEY,
      ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
      app_id      TEXT,
      app_name    TEXT,
      username    TEXT,
      email       TEXT,
      company     TEXT,
      ip          TEXT,
      user_agent  TEXT,
      status      TEXT NOT NULL,
      error       TEXT,
      raw         JSONB
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_activities_ts ON login_activities (ts DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_activities_app ON login_activities (app_id, ts DESC)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows: adminRows } = await pool.query('SELECT count(*)::int AS n FROM admin_users');
  if (adminRows[0].n === 0) {
    const defaultUser = process.env.ADMIN_USERNAME || 'admin';
    const defaultPass = process.env.ADMIN_PASSWORD || 'admin';
    const hash = await bcrypt.hash(defaultPass, 10);
    await pool.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING',
      [defaultUser, hash]
    );
    console.log(`Seeded admin user "${defaultUser}" — change the password immediately.`);
  }
  await pool.query(`
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END
    $$ LANGUAGE plpgsql
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'app_configs_set_updated_at') THEN
        CREATE TRIGGER app_configs_set_updated_at
        BEFORE UPDATE ON app_configs
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      END IF;
    END
    $$
  `);

  const { rowCount } = await pool.query('SELECT count(*) FROM app_configs');
  if (rowCount === 0) {
    await pool.query(
      `INSERT INTO app_configs (app_id, app_name, sso_login_endpoint, default_post_login_route, backend_api_url, allowed_return_urls)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      ['hr-portal', 'HR Portal', encryptField('https://hr.example.com/api/auth/sso-login'), '/dashboard', '', ['https://hr.example.com']]
    );
    console.log('Seeded hr-portal');
  }
}

initDb().catch((e) => console.error('DB init failed:', e));

function notFound(res, appId) {
  return res.status(404).json({ detail: `Application "${appId}" not found.` });
}

app.get('/api/app-configs', async (_req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { rows } = await pool.query('SELECT * FROM app_configs ORDER BY app_id');
  res.json(rows.map(toApiShape));
});

app.get('/api/app-configs/:appId', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { rows } = await pool.query('SELECT * FROM app_configs WHERE app_id = $1', [req.params.appId]);
  if (rows.length === 0) return notFound(res, req.params.appId);
  res.json(toApiShape(rows[0]));
});

app.post('/api/app-configs', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const cfg = req.body;
  if (!cfg || !cfg.appId) {
    return res.status(400).json({ detail: 'appId is required.' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO app_configs (app_id, app_name, sso_login_endpoint, default_post_login_route, backend_api_url, allowed_return_urls)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
         cfg.appId,
         cfg.appName || '',
         encryptField(cfg.ssoLoginEndpoint || ''),
         cfg.defaultPostLoginRoute || '/dashboard',
         cfg.backendApiUrl || '',
         Array.isArray(cfg.allowedReturnUrls) ? cfg.allowedReturnUrls : []
      ]
    );
    res.status(201).json(toApiShape(rows[0]));
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ detail: `Application "${cfg.appId}" already exists.` });
    }
    throw e;
  }
});

app.put('/api/app-configs/:appId', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { rows } = await pool.query('SELECT * FROM app_configs WHERE app_id = $1', [req.params.appId]);
  if (rows.length === 0) return notFound(res, req.params.appId);

  const existing = rows[0];
  const updated = {
    app_name: req.body.appName ?? existing.app_name,
    sso_login_endpoint: req.body.ssoLoginEndpoint
      ? encryptField(req.body.ssoLoginEndpoint)
      : existing.sso_login_endpoint,
    default_post_login_route: req.body.defaultPostLoginRoute ?? existing.default_post_login_route,
    backend_api_url: req.body.backendApiUrl ?? existing.backend_api_url,
    allowed_return_urls: Array.isArray(req.body.allowedReturnUrls) ? req.body.allowedReturnUrls : existing.allowed_return_urls
  };

  const { rows: saved } = await pool.query(
    `UPDATE app_configs SET app_name=$1, sso_login_endpoint=$2, default_post_login_route=$3, backend_api_url=$4, allowed_return_urls=$5
     WHERE app_id=$6 RETURNING *`,
    [updated.app_name, updated.sso_login_endpoint, updated.default_post_login_route, updated.backend_api_url, updated.allowed_return_urls, req.params.appId]
  );
  res.json(toApiShape(saved[0]));
});

app.delete('/api/app-configs/:appId', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { rowCount } = await pool.query('DELETE FROM app_configs WHERE app_id = $1', [req.params.appId]);
  if (rowCount === 0) return notFound(res, req.params.appId);
  res.status(204).end();
});

app.post('/api/activities', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const a = req.body || {};
  const encryptedA = encryptPiiFields(a);
  try {
    const { rows } = await pool.query(
      `INSERT INTO login_activities (ts, app_id, app_name, username, email, company, ip, user_agent, status, error, raw)
       VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, ts`,
      [
        a.ts || null,
        a.appId || null,
        a.appName || null,
        encryptField(a.username || null),
        encryptField(a.email || null),
        encryptField(a.company || null),
        encryptField(a.ip || null),
        encryptField(a.userAgent || null),
        a.status || 'unknown',
        a.error || null,
        encryptedA
      ]
    );
    res.status(201).json({ id: rows[0].id, ts: rows[0].ts });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.get('/api/activities', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const appId = req.query.appId || null;
  const status = req.query.status || null;
  const params = [];
  let where = 'WHERE 1=1';
  if (appId) { params.push(appId); where += ` AND app_id = $${params.length}`; }
  if (status) { params.push(status); where += ` AND status = $${params.length}`; }
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, ts, app_id, app_name, username, email, company, ip, user_agent, status, error
     FROM login_activities ${where}
     ORDER BY ts DESC LIMIT $${params.length}`,
    params
  );
  res.json(rows.map(r => ({
    id: r.id, ts: r.ts,
    appId: r.app_id, appName: r.app_name,
    username: decryptField(r.username), email: decryptField(r.email), company: decryptField(r.company),
    ip: decryptField(r.ip), userAgent: decryptField(r.user_agent), status: r.status, error: r.error
  })));
});

app.get('/api/activities/summary', async (_req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { rows } = await pool.query(`
    SELECT status, count(*)::int AS n
    FROM login_activities
    WHERE ts > now() - interval '7 days'
    GROUP BY status
  `);
  res.json(rows);
});

function signAdminToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, role: 'admin' }, ADMIN_JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
}

function readAdminToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  try { return jwt.verify(auth.slice(7), ADMIN_JWT_SECRET); } catch { return null; }
}

app.post('/api/admin/login', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ detail: 'username and password are required.' });
  try {
    const { rows } = await pool.query('SELECT id, username, password_hash FROM admin_users WHERE username = $1', [username]);
    if (rows.length === 0) return res.status(401).json({ detail: 'Invalid credentials.' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ detail: 'Invalid credentials.' });
    const token = signAdminToken(rows[0]);
    res.json({ token, username: rows[0].username });
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

app.post('/api/admin/logout', (_req, res) => res.status(204).end());

app.get('/api/admin/me', (req, res) => {
  const claims = readAdminToken(req);
  if (!claims) return res.status(401).json({ detail: 'Not signed in.' });
  res.json({ username: claims.username, role: claims.role });
});

app.post('/api/admin/password', async (req, res) => {
  if (!pool) return res.status(500).json({ detail: 'Database not configured.' });
  const claims = readAdminToken(req);
  if (!claims) return res.status(401).json({ detail: 'Not signed in.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ detail: 'newPassword must be at least 6 characters.' });
  }
  try {
    const { rows } = await pool.query('SELECT id, password_hash FROM admin_users WHERE id = $1', [claims.sub]);
    if (rows.length === 0) return res.status(404).json({ detail: 'User not found.' });
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(401).json({ detail: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ detail: e.message });
  }
});

function toApiShape(row) {
  return {
    appId: row.app_id,
    appName: row.app_name,
    ssoLoginEndpoint: decryptField(row.sso_login_endpoint),
    defaultPostLoginRoute: row.default_post_login_route,
    backendApiUrl: row.backend_api_url,
    allowedReturnUrls: row.allowed_return_urls || []
  };
}

app.listen(PORT, () => {
  console.log(`Broker backend listening on http://localhost:${PORT}`);
});
