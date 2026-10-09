const express = require('express');
const morgan = require('morgan');
const { PrismaClient, Prisma } = require('@prisma/client');

const app = express();
const PORT = process.env.PORT || 3004;

const prisma = new PrismaClient();

app.use(morgan('dev'));
app.use(express.json());

const isPositiveInt = (n) => Number.isInteger(n) && n > 0;

// ---------- Health ----------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'inventory-service' });
});

// ---------- POST /api/v1/inventory ----------
// Idempotent: called by Product Service (possibly retried by the circuit
// breaker). A duplicate call must not fail nor reset existing stock.
app.post('/api/v1/inventory', async (req, res, next) => {
  try {
    const { productId } = req.body || {};
    if (typeof productId !== 'string' || !productId.trim()) {
      return res.status(400).json({ error: 'productId required' });
    }

    try {
      const inventory = await prisma.inventory.create({
        data: { productId, quantity: 0 },
      });
      return res.status(201).json({ inventory });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Already exists -> return it as-is (do NOT touch quantity)
        const inventory = await prisma.inventory.findUnique({ where: { productId } });
        return res.status(200).json({ inventory });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ---------- GET /api/v1/inventory/:productId ----------
app.get('/api/v1/inventory/:productId', async (req, res, next) => {
  try {
    const inventory = await prisma.inventory.findUnique({
      where: { productId: req.params.productId },
    });
    if (!inventory) return res.status(404).json({ error: 'Inventory not found' });
    res.json({ inventory });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /api/v1/inventory/:productId/add ----------
app.post('/api/v1/inventory/:productId/add', async (req, res, next) => {
  try {
    const { quantity } = req.body || {};
    if (!isPositiveInt(quantity)) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    try {
      const inventory = await prisma.inventory.update({
        where: { productId: req.params.productId },
        data: { quantity: { increment: quantity } },
      });
      res.json({ inventory });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /api/v1/inventory/:productId/deduct ----------
// Atomic check-and-deduct: compiles to
//   UPDATE "Inventory" SET quantity = quantity - $n
//   WHERE productId = $p AND quantity >= $n
// The guard + row lock in a single statement prevents overselling even
// under concurrent orders (PostgreSQL serializes updates on the same row).
app.put('/api/v1/inventory/:productId/deduct', async (req, res, next) => {
  try {
    const { quantity } = req.body || {};
    if (!isPositiveInt(quantity)) {
      return res.status(400).json({ error: 'quantity must be a positive integer' });
    }

    const result = await prisma.inventory.updateMany({
      where: { productId: req.params.productId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });

    if (result.count === 0) {
      // Distinguish "no record" (404) from "not enough stock" (400)
      const exists = await prisma.inventory.findUnique({
        where: { productId: req.params.productId },
      });
      if (!exists) return res.status(404).json({ error: 'Inventory not found' });
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const inventory = await prisma.inventory.findUnique({
      where: { productId: req.params.productId },
    });
    res.json({ inventory });
  } catch (err) {
    next(err);
  }
});

// ---------- 404 + error handler ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  console.error('[inventory-service]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`📊 Inventory Service on port ${PORT}`);
});
