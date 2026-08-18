FROM node:22-alpine AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY db/package.json db/package.json
RUN pnpm install --filter @word-journey/api... --filter @word-journey/db --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/db/node_modules ./db/node_modules
COPY tsconfig.base.json ./
COPY package.json ./
COPY apps/ apps/
COPY packages/ packages/
COPY db/schema.prisma db/schema.prisma
COPY scripts/ scripts/
# 构建期守卫：raw SQL 表名必须与 Prisma schema model 名大小写一致（Linux MySQL 表名大小写敏感）
RUN node scripts/check-raw-sql-tables.mjs
RUN cd db && npx prisma generate --schema schema.prisma
RUN cd packages/shared && pnpm build
WORKDIR /app/apps/api
RUN pnpm build

FROM base AS runner
WORKDIR /app/apps/api
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/packages /app/packages
EXPOSE 3000
CMD ["node", "dist/main.js"]