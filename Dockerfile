# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: argon2 and the pg driver expect glibc, and
# Alpine's musl means either prebuilt binaries are skipped or they misbehave.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — every dependency, plus the toolchain argon2 needs if no prebuilt
# binary matches this platform. None of this reaches the final image.
# ---------------------------------------------------------------------------
FROM base AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Copied before the source so editing a .ts file doesn't invalidate this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# prod-deps — the same install minus devDependencies, for the runtime stage.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---------------------------------------------------------------------------
# build — generate the Prisma client, then compile to dist/.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
# prisma.config.ts resolves env('DATABASE_URL') eagerly, but `generate` never
# opens a connection. A placeholder keeps the real credential out of the build.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN pnpm db:generate && pnpm build

# ---------------------------------------------------------------------------
# runtime — compiled JS and production node_modules only.
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# The VM has 1 GB. Cap the heap so Node reclaims memory instead of being
# OOM-killed by the kernel, which gives no warning and no stack trace.
ENV NODE_OPTIONS=--max-old-space-size=320
WORKDIR /app

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

# node:24-slim ships an unprivileged `node` user (uid 1000). A container escape
# then lands on an account that owns nothing, instead of root.
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
