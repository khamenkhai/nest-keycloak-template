FROM node:24-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm i -f

FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts prisma.store.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
COPY .env.example ./.env

RUN npx prisma generate
RUN npx prisma generate --config=prisma.store.config.ts
RUN npm run build

FROM node:24-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm i -f --only=production

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json prisma.config.ts prisma.store.config.ts ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

RUN mkdir -p logs && chown -R node:node /app

USER node
EXPOSE 3000

CMD ["node", "dist/src/main"]
