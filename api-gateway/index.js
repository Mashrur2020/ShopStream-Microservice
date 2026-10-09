const express = require('express');
const morgan = require('morgan');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));

// Route table: path prefix -> target service (Docker DNS names)
// Paths are forwarded AS-IS (services declare full /api/v1/... routes),
// so each service stays independently testable outside the gateway.
const SERVICES = [
  { prefix: '/api/v1/auth', target: process.env.USER_SERVICE_URL || 'http://user-service:3001' },
  { prefix: '/api/v1/users', target: process.env.USER_SERVICE_URL || 'http://user-service:3001' },
  { prefix: '/api/v1/products', target: process.env.PRODUCT_SERVICE_URL || 'http://product-service:3002' },
  { prefix: '/api/v1/orders', target: process.env.ORDER_SERVICE_URL || 'http://order-service:3003' },
  { prefix: '/api/v1/inventory', target: process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:3004' },
];

// Boundary-aware prefix match: '/api/v1/auth' matches '/api/v1/auth/login'
// but NOT '/api/v1/authorize'
const matches = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

for (const { prefix, target } of SERVICES) {
  const proxy = createProxyMiddleware({
    target,
    changeOrigin: true,
    // Downstream service down / unreachable -> clean 502 instead of hanging.
    // v3 API: `on.error` REPLACES the default error plugin (which would
    // otherwise map ENOTFOUND/ECONNREFUSED to a plain-text 504).
    on: {
      error: (err, req, res) => {
        console.error(`[gateway] ${prefix} -> ${target} failed: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Service unavailable' }));
      },
    },
  });

  // Wrap with our own matcher (no Express path mounting, so req.url stays
  // intact and the full /api/v1/... path is forwarded upstream).
  // NOTE: no body-parser here on purpose — request bodies must stream
  // through the proxy untouched.
  app.use((req, res, next) => (matches(req.path, prefix) ? proxy(req, res, next) : next()));
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
});
