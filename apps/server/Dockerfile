FROM node:22-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json

RUN npm ci

COPY apps/server apps/server
COPY packages/protocol packages/protocol

RUN npm run build --workspace @scooter-shooter/protocol \
  && npm run build --workspace @scooter-shooter/server

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist
COPY --from=build --chown=node:node /workspace/packages/protocol/dist ./node_modules/@scooter-shooter/protocol/dist
COPY --from=build --chown=node:node /workspace/packages/protocol/package.json ./node_modules/@scooter-shooter/protocol/package.json
COPY --from=build --chown=node:node /workspace/node_modules/zod ./node_modules/zod

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
