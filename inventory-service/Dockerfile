FROM node:18-alpine

# openssl for Prisma engine version detection on musl
RUN apk add --no-cache openssl

WORKDIR /app

# Install deps first (cached layer: only re-runs when package.json changes)
COPY package.json ./
RUN npm install

# Prisma schema + migrations
COPY prisma ./prisma
RUN npx prisma generate

# App source
COPY src ./src

# Non-root
USER node

EXPOSE 3004

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:3004/health || exit 1

# migrate deploy is idempotent: applies committed migrations on startup
CMD ["sh", "-c", "npx prisma migrate deploy && node src/index.js"]
