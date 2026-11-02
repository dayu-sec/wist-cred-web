import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, createCredential, redeliverCredential, revokeCredential } from "../api";
import type {
  CreateInput,
  CreatedCredential,
  Credential,
  IssuePolicy,
  OnboardingState,
} from "../api";
import { copyText, describe, formatTime, humanDuration } from "../ui";

interface FormState {
  purpose: string;
  audience: string;
  /** `null` = 用上限（页面上叫“永久”）。 */
  ttlSeconds: number | null;
  breakGlass: boolean;
  /** 从认证系统登记的列表里选中的角色；不在这张表里的角色发不出去。 */
  picked: string[];
}

/** 常见有效期。`null` = 不传，服务端按上限算。 */
const TTL_PRESETS: { label: string; seconds: number | null }[] = [
  { label: "10 分钟", seconds: 600 },
  { label: "1 小时", seconds: 3600 },
  { label: "4 小时", seconds: 4 * 3600 },
  { label: "1 天", seconds: 86400 },
  { label: "1 周", seconds: 7 * 86400 },
  { label: "1 个月", seconds: 30 * 86400 },
  { label: "3 个月", seconds: 90 * 86400 },
  { label: "1 年", seconds: 365 * 86400 },
  { label: "永久", seconds: null },
];

/** 在给定上限内，最大的那个预设（用作默认选中）。 */
function largestWithin(cap: number): number | null {
  let best: number | null = null;
  for (const preset of TTL_PRESETS) {
    if (preset.seconds === null) continue;
    if (preset.seconds <= cap && (best === null || preset.seconds > best)) {
      best = preset.seconds;
    }
  }
  return best;
}

interface Props {
  items: Credential[];
  loading: boolean;
  boarding: OnboardingState | null;
  policy: IssuePolicy | null;
  onReload: () => void;
  onError: (message: string) => void;
  /** 没有可选的认证系统时，引导去那一页。 */
  onGoSystems: () => void;
}

function stateOf(item: Credential): { label: string; className: string } {
  if (item.revoked_at !== null) return { label: "已撤销", className: "state revoked" };
  if (item.expires_at * 1000 < Date.now()) return { label: "已过期", className: "state expired" };
  return { label: "有效", className: "state active" };
}

/**
 * 访问凭证：为**程序**签发、查看、撤销。
 *
 * 「受众」不再手填，只能从「认证系统」里选 —— 凭证的唯一作用就是让某个系统认它，
 * 而能认它的系统必须是已经接入过的。服务端也会校验（`audience_not_configured`）。
 */
