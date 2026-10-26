# Node + better-sqlite3. bookworm-slim + build tools so the native module installs
# cleanly on both x64 and ARM64 (Oracle Cloud Always Free is ARM64/Ampere).
FROM node:20-bookworm-slim

# Build deps for better-sqlite3 (used only if a prebuilt binary isn't available).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production deps first (better layer caching).
COPY package.json ./
RUN npm install --omit=dev

# App source.
COPY . .

# Persisted SQLite lives here (mounted as a volume in docker-compose).
RUN mkdir -p /app/data
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/server.js"]
