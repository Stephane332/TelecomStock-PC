/**
 * Authentification JWT.
 * Le secret provient de la base (généré aléatoirement au premier lancement),
 * ou de TS_JWT_SECRET si l'exploitant veut le piloter lui-même.
 */
const jwt = require('jsonwebtoken');
const { JWT_SECRET: DB_SECRET } = require('./database');

const SECRET = process.env.TS_JWT_SECRET || DB_SECRET;
const TOKEN_EXPIRY = '12h';

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, SECRET);
    } catch {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentification requise' });
    }
    const payload = verifyToken(header.slice(7));
    if (!payload) {
        return res.status(401).json({ error: 'Session expirée, reconnectez-vous' });
    }
    req.user = payload;
    next();
}

module.exports = { generateToken, verifyToken, authMiddleware };
