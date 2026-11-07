import { useCallback, useEffect, useState } from "react";

import { ApiError, getPolicy, getServiceVersion, listCredentials, listOnboardingPeers } from "./api";
import type { Credential, IssuePolicy, OnboardingState, ServiceVersion } from "./api";
import { AUTH_CHANGED_EVENT, clearPassword, getPassword } from "./auth";
import { BrandMark } from "./BrandMark";
import Credentials from "./pages/Credentials";
import Systems from "./pages/Systems";
import { setAppLocale, t, useLocale } from "./i18n";
import Login from "./Login";
import { describe } from "./ui";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "";

/** 两个页面。用 hash 路由，刷新和分享都能落回同一页（不引 react-router）。 */
type Tab = "credentials" | "systems";

const TABS: { key: Tab; label: () => string; hash: string }[] = [
  { key: "credentials", label: () => t("访问凭证", "Credentials"), hash: "#/credentials" },
  { key: "systems", label: () => t("认证系统", "Systems"), hash: "#/systems" },
];

function tabFromHash(): Tab {
  return window.location.hash === TABS[1].hash ? "systems" : "credentials";
}

export default function App() {
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>(tabFromHash);

  // 登录态：口令是本标签页里的（见 auth.ts）；`locked` = 服务端说“需要口令”。
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
      if (!getPassword()) setLocked(true);
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
          <BrandMark size={26} />
          <h1>WistCred</h1>
        </div>
        <div className="topbar-right">
          {/* 语言开关：标签写**点下去会切到的那种语言**（中文界面显示 EN，英文界面显示 中文）。 */}
          <button
            type="button"
            className="locale-toggle"
            onClick={() => setAppLocale(locale === "zh" ? "en" : "zh")}
            title={locale === "zh" ? "Switch to English" : "切换到中文"}
            aria-label={t("切换界面语言", "Switch interface language")}
          >
            {locale === "zh" ? "EN" : "中文"}
          </button>
          {/* 一直显示：即使这个部署没配口令（页面直接可用），"退出"也是人找得到的出口
              —— 点了就回登录框，把本地口令清掉。图标按钮，给 title / aria-label 兜底。 */}
          <button
            type="button"
            className="icon-button"
            onClick={logout}
            title={t("退出", "Sign out")}
            aria-label={t("退出", "Sign out")}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
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
            {item.label()}
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
          versions={{
            web: VERSION,
            cred: serviceVersion?.version ?? null,
            stack: serviceVersion?.stackVersion ?? null,
          }}
          items={items}
          loading={loading}
          boarding={boarding}
          policy={policy}
          onReload={() => void reload()}
          onGoSystems={() => go("systems")}
        />
      )}
    </div>
  );
}
