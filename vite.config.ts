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

// dev server 把 /api 代理到本地 cred，并**注入操作者头**。
//
// 为什么注入放在 dev server：开发态的 cred 跑在 `mode = "ingress"`（不想每次开发都输口令）。
// 浏览器不能自己带 `x-wist-operator`（那是身份，不是页面能决定的东西），所以由代理写。
// **发布态不是这么干的**：`mode = "token"` —— 页面里有登录框，口令由 cred 自己验，
// 这一层不碰身份。
const target = process.env.WIST_CRED_TARGET ?? "http://127.0.0.1:18443";
const operator = process.env.WIST_OPERATOR ?? "dev";

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
        headers: { "x-wist-operator": operator },
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
