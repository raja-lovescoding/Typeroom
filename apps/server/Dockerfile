FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @typeroom/shared build && pnpm --filter @typeroom/server build

FROM node:22-alpine
RUN addgroup -S typeroom && adduser -S typeroom -G typeroom
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
USER typeroom
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget --spider -q http://localhost:3000/health || exit 1
CMD ["node", "apps/server/dist/index.js"]
