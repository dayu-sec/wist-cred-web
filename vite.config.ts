import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 页面版本（`import.meta.env.VITE_APP_VERSION`）在运行态由 Docker 构建注入
// （`--build-arg APP_VERSION=<发布 tag>`）。dev / 本地 `npm run build` 没有它，
// 用仓库根 `version.txt` 补上 —— 否则右上角那一行会显示 `—`，看不出自己在跑哪版。
if (!process.env.VITE_APP_VERSION) {
  try {
    process.env.VITE_APP_VERSION =
      readFileSync(resolve(process.cwd(), "version.txt"), "utf8").trim() || "";
  } catch {
    // 没有 version.txt 就留空：页面显示 `—`，不编版本号。
  }
}

// dev server 把 /api 代理到本地 cred，并在**请求没带口令时**补一把 dev 口令。
//
// 为什么：开发态的 cred 用 `mode = "token"`（曾经有一个 `mode = "ingress"`，身份由反代注入
// `x-wist-operator`，2026-11 已删除 —— 那等于信任一个客户端可伪造的头）。为了“打开就能用”，
// 代理补上栈里 `dev/svc.sh` 生成的同一把 `WIST_CRED_DEV_PASSWORD`。
//
// 只在页面自己**没带** `Authorization` 时才补：带了就以页面为准，这样登录框、错口令、401
// 这些路径在 dev 里仍是真的，而不是被代理一口吃掉。
// **发布态不注入任何东西**：口令由页面自己输，这一层不碰身份。
const target = process.env.WIST_CRED_TARGET ?? "http://127.0.0.1:18443";
const devPassword = process.env.WIST_CRED_DEV_PASSWORD ?? "dev-only-password";

export default defineConfig({
  plugins: [react()],
  server: {
    // 显式绑 IPv4：默认只绑 localhost（macOS 上常解析到 ::1），
    // 导致 curl/浏览器用 127.0.0.1 连不上。
    host: "127.0.0.1",
    port: Number(process.env.WIST_CRED_WEB_PORT ?? 5174),
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        // 页面没带口令时才补：带了就让 cred 真的去验，别让 dev 把认证路径吃掉。
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (!req.headers.authorization) {
              proxyReq.setHeader("authorization", `Bearer ${devPassword}`);
            }
          });
        },
      },
      // 一次性接入券（join.sh / certificate）。dev 下必须一起代理，
      // 否则页面生成的 curl 地址在 5174 上会 404。
      // （发布态由入口 nginx 单独一条 location 接手；那条面本来就不需要口令 ——
      //  拿它的是机器，靠 URL 里的一次性券授权。）
      "/enroll": {
        target,
        changeOrigin: true,
      },
    },
  },
});
