FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
# Keep workspace source: tsx resolves the shared packages' TypeScript exports.
# .dockerignore excludes local data, credentials and generated build output.
COPY . .
RUN pnpm --filter @sorye/hub... install --prod --frozen-lockfile
ENV NODE_ENV=production STORE_DRIVER=postgres
WORKDIR /app/apps/hub
CMD ["node", "--import", "tsx", "lib/workers/start-ocr-worker.ts"]
