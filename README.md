# ShopStream

> A production-ready, event-driven e-commerce backend built with **Node.js**, **Express**, **PostgreSQL**, **MongoDB**, and **Docker**.

## Quick Start

```bash
docker compose up -d postgres mongodb   # start databases
docker compose up --build               # build & run all services
curl http://localhost:3000/health       # verify gateway
```

## Services

| Service | Port | Database |
| :--- | :--- | :--- |
| api-gateway | 3000 | — |
| user-service | 3001 | PostgreSQL |
| product-service | 3002 | MongoDB |
| order-service | 3003 | MongoDB |
| inventory-service | 3004 | PostgreSQL |

Full architecture and API documentation: [ARCHITECTURE.md](./ARCHITECTURE.md)
