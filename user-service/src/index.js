const express = require('express');
const morgan = require('morgan');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient, Prisma } = require('@prisma/client');
const { requireAuth, ownsResource } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.error('[user-service] FATAL: JWT_SECRET not set — copy .env.example to .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;

const prisma = new PrismaClient();

app.use(morgan('dev'));
app.use(express.json());

// Fields safe to return — password never leaves this service
const safeUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  createdAt: user.createdAt,
});

// ---------- Health ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'user-service' });
});

// ---------- POST /api/v1/auth/register ----------
app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};

    if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Valid email and password (min 6 chars) required' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, password: hashed, name: name || null },
    });

    res.status(201).json({ user: safeUser(user) });
  } catch (err) {
    // Unique constraint violation on email (Prisma P2002)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    next(err);
  }
});

// ---------- POST /api/v1/auth/login ----------
app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    // Same generic message for unknown email vs wrong password (no user enumeration)
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });

    res.json({ token, user: safeUser(user) });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/users/:id ----------
// Profile lookup contains PII (email), so only the owner or an ADMIN may read it.
app.get('/api/v1/users/:id', requireAuth, async (req, res, next) => {
  try {
    if (!ownsResource(req.user, req.params.id)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user });
  } catch (err) {
    next(err);
  }
});

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[user-service]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`👤 User Service on port ${PORT}`);
});
