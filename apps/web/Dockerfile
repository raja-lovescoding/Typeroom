FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile
# Operator details for the About/Privacy/Terms/Contact pages (see apps/web/.env.example).
ARG VITE_CONTACT_EMAIL VITE_OPERATOR_NAME VITE_JURISDICTION VITE_LOG_RETENTION_DAYS VITE_HOSTING_PROVIDER VITE_REPO_URL
ENV VITE_CONTACT_EMAIL=$VITE_CONTACT_EMAIL VITE_OPERATOR_NAME=$VITE_OPERATOR_NAME VITE_JURISDICTION=$VITE_JURISDICTION
ENV VITE_LOG_RETENTION_DAYS=$VITE_LOG_RETENTION_DAYS VITE_HOSTING_PROVIDER=$VITE_HOSTING_PROVIDER VITE_REPO_URL=$VITE_REPO_URL
RUN pnpm --filter @typeroom/shared build && pnpm --filter @typeroom/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s CMD wget --spider -q http://localhost/ || exit 1
