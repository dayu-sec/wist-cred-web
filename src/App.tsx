import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  createCredential,
  listCredentials,
  revokeCredential,
  type CreateInput,
  type CreatedCredential,
  type Credential,
} from "./api";

const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

interface FormState {
  subject: string;
  purpose: string;
  roles: string;
  audience: string;
  ttl: string;
  breakGlass: boolean;
}

const EMPTY_FORM: FormState = {
  subject: "",
  purpose: "",
  roles: "investigation:run",
  audience: "wist-center",
  ttl: "",
  breakGlass: false,
};

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `未认证（${error.code}）：dev 下由 vite 代理注入操作者头，发布态由入口 nginx 注入。`;
    }
    return `${error.code}：${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString("zh-CN", { hour12: false });
}

function stateOf(item: Credential): { label: string; className: string } {
  if (item.revoked_at !== null) return { label: "已撤销", className: "state revoked" };
  if (item.expires_at * 1000 < Date.now()) return { label: "已过期", className: "state expired" };
  return { label: "有效", className: "state active" };
}

export default function App() {
  const [items, setItems] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedCredential | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateInput = {
        subject: form.subject.trim(),
        purpose: form.purpose.trim(),
        roles: form.roles
          .split(",")
          .map((role) => role.trim())
          .filter(Boolean),
        audience: form.audience.trim(),
        break_glass: form.breakGlass,
      };
      const ttl = Number.parseInt(form.ttl, 10);
      if (Number.isFinite(ttl) && ttl > 0) {
        input.ttl_seconds = ttl;
      }
      const result = await createCredential(input);
      setCreated(result);
      setCopied(false);
      setForm({ ...EMPTY_FORM, audience: form.audience });
      await reload();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(credentialId: string) {
    if (!window.confirm(`撤销 ${credentialId}？撤销后该 token 立即失效，且不可恢复。`)) {
      return;
    }
    try {
      await revokeCredential(credentialId);
      await reload();
    } catch (err) {
      setError(describe(err));
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>WistCred</h1>
          <p className="subtitle">为程序签发、查看与撤销访问凭据</p>
        </div>
        <div className="topbar-right">
          <span className="version">v{VERSION}</span>
          <button type="button" className="ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? "刷新中…" : "刷新"}
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      {created && (
        <div className="banner token">
          <div className="token-head">
            <strong>凭据已创建：{created.subject}</strong>
            <button type="button" className="ghost" onClick={() => setCreated(null)}>
              知道了
            </button>
          </div>
          <p className="warn">
            明文只显示这一次，离开本页后服务端只会保留 sha256 摘要，无法再取回。
          </p>
          <code className="secret">{created.token}</code>
          <div className="token-actions">
            <button type="button" onClick={() => void copy()}>
              {copied ? "已复制" : "复制"}
            </button>
            <span className="muted">
              {created.credential_id} · {created.audience} · 到期 {formatTime(created.expires_at)}
            </span>
          </div>
        </div>
      )}

      <section className="panel">
        <h2>新建凭据</h2>
        <form onSubmit={(event) => void submit(event)}>
          <div className="grid">
            <label>
              程序名
              <input
                required
                value={form.subject}
                placeholder="ci-nightly"
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
              />
            </label>
            <label>
              受众
              <input
                required
                value={form.audience}
                placeholder="wist-center"
                onChange={(event) => setForm({ ...form, audience: event.target.value })}
              />
            </label>
            <label>
              角色（逗号分隔）
              <input
                required
                value={form.roles}
                placeholder="investigation:run,read"
                onChange={(event) => setForm({ ...form, roles: event.target.value })}
              />
            </label>
            <label>
              有效期（秒，可选）
              <input
                value={form.ttl}
                inputMode="numeric"
                placeholder="默认取上限"
                onChange={(event) => setForm({ ...form, ttl: event.target.value })}
              />
            </label>
          </div>
          <label className="wide">
            用途（进审计）
            <input
              required
              value={form.purpose}
              placeholder="nightly disk inspection"
              onChange={(event) => setForm({ ...form, purpose: event.target.value })}
            />
          </label>
          <div className="form-actions">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.breakGlass}
                onChange={(event) => setForm({ ...form, breakGlass: event.target.checked })}
              />
              应急凭据（上限更长，使用时会告警）
            </label>
            <button type="submit" disabled={submitting}>
              {submitting ? "创建中…" : "创建"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>已发放凭据</h2>
          <span className="muted">{items.length} 条</span>
        </div>
        {items.length === 0 ? (
          <p className="muted empty">{loading ? "加载中…" : "还没有凭据。"}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>程序</th>
                <th>申请人</th>
                <th>受众</th>
                <th>角色</th>
                <th>到期</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const state = stateOf(item);
                return (
                  <tr key={item.credential_id}>
                    <td>
                      <div className="mono">{item.subject}</div>
                      <div className="muted small">{item.purpose}</div>
                    </td>
                    <td className="mono">{item.owner}</td>
                    <td className="mono">{item.audience}</td>
                    <td className="mono small">{item.roles.join(", ") || "—"}</td>
                    <td className="mono small">{formatTime(item.expires_at)}</td>
                    <td>
                      <span className={state.className}>{state.label}</span>
                    </td>
                    <td className="right">
                      <button
                        type="button"
                        className="danger"
                        disabled={item.revoked_at !== null}
                        onClick={() => void revoke(item.credential_id)}
                      >
                        撤销
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <footer className="footer">
        凭据明文从不落盘；服务端只保留 sha256 摘要。
      </footer>
    </div>
  );
}
