FROM node:22-alpine AS build

WORKDIR /workspace

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/game-config/package.json packages/game-config/package.json
COPY packages/simulation/package.json packages/simulation/package.json

RUN npm ci

COPY apps/server apps/server
COPY packages/protocol packages/protocol
COPY packages/game-config packages/game-config
COPY packages/simulation packages/simulation

RUN npm run build --workspace @scooter-shooter/server

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist
COPY --from=build --chown=node:node /workspace/packages/protocol/dist ./node_modules/@scooter-shooter/protocol/dist
COPY --from=build --chown=node:node /workspace/packages/protocol/package.json ./node_modules/@scooter-shooter/protocol/package.json
COPY --from=build --chown=node:node /workspace/packages/game-config/dist ./node_modules/@scooter-shooter/game-config/dist
COPY --from=build --chown=node:node /workspace/packages/game-config/package.json ./node_modules/@scooter-shooter/game-config/package.json
COPY --from=build --chown=node:node /workspace/packages/simulation/dist ./node_modules/@scooter-shooter/simulation/dist
COPY --from=build --chown=node:node /workspace/packages/simulation/package.json ./node_modules/@scooter-shooter/simulation/package.json
COPY --from=build --chown=node:node /workspace/node_modules/zod ./node_modules/zod
COPY --from=build --chown=node:node /workspace/node_modules/ws ./node_modules/ws

USER node

EXPOSE 8080

CMD ["node", "dist/index.js"]
