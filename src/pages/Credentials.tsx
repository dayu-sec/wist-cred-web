import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { ApiError, createCredential, redeliverCredential, revokeCredential } from "../api";
import type {
  CreateInput,
  CreatedCredential,
  Credential,
  IssuePolicy,
  OnboardingState,
} from "../api";
import { t } from "../i18n";
import { copyText, describe, formatTime, formatVersion, humanDuration } from "../ui";

interface FormState {
  purpose: string;
  audience: string;
  /** `null` = 用上限（页面上叫“永久”）。 */
  ttlSeconds: number | null;
  breakGlass: boolean;
  /** 从认证系统登记的列表里选中的角色；不在这张表里的角色发不出去。 */
  picked: string[];
}

/** 角色色系：已知角色固定配色（admin 紫、read 蓝、write 绿、调查 琥珀），
 *  其余按名字散列到同一组色板 —— 同一角色在任何系统、任何刷新里都是同一个颜色。
 *  色板刻意避开红/玫红：那是「已撤销 / 出错」的语义色，不该拿来标权限。 */
const ROLE_COLORS: Record<string, number> = {
  admin: 1,
  read: 0,
  write: 3,
  "investigation:run": 2,
};

function roleTone(role: string): number {
  const known = ROLE_COLORS[role];
  if (known !== undefined) return known;
  let hash = 0;
  for (const ch of role) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return hash % 6;
}

/** 常见有效期。`null` = 不传，服务端按上限算。 */
const TTL_PRESETS: { label: () => string; seconds: number | null }[] = [
  { label: () => t("10 分钟", "10 min"), seconds: 600 },
  { label: () => t("1 小时", "1 hour"), seconds: 3600 },
  { label: () => t("4 小时", "4 hours"), seconds: 4 * 3600 },
  { label: () => t("1 天", "1 day"), seconds: 86400 },
  { label: () => t("1 周", "1 week"), seconds: 7 * 86400 },
  { label: () => t("1 个月", "1 month"), seconds: 30 * 86400 },
  { label: () => t("3 个月", "3 months"), seconds: 90 * 86400 },
  { label: () => t("1 年", "1 year"), seconds: 365 * 86400 },
  { label: () => t("永久", "Never"), seconds: null },
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
  /** 三个版本号（页面 / 凭据服务 / 部署栈）：放在左栏底部，跟着这一列常驻。 */
  versions: { web: string; cred: string | null; stack: string | null };
  items: Credential[];
  loading: boolean;
  boarding: OnboardingState | null;
  policy: IssuePolicy | null;
  onReload: () => void;
  /** 没有可选的认证系统时，引导去那一页。 */
  onGoSystems: () => void;
}

type CredentialState = "valid" | "expired" | "revoked";

/** 状态判定只有一处：列表徽标与上面的分系统统计都用它，别让两处口径漂开。 */
function stateOf(item: Credential): {
  key: CredentialState;
  label: string;
  className: string;
} {
  if (item.revoked_at !== null)
    return { key: "revoked", label: t("已撤销", "Revoked"), className: "state revoked" };
  if (item.expires_at * 1000 < Date.now())
    return { key: "expired", label: t("已过期", "Expired"), className: "state expired" };
  return { key: "valid", label: t("有效", "Active"), className: "state active" };
}

/**
 * 访问凭证：为**程序**签发、查看、撤销。
 *
 * 「受众」不再手填，只能从「认证系统」里选 —— 凭证的唯一作用就是让某个系统认它，
 * 而能认它的系统必须是已经接入过的。服务端也会校验（`audience_not_configured`）。
 */
