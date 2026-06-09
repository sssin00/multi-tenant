FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm --filter auth-iam-service build
RUN pnpm deploy --filter auth-iam-service --prod /prod/auth-iam-service

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV AUTH_PORT=3000
RUN apk add --no-cache dumb-init
COPY --from=build --chown=node:node /prod/auth-iam-service ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${AUTH_PORT}/health >/dev/null 2>&1 || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
