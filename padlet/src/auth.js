const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('./db');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ALLOWED_HOSTED_DOMAIN = (process.env.ALLOWED_HOSTED_DOMAIN || '').trim();

const oauthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// 구글 ID 토큰을 검증하고 users 테이블에 upsert한 뒤 유저 레코드를 반환
async function verifyGoogleToken(credential) {
  const ticket = await oauthClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  if (ALLOWED_HOSTED_DOMAIN && payload.hd !== ALLOWED_HOSTED_DOMAIN) {
    const err = new Error(`${ALLOWED_HOSTED_DOMAIN} 계정만 로그인할 수 있습니다.`);
    err.status = 403;
    throw err;
  }

  db.prepare(
    `INSERT INTO users (google_sub, email, name, picture) VALUES (?, ?, ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture`
  ).run(payload.sub, payload.email, payload.name || payload.email, payload.picture || null);

  return db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub);
}

function issueSessionCookie(res, user) {
  const token = jwt.sign(
    { uid: user.id, email: user.email, name: user.name, admin: isAdminEmail(user.email) },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// 로그인 필수 미들웨어 — req.user 채움
function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie('session');
    return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인하세요.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.admin) return res.status(403).json({ error: '관리자만 할 수 있습니다.' });
    next();
  });
}

module.exports = { verifyGoogleToken, issueSessionCookie, requireAuth, requireAdmin, isAdminEmail };
