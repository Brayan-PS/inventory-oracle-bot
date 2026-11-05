# syntax=docker/dockerfile:1
FROM node:24.16.0-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
# The Lovable wrapper forwards this target to Nitro outside Lovable builds.
ENV NITRO_PRESET=node_server
RUN npm run build

FROM build AS migrate
CMD ["npm", "run", "db:setup"]

FROM node:24.16.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
