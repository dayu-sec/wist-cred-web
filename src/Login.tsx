import { useEffect, useRef, useState, type FormEvent } from "react";

import { getPolicy } from "./api";
import { setPassword } from "./auth";
import { describe } from "./ui";

/**
 * 登录门：`wist-cred` 的页面口令。
 *
 * 为什么要有它：人机面（页面）的验证属于**产品自己**，不是入口反代的浏览器原生弹窗 ——
 * 那个没有登录框、没有登出、改不了提示。这里输的口令存在本标签页（`auth.ts`），
 * 请求带 `Authorization: Bearer`，由 `wist-cred` 的 `server.mode = "token"` 验。
 *
 * 只在前端收到 401 时出现：`mode = "ingress"`（开发态 / 已由入口认证）下请求本来就通，
 * 这时不该先要求输口令。
 */
export default function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = value.trim();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    // 先存再验：`request` 会把口令带在头上，错了它会就地清掉并抛 401。
    setPassword(password);
    try {
      // 最轻的一次人机面请求：能通就说明口令对（比专门加一个 /login 端点更实在）。
      await getPolicy();
      setValue(""); // 不把口令留在输入框里
      onDone();
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={(event) => void submit(event)}>
        <h1>WistCred</h1>
        <p className="subtitle">输入访问口令，管理程序访问凭证</p>

        <label className="login-label" htmlFor="cred-password">
          访问口令
        </label>
        <input
          id="cred-password"
          ref={inputRef}
          className="login-input"
          type="password"
          autoComplete="current-password"
          spellCheck={false}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="部署方设置的页面口令"
        />

        {error ? <div className="banner error">{error}</div> : null}

        <button type="submit" className="primary login-submit" disabled={busy || !value.trim()}>
          {busy ? "验证中…" : "进入"}
        </button>

        <p className="login-hint">
          口令只存在本标签页，关掉即失效。它不是发给程序用的 token —— 那是另一把（由页面签发）。
        </p>
      </form>
    </div>
  );
}
