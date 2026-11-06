import { useState } from "react";
import type { FormEvent } from "react";

import { createPeer, deletePeer, mintOnboardingLink, setPeerEndpoint } from "../api";
import type { Credential, OnboardingLink, OnboardingPeer, OnboardingState } from "../api";
import { ConfirmDialog } from "../ConfirmDialog";
import { copyText, describe, ticketFromPath } from "../ui";

interface Props {
  boarding: OnboardingState | null;
  error: string | null;
  /** 已发放凭据：删除确认里要说清"它还有 N 条没吊销"。 */
  credentials: Credential[];
  onReload: () => void;
  /** 去「访问凭证」页（接好之后紧接着要发凭证）。 */
  onGoCredentials: () => void;
}

interface FormState {
  name: string;
}

const EMPTY_FORM: FormState = { name: "" };

function healthOf(peer: OnboardingPeer): { label: string; className: string } {
  // 没有收数地址就不是“未探测”，而是一个**不会自愈的错误**：探针会直接跳过它，
  // 凭据签发了也送不达。所以用红色说出来，不能和“刚建好、等第一次心跳”混在一起。
  if (peer.health === "no_endpoint" || !peer.endpoint) {
    return { label: "缺收数地址", className: "state revoked" };
  }
  if (peer.health === "up") return { label: "可联通", className: "state active" };
  if (peer.health === "down") return { label: "不通", className: "state revoked" };
  return { label: "未探测", className: "state expired" };
}

/**
 * 认证系统：谁可以来校验 cred 签发的凭据。
 *
 * 一个系统 = 注册表里的一条（`state/peers.json`）。名称就是创建凭证时要选的「受众」，
 * 也是签发证书时写进 SAN 的那个名字。
 *
 * 「可联通」是心跳探出来的：cred 用自己的客户端证书按周期去敲 `probe_url`。
 * 只有能握手，推送才有意义 —— 证书过期、链不对、时间偏都会在这里先暴露。
 */
export default function Systems({
  boarding,
  error,
  credentials,
  onReload,
  onGoCredentials,
}: Props) {
  const [link, setLink] = useState<OnboardingLink | null>(null);
  const [minting, setMinting] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "ticket">("");
  const [localError, setLocalError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  /** 正在编辑收数地址的系统名；`""` = 没在编辑。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  /** 待删除的系统（非 null 就弹二次确认框）。 */
  const [pendingDelete, setPendingDelete] = useState<OnboardingPeer | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function mint(peer: string) {
    setMinting(peer);
    setCopied("");
    try {
      setLink(await mintOnboardingLink(peer));
      setLocalError(null);
    } catch (err) {
      setLocalError(describe(err));
    } finally {
      setMinting(null);
    }
  }

  /** 自注册只要这串券 —— 这是新流程的主路径。 */
  async function copyTicket() {
    if (!link) return;
    setCopied((await copyText(linkTicket)) ? "ticket" : "");
  }

  /** 已签发的这个系统在列表里的那条记录。 */
  const linkPeer = link
    ? (boarding?.peers.find((peer) => peer.name === link.peer) ?? null)
    : null;

  /** 要签命令的这个系统**没有收数地址**（被撤销了）：接入会被拒，要提前说。 */
  const linkNeedsAddress = Boolean(link) && linkPeer !== null && !linkPeer.endpoint;

  /** 券：cred 0.7+ 直接给；旧版从 `/enroll/{券}/join.sh` 里取（见 `ticketFromPath`）。 */
  const linkTicket = link ? (link.ticket ?? ticketFromPath(link.path)) : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      // 只发名称：收数地址不再在新建时问（后端一直允许不填）。
      // 自注册（cred-peer 初始化）会带着它自己的地址进来；手工接入的系统建完后
      // 在「已接入」列表里点那一行补地址即可（改完下一轮心跳生效）。
      const created = await createPeer({ name: form.name.trim() });
      setForm(EMPTY_FORM);
      setLocalError(null);
      onReload();
      // 建完直接给接入令牌（券），省一次点击。
      await mint(created.name);
    } catch (err) {
      setLocalError(describe(err));
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(peer: OnboardingPeer) {
    setEditing(peer.name);
    setDraft(peer.endpoint ?? "");
    setLocalError(null);
  }

  async function saveEndpoint(peer: string) {
    setSaving(true);
    try {
      await setPeerEndpoint(peer, draft.trim() || null);
      setEditing(null);
      setLocalError(null);
      onReload();
    } catch (err) {
      setLocalError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deletePeer(pendingDelete.name);
      // 接入面板正开着这个系统：一起收掉，否则会指着一个不存在的系统。
      if (link?.peer === pendingDelete.name) setLink(null);
      if (editing === pendingDelete.name) setEditing(null);
      setPendingDelete(null);
      setLocalError(null);
      onReload();
    } catch (err) {
      setLocalError(describe(err));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const shown = localError ?? error;
  const peers = boarding?.peers ?? [];
  /** 待删除的系统还有几条凭据（确认框里要说清：删除不吊销它们）。 */
  const pendingIssued = pendingDelete
    ? credentials.filter((item) => item.audience === pendingDelete.name).length
    : 0;

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>新建认证系统</h2>
            <p className="muted small">
              一个系统只需要一个名称。收数地址不在这一步问 —— 自注册接入时由对方自己报上来，
              传统接入的在下面列表里补。
            </p>
          </div>
        </div>

        {boarding && !boarding.enabled && (
          <p className="warn">
            本部署缺少签发 CA 或客户端 CA（<span className="mono">[onboarding]</span>），
            新建会失败。先跑一次 <span className="mono">gops sys localize</span>。
          </p>
        )}

        <form onSubmit={(event) => void submit(event)}>
          <div className="sentence-row">
            <span className="sentence-word">名称</span>
            <input
              required
              className="sentence-input"
              value={form.name}
              placeholder="wist-ingest"
              pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
              title="小写字母、数字、连字符；不能以连字符开头或结尾"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "创建中…" : "创建并生成接入令牌"}
            </button>
          </div>
          <p className="field-hint sentence-hint">
            名称同时是凭证的受众与证书 SAN。收数地址随时可在下面「已接入」列表里点开那一行改
            （下一轮心跳生效）；没有地址的系统用传统 join.sh 接入会被拒。
          </p>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>已接入</h2>
            <p className="muted small">
              心跳每 {boarding?.heartbeat_seconds ?? "—"} 秒一次，用 cred 自己的客户端证书探。
            </p>
          </div>
          <div className="head-actions">
            <span className="muted small">{peers.length} 个</span>
            <button type="button" className="ghost" onClick={onGoCredentials}>
              去签发凭证 →
            </button>
          </div>
        </div>

        {shown && <div className="banner error">{shown}</div>}

        {boarding && !boarding.push_enabled && (
          <p className="warn">
            没有配置 <span className="mono">[push]</span>：凭据不会被推送，也没有心跳。
          </p>
        )}

        {peers.length === 0 ? (
          <p className="muted empty">还没有认证系统。上面建一个。</p>
        ) : (
          <ul className="peer-list">
            {peers.map((peer) => {
              const health = healthOf(peer);
              const isEditing = editing === peer.name;
              return (
                <li className="peer-row" key={peer.name}>
                  <div className="peer-id">
                    <span className="peer-name mono">{peer.name}</span>
                    <span className="peer-host mono muted">
                      {peer.host ?? "主机名未上报"}
                    </span>
                  </div>

                  <div className="peer-state">
                    <span className={health.className}>{health.label}</span>
                    {peer.latency_ms !== null && (
                      <span className="muted small">{peer.latency_ms}ms</span>
                    )}
                  </div>

                  <div className="peer-target">
                    {isEditing ? (
                      <div className="inline-edit">
                        <input
                          autoFocus
                          value={draft}
                          placeholder="https://host:port/path（留空 = 手工分发）"
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveEndpoint(peer.name);
                            if (event.key === "Escape") setEditing(null);
                          }}
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void saveEndpoint(peer.name)}
                        >
                          {saving ? "保存中…" : "保存"}
                        </button>
                        <button type="button" className="ghost" onClick={() => setEditing(null)}>
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="linklike peer-endpoint"
                        title={peer.endpoint ?? "点击设置收数地址"}
                        onClick={() => startEdit(peer)}
                      >
                        {peer.endpoint ? (
                          <span className="mono">{peer.endpoint}</span>
                        ) : (
                          <span className="muted">缺收数地址 — 点击补上（不补就永远收不到推送）</span>
                        )}
                      </button>
                    )}
                    <span className="peer-roles mono muted">
                      {peer.roles.length > 0
                        ? peer.roles.join(" · ")
                        : "角色未登记 — 接入时带 --roles"}
                    </span>
                  </div>

                  <div className="peer-actions">
                    <button
                      type="button"
                      className="ghost"
                      disabled={minting !== null}
                      onClick={() => void mint(peer.name)}
                    >
                      {minting === peer.name ? "生成中…" : "接入令牌"}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      title="从注册表里删除这套认证系统"
                      onClick={() => setPendingDelete(peer)}
                    >
                      删除
                    </button>
                  </div>

                  {peer.last_error && !isEditing && (
                    <p className="peer-error" title={peer.last_error}>
                      {peer.last_error}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {link && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>接入 · {link.peer}</h2>
            </div>
            <button type="button" className="ghost" onClick={() => setLink(null)}>
              收起
            </button>
          </div>
          <p className="warn">
            一次性令牌，{Math.round(link.expires_in / 60)} 分钟内有效，<strong>登记时作废</strong>。
            私钥不出对方机器：它只交 CSR，证书按 CSR 签出。
          </p>
          {linkNeedsAddress && (
            <p className="warn">
              这个系统<strong>没有收数地址</strong>（被撤销了）：登记会被拒
              —— 推不了、探不了的系统不允许接入。先在上面列表里把地址补上再过。
            </p>
          )}

          <div className="ticket-box">
            <p className="muted small">
              在对方机器的初始化页（<span className="mono">/__init</span>）里填这串令牌 ——
              它自己生成密钥、自己登记，之后收数监听自己起来。
            </p>
            <div className="token-actions">
              <code className="secret">{linkTicket}</code>
              <button type="button" onClick={() => void copyTicket()}>
                {copied === "ticket" ? "已复制" : "复制"}
              </button>
            </div>
            <p className="muted small">
              这串东西就是接入授权本身（等同于一次性口令）：发完就别留在聊天记录里。
            </p>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`删除认证系统 ${pendingDelete?.name ?? ""}？`}
        requireText={pendingDelete?.name}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      >
        <p>
          它会从「已接入」名单里消失：cred 不再往它推送、不再探活，
          也不能再给它签发新凭据（受众列表里就没有它了）。
        </p>
        {pendingIssued > 0 ? (
          <p className="warn">
            它已经签发过 <strong>{pendingIssued}</strong> 条凭据，这些凭据不会跟着吊销 ——
            要停用请先去「访问凭证」里逐条撤销。
          </p>
        ) : (
          <p className="muted small">它还没有签发过凭据。</p>
        )}
        <p className="muted small">
          如果它是部署栈里的系统（<span className="mono">identity/cred/onboarding/</span>
          ），删掉后重启也不会再导入回来；要恢复得在栈里重新 localize，或直接再建一个同名系统。
        </p>
      </ConfirmDialog>
    </>
  );
}
