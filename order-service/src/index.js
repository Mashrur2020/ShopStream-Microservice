const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const axios = require('axios');
const Order = require('./models/Order');
const { requireAuth, extractToken, ownsResource } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.error('[order-service] FATAL: JWT_SECRET not set — copy .env.example to .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3003;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb:27017/orderdb';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004';

app.use(morgan('dev'));
app.use(express.json());

// ============================================================
// Inventory client
// ============================================================
const INVENTORY_TIMEOUT = 3000;

// `token` is the buyer's JWT, forwarded on-behalf-of so inventory-service
// can enforce auth on its deduct/add endpoints.
const authHeaders = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

const deductStock = async (productId, quantity, token) => {
  await axios.put(
    `${INVENTORY_SERVICE_URL}/api/v1/inventory/${productId}/deduct`,
    { quantity },
    { timeout: INVENTORY_TIMEOUT, headers: authHeaders(token) }
  );
};

const addStock = async (productId, quantity, token) => {
  await axios.post(
    `${INVENTORY_SERVICE_URL}/api/v1/inventory/${productId}/add`,
    { quantity },
    { timeout: INVENTORY_TIMEOUT, headers: authHeaders(token) }
  );
};

// ============================================================
// MongoDB
// ============================================================
mongoose
  .connect(MONGO_URL)
  .then(() => console.log('🗄️ Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ============================================================
// Routes
// ============================================================

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

const STATUSES = ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'];

// ---------- Health ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

// ---------- POST /api/v1/orders ----------
// Saga: deduct stock for every item, then save the order.
// If ANY deduct fails, compensate (add back) every item that was
// definitely deducted (HTTP 2xx) before returning 400.
app.post('/api/v1/orders', requireAuth, async (req, res, next) => {
  try {
    const { userId, items } = req.body || {};

    if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ error: 'userId required' });
    }
    // Order must be placed for the authenticated user (ADMIN may act for others).
    if (!ownsResource(req.user, userId)) {
      return res.status(403).json({ error: 'userId does not match authenticated user' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    for (const item of items) {
      if (
        typeof item.productId !== 'string' ||
        !item.productId.trim() ||
        typeof item.productName !== 'string' ||
        !item.productName.trim() ||
        !isPositiveInt(item.quantity) ||
        typeof item.price !== 'number' ||
        item.price < 0
      ) {
        return res.status(400).json({
          error: 'Each item requires productId, productName, quantity (positive integer) and price (number >= 0)',
        });
      }
    }

    // total computed server-side — client-sent total is ignored
    const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

    const deducted = []; // items whose deduct DEFINITELY succeeded (for rollback)
    const token = extractToken(req); // forwarded to inventory on deduct AND rollback

    for (const item of items) {
      try {
        await deductStock(item.productId, item.quantity, token);
        deducted.push(item);
      } catch (err) {
        // Rollback: add stock back for every item already deducted.
        for (const done of deducted) {
          try {
            await addStock(done.productId, done.quantity, token);
          } catch (rbErr) {
            // Compensation failed -> stock may be inconsistent; needs manual reconciliation
            console.error(
              `[order-service] Rollback FAILED for productId=${done.productId} qty=${done.quantity}: ${rbErr.message}`
            );
          }
        }

        // Transport-level failure (timeout / 5xx) is ambiguous: we do NOT
        // compensate the failing item itself — `add` is not idempotent and
        // would inflate stock if the deduct never landed.
        if (!err.response) {
          console.error(
            `[order-service] Ambiguous inventory failure for productId=${item.productId}: ${err.message}`
          );
        }

        // ARCHITECTURE.md Test 4 expects this exact shape
        const reason = err.response?.data?.error || 'Inventory unavailable';
        return res.status(400).json({ error: `Order failed: ${reason}` });
      }
    }

    const order = await Order.create({
      userId,
      items: items.map(({ productId, productName, quantity, price }) => ({
        productId,
        productName,
        quantity,
        price,
      })),
      total,
      status: 'CONFIRMED',
    });

    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/orders ----------
app.get('/api/v1/orders', requireAuth, async (req, res, next) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/orders/user/:userId ----------
app.get('/api/v1/orders/user/:userId', requireAuth, async (req, res, next) => {
  try {
    if (!ownsResource(req.user, req.params.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const orders = await Order.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/orders/:id ----------
app.get('/api/v1/orders/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!ownsResource(req.user, order.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /api/v1/orders/:id/status ----------
app.put('/api/v1/orders/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Order not found' });
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[order-service]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`🛒 Order Service on port ${PORT}`);
});
