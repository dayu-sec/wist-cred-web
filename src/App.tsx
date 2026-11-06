import { useCallback, useEffect, useState } from "react";

import { ApiError, getPolicy, getServiceVersion, listCredentials, listOnboardingPeers } from "./api";
import type { Credential, IssuePolicy, OnboardingState, ServiceVersion } from "./api";
import { AUTH_CHANGED_EVENT, clearPassword, getPassword } from "./auth";
import { BrandMark } from "./BrandMark";
import Credentials from "./pages/Credentials";
import Systems from "./pages/Systems";
import Login from "./Login";
import { describe } from "./ui";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "";

/** 版本号统一成 `vX.Y.Z`：构建期注入的是发布 tag（自带 `v`），服务端返回纯 semver。
 *  已带 `v` 就原样、否则补一个 —— 免得拼出 `vv0.4.0-alpha`（这一处曾经就是）。 */
function formatVersion(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "—";
  return value.startsWith("v") ? value : `v${value}`;
}

/** 两个页面。用 hash 路由，刷新和分享都能落回同一页（不引 react-router）。 */
type Tab = "credentials" | "systems";

const TABS: { key: Tab; label: string; hash: string }[] = [
  { key: "credentials", label: "访问凭证", hash: "#/credentials" },
  { key: "systems", label: "认证系统", hash: "#/systems" },
];

function tabFromHash(): Tab {
  return window.location.hash === TABS[1].hash ? "systems" : "credentials";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);

  // 登录态：口令是本标签页里的（见 auth.ts）；`locked` = 服务端说“需要口令”。
  const [hasPassword, setHasPassword] = useState(() => Boolean(getPassword()));
  const [locked, setLocked] = useState(false);

  const [items, setItems] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [boarding, setBoarding] = useState<OnboardingState | null>(null);
  const [boardingError, setBoardingError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<IssuePolicy | null>(null);
  // 服务端版本（wist-cred / wist-cred-stack）：公开端点，拿不到就是 null（显示 `—`）。
  const [serviceVersion, setServiceVersion] = useState<ServiceVersion | null>(null);

  /** 401 = 缺口令 / 口令不对：不是“页面出错”，而是该回登录框。 */
  const needsLogin = (err: unknown) => err instanceof ApiError && err.status === 401;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listCredentials());
      setError(null);
    } catch (err) {
      if (needsLogin(err)) {
        setLocked(true);
        setError(null);
      } else {
        setError(describe(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadBoarding = useCallback(async () => {
    try {
      setBoarding(await listOnboardingPeers());
      setBoardingError(null);
    } catch (err) {
      if (needsLogin(err)) {
        setLocked(true);
        setBoardingError(null);
      } else {
        setBoardingError(describe(err));
      }
    }
  }, []);

  const reloadPolicy = useCallback(async () => {
    try {
      setPolicy(await getPolicy());
    } catch {
      // 拿不到上限也能用：页面上会退回“按服务端上限”，不影响签发。
      setPolicy(null);
    }
  }, []);

  const reloadVersion = useCallback(async () => {
    try {
      setServiceVersion(await getServiceVersion());
    } catch {
      // 旧 cred 没有这条路由（404）：保留 null，页面显示 `—`，不影响别的功能。
      setServiceVersion(null);
    }
  }, []);

  useEffect(() => {
    void reload();
    void reloadBoarding();
    void reloadPolicy();
    void reloadVersion();
  }, [reload, reloadBoarding, reloadPolicy, reloadVersion]);

  // 心跳状态是会变的：页面开着的时候轻量轮询一下，不然只能靠手动刷新。
  // 没登录时不轮询：否则每 10s 一次 401，把“没口令”刷成噪音。
  useEffect(() => {
    if (locked) return;
    const timer = window.setInterval(() => void reloadBoarding(), 10_000);
    return () => window.clearInterval(timer);
  }, [reloadBoarding, locked]);

  // 口令被清掉（点退出 / 服务端说不对）→ 回登录框。
  useEffect(() => {
    const onAuthChanged = () => {
      const next = Boolean(getPassword());
      setHasPassword(next);
      if (!next) setLocked(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuthChanged);
  }, []);

  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function go(next: Tab) {
    const target = TABS.find((item) => item.key === next) ?? TABS[0];
    window.location.hash = target.hash;
    setTab(next);
  }

  async function refresh() {
    await Promise.all([reload(), reloadBoarding(), reloadPolicy(), reloadVersion()]);
  }

  function logout() {
    clearPassword();
    setLocked(true);
    setItems([]);
    setBoarding(null);
    setError(null);
    setBoardingError(null);
  }

  // 登录后回到页面：先解锁，再把三份数据拉一遍。
  function onLoggedIn() {
    setLocked(false);
    void refresh();
  }

  if (locked) {
    return <Login onDone={onLoggedIn} />;
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={34} />
          <div>
            <h1>WistCred</h1>
            <p className="subtitle">认证系统接入 · 程序访问凭证签发与撤销</p>
          </div>
        </div>
        <div className="topbar-right">
          <span className="version" aria-label="版本信息">
            <span className="version-item">
              <span className="version-name">wist-cred-web</span>
              {formatVersion(VERSION)}
            </span>
            <span className="version-item">
              <span className="version-name">wist-cred</span>
              {formatVersion(serviceVersion?.version)}
            </span>
            <span className="version-item">
              <span className="version-name">wist-cred-stack</span>
              {formatVersion(serviceVersion?.stackVersion)}
            </span>
          </span>
          <button
            type="button"
            className="ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
          {hasPassword ? (
            <button type="button" className="ghost" onClick={logout}>
              退出
            </button>
          ) : null}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={item.key === tab ? "tab active" : "tab"}
            onClick={() => go(item.key)}
          >
            {item.label}
            {item.key === "systems" && boarding ? (
              <span className="badge">{boarding.peers.length}</span>
            ) : null}
            {item.key === "credentials" && !loading ? (
              <span className="badge">{items.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      {error && <div className="banner error">{error}</div>}

      {tab === "systems" ? (
        <Systems
          boarding={boarding}
          error={boardingError}
          credentials={items}
          onReload={() => void reloadBoarding()}
          onGoCredentials={() => go("credentials")}
        />
      ) : (
        <Credentials
          items={items}
          loading={loading}
          boarding={boarding}
          policy={policy}
          onReload={() => void reload()}
          onError={setError}
          onGoSystems={() => go("systems")}
        />
      )}

      <footer className="footer">
        凭据明文从不落盘；服务端只保留 sha256 摘要。认证系统的私钥只在它自己的机器上。
      </footer>
    </div>
  );
}
