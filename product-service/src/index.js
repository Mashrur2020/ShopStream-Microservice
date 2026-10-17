const express = require('express');
const morgan = require('morgan');
const mongoose = require('mongoose');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const Product = require('./models/Product');
const { requireAuth, extractToken } = require('./middleware/auth');

if (!process.env.JWT_SECRET) {
  console.error('[product-service] FATAL: JWT_SECRET not set — copy .env.example to .env');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3002;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb:27017/productdb';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004';

app.use(morgan('dev'));
app.use(express.json());

// ============================================================
// Circuit Breaker — Product -> Inventory
// ============================================================
// Opens after 50% failures (with volumeThreshold 1 so even a single
// failure trips it while the inventory service is down), then stops
// calling inventory entirely until resetTimeout elapses and the
// breaker half-opens to probe recovery.
// `token` is the caller's JWT, forwarded on-behalf-of so inventory-service
// can enforce auth on its internal create endpoint.
const inventoryCall = async (productId, token) => {
  const res = await axios.post(
    `${INVENTORY_SERVICE_URL}/api/v1/inventory`,
    { productId },
    { timeout: 3000, headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  return res.data;
};

const breaker = new CircuitBreaker(inventoryCall, {
  timeout: 3000, // async function timeout before counting as failure
  errorThresholdPercentage: 50, // open at 50% failure rate
  volumeThreshold: 1, // evaluate after just 1 request (default 10 is too slow to trip in dev)
  resetTimeout: 10000, // try half-open after 10s
});

// Called on timeout/open/half-open failure -> product creation NEVER fails
breaker.fallback(() => ({ synced: false, message: 'queued for retry' }));

breaker.on('open', () => console.warn('🔴 Circuit breaker OPEN — inventory sync paused'));
breaker.on('halfOpen', () => console.log('🟡 Circuit breaker HALF-OPEN — probing inventory'));
breaker.on('close', () => console.log('🟢 Circuit breaker CLOSED — inventory sync restored'));

// ============================================================
// MongoDB
// ============================================================
mongoose
  .connect(MONGO_URL)
  .then(() => console.log('📦 Connected to MongoDB'))
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });

// ============================================================
// Routes
// ============================================================

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ---------- Health ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'product-service' });
});

// ---------- POST /api/v1/products ----------
// Saves the product FIRST, then fires the inventory sync through the
// circuit breaker. The response is 201 either way: if the breaker is
// open inventorySync = { synced: false, message: "queued for retry" }.
app.post('/api/v1/products', requireAuth, async (req, res, next) => {
  try {
    const { name, price } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'name (string) and price (number >= 0) are required' });
    }

    const product = await Product.create(req.body);

    const result = await breaker.fire(product._id.toString(), extractToken(req)).catch(() => ({
      synced: false,
      message: 'queued for retry',
    }));

    res.status(201).json({ product, inventorySync: result });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/products ----------
app.get('/api/v1/products', async (req, res, next) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ products });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/products/:id ----------
app.get('/api/v1/products/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /api/v1/products/:id ----------
app.put('/api/v1/products/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ product });
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /api/v1/products/:id ----------
app.delete('/api/v1/products/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Product not found' });
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
});

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[product-service]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`📦 Product Service on port ${PORT}`);
});
