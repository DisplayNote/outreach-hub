# syntax=docker/dockerfile:1.7

FROM node:24.13.0-alpine AS base
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN npm install -g pnpm@11.2.2

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS builder
# Placeholder env so `next build` compiles without real credentials. getServerEnv()
# is only evaluated at RUNTIME in the running container (ACA injects the real
# values from Key Vault); these merely satisfy the env schema during the build's
# static analysis / page data collection. They never reach a running container.
ENV DATABASE_URL=postgres://app_user:placeholder@localhost:5432/outreach
ENV AUTH_SECRET=build-placeholder
ENV AZURE_AD_CLIENT_ID=build-placeholder
ENV AZURE_AD_CLIENT_SECRET=build-placeholder
ENV AZURE_AD_TENANT_ID=11111111-1111-1111-1111-111111111111

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:24.13.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
