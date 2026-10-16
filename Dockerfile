# syntax=docker/dockerfile:1.10

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
ARG NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_RELEASE
ARG RACESIDE_RELEASE_SHA
ARG LIVE_INTERNAL_ORIGIN=http://live:3002
ENV LIVE_INTERNAL_ORIGIN=$LIVE_INTERNAL_ORIGIN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_ENVIRONMENT=$NEXT_PUBLIC_SENTRY_ENVIRONMENT
ENV NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=$NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV RACESIDE_RELEASE_SHA=$RACESIDE_RELEASE_SHA
LABEL org.opencontainers.image.revision=$RACESIDE_RELEASE_SHA
RUN corepack enable
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN,required=false pnpm build

FROM node:22-bookworm-slim AS runner
ARG RACESIDE_RELEASE_SHA
WORKDIR /app
ENV NODE_ENV=production
ENV RACESIDE_RELEASE_SHA=$RACESIDE_RELEASE_SHA
ENV FASTF1_PYTHON_BIN=/opt/fastf1/bin/python
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/sentry-scrub.mjs ./sentry-scrub.mjs
COPY --from=builder /app/scripts/warm-public-pages.mjs ./scripts/warm-public-pages.mjs
COPY --from=builder /app/src/config/admin-jobs.json ./src/config/admin-jobs.json
COPY --from=builder /app/src/config/ai-prompts.json ./src/config/ai-prompts.json
COPY --from=builder /app/src/lib/replay-pit-lane.mjs ./src/lib/replay-pit-lane.mjs
COPY --from=builder /app/src/data/replay-pit-layouts.json ./src/data/replay-pit-layouts.json
COPY --from=builder /app/src/features/race-replay/lib/motion.ts ./src/features/race-replay/lib/motion.ts
COPY --from=builder /app/src/features/race-replay/lib/track-geometry.ts ./src/features/race-replay/lib/track-geometry.ts
COPY --from=builder /app/scripts/telegram-authorize.mjs ./scripts/telegram-authorize.mjs
COPY --from=builder /app/scripts/warm-public-pages.mjs ./scripts/warm-public-pages.mjs
COPY --from=builder /app/package.json ./package.json
RUN python3 -m venv /opt/fastf1 \
  && /opt/fastf1/bin/pip install --no-cache-dir -r worker/fastf1/requirements.txt
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server.js"]
