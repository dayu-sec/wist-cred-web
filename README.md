# wist-cred-web

凭据服务 `wist-cred` 的**管理页面**：为程序创建凭据、一次性展示明文、查看与撤销。

> 设计口径：`wist-design/doc/design/foundation/auth-token-verification.md`
> （D16 凭据由人为程序创建、D17 页面与认证解耦）。

## 页面做什么

| 区域 | 行为 |
|---|---|
| 新建凭据 | 填程序名 / 用途 / 角色 / 受众 / 有效期（可选）/ 应急标记 |
| 明文展示 | 创建成功后**只显示一次**，带复制按钮；离开即消失，服务端只留 `sha256` |
| 已发放列表 | 程序、申请人、受众、角色、到期、状态（有效 / 已撤销 / 已过期） |
| 撤销 | 二次确认后调 `POST .../revoke`（幂等） |

## 身份与安全

**页面从不自己设置 `x-wist-operator`。**

| 环境 | 谁注入 |
|---|---|
| 发布态 | 入口 nginx：先做 basic auth（阶段一），再把 `$remote_user` 写进请求头 |
| dev | vite 代理（`vite.config.ts`），值为 `WIST_OPERATOR`，默认 `dev` |

浏览器不持任何平台凭据，也读不到别人的 token —— 明文只在创建响应里出现一次。

## 开发

```sh
npm install
npm run dev        # http://127.0.0.1:5174
```

`/api` 代理到本地 cred：

| env | 默认 | 说明 |
|---|---|---|
| `WIST_CRED_TARGET` | `http://127.0.0.1:18443` | cred 地址 |
| `WIST_OPERATOR` | `dev` | 注入的操作者名 |
| `WIST_CRED_WEB_PORT` | `5174` | dev server 端口 |

配套：`wist-cred-stack` 的 `./dev/svc.sh start` 会同时起 cred 与 web。

## 构建

```sh
npm run build      # tsc --noEmit + vite build → dist/
npm run preview
```

镜像（静态托管，**不含**站点配置）：

```sh
docker build -t wist-cred-web:local --build-arg APP_VERSION=0.1.0 .
```

`/api` 反代、SPA 回退与操作者头注入由 `wist-cred-stack` 的
`sys/configs/web/nginx.conf.tpl` 渲染后挂载提供。

## 接口契约

只依赖这四条（见 `src/api.ts`）：

```text
GET  /api/v1/credentials
GET  /api/v1/credentials/{id}
POST /api/v1/credentials
POST /api/v1/credentials/{id}/revoke
```

错误信封：`{"error":{"code":"...","message":"..."}}`。
`401` 时会提示"操作者头从哪来"，而不是只说"未授权"。
