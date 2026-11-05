FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ARG APP
RUN test -f apps/$APP/vite.config.ts && pnpm --filter @sorye/$APP... build && pnpm --filter @sorye/$APP exec vite build --base=/remote/
RUN mkdir /output && cp -r apps/$APP/dist/. /output/

FROM nginx:1.28-alpine AS gateway
ARG APP
ENV APP_SLUG=$APP HUB_UPSTREAM=http://hub:3000 NGINX_WORKER_PROCESSES=2
COPY deploy/app.nginx.conf /etc/nginx/templates/default.conf.template
RUN mkdir -p /usr/share/nginx/html/remote && sed -i 's/worker_processes  auto/worker_processes  2/' /etc/nginx/nginx.conf
EXPOSE 8080

FROM gateway AS remote
COPY --from=build /output/ /usr/share/nginx/html/remote/
