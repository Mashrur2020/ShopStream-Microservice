# ShopStream — E-commerce Microservices Architecture

> A production-ready, event-driven e-commerce backend built with **Node.js**, **Express**, **PostgreSQL**, **MongoDB**, and **Docker**.

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
- **Resilience patterns** — Circuit breakers, retries, rollback
- **Container orchestration** — Full Docker Compose setup

### Core Feature

> **When a product is created, an inventory record is automatically created with 0 stock.** No manual sync required. This is achieved via synchronous HTTP calls with circuit breaker protection.

---

## 2. System Architecture

```
                                +-----------------------------------------------------------------------------------+
                                |                                                                                   |
                                |                             API GATEWAY LAYER                                     |
                                |                                                                                   |
+--------+                      |   +---------------------+       +---------------------------------------------+   |
|        |                      |   |                     |       |  Express Gateway (Port 3000)                |   |
| Client | ---------------------->  |  Nginx (Optional)   | ----> |                                             |   |
| (Web/  |   HTTP Request       |   |  (Reverse Proxy)    |       |  Routes:                                    |   |
| Mobile)|                      |   |                     |       |   /api/v1/users     -> USER-SERVICE         |   |
+--------+                      |   +---------------------+       |   /api/v1/auth      -> USER-SERVICE         |   |
                                |                                 |   /api/v1/products  -> PRODUCT-SERVICE      |   |
                                |                                 |   /api/v1/orders    -> ORDER-SERVICE        |   |
                                |                                 |   /api/v1/inventory -> INVENTORY-SERVICE    |   |
                                |                                 +----------------------+----------------------+   |
                                +--------------------------------------------------------|--------------------------+
                                                                                         |
                                                                                         | (Docker DNS)
                                                                                         v
+-----------------------------------------------------------------------------------+-----------------------------+
|                                                                                                               |
|                                        MICROSERVICES LAYER (Node.js + Express)                                |
|                                                                                                               |
|  +-----------------------+      +-----------------------+      +-----------------------+      +-----------------------+
|  |   User Service        |      |   Product Service     |      |   Order Service       |      |  Inventory Service    |
|  |   (Express + Prisma)  |      |   (Express + Mongoose)|      |   (Express + Mongoose)|      |  (Express + Prisma)   |
|  |                       |      |                       |      |                       |      |                       |
|  |  - bcrypt             |      |  - Product Schema     |      |  - Order Schema       |      |  - ACID Transactions  |
|  |  - jsonwebtoken       |      |  - Axios Client       |      |  - Axios Client       |      |  - Opossum            |
|  |  - Prisma Client      |      |  - Opossum            |      |  - Rollback Logic     |      |  - Prisma Client      |
|  +----------+------------+      +----------+------------+      +----------+------------+      +----------+------------+
|             |                              |                              |                              |
|             | (1) Create Product           | (2) Auto-create Inventory    | (3) Check/Deduct Stock       |
|             |                              |     via Axios                |     via Axios                |
|             |                              +------------------------------>                              |
|             |                                                             |                              |
|             |                                                             +------------------------------>|
|             |                                                                            (4) Confirm/Reject |
|             |                                                             <------------------------------+
+-------------|------------------------------|------------------------------|------------------------------|-------+
              |                              |                              |                              |
              v                              v                              v                              v
+-----------------------------------------------------------------------------------+-----------------------------+
|                                                                                                               |
|                                          DATABASE LAYER (Polyglot Persistence)                                |
|                                                                                                               |
|  +-----------------------+      +-----------------------+      +-----------------------+      +-----------------------+
|  |    PostgreSQL         |      |      MongoDB          |      |      MongoDB          |      |    PostgreSQL         |
|  |                       |      |                       |      |                       |      |                       |
|  |   - User Data         |      |   - Product Data      |      |   - Order Data        |      |  - Inventory Data     |
|  |   - Auth Credentials  |      |   - Flexible Schema   |      |   - Order History     |      |  - Stock Levels       |
|  |   - Roles/Permissions |      |   - Categories        |      |   - Order Items       |      |  - ACID Transactions  |
|  +-----------------------+      +-----------------------+      +-----------------------+      +-----------------------+
```

