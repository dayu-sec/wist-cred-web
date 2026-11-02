import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev server 把 /api 代理到本地 cred，并**注入操作者头**。
//
// 为什么注入放在 dev server：浏览器不能自己带 `x-wist-operator`（那是身份，
// 不是页面能决定的东西）。发布态由入口 nginx 做完 basic auth 后注入，
// 浏览器始终不碰这个头 —— 这里只是 dev 的等价物。
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
    },
  },
});
