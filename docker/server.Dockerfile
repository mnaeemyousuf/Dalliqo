# Build context: repository root (needs shared/ and server/).

FROM node:22-alpine AS build
# Test-only dependency; don't pull a MongoDB binary into the build.
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root
COPY shared shared
COPY server server
RUN npm run build -w @recrm/shared && npm run build -w @recrm/server \
 && npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json shared/
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
# Brand assets used in PDF reports (logo).
COPY --from=build /app/server/assets server/assets
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/server.js"]
