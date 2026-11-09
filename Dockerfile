# syntax=docker/dockerfile:1
#
# 单镜像：前端产物 + 后端源码 + 后端运行期依赖。
# 三个构建阶段：
#   frontend      装全量依赖并构建前端（devDependencies 只存在于这一层）
#   backend-deps  只装后端 dependencies（--omit=dev）
#   runtime       只拷上面两层的产物，构建工具链全部丢弃

ARG NODE_IMAGE=node:24-alpine

# 前端产物与架构无关，固定用构建机架构跑，多架构构建时不走 QEMU
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS frontend

# lockfile 的 resolved 指向 npmmirror，构建机未必可达，统一替换为下面这个源
ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /build
COPY Frontend/package.json Frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --registry=$NPM_REGISTRY --replace-registry-host=always
COPY Frontend/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS backend-deps

ARG NPM_REGISTRY=https://registry.npmjs.org

WORKDIR /app
COPY Backend/package.json Backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --registry=$NPM_REGISTRY --replace-registry-host=always \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime

ARG APP_VERSION=0.0.0

LABEL org.opencontainers.image.title="MailFlow" \
      org.opencontainers.image.description="单用户自托管邮件同步服务器（IMAP/SMTP + SQLite + Web UI）" \
      org.opencontainers.image.version="${APP_VERSION}"

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/dist

WORKDIR /app

COPY --from=backend-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node Backend/package.json ./
COPY --chown=node:node Backend/src ./src
COPY --chown=node:node Backend/.env.example ./.env.example
COPY --from=frontend --chown=node:node /build/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "src/index.js"]