export default function Credentials({
  versions,
  items,
  loading,
  boarding,
  policy,
  onReload,
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
  /** 创建成功后把令牌块滚进视野：表单在页面下方，顶部横幅可能正好在屏幕外。 */
  const createdRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!created) return;
    createdRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [created]);
  const [copied, setCopied] = useState(false);
  /** 重推成功的短提示（列表本身不变，不给个反馈像是没点）。 */
  const [notice, setNotice] = useState<string | null>(null);
  /** 签发/撤销失败的错误：留在表单里，**不交给 App** —— 那边刷新成功会把它清掉。 */
  const [formError, setFormError] = useState<string | null>(null);
  /** 令牌块的补充说明（例如"已签发但没送达"）。 */
  const [createdNote, setCreatedNote] = useState<string | null>(null);

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
      setFormError(null);
      setCreatedNote(null);
      setCreated(result);
      setCopied(false);
      setForm((prev) => ({ ...prev, purpose: "" }));
      onReload();
    } catch (err) {
      // 推送失败（`credential_delivery_pending`）：凭据已经落库、**明文只在这一刻存在**，
      // 服务端把 `credential` + `token` 放在错误体里 → 照样把令牌显示出来，
      // 另加一句"没送达、可重推"。否则这条凭据永远没法用。
      if (err instanceof ApiError && err.code === "credential_delivery_pending") {
        const payload = err.payload as { credential?: CreatedCredential } | null;
        if (payload?.credential?.token) {
          setCreated(payload.credential);
          setCreatedNote(
            t(
              "已签发，但 {name} 没有确认收到（推送失败）。令牌仍然有效：在「认证系统」确认它可联通后，点列表里这条的「重推」即可送达。",
              "Issued, but {name} has not accepted it yet (delivery failed). The token is still valid — once it is reachable again, use “Redeliver” on this row.",
              { name: payload.credential.audience },
            ),
          );
          setCopied(false);
          setForm((prev) => ({ ...prev, purpose: "" }));
          setFormError(null);
          onReload();
          return;
        }
      }
      setFormError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(credentialId: string) {
    if (
      !window.confirm(
        t(
          "撤销 {id}？撤销后该 token 立即失效，且不可恢复。",
          "Revoke {id}? The token stops working immediately and this cannot be undone.",
          { id: credentialId },
        ),
      )
    ) {
      return;
    }
    try {
      await revokeCredential(credentialId);
      onReload();
    } catch (err) {
      setFormError(describe(err));
    }
  }

  async function redeliver(credentialId: string) {
    try {
      const result = await redeliverCredential(credentialId);
      setNotice(
        t("已重新投递到 {name}", "Redelivered to {name}", { name: result.audience }),
      );
      onReload();
    } catch (err) {
      setFormError(describe(err));
    }
  }

  async function copy() {
    if (!created) return;
    setCopied(await copyText(created.token));
  }

  // 统计跟着左边选中的系统走：这一页的主轴就是"哪套认证系统"，
  // 换系统时下面的「已发放凭据」跟着换，而不是把所有系统摊在一张表里。
  const selectedItems = useMemo(
    () => items.filter((item) => item.audience === form.audience),
    [items, form.audience],
  );
  /** 列表默认只放最新的几条：过期/撤销的旧记录会把页面拉得很长。 */
  const RECENT_LIMIT = 5;
  const orderedItems = useMemo(
    () => [...selectedItems].sort((a, b) => b.issued_at - a.issued_at),
    [selectedItems],
  );
  const [showAll, setShowAll] = useState(false);
  // 换系统就回到"只看最新"：上一个系统展开过，不该带到下一个。
  useEffect(() => setShowAll(false), [form.audience]);
  const visibleItems = showAll ? orderedItems : orderedItems.slice(0, RECENT_LIMIT);

  const selectedStats = useMemo(() => {
    if (!form.audience) return null;
    const counts = { total: selectedItems.length, valid: 0, expired: 0, revoked: 0 };
    for (const item of selectedItems) counts[stateOf(item).key] += 1;
    return counts;
  }, [selectedItems, form.audience]);

  const hasAudience = audienceOptions.length > 0;
  // 角色只能从认证系统登记过的表里选：一个都没登记就没东西可签。
  const canSubmit = hasAudience && form.picked.length > 0;

  return (
    <>
      {notice && (
        <div className="banner">
          <div className="token-head">
            <strong>{notice}</strong>
            <button type="button" className="ghost" onClick={() => setNotice(null)}>
              {t("知道了", "Got it")}
            </button>
          </div>
        </div>
      )}


      <div className="page-split">
        {/* 这一页的主轴是"哪套认证系统"：左列选它，右边为它签发、也只看它的凭据。 */}
        <nav className="system-nav" aria-label={t("认证系统", "Auth systems")}>
          <h2 className="system-nav-title">{t("认证系统", "Auth systems")}</h2>
          {hasAudience ? (
            <ul className="system-nav-list">
              {audienceOptions.map((audience) => {
                const on = form.audience === audience;
                return (
                  <li key={audience}>
                    <button
                      type="button"
                      className={on ? "system-nav-item active" : "system-nav-item"}
                      aria-current={on ? "true" : undefined}
                      onClick={() => setForm({ ...form, audience })}
                    >
                      <span className="mono">{audience}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted small">{t("还没有认证系统。", "No auth systems yet.")}</p>
          )}
          <div className="system-nav-foot">
            <div className="version" aria-label={t("版本信息", "Version info")}>
              <span className="version-item">
                <span className="version-name">wist-cred-web</span>
                {formatVersion(versions.web)}
              </span>
              <span className="version-item">
                <span className="version-name">wist-cred</span>
                {formatVersion(versions.cred)}
              </span>
              <span className="version-item">
                <span className="version-name">wist-cred-stack</span>
                {formatVersion(versions.stack)}
              </span>
            </div>
          </div>
        </nav>

        <div className="page-split-main">
          <section className="panel">
            <div className="panel-head">
              <h2>{t("新建访问凭证", "New credential")}</h2>
            </div>

            {created && (
              <div className="banner token" ref={createdRef}>
                <div className="token-head">
                  <strong>{t("凭据已创建：{name}", "Credential created for {name}", { name: created.audience })}</strong>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setCreated(null);
                      setCreatedNote(null);
                    }}
                  >
                    {t("知道了", "Got it")}
                  </button>
                </div>
                <p className="warn">
                  {t(
                    "明文只显示这一次，离开本页后服务端只会保留 sha256 摘要，无法再取回。",
                    "The plaintext is shown only once; after you leave this page the server keeps just its sha256 digest.",
                  )}
                </p>
                {createdNote && <p className="warn">{createdNote}</p>}
                <code className="secret">{created.token}</code>
                <div className="token-actions">
                  <button type="button" onClick={() => void copy()}>
                    {copied ? t("已复制", "Copied") : t("复制", "Copy")}
                  </button>
                  <span className="muted">
                    {created.credential_id} · {created.audience} · {t("到期", "expires")}{" "}
                    {formatTime(created.expires_at)}
                  </span>
                </div>
              </div>
            )}

            {formError && <div className="banner error">{formError}</div>}

            {!hasAudience && (
              <p className="warn">
                {t("还没有可选的认证系统，先去", "No auth system to issue for yet — enroll one under")}{' '}
                <button type="button" className="linklike" onClick={onGoSystems}>
                  {t("认证系统", "Auth systems")}
                </button>
                {t(" 接入一个。", " first.")}
              </p>
            )}

            <form onSubmit={(event) => void submit(event)}>
              {/* 角色是这张表单里唯一要"想一下"的选择：给它一块自己的区域，
                  大格 + 色块 + 勾选位，而不是夹在两行小 chip 里。 */}
              <div className="role-field">
                <div className="role-field-body">
                <div className="role-field-roles">
                  <div className="role-field-head">
                    <span className="role-field-title">{t("角色", "Roles")}</span>
                    <span className="role-field-hint">{t("可多选", "multi-select")}</span>
                  </div>
                {peerRoles.length > 0 ? (
                  <div className="role-chips">
                    {peerRoles.map((role) => {
                      const on = form.picked.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          className={`role-chip role-tone-${roleTone(role)}${
                            on ? " active" : ""
                          }`}
                          aria-pressed={on}
                          onClick={() =>
                            setForm({
                              ...form,
                              picked: on
                                ? form.picked.filter((item) => item !== role)
                                : [...form.picked, role],
                            })
                          }
                        >
                          {/* 勾选位固定宽度：选中时出现，但不推挤后面的文字。 */}
                          <span
                            className={on ? "role-check on" : "role-check"}
                            aria-hidden="true"
                          >
                            ✓
                          </span>
                          {role}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="static-field muted">
                    {form.audience ? t("未登记角色", "No roles registered") : t("先选认证系统", "Pick an auth system first")}
                  </div>
                )}
                {peerRoles.length === 0 && (
                  <span className="field-hint">
                    {t("它还没登记自己能验的角色，去", "It has not registered any roles yet — go to")}{' '}
                    <button type="button" className="linklike" onClick={onGoSystems}>
                      {t("认证系统", "Auth systems")}
                    </button>{' '}
                    {t("用", "and register once with")} <span className="mono">--roles</span>
                  </span>
                )}
                </div>

                {/* 用途跟角色是同一件事的两面："它能干什么" + "拿它干什么"，
                    放进同一块里，读起来就是这次签发的内容。 */}
                <label className="role-field-purpose">
                  <span className="role-field-title">{t("用途", "Purpose")}</span>
                  <input
                    required
                    value={form.purpose}
                    placeholder={t("例如：nightly disk inspection", "e.g. nightly disk inspection")}
                    onChange={(event) => setForm({ ...form, purpose: event.target.value })}
                  />
                </label>
                </div>
              </div>

              {/* 九个固定选项放下拉里是浪费：要选先得点开看一眼。直接摆出来。
                  但它是**单选**，与上面的多选角色必须长得不一样 —— 用连成一条的 segmented
                  控件（一块带分隔的横条），而不是同样一颗颗的圆 chip。 */}
              <div className="field wide">
                <span className="field-label">{t("有效期", "Valid for")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("有效期", "Valid for")}>
                  {TTL_PRESETS.map((preset) => {
                    const selected = form.ttlSeconds === preset.seconds;
                    const overCap =
                      preset.seconds !== null && cap !== null && preset.seconds > cap;
                    return (
                      <button
                        key={preset.label()}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={selected ? "segment active" : "segment"}
                        disabled={overCap}
                        title={overCap ? `超过上限 ${humanDuration(cap!)}` : undefined}
                        onClick={() => {
                          setTouchedTtl(true);
                          setForm({ ...form, ttlSeconds: preset.seconds });
                        }}
                      >
                        {preset.label()}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="form-actions">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.breakGlass}
                    onChange={(event) => setForm({ ...form, breakGlass: event.target.checked })}
                  />
                  {t("应急凭据（上限更长，使用时会告警）", "Break-glass credential (longer cap, warns when used)")}
                </label>
                <button type="submit" disabled={submitting || !canSubmit}>
                  {submitting ? t("创建中…", "Creating…") : t("创建", "Create")}
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>{t("已发放凭据", "Issued credentials")}</h2>
              {selectedStats ? (
                <div className="stat-row">
                  <span className="stat">
                    <b>{selectedStats.total}</b> {t("签发", "issued")}
                  </span>
                  <span className="stat ok">
                    <b>{selectedStats.valid}</b> {t("有效", "active")}
                  </span>
                  <span className="stat">
                    <b>{selectedStats.expired}</b> {t("过期", "expired")}
                  </span>
                  <span className="stat crit">
                    <b>{selectedStats.revoked}</b> {t("已撤销", "revoked")}
                  </span>
                </div>
              ) : null}
            </div>

            {!form.audience ? (
              <p className="muted empty">{t("先在左边选一套认证系统。", "Pick an auth system on the left.")}</p>
            ) : selectedItems.length === 0 ? (
              <p className="muted empty">
                {loading ? t("加载中…", "Loading…") : t("这套系统还没有签发过凭据。", "No credentials issued for this system yet.")}
              </p>
            ) : (
              <table className="issued">
                <thead>
                  <tr>
                    <th>{t("用途", "Purpose")}</th>
                    <th>{t("角色", "Roles")}</th>
                    <th>{t("到期", "Expires")}</th>
                    <th>{t("状态", "Status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const state = stateOf(item);
                    return (
                      <tr
                        key={item.credential_id}
                        className={
                          created?.credential_id === item.credential_id ? "fresh" : undefined
                        }
                      >
                        <td className="subject">
                          <div className="subject-purpose">{item.purpose}</div>
                          <div
                            className="subject-meta muted small mono"
                            title={`${item.owner} · ${item.credential_id}`}
                          >
                            {item.credential_id}
                          </div>
                        </td>
                        <td className="mono small roles">{item.roles.join(", ") || "—"}</td>
                        <td className="mono small when">{formatTime(item.expires_at)}</td>
                        <td className="state-cell">
                          <span className={state.className}>{state.label}</span>
                        </td>
                        <td className="right">
                          <div className="row-actions">
                            {pushableAudiences.has(item.audience) && (
                              <button
                                type="button"
                                className="ghost"
                                disabled={item.revoked_at !== null}
                                title={t(
                                  "把同一摘要再推给这个认证系统（推送失败后补）",
                                  "Push the same digest to this auth system again (after a failed delivery)",
                                )}
                                onClick={() => void redeliver(item.credential_id)}
                              >
                                {t("重推", "Redeliver")}
                              </button>
                            )}
                            <button
                              type="button"
                              className="danger"
                              disabled={item.revoked_at !== null}
                              onClick={() => void revoke(item.credential_id)}
                            >
                              {t("撤销", "Revoke")}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {selectedItems.length > RECENT_LIMIT && (
              <p className="list-more">
                <button
                  type="button"
                  className="linklike"
                  onClick={() => setShowAll((prev) => !prev)}
                >
                  {showAll
                    ? t("只看最新 {n} 条", "Show latest {n} only", { n: RECENT_LIMIT })
                    : t("显示全部 {n} 条", "Show all {n}", { n: selectedItems.length })}
                </button>
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
