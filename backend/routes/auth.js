const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../models/database');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-me';
const JWT_EXPIRY = '30m';

// In-memory token blacklist for logout support.
// In production with multiple instances, consider a shared store (Redis / DB).
const tokenBlacklist = new Set();

/**
 * Middleware: verify JWT token from Authorization: Bearer header.
 * Attaches the decoded user payload to req.user and the raw token to req.token.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: 'Kimlik doğrulama gerekli. Token bulunamadı.' });
  }

  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: 'Oturum sonlandırılmış. Lütfen tekrar giriş yapın.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    req.token = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Oturum süresi dolmuş. Lütfen tekrar giriş yapın.' });
    }
    return res.status(403).json({ error: 'Geçersiz token.' });
  }
}

/**
 * POST /api/auth/login
 * Validate username and password with bcrypt, return JWT token.
 * If must_change_password is true, includes flag in response.
 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Kullanıcı adı ve şifre gereklidir.' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });
    }

    const passwordValid = bcrypt.compareSync(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre.' });
    }

    const tokenPayload = {
      userId: user.id,
      username: user.username,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    const response = {
      token,
      user: {
        id: user.id,
        username: user.username,
        must_change_password: !!user.must_change_password,
      },
    };

    // Include top-level flag for easy client-side checking
    if (user.must_change_password) {
      response.must_change_password = true;
    }

    res.json(response);
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Giriş sırasında bir hata oluştu.' });
  }
});

/**
 * POST /api/auth/change-password
 * Requires auth. Updates password and sets must_change_password = false.
 * Body: { current_password, new_password }
 */
router.post('/change-password', authenticateToken, (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Mevcut şifre ve yeni şifre gereklidir.' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Yeni şifre en az 8 karakter olmalıdır.' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    const currentPasswordValid = bcrypt.compareSync(current_password, user.password_hash);
    if (!currentPasswordValid) {
      return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
    }

    const newPasswordHash = bcrypt.hashSync(new_password, 10);

    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now')
       WHERE id = ?`
    ).run(newPasswordHash, user.id);

    res.json({ message: 'Şifre başarıyla değiştirildi.' });
  } catch (err) {
    console.error('[auth] Change password error:', err.message);
    res.status(500).json({ error: 'Şifre değiştirme sırasında bir hata oluştu.' });
  }
});

/**
 * POST /api/auth/logout
 * Adds the current token to the blacklist so it cannot be reused.
 * JWT is stateless, but the blacklist provides explicit invalidation.
 */
router.post('/logout', authenticateToken, (req, res) => {
  tokenBlacklist.add(req.token);

  // Schedule removal from blacklist after the token's max lifetime (30 min)
  // to prevent unbounded memory growth.
  setTimeout(() => {
    tokenBlacklist.delete(req.token);
  }, 30 * 60 * 1000);

  res.json({ message: 'Başarıyla çıkış yapıldı.' });
});

/**
 * GET /api/auth/me
 * Return current authenticated user's information.
 */
router.get('/me', authenticateToken, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, must_change_password, created_at, updated_at FROM users WHERE id = ?'
    ).get(req.user.userId);

    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    }

    res.json({
      id: user.id,
      username: user.username,
      must_change_password: !!user.must_change_password,
      created_at: user.created_at,
      updated_at: user.updated_at,
    });
  } catch (err) {
    console.error('[auth] Get user error:', err.message);
    res.status(500).json({ error: 'Kullanıcı bilgileri alınırken bir hata oluştu.' });
  }
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;
