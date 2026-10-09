FROM node:18-alpine

WORKDIR /app

# Install deps first (cached layer: only re-runs when package.json changes)
COPY package.json ./
RUN npm install

# App source
COPY src ./src

# Non-root
USER node

EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "src/index.js"]