---

## 3. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Runtime** | Node.js 18 (Alpine) | JavaScript runtime |
| **Framework** | Express.js 4 | HTTP server |
| **API Gateway** | Express + `http-proxy-middleware` | Reverse proxy & routing |
| **User DB** | PostgreSQL 15 | Relational, ACID-compliant |
| **Product DB** | MongoDB 6 | Document store, flexible schema |
| **Order DB** | MongoDB 6 | Document store, order history |
| **Inventory DB** | PostgreSQL 15 | ACID transactions for stock |
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
| `/health` | Self |

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
- Track order status (PENDING → CONFIRMED → SHIPPED → DELIVERED)

---

### 4.5 Inventory Service (`inventory-service`)

| Property | Value |
| :--- | :--- |
| **Port** | 3004 |
| **Database** | PostgreSQL (`inventory_service` schema) |
| **Responsibility** | Stock level management |

**Key Responsibilities:**
- Track stock per product
- **Atomic stock deduction** (ACID transactions to prevent overselling)
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
- **ACID transactions** are essential for stock deduction
- Row-level locking prevents race conditions
- `UPDATE ... WHERE quantity >= N` guarantees no overselling

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

### 6.1 Auth & Users (`/api/v1/auth`, `/api/v1/users`)

| Method | Endpoint | Description | Auth |
| :--- | :--- | :--- | :--- |
| POST | `/api/v1/auth/register` | Register new user | ❌ |
| POST | `/api/v1/auth/login` | Login, returns JWT | ❌ |
| GET | `/api/v1/users/:id` | Get user by ID | ❌ |

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

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/api/v1/products` | Create product (auto-creates inventory) |
| GET | `/api/v1/products` | List all products |
| GET | `/api/v1/products/:id` | Get product by ID |
| PUT | `/api/v1/products/:id` | Update product |
| DELETE | `/api/v1/products/:id` | Delete product |

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

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/api/v1/orders` | Create order (deducts stock) |
| GET | `/api/v1/orders` | List all orders |
| GET | `/api/v1/orders/:id` | Get order by ID |
| GET | `/api/v1/orders/user/:userId` | Get user's orders |
| PUT | `/api/v1/orders/:id/status` | Update order status |

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

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| POST | `/api/v1/inventory` | Create inventory record (called by Product Service) |
| GET | `/api/v1/inventory/:productId` | Get stock for product |
| POST | `/api/v1/inventory/:productId/add` | Add stock |
| PUT | `/api/v1/inventory/:productId/deduct` | Deduct stock (atomic) |

---

## 7. Inter-Service Communication

### Communication Style

**Synchronous HTTP** via Axios, protected by circuit breakers.

| Caller | Callee | Purpose | Failure Handling |
| :--- | :--- | :--- | :--- |
| Product Service | Inventory Service | Auto-create inventory | Circuit breaker + fallback |
| Order Service | Inventory Service | Deduct stock | Try/catch + rollback |

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

**If Inventory Service is down:**
- Circuit breaker **opens** after 50% failures
- Fallback returns `{ message: "queued for retry" }`
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
shopstream-node/
├── ARCHITECTURE.md               ← This file
├── docker-compose.yml            ← Base orchestration
├── docker-compose.override.yml   ← Dev overrides (hot reload)
├── docker-compose.prod.yml       ← Prod overrides (resource limits)
├── .env.example                  ← Sample env variables
│
├── api-gateway/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── index.js
│
├── user-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       └── index.js
│
├── product-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── index.js
│       └── models/
│           └── Product.js
│
├── order-service/
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── package.json
│   └── src/
│       ├── index.js
│       └── models/
│           └── Order.js
│
└── inventory-service/
    ├── Dockerfile
    ├── .dockerignore
    ├── package.json
    ├── prisma/
    │   └── schema.prisma
    └── src/
        └── index.js
