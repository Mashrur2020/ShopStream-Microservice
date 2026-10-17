const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Extract "Bearer <token>" from the Authorization header (case-insensitive scheme).
const extractToken = (req) => {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
};

// Reject the request unless a valid JWT is present.
// On success attaches req.user = { id, role, iat, exp }.
const requireAuth = (req, res, next) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// True when the token subject matches `id` or has the ADMIN role.
const ownsResource = (user, id) => user && (user.id === id || user.role === 'ADMIN');

module.exports = { requireAuth, ownsResource, extractToken };
