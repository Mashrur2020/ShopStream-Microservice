# ShopStream — E-commerce Microservices Architecture

> A production-ready microservices e-commerce backend built with **Node.js**, **Express**, **PostgreSQL**, **MongoDB**, and **Docker**.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [Services](#services)
5. [Database Design](#database-design)
6. [API Endpoints](#api-endpoints)
7. [Inter-Service Communication](#inter-service-communication)
8. [Key Workflows](#key-workflows)
9. [Project Structure](#project-structure)
10. [Environment Variables](#environment-variables)
11. [Running the Project](#running-the-project)
12. [Testing the Workflows](#testing-the-workflows)
13. [Design Patterns Used](#design-patterns-used)
14. [Security Considerations](#security-considerations)
15. [Known Limitations & Future Improvements](#known-limitations--future-improvements)

---

## 1. Overview

**ShopStream** is a microservices-based e-commerce backend that demonstrates:

- **Service decomposition** — 5 independent services with clear boundaries
- **Polyglot persistence** — Different databases for different needs
- **API Gateway pattern** — Single entry point for all clients
- **Automated inventory sync** — Creating a product auto-creates inventory
- **Resilience patterns** — Circuit breaker with fallback, saga-style rollback
- **Container orchestration** — Full Docker Compose setup

### Core Feature

> **When a product is created, an inventory record is automatically created with 0 stock.** No manual sync required. This is achieved via synchronous HTTP calls with circuit breaker protection.

---

## 2. System Architecture

```
Client (Web / Mobile)
   │  HTTP
   v
API Gateway — Express, port 3000
   │  http-proxy-middleware: path-prefix routing · morgan request logs
   │  /api/v1/auth|users -> user-service:3001
   │  /api/v1/products   -> product-service:3002
   │  /api/v1/orders     -> order-service:3003
   │  /api/v1/inventory  -> inventory-service:3004
   │  /api-docs (Swagger UI) · /openapi.json · /health
   │
   │  Docker DNS (shopstream-net) — one container per service
   ├──► user-service       Express + Prisma + bcrypt + JWT   ──►  PostgreSQL  (user_service)
   ├──► product-service    Express + Mongoose + Opossum CB   ──►  MongoDB     (productdb)
   ├──► order-service      Express + Mongoose + Axios saga   ──►  MongoDB     (orderdb)
   └──► inventory-service  Express + Prisma                  ──►  PostgreSQL  (inventory_service)

Inter-service calls — synchronous HTTP via Axios; the caller's JWT is forwarded:
   product-service ──(1) POST /api/v1/inventory ─────────────► inventory-service  (circuit breaker + fallback)
   order-service   ──(2) PUT  /api/v1/inventory/:id/deduct ──► inventory-service  (atomic guarded UPDATE)
   order-service   ──(3) POST /api/v1/inventory/:id/add ─────► inventory-service  (rollback compensation)
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js 18 (Alpine) | JavaScript runtime |
| **Framework** | Express.js 4 | HTTP server |
| **API Gateway** | Express + `http-proxy-middleware` | Reverse proxy & routing |
| **API Docs** | `swagger-ui-express` + OpenAPI 3 | Interactive Swagger UI at `/api-docs` |
| **User DB** | PostgreSQL 15 | Relational, ACID-compliant |
| **Product DB** | MongoDB 6 | Document store, flexible schema |
| **Order DB** | MongoDB 6 | Document store, order history |
| **Inventory DB** | PostgreSQL 15 | Atomic conditional stock deduction |
| **User ORM** | Prisma | Type-safe PostgreSQL access |
| **Inventory ORM** | Prisma | Type-safe PostgreSQL access |
| **Product ODM** | Mongoose | MongoDB schema validation |
| **Order ODM** | Mongoose | MongoDB schema validation |
| **HTTP Client** | Axios | Inter-service calls |
| **Circuit Breaker** | Opossum | Resilience pattern |
| **Auth** | bcrypt + jsonwebtoken | Password hashing + JWT |
| **Containerization** | Docker + Docker Compose | Deployment & orchestration |
| **Logging** | Morgan | HTTP request logging |

---

## 4. Services

### 4.1 API Gateway (`api-gateway`)

| Property | Value |
| :--- | :--- |
| **Port** | 3000 |
| **Database** | None |
| **Responsibility** | Route all client requests to the correct microservice |

**Routes:**

| Path Prefix | Target |
| :--- | :--- |
| `/api/v1/auth/*` | user-service:3001 |
| `/api/v1/users/*` | user-service:3001 |
| `/api/v1/products/*` | product-service:3002 |
| `/api/v1/orders/*` | order-service:3003 |
| `/api/v1/inventory/*` | inventory-service:3004 |
| `/api-docs` | Swagger UI (served locally from `openapi.json`) |
| `/openapi.json` | Raw OpenAPI 3 spec (served locally) |
| `/health` | Self |

Targets default to the Docker DNS names above and can be overridden with
`USER_SERVICE_URL`, `PRODUCT_SERVICE_URL`, `ORDER_SERVICE_URL` and
`INVENTORY_SERVICE_URL`.

**Why it exists:**
- Single entry point for the client
- Hides internal service topology
- Central place for future rate-limiting, caching, auth

---

### 4.2 User Service (`user-service`)

| Property | Value |
| :--- | :--- |
| **Port** | 3001 |
| **Database** | PostgreSQL (`user_service` schema) |
| **Responsibility** | User registration, login, authentication |

**Key Responsibilities:**
- Password hashing with bcrypt (10 rounds)
- JWT token generation
- User profile lookup

---

### 4.3 Product Service (`product-service`)

| Property | Value |
| :--- | :--- |
| **Port** | 3002 |
| **Database** | MongoDB (`productdb`) |
| **Responsibility** | Product catalog CRUD |

**Key Responsibilities:**
- Manage product catalog
- Support flexible product attributes (e.g., `color`, `size`, `storage`)
- **Trigger inventory creation** when a new product is added (via Axios + Circuit Breaker)

---

### 4.4 Order Service (`order-service`)

| Property | Value |
| :--- | :--- |
| **Port** | 3003 |
| **Database** | MongoDB (`orderdb`) |
| **Responsibility** | Order lifecycle management |

**Key Responsibilities:**
- Create orders
- Deduct stock via inventory-service (with rollback on failure)
- Track order status — orders are created as `CONFIRMED`; valid statuses: `PENDING`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, `CANCELLED`

---

### 4.5 Inventory Service (`inventory-service`)

| Property | Value |
| :--- | :--- |
| **Port** | 3004 |
| **Database** | PostgreSQL (`inventory_service` schema) |
| **Responsibility** | Stock level management |

**Key Responsibilities:**
- Track stock per product
- **Atomic stock deduction** — a single guarded `UPDATE ... WHERE quantity >= n` prevents overselling under concurrency
- Add stock (restock)

---

## 5. Database Design

### 5.1 PostgreSQL — User Service

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String?
  role      String   @default("CUSTOMER")
  createdAt DateTime @default(now())
}
```

**Why PostgreSQL?**
- Structured data with strict schema
- Unique constraints (email)
- Referential integrity

---

### 5.2 PostgreSQL — Inventory Service

```prisma
model Inventory {
  id        String   @id @default(uuid())
  productId String   @unique
  quantity  Int      @default(0)
  updatedAt DateTime @updatedAt
  createdAt DateTime @default(now())
}
```

**Why PostgreSQL?**
- **Atomicity** is essential for stock deduction
- Deduction compiles to one guarded statement: `UPDATE "Inventory" SET quantity = quantity - $n WHERE productId = $p AND quantity >= $n`
- PostgreSQL serializes concurrent updates on the same row, so check-and-deduct can never oversell

---

### 5.3 MongoDB — Product Service

```javascript
{
  _id: ObjectId,
  name: String,
  description: String,
  price: Number,
  category: String,
  imageUrl: String,
  attributes: Map<String, String>,  // flexible
  createdAt: Date,
  updatedAt: Date
}
```

**Why MongoDB?**
- Products have **highly variable attributes**
- No schema migrations when adding new fields
- Fast reads for catalog browsing

---

### 5.4 MongoDB — Order Service

```javascript
{
  _id: ObjectId,
  userId: String,
  items: [{
    productId: String,
    productName: String,
    quantity: Number,
    price: Number
  }],
  total: Number,
  status: String,  // enum: PENDING, CONFIRMED, SHIPPED, DELIVERED, CANCELLED
  createdAt: Date,
  updatedAt: Date
}
```

**Why MongoDB?**
- Orders are read-heavy documents
- Nested items structure fits naturally
- Order history is append-only (no complex joins needed)

---

## 6. API Endpoints

> **Swagger UI:** [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
> renders every endpoint below from `api-gateway/openapi.json`, with
> **Try it out** and an **Authorize** button for the JWT. The raw spec is at
> `/openapi.json`. The curl snippets in §12 cover the same flows for scripting.

All protected endpoints require a JWT from `POST /api/v1/auth/login`, sent as:

```
Authorization: Bearer <token>
```

Missing/invalid/expired token → `401`. Authenticated but not allowed (e.g. reading
another user's data) → `403`. Public endpoints (catalog reads, health checks)
need no token.

### 6.1 Auth & Users (`/api/v1/auth`, `/api/v1/users`)

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/auth/register` | Register new user | ❌ |
| POST | `/api/v1/auth/login` | Login, returns JWT | ❌ |
| GET | `/api/v1/users/:id` | Get user by ID | ✅ owner or ADMIN |

**Register Request:**
```json
{
  "email": "john@test.com",
  "password": "pass123",
  "name": "John Doe"
}
```

**Login Response:**
```json
{
  "token": "eyJhbGciOi...",
  "user": { "id": "...", "email": "john@test.com", "role": "CUSTOMER" }
}
```

---

### 6.2 Products (`/api/v1/products`)

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/products` | Create product (auto-creates inventory) | ✅ |
| GET | `/api/v1/products` | List all products | ❌ |
| GET | `/api/v1/products/:id` | Get product by ID | ❌ |
| PUT | `/api/v1/products/:id` | Update product | ✅ |
| DELETE | `/api/v1/products/:id` | Delete product | ✅ |

**Create Request:**
```json
{
  "name": "iPhone 15 Pro",
  "description": "Latest Apple flagship",
  "price": 999.99,
  "category": "Electronics",
  "attributes": {
    "color": "Titanium",
    "storage": "256GB"
  }
}
```

---

### 6.3 Orders (`/api/v1/orders`)

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/orders` | Create order (deducts stock) | ✅ `userId` must match token |
| GET | `/api/v1/orders` | List all orders | ✅ |
| GET | `/api/v1/orders/:id` | Get order by ID | ✅ owner or ADMIN |
| GET | `/api/v1/orders/user/:userId` | Get user's orders | ✅ owner or ADMIN |
| PUT | `/api/v1/orders/:id/status` | Update order status | ✅ |

**Create Request:**
```json
{
  "userId": "uuid",
  "items": [
    {
      "productId": "mongo-id",
      "productName": "iPhone 15 Pro",
      "quantity": 2,
      "price": 999.99
    }
  ]
}
```

---

### 6.4 Inventory (`/api/v1/inventory`)

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/inventory` | Create inventory record (called by Product Service) | ✅ forwarded user JWT |
| GET | `/api/v1/inventory/:productId` | Get stock for product | ❌ |
| POST | `/api/v1/inventory/:productId/add` | Add stock | ✅ |
| PUT | `/api/v1/inventory/:productId/deduct` | Deduct stock (atomic) | ✅ forwarded user JWT |

---

## 7. Inter-Service Communication

### Communication Style

**Synchronous HTTP** via Axios, protected by circuit breakers.

| Caller | Callee | Purpose | Failure Handling |
| :--- | :--- | :--- | :--- |
| Product Service | Inventory Service | Auto-create inventory | Circuit breaker + fallback |
| Order Service | Inventory Service | Deduct stock | Try/catch + rollback |

Both callers forward the **original user's JWT** (`Authorization: Bearer …`) to
inventory-service, so every inventory mutation is authenticated end-to-end
without a separate service account. On partial failure, order-service also calls
`POST /api/v1/inventory/:productId/add` to compensate (saga rollback).

### Why Not Async (Message Queue)?

For simplicity in this learning project, we use synchronous HTTP. In production, this would likely be **Kafka or RabbitMQ** with **event-driven patterns**.

---

## 8. Key Workflows

### 8.1 Create Product → Auto-Create Inventory

```
Client → Gateway → Product Service
                    │
                    ├─ 1. Save product to MongoDB
                    │
                    └─ 2. POST /api/v1/inventory (via Axios + Circuit Breaker)
                           │
                           └─ Inventory Service saves record with quantity: 0
```

On success, `inventorySync` contains the created inventory record. **If Inventory
Service is down:**
- Circuit breaker **opens** at a 50% failure rate (evaluated after a single call — `volumeThreshold: 1`)
- Call timeout 3 s, reset timeout 10 s before half-opening to probe recovery
- Fallback returns `{ synced: false, message: "queued for retry" }`
- Product is still created ✅
- Inventory sync can be retried later

---

### 8.2 Place Order → Deduct Stock (with Rollback)

```
Client → Gateway → Order Service
                    │
                    ├─ 1. For each item:
                    │     PUT /api/v1/inventory/:id/deduct
                    │     (PostgreSQL transaction: check + deduct atomically)
                    │
                    ├─ 2. If ALL succeed:
                    │     Save order to MongoDB with status CONFIRMED
                    │
                    └─ 3. If ANY fail:
                          For each already-deducted item:
                          POST /api/v1/inventory/:id/add (rollback)
                          Return 400 error
```

**Why rollback?**
If you deduct stock for 3 items and the 3rd fails, items 1 and 2 must be restored. This is the **Saga Pattern** (compensating transactions).

---

## 9. Project Structure

```
ShopStream/
├── ARCHITECTURE.md               ← This file
├── README.md
├── docker-compose.yml            ← Orchestration (dev & prod)
├── .env.example                  ← Sample env variables
├── .gitignore
├── scripts/
│   └── smoke-test.sh             ← End-to-end auth + order-flow smoke test
│
├── api-gateway/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── openapi.json              ← OpenAPI 3 spec (served as Swagger UI)
│   └── index.js
│
├── user-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/           ← Committed; applied on startup (migrate deploy)
│   └── src/
│       ├── index.js
│       └── middleware/
│           └── auth.js           ← requireAuth / ownsResource / extractToken
│
├── product-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── middleware/
│       │   └── auth.js
│       └── models/
│           └── Product.js
│
├── order-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── index.js
│       ├── middleware/
│       │   └── auth.js
│       └── models/
│           └── Order.js
│
└── inventory-service/
    ├── Dockerfile
    ├── .dockerignore
    ├── package.json
    ├── prisma/
    │   ├── schema.prisma
    │   └── migrations/
    └── src/
        ├── index.js
        └── middleware/
            └── auth.js
```

---

## 10. Environment Variables

Secrets (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`) live in an **untracked `.env`** at the repo root (see `.env.example`). `docker-compose.yml` reads them via `${VAR:?}` interpolation and fails fast if `.env` is missing; the services also refuse to start without `JWT_SECRET`.

| Service | Variable | Description | Example |
| :--- | :--- | :--- | :--- |
| **api-gateway** | `USER_SERVICE_URL`, `PRODUCT_SERVICE_URL`, `ORDER_SERVICE_URL`, `INVENTORY_SERVICE_URL` | Optional proxy target overrides | defaults to the Docker DNS names (e.g. `http://user-service:3001`) |
| **user-service** | `DATABASE_URL` | PostgreSQL connection (assembled from `POSTGRES_USER`/`POSTGRES_PASSWORD`) | `postgresql://<user>:<password>@postgres:5432/shopstream?schema=user_service` |
| | `JWT_SECRET` | Secret for signing JWTs (from `.env`) | *(set in `.env`, never committed)* |
| | `PORT` | Service port | `3001` |
| **product-service** | `MONGO_URL` | MongoDB connection | `mongodb://mongodb:27017/productdb` |
| | `INVENTORY_SERVICE_URL` | Inventory service base URL | `http://inventory-service:3004` |
| | `JWT_SECRET` | Secret for verifying JWTs (must match user-service) | *(set in `.env`, never committed)* |
| **order-service** | `MONGO_URL` | MongoDB connection | `mongodb://mongodb:27017/orderdb` |
| | `INVENTORY_SERVICE_URL` | Inventory service base URL | `http://inventory-service:3004` |
| | `JWT_SECRET` | Secret for verifying JWTs (must match user-service) | *(set in `.env`, never committed)* |
| **inventory-service** | `DATABASE_URL` | PostgreSQL connection (assembled from `POSTGRES_USER`/`POSTGRES_PASSWORD`) | `postgresql://<user>:<password>@postgres:5432/shopstream?schema=inventory_service` |
| | `JWT_SECRET` | Secret for verifying JWTs (must match user-service) | *(set in `.env`, never committed)* |

> ⚠️ **Never commit `.env` files.** Use `.env.example` as a template: `cp .env.example .env`.

---

## 11. Running the Project

### Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose v2)

Node.js 18 is only needed if you want to run a service directly on the host.

### First-Time Setup

```bash
# 1. Clone the repo + create local secrets
git clone <your-repo-url>
cd ShopStream
cp .env.example .env        # then edit .env (set a real JWT_SECRET via openssl rand -hex 32)

# 2. Build & start everything (databases + services + gateway)
docker compose up --build -d

# 3. Verify the gateway
curl http://localhost:3000/health
```

Prisma migrations are committed in each service's `prisma/migrations/` and are
applied automatically on container startup (`npx prisma migrate deploy` in the
Dockerfiles) — no manual migration step is required.

### Expected Output

```
shopstream-postgres          | database system is ready to accept connections
shopstream-mongodb           | Waiting for connections
shopstream-user-service      | 👤 User Service on port 3001
shopstream-product-service   | 📦 Product Service on port 3002
shopstream-order-service     | 🛒 Order Service on port 3003
shopstream-inventory-service | 📊 Inventory Service on port 3004
shopstream-api-gateway       | API Gateway running on port 3000
```

### Common Commands

```bash
# Start everything
docker compose up -d

# View logs
docker compose logs -f

# View logs for one service
docker compose logs -f product-service

# Rebuild a single service
docker compose up -d --build product-service

# Stop (keep data)
docker compose down

# Stop + delete data
docker compose down -v

# Enter a container
docker exec -it shopstream-user-service sh

# Check health of all services
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
```

---

## 12. Testing the Workflows

**Automated:** `./scripts/smoke-test.sh` runs every flow below (plus the
401/403 auth checks) end-to-end and prints a PASS/FAIL summary.

**Interactive:** open [Swagger UI](http://localhost:3000/api-docs), login via
`POST /api/v1/auth/login`, click **Authorize** with the token, then use
**Try it out** on any endpoint.

> All steps below use the gateway (`:3000`). Protected endpoints need the JWT
> from Test 1 — copy `token` and `user.id` from the login response into
> `<TOKEN>` and `<USER_ID>`.

### Test 1: Register + Login

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"pass123","name":"John Doe"}'

# Login — save the returned token (for Authorization headers) and user.id
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"pass123"}'
```

**No token → rejected:**
```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Nope","price":1}'
# Expected: { "error": "Authentication required" }
```

---

### Test 2: Create Product (Auto-Creates Inventory)

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "iPhone 15 Pro",
    "price": 999.99,
    "category": "Electronics",
    "attributes": {"color": "Titanium", "storage": "256GB"}
  }'
```

**Verify inventory was created:**
```bash
# Replace <PRODUCT_ID> with the _id from the response above
curl http://localhost:3000/api/v1/inventory/<PRODUCT_ID>
# Expected: { "inventory": { "productId": "...", "quantity": 0, ... } }
```

---

### Test 3: Place Order (Deducts Stock)

```bash
# 1. Add stock
curl -X POST http://localhost:3000/api/v1/inventory/<PRODUCT_ID>/add \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"quantity": 50}'

# 2. Place order (userId MUST be the logged-in user's id)
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "userId": "<USER_ID>",
    "items": [{
      "productId": "<PRODUCT_ID>",
      "productName": "iPhone 15 Pro",
      "quantity": 2,
      "price": 999.99
    }]
  }'

# 3. Verify stock deducted (should be 48)
curl http://localhost:3000/api/v1/inventory/<PRODUCT_ID>
```

**Impersonation blocked:** the same request with someone else's `userId` →
`403 { "error": "userId does not match authenticated user" }`.

---

### Test 4: Rollback on Insufficient Stock

```bash
# Try to order 100 when only 48 exist
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "userId": "<USER_ID>",
    "items": [{
      "productId": "<PRODUCT_ID>",
      "productName": "iPhone 15 Pro",
      "quantity": 100,
      "price": 999.99
    }]
  }'
# Expected: { "error": "Order failed: Insufficient stock" }

# Verify stock unchanged (should still be 48)
curl http://localhost:3000/api/v1/inventory/<PRODUCT_ID>
```

---

## 13. Design Patterns Used

| Pattern | Where | Purpose |
| :--- | :--- | :--- |
| **API Gateway** | api-gateway | Single entry point for clients |
| **Database per Service** | All services | Loose coupling, independent scaling |
| **Polyglot Persistence** | All services | Right DB for the right job |
| **Circuit Breaker** | Product → Inventory | Prevent cascading failures |
| **Saga / Compensating Transaction** | Order Service | Rollback on partial failure |
| **Repository Pattern** | Via Prisma/Mongoose | Data access abstraction |
| **Middleware Chain** | All services | Auth checks, JSON parsing, request logging |

---

## 14. Security Considerations

### Implemented

- ✅ **Password hashing** with bcrypt (10 rounds)
- ✅ **JWT** for stateless auth (issued by user-service, 24h expiry)
- ✅ **JWT validation middleware** on every mutation + private read in all 4 services (`401` missing/invalid, `403` wrong owner)
- ✅ **Ownership checks** — user profiles and single-order reads are restricted to the owner or an ADMIN; order `userId` must match the token (`GET /orders` is not yet scoped — see §15)
- ✅ **Service-to-service forwarding** — product/order services pass the caller's JWT to inventory
- ✅ **Non-root user** in Docker containers
- ✅ **Secrets via untracked `.env`** — compose uses `${VAR:?}` interpolation, services fail fast without `JWT_SECRET` (still migrate to Docker secrets in prod)
- ✅ **Input validation** on critical endpoints

### Recommended for Production
- ⚠️ Add **rate limiting** (`express-rate-limit`) on the gateway
- ⚠️ Add **Helmet** for HTTP security headers
- ⚠️ Add **CORS** configuration
- ⚠️ Use **Docker secrets** instead of env vars
- ⚠️ Enable **HTTPS** via reverse proxy (Nginx/Traefik)
- ⚠️ Add **API input validation** with Zod or Joi
- ⚠️ Set up **audit logging**

---

## 15. Known Limitations & Future Improvements

### Current Limitations

| Limitation | Impact | Fix |
| :--- | :--- | :--- |
| **Synchronous HTTP** between services | If inventory is slow, product creation is slow | Move to message queue (Kafka/RabbitMQ) |
| **No distributed tracing** | Hard to debug multi-service issues | Add OpenTelemetry + Jaeger |
| **No event bus** | Tight coupling between Product & Inventory | Use event-driven architecture |
| **Rollback can fail** | If order-service crashes mid-rollback, data is inconsistent | Use outbox pattern + retries |
| **No API versioning strategy** | Breaking changes affect all clients | Add `/v2` support + deprecation policy |
| **No role-based authorization** | Any authenticated user can edit any product / change any order's status / restock any product | Add `requireAdmin` middleware + admin seeding |
| **Order list is not scoped** | `GET /api/v1/orders` returns every user's orders to any authenticated caller | Filter by `req.user.id` unless ADMIN |

### Roadmap

#### Phase 1 — Hardening (Next)
- [x] Add JWT middleware for protected routes
- [ ] Add request validation (Zod)
- [ ] Add integration tests (Jest + Supertest)
- [ ] Add E2E tests (Playwright)

#### Phase 2 — Observability
- [ ] Add structured logging (Winston/Pino)
- [ ] Add OpenTelemetry tracing
- [ ] Add Prometheus metrics
- [ ] Add Grafana dashboards

#### Phase 3 — Scale
- [ ] Migrate to Kafka for inter-service events
- [ ] Add Redis for caching (product catalog)
- [ ] Add service discovery (Consul)
- [ ] Migrate to Kubernetes for multi-node deployment

#### Phase 4 — Advanced Features
- [ ] Payment service (Stripe integration)
- [ ] Notification service (email/SMS)
- [ ] Search service (Elasticsearch)
- [ ] Recommendation service (ML)

---

## 📚 References

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
- [Microservices Patterns (Chris Richardson)](https://microservices.io/patterns/)
- [12-Factor App](https://12factor.net/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Mongoose Documentation](https://mongoosejs.com/docs/)
- [Opossum Circuit Breaker](https://nodeshift.dev/opossum/)

---

**Maintainer:** [Your Name]
**Last Updated:** 2026-10-17
**Version:** 1.0.0