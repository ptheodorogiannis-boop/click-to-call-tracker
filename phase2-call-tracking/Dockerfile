# Two stages: build the web app and the native better-sqlite3 module, then ship only what runs.
# bookworm-slim works on x64 and ARM64 (Oracle Cloud Always Free is ARM64/Ampere). Node 22 for the Vite config.
FROM node:22-bookworm-slim AS build

# Build deps for better-sqlite3 (used only if a prebuilt binary isn't available).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./
COPY src ./src
COPY migrations ./migrations
COPY public ./public
COPY tools ./tools
COPY test/simulate.js ./test/simulate.js

# Persisted SQLite lives here (mounted as a volume in docker-compose).
RUN mkdir -p /app/data
EXPOSE 8080

CMD ["node", "src/server.js"]
