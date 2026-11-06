# wist-cred-web

凭据服务 `wist-cred` 的**管理页面**：为程序创建凭据、一次性展示明文、查看与撤销。

> 设计口径：`wist-design/doc/design/foundation/auth-token-verification.md`
> （D16 凭据由人为程序创建；人机面的验证由**本服务自己**做，不靠入口反代）。

## 页面做什么

| 区域 | 行为 |
|---|---|
| 新建凭据 | 填程序名 / 用途 / 角色 / 受众 / 有效期（可选）/ 应急标记 |
| 明文展示 | 创建成功后**只显示一次**，带复制按钮；离开即消失，服务端只留 `sha256` |
| 已发放列表 | 程序、申请人、受众、角色、到期、状态（有效 / 已撤销 / 已过期） |
| 撤销 | 二次确认后调 `POST .../revoke`（幂等） |

## 身份与安全

**口径：验证在产品里，不在反代里。** 页面上有一个登录框，输部署方设置的口令；
口令只存在**本标签页**（`sessionStorage`），每次请求带 `Authorization: Bearer <口令>`，
由 `wist-cred` 自己验（配置里只有它的 `sha256`）。

| 情况 | 页面行为 |
|---|---|
| 没口令 / 口令不对（401） | 弹登录框（`src/Login.tsx`）；服务端说 `invalid_admin_bearer_token` 时**就地清掉**本地口令，不会拿错口令反复轮询 |
| 已登录 | 右上角显示「退出」；换口令 = 退出重输 |
| 开发态 | 与发布态同一条路（`mode = "token"`）；vite 代理只在页面**没带**口令时补上 `WIST_CRED_DEV_PASSWORD`（默认 `dev-only-password`），所以登录框 / 错口令 / 401 在 dev 里也是真的 |

浏览器**拿不到平台签发的 token**：那是给程序用的，明文只在创建响应里出现一次。

## 开发

```sh
npm install
npm run dev        # http://127.0.0.1:5174
```

`/api` 代理到本地 cred：

| env | 默认 | 说明 |
|---|---|---|
| `WIST_CRED_TARGET` | `http://127.0.0.1:18443` | cred 地址 |
| `WIST_CRED_DEV_PASSWORD` | `dev-only-password` | 页面**没带**口令时，代理补上的 dev 口令（带了就不覆盖） |
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
