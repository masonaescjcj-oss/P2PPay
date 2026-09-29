# syntax=docker/dockerfile:1
# P2PPay: one image serving the API and the built web app. Data lives in Supabase (Postgres + Storage).

# ---- web app ----
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server dependencies (production only) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /build/server/node_modules server/node_modules
COPY server/package.json server/
COPY server/src server/src
COPY supabase/migrations supabase/migrations
COPY --from=web /build/web/dist web/dist
USER node
WORKDIR /app/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