export default function Credentials({
  items,
  loading,
  boarding,
  policy,
  onReload,
  onError,
  onGoSystems,
}: Props) {
  const audienceOptions = boarding?.peers.map((peer) => peer.name) ?? [];
  // peers 是异步来的：用到它的值做依赖要在 effect 里重复推导（数组引用每次都变）。
  const audienceKey = audienceOptions.join("|");

  const [form, setForm] = useState<FormState>({
    purpose: "",
    audience: "",
    ttlSeconds: null,
    breakGlass: false,
    picked: [],
  });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedCredential | null>(null);
  const [copied, setCopied] = useState(false);
  /** 重推成功的短提示（列表本身不变，不给个反馈像是没点）。 */
  const [notice, setNotice] = useState<string | null>(null);

  // 只有配了收数地址的认证系统才“推得动”；其余是手工分发，不该出现重推按钮。
  const pushableAudiences = new Set(
    (boarding?.peers ?? [])
      .filter((peer) => peer.endpoint !== null)
      .map((peer) => peer.name),
  );

  // 角色**由认证系统上报**：发凭证时只能从它给的列表里选。
  const currentPeer = boarding?.peers.find((peer) => peer.name === form.audience) ?? null;
  const peerRoles = currentPeer?.roles ?? [];
  const peerRolesKey = peerRoles.join("|");

  // 上限跟着“应急”变：普通 30d / 应急 90d（具体值来自服务端）。
  const cap = policy
    ? form.breakGlass
      ? policy.break_glass_max_ttl_seconds
      : policy.max_ttl_seconds
    : null;

  // 受众必须始终是「当前可选里的一项」：首帧为空、或选中的系统被移除，都要归位。
  useEffect(() => {
    const options = audienceKey ? audienceKey.split("|") : [];
    if (options.length === 0) return;
    setForm((prev) =>
      options.includes(prev.audience) ? prev : { ...prev, audience: options[0] },
    );
  }, [audienceKey]);

  // 首次拿到上限时，默认选“上限以内的最长一项”（而不是空）。
  const [touchedTtl, setTouchedTtl] = useState(false);
  useEffect(() => {
    if (policy === null || touchedTtl) return;
    setForm((prev) => ({ ...prev, ttlSeconds: largestWithin(cap ?? 0) }));
  }, [policy, cap, touchedTtl]);

  // 切到“普通”后，之前选的超限项要退回到上限内。
  useEffect(() => {
    if (cap === null) return;
    setForm((prev) =>
      prev.ttlSeconds !== null && prev.ttlSeconds > cap
        ? { ...prev, ttlSeconds: largestWithin(cap) }
        : prev,
    );
  }, [cap]);

  // 实际到期时间：选了多久就多久，但不会真的超过上限。
  const effectiveSeconds =
    cap === null ? form.ttlSeconds : Math.min(form.ttlSeconds ?? cap, cap);

  // 切系统后，之前选的角色可能不在新系统登记的范围里 —— 退回首项；
  // 新系统一个角色都没登记，就把选择清空（它没法验任何东西）。
  useEffect(() => {
    const roles = peerRolesKey ? peerRolesKey.split("|") : [];
    setForm((prev) => {
      if (roles.length === 0) {
        return prev.picked.length === 0 ? prev : { ...prev, picked: [] };
      }
      const kept = prev.picked.filter((role) => roles.includes(role));
      return kept.length > 0 ? { ...prev, picked: kept } : { ...prev, picked: [roles[0]] };
    });
  }, [peerRolesKey]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const input: CreateInput = {
        purpose: form.purpose.trim(),
        roles: form.picked,
        audience: form.audience,
        break_glass: form.breakGlass,
      };
      if (form.ttlSeconds !== null) {
        input.ttl_seconds = form.ttlSeconds;
      }
      const result = await createCredential(input);
      setCreated(result);
      setCopied(false);
      setForm((prev) => ({ ...prev, purpose: "" }));
      onReload();
    } catch (err) {
      // 推送失败（`credential_delivery_pending`）时凭据**已经落库**了：刷新一次，
      // 否则人只会看到一个错误横幅，列表里那条“没交付”的记录要等下次手动刷新才出现。
      if (err instanceof ApiError && err.code === "credential_delivery_pending") {
        onReload();
      }
      onError(describe(err));
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
      onReload();
    } catch (err) {
      onError(describe(err));
    }
  }

  async function redeliver(credentialId: string) {
    try {
      const result = await redeliverCredential(credentialId);
      setNotice(`已重新投递到 ${result.audience}`);
      onReload();
    } catch (err) {
      onError(describe(err));
    }
  }

  async function copy() {
    if (!created) return;
    setCopied(await copyText(created.token));
  }

  const hasAudience = audienceOptions.length > 0;
  // 角色只能从认证系统登记过的表里选：一个都没登记就没东西可签。
  const canSubmit = hasAudience && form.picked.length > 0;
  // 只有一个系统时没必要让人选：受众直接定死，表单只剩一个需要想的字段。
  const singleAudience = audienceOptions.length === 1 ? audienceOptions[0] : null;

  return (
    <>
      {notice && (
        <div className="banner">
          <div className="token-head">
            <strong>{notice}</strong>
            <button type="button" className="ghost" onClick={() => setNotice(null)}>
              知道了
            </button>
          </div>
        </div>
      )}

      {created && (
        <div className="banner token">
          <div className="token-head">
            <strong>凭据已创建：{created.audience}</strong>
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
        <div className="panel-head">
          <div>
            <h2>新建访问凭证</h2>
            <p className="muted small">一把钥匙只在一个认证系统里有效。</p>
          </div>
        </div>

        {!hasAudience && (
          <p className="warn">
            还没有可选的认证系统，先去{' '}
            <button type="button" className="linklike" onClick={onGoSystems}>
              认证系统
            </button>{' '}
            接入一个。
          </p>
        )}

        <form onSubmit={(event) => void submit(event)}>
          <div className="grid">
            <label>
              认证系统
              {singleAudience ? (
                <div className="static-field mono">{singleAudience}</div>
              ) : (
                <select
                  required
                  value={form.audience}
                  disabled={!hasAudience}
                  onChange={(event) => setForm({ ...form, audience: event.target.value })}
                >
                  {!hasAudience && <option value="">（先去接入一个系统）</option>}
                  {audienceOptions.map((audience) => (
                    <option key={audience} value={audience}>
                      {audience}
                    </option>
                  ))}
                </select>
              )}
              <span className="field-hint">这把钥匙只在这个系统里有效</span>
            </label>
            <label>
              角色
              {peerRoles.length > 0 ? (
                <div className="chips">
                  {peerRoles.map((role) => {
                    const on = form.picked.includes(role);
                    return (
                      <button
                        key={role}
                        type="button"
                        className={on ? "chip active" : "chip"}
                        onClick={() =>
                          setForm({
                            ...form,
                            picked: on
                              ? form.picked.filter((item) => item !== role)
                              : [...form.picked, role],
                          })
                        }
                      >
                        {role}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="static-field muted">
                  {form.audience ? "未登记角色" : "先选认证系统"}
                </div>
              )}
              <span className="field-hint">
                {peerRoles.length > 0 ? (
                  `由 ${form.audience} 登记，只能从里面选（可多选）`
                ) : (
                  <>
                    它还没登记自己能验的角色，去{' '}
                    <button type="button" className="linklike" onClick={onGoSystems}>
                      认证系统
                    </button>{' '}
                    用 <span className="mono">--roles</span> 登记一次
                  </>
                )}
              </span>
            </label>
          </div>

          {/* 九个固定选项放下拉里是浪费：要选先得点开看一眼。直接摆出来。 */}
          <div className="field wide">
            <span className="field-label">有效期</span>
            <div className="chips">
              {TTL_PRESETS.map((preset) => {
                const selected = form.ttlSeconds === preset.seconds;
                const overCap =
                  preset.seconds !== null && cap !== null && preset.seconds > cap;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    className={selected ? "chip active" : "chip"}
                    disabled={overCap}
                    title={overCap ? `超过上限 ${humanDuration(cap!)}` : undefined}
                    onClick={() => {
                      setTouchedTtl(true);
                      setForm({ ...form, ttlSeconds: preset.seconds });
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <span className="field-hint">
              {effectiveSeconds === null
                ? "按服务端上限"
                : `到期 ${formatTime(Math.floor(Date.now() / 1000) + effectiveSeconds)}`}
              {cap !== null && ` · 上限 ${humanDuration(cap)}（勾“应急”可放宽）`}
            </span>
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
            <button type="submit" disabled={submitting || !canSubmit}>
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
                <th>认证系统</th>
                <th>用途</th>
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
                      <div className="mono">{item.audience}</div>
                      <div className="muted small mono">
                        {item.owner} · {item.credential_id}
                      </div>
                    </td>
                    <td className="small">{item.purpose}</td>
                    <td className="mono small">{item.roles.join(", ") || "—"}</td>
                    <td className="mono small">{formatTime(item.expires_at)}</td>
                    <td>
                      <span className={state.className}>{state.label}</span>
                    </td>
                    <td className="right">
                      <div className="row-actions">
                        {pushableAudiences.has(item.audience) && (
                          <button
                            type="button"
                            className="ghost"
                            disabled={item.revoked_at !== null}
                            title="把同一摘要再推给这个认证系统（推送失败后补）"
                            onClick={() => void redeliver(item.credential_id)}
                          >
                            重推
                          </button>
                        )}
                        <button
                          type="button"
                          className="danger"
                          disabled={item.revoked_at !== null}
                          onClick={() => void revoke(item.credential_id)}
                        >
                          撤销
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
