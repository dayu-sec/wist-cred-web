import { useCallback, useEffect, useState } from "react";

import { listCredentials, listOnboardingPeers, getPolicy } from "./api";
import type { Credential, IssuePolicy, OnboardingState } from "./api";
import Credentials from "./pages/Credentials";
import Systems from "./pages/Systems";
import { describe } from "./ui";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

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

  const [items, setItems] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [boarding, setBoarding] = useState<OnboardingState | null>(null);
  const [boardingError, setBoardingError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<IssuePolicy | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listCredentials());
      setError(null);
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadBoarding = useCallback(async () => {
    try {
      setBoarding(await listOnboardingPeers());
      setBoardingError(null);
    } catch (err) {
      setBoardingError(describe(err));
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

  useEffect(() => {
    void reload();
    void reloadBoarding();
    void reloadPolicy();
  }, [reload, reloadBoarding, reloadPolicy]);

  // 心跳状态是会变的：页面开着的时候轻量轮询一下，不然只能靠手动刷新。
  useEffect(() => {
    const timer = window.setInterval(() => void reloadBoarding(), 10_000);
    return () => window.clearInterval(timer);
  }, [reloadBoarding]);

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
    await Promise.all([reload(), reloadBoarding(), reloadPolicy()]);
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>WistCred</h1>
          <p className="subtitle">认证系统接入 · 程序访问凭证签发与撤销</p>
        </div>
        <div className="topbar-right">
          <span className="version">v{VERSION}</span>
          <button
            type="button"
            className="ghost"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
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
