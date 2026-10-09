FROM node:18-alpine

WORKDIR /app

# Install deps first (cached layer: only re-runs when package.json changes)
COPY package.json ./
RUN npm install --omit=dev

# App source
COPY index.js ./

# Non-root
USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=5 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
