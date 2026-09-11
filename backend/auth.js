const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.TS_JWT_SECRET || 'telecomstock-secret-change-in-production';
const TOKEN_EXPIRY = '7d';

function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    );
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requis' });
    }
    const token = authHeader.split(' ')[1];
    const user = verifyToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
    req.user = user;
    next();
}

module.exports = { generateToken, verifyToken, authMiddleware, JWT_SECRET };
