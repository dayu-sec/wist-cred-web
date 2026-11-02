# Changelog

## [Unreleased]

### Added

- 管理页面最小版（React 18 + Vite 5 + TS，无 UI 框架依赖）：
  - 新建凭据表单：程序名 / 用途 / 角色 / 受众 / 有效期 / 应急标记；
  - 一次性明文展示 + 复制（离开即消失，服务端只留 `sha256`）；
  - 已发放列表：状态（有效 / 已撤销 / 已过期）、到期时间、撤销按钮（二次确认）；
- dev 形态：vite 代理 `/api` 到本地 cred 并注入操作者头（`WIST_OPERATOR`）。
- `401` 提示区分"缺操作者头"与普通错误，指向 dev / 发布态各自的注入点。
- Dockerfile：node 构建 + nginx 静态托管，站点配置由 `wist-cred-stack` 运行期挂载。
