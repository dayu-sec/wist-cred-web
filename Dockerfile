# ===========================================================================
# wist-cred-web — 静态产物构建 + nginx 托管
#
# 1. node 构建阶段：npm ci + npm run build → dist/
# 2. nginx 运行阶段：静态托管
#
# 注意：镜像内**不含** nginx 站点配置（与 wist-center-web 同构）——SPA 回退、
# `/api` 反代与操作者头注入由运行期挂载的 conf 提供（见 wist-cred-stack 的
# sys/configs/web/nginx.conf.tpl）。只跑本镜像时 `/` 能出页面，但 `/api` 不通。
# ===========================================================================

FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
