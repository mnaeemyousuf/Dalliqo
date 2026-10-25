# Build context: repository root (needs shared/ and web/).

FROM node:22-alpine AS build
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --workspaces --include-workspace-root
COPY shared shared
COPY web web
RUN npm run build -w @recrm/web

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
