# syntax=docker/dockerfile:1

# --- build stage -------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- dev stage -----------------------------------------------------------
# Placed before `runtime` so plain `docker build .` (no --target) still
# defaults to the last stage, `runtime` — required for production builds.
FROM node:24-slim AS dev
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

CMD ["sh", "-c", "node scripts/installSiblingDeps.mjs && npx nodemon --legacy-watch --watch src --ext ts,json --exec 'node --import tsx src/dev.ts'"]

# --- runtime stage -------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY scripts/healthcheck.mjs ./scripts/healthcheck.mjs

RUN chown -R node:node /app
USER node

# Documentation only: the effective listen port is HOMEBASE_PORT / registry
# server.port at runtime, not a build-time constant.
EXPOSE 17106

STOPSIGNAL SIGTERM

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

ENTRYPOINT ["node", "dist/main.js"]