```

---

## 10. Environment Variables

| Service | Variable | Description | Example |
| :--- | :--- | :--- | :--- |
| **user-service** | `DATABASE_URL` | PostgreSQL connection | `postgresql://admin:admin123@postgres:5432/shopstream?schema=user_service` |
| | `JWT_SECRET` | Secret for signing JWTs | `supersecretkey` |
| | `PORT` | Service port | `3001` |
| **product-service** | `MONGO_URL` | MongoDB connection | `mongodb://mongodb:27017/productdb` |
| | `INVENTORY_SERVICE_URL` | Inventory service base URL | `http://inventory-service:3004` |
| **order-service** | `MONGO_URL` | MongoDB connection | `mongodb://mongodb:27017/orderdb` |
| | `INVENTORY_SERVICE_URL` | Inventory service base URL | `http://inventory-service:3004` |
| **inventory-service** | `DATABASE_URL` | PostgreSQL connection | `postgresql://admin:admin123@postgres:5432/shopstream?schema=inventory_service` |

> ⚠️ **Never commit `.env` files.** Use `.env.example` as a template.

---

## 11. Running the Project

### Prerequisites

- Docker Desktop (or Docker Engine + Compose)
- Node.js 18+ (only for running `prisma migrate` locally)
- Make (optional, for shortcuts)

### First-Time Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd shopstream-node

# 2. Start only Postgres (for migrations)
docker-compose up -d postgres

# 3. Generate Prisma clients + run migrations
cd user-service
npm install
DATABASE_URL="postgresql://admin:admin123@localhost:5432/shopstream?schema=user_service" \
  npx prisma migrate dev --name init
cd ..

cd inventory-service
npm install
DATABASE_URL="postgresql://admin:admin123@localhost:5432/shopstream?schema=inventory_service" \
  npx prisma migrate dev --name init
cd ..

# 4. Stop Postgres
docker-compose down

# 5. Start everything
docker-compose up --build
```

### Expected Output

```
shopstream-postgres   | database system is ready to accept connections
shopstream-mongo      | Waiting for connections
user-service          | 👤 User Service on port 3001
product-service       | 📦 Product Service on port 3002
order-service         | 🛒 Order Service on port 3003
inventory-service     | 📊 Inventory Service on port 3004
api-gateway           | 🚀 API Gateway running on port 3000
```

### Common Commands

```bash
# Start everything
docker-compose up -d

# View logs
docker-compose logs -f

# View logs for one service
docker-compose logs -f product-service

# Rebuild a single service
docker-compose up -d --build product-service

# Stop (keep data)
docker-compose down

# Stop + delete data
docker-compose down -v

# Enter a container
docker exec -it user-service sh

# Check health of all services
curl http://localhost:3000/health
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
```

---

## 12. Testing the Workflows

### Test 1: Register + Login

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"pass123","name":"John Doe"}'

# Login
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"john@test.com","password":"pass123"}'
```

---

### Test 2: Create Product (Auto-Creates Inventory)

```bash
curl -X POST http://localhost:3000/api/v1/products \
  -H "Content-Type: application/json" \
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
# Expected: { "productId": "...", "quantity": 0 }
```

---

### Test 3: Place Order (Deducts Stock)

```bash
# 1. Add stock
curl -X POST http://localhost:3000/api/v1/inventory/<PRODUCT_ID>/add \
  -H "Content-Type: application/json" \
  -d '{"quantity": 50}'

# 2. Place order
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
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

---

### Test 4: Rollback on Insufficient Stock

```bash
# Try to order 100 when only 48 exist
curl -X POST http://localhost:3000/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "<USER_ID>",
    "items": [{
      "productId": "<PRODUCT_ID>",
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
| **Dependency Injection** | Express middleware | Testability |

---

## 14. Security Considerations

### Implemented

- ✅ **Password hashing** with bcrypt (10 rounds)
- ✅ **JWT** for stateless auth
- ✅ **Non-root user** in Docker containers
- ✅ **Secrets via env vars** (should migrate to Docker secrets in prod)
- ✅ **Input validation** on critical endpoints

### Recommended for Production

- ⚠️ Add **JWT middleware** to protect admin routes
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
| **JWT not validated on all routes** | Unauthenticated product creation possible | Add JWT middleware |

### Roadmap

#### Phase 1 — Hardening (Next)
- [ ] Add JWT middleware for protected routes
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
**Last Updated:** 2026-10-09
**Version:** 1.0.0