import { useState } from "react";
import type { FormEvent } from "react";

import { createPeer, mintOnboardingLink, setPeerEndpoint, setPeerSetup } from "../api";
import type { CreatePeerInput, OnboardingLink, OnboardingPeer, OnboardingState } from "../api";
import { copyText, describe, linkCommand } from "../ui";

interface Props {
  boarding: OnboardingState | null;
  error: string | null;
  onReload: () => void;
  /** 去「访问凭证」页（接好之后紧接着要发凭证）。 */
  onGoCredentials: () => void;
}

interface FormState {
  name: string;
}

const EMPTY_FORM: FormState = { name: "" };

/**
 * 材料目录的常见落点：已经在用的（别的认证系统存过的）排前面，再补几个静态项。
 *
 * 为什不是纯输入框：栈里写错一个字符，脚本会落在消费方不看的地方，而券已经烧了。
 * 能选就不让人打字。
 */
function materialDirOptions(peer: string, used: string[]): string[] {
  const common = [
    `./identity/${peer}/cred`,
    "./configs/wist-cred",
    `/etc/wist/${peer}`,
    `./wist-cred/${peer}`,
  ];
  return [...new Set([...used.filter(Boolean), ...common])];
}

/** 角色组合的常见取法（与 center / ingest 的词汇表对齐）。 */
const ROLE_PRESETS = ["admin,read", "read", "investigation:run", "read,investigation:run"];

function healthOf(peer: OnboardingPeer): { label: string; className: string } {
  // 没有收数地址就不会被探测，说「未探测」会误导。
  if (!peer.endpoint) return { label: "不探测", className: "state expired" };
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
export default function Systems({ boarding, error, onReload, onGoCredentials }: Props) {
  const [link, setLink] = useState<OnboardingLink | null>(null);
  const [minting, setMinting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  /** 正在编辑收数地址的系统名；`""` = 没在编辑。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  /** 接入落点（材料目录 / 角色 / 重启命令）：随认证系统存，签发时烘进脚本。 */
  const [setupDir, setSetupDir] = useState("");
  const [setupRoles, setSetupRoles] = useState("");
  const [setupRestart, setSetupRestart] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);

  async function mint(peer: string) {
    setMinting(peer);
    setCopied(false);
    // 预填上一次存下的落点：改完保存直接重新签发，不用再想。
    const record = boarding?.peers.find((item) => item.name === peer);
    setSetupDir(record?.install_dir ?? "");
    // 角色不是本页存的，而是对方登记时上报的：只在人没填过时用已登记的预填，
    // 否则“保存 → 重新签发”会把人刚选的组合清掉。
    setSetupRoles((previous) => previous || (record?.roles.join(",") ?? ""));
    setSetupRestart(record?.restart_cmd ?? "");
    try {
      setLink(await mintOnboardingLink(peer));
      setLocalError(null);
    } catch (err) {
      setLocalError(describe(err));
    } finally {
      setMinting(null);
    }
  }

  async function copy() {
    if (!link) return;
    setCopied(
      await copyText(
        linkCommand(link.path, {
          dir: setupDir,
          roles: setupRoles.split(","),
          restartCmd: setupRestart,
        }),
      ),
    );
  }

  /** 保存落点并**重新签发**：脚本是签发时渲染的，改了必须换一张券才生效。 */
  async function saveSetup() {
    if (!link) return;
    const peer = link.peer;
    setSetupSaving(true);
    try {
      await setPeerSetup(peer, {
        install_dir: setupDir.trim() || null,
        config_path: null,
        restart_cmd: setupRestart.trim() || null,
      });
      setLocalError(null);
      onReload();
      await mint(peer);
    } catch (err) {
      setLocalError(describe(err));
    } finally {
      setSetupSaving(false);
    }
  }

  const dirOptions = link
    ? materialDirOptions(
        link.peer,
        (boarding?.peers ?? []).map((peer) => peer.install_dir ?? ""),
      )
    : [];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const input: CreatePeerInput = { name: form.name.trim() };

      const created = await createPeer(input);
      setForm(EMPTY_FORM);
      setLocalError(null);
      onReload();
      // 建完直接给接入命令，省一次点击。
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

  const shown = localError ?? error;
  const peers = boarding?.peers ?? [];

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>新建认证系统</h2>
            <p className="muted small">
              只要一个名字。主机名、收数地址和角色都由对方接入时自己上报 —— 它比我们清楚自己叫什么、在哪里听、能验什么。
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
              onChange={(event) => setForm({ name: event.target.value })}
            />
            <button type="submit" disabled={submitting}>
              {submitting ? "创建中…" : "创建并生成接入命令"}
            </button>
          </div>
          <p className="field-hint sentence-hint">
            这个名字同时是凭证的受众与证书 SAN；接入后会被对方上报的主机名/地址填满。
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
                          <span className="muted">手工分发 — 点击设置地址</span>
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
                      {minting === peer.name ? "生成中…" : "接入命令"}
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
              <h2>接入命令 · {link.peer}</h2>
              <p className="muted small">
                在 {link.host ?? "对方主机"} 上执行下面这一行。
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => setLink(null)}>
              收起
            </button>
          </div>
          <p className="warn">
            一次性券，{Math.round(link.expires_in / 60)} 分钟内有效，<strong>登记时作废</strong>。
            命令里没有任何私钥：对方在本机生成密钥，只交 CSR，证书按 CSR 签出。
          </p>
          <p className="muted small">
            在对方机器上要带上 <span className="mono">--roles a,b,c</span> 登记它能验的角色；
            之后发凭证只能从这张表里选。改角色也是这条路 —— 重新生成一次命令，带新的
            <span className="mono">--roles</span> 重跑（当前值会补进命令里，不带就保持原样）。
          </p>

          <div className="setup-fields">
            <p className="muted small">
              脚本会在材料目录里生成 <span className="mono">cred.toml</span>（只写
              [identity] 与 [verify]），程序启动时加一行
              <span className="mono">--credentials &lt;路径&gt;</span> 指过来就行。
              它必须与材料同目录（相对路径按文件目录解），所以这里不提供改路径。
              <strong>部署栈里必须填材料目录</strong>（默认值会被护栏拦下）。
            </p>
            <div className="inline-edit">
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value) setSetupDir(event.target.value);
                }}
              >
                <option value="">常用位置…</option>
                {dirOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <input
                value={setupDir}
                placeholder="材料目录（部署栈里必填），如 ./identity/center/cred"
                onChange={(event) => setSetupDir(event.target.value)}
              />
            </div>
            <div className="inline-edit">
              <select
                value=""
                onChange={(event) => {
                  if (event.target.value) setSetupRoles(event.target.value);
                }}
              >
                <option value="">常用角色…</option>
                {ROLE_PRESETS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <input
                value={setupRoles}
                placeholder="角色（逗号分隔），留空 = 沿用已登记的"
                onChange={(event) => setSetupRoles(event.target.value)}
              />
            </div>
            <div className="inline-edit">
              <input
                value={setupRestart}
                placeholder="重启命令（可选），如 gops run stop && gops run start"
                onChange={(event) => setSetupRestart(event.target.value)}
              />
              <button
                type="button"
                disabled={setupSaving}
                onClick={() => void saveSetup()}
              >
                {setupSaving ? "保存中…" : "保存为默认"}
              </button>
            </div>
          </div>

          <code className="secret">
            {linkCommand(link.path, {
              dir: setupDir,
              roles: setupRoles.split(","),
              restartCmd: setupRestart,
            })}
          </code>
          <div className="token-actions">
            <button type="button" onClick={() => void copy()}>
              {copied ? "已复制" : "复制"}
            </button>
            <span className="muted small">
              材料目录与 cred.toml 同目录；cred.toml 会被整份重写
            </span>
          </div>
        </section>
      )}
    </>
  );
}
