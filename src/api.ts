/**
 * 与 `wist-cred` 的接口契约。
 *
 * 页面自己带凭据：`Authorization: Bearer <页面口令>`（存在本标签页，见 `auth.ts`），
 * 由 `wist-cred` 自己验。**不靠反代注入身份** —— 那是浏览器原生弹窗，没有登录框/登出。
 */

import { clearPassword, getPassword } from "./auth";

export interface Credential {
  credential_id: string;
  subject: string;
  owner: string;
  purpose: string;
  roles: string[];
  resources: Record<string, string[]>;
  audience: string;
  break_glass: boolean;
  issued_at: number;
  expires_at: number;
  revision: number;
  revoked_at: number | null;
  last_used_at: number | null;
}

/** 创建响应：多一个 `token`，**只出现这一次**。 */
export interface CreatedCredential extends Credential {
  token: string;
}

export interface CreateInput {
  /** 可选：不给时服务端用 `audience` 填（页面不问这一项）。 */
  subject?: string;
  purpose: string;
  roles: string[];
  audience: string;
  resources?: Record<string, string[]>;
  ttl_seconds?: number;
  break_glass?: boolean;
}

/** 签发上限：页面用它把超出上限的有效期选项标出来。 */
export interface IssuePolicy {
  max_ttl_seconds: number;
  break_glass_max_ttl_seconds: number;
  overlap_seconds: number;
  digest: string;
}

export function getPolicy(): Promise<IssuePolicy> {
  return request<IssuePolicy>("/policy");
}

/**
 * 凭据服务与部署栈的版本（`GET /api/v1/version`，**公开**、无需口令）。
 *
 * 页面自己那一版来自构建期注入的 `VITE_APP_VERSION`；另外两个只有服务端知道：
 * `version` 是 `wist-cred` 二进制，`stack_version` 是这套部署（`wist-cred-stack` 的 version.txt）。
 * 旧 cred 没有这条路由 / 不返回 `stack_version` 时都按「不知道」处理（页面显示 `—`），
 * 不编值 —— 一个假的版本号会让运维照着错版本排障。
 */
export interface ServiceVersion {
  name: string;
  version: string;
  stackVersion: string | null;
}

export async function getServiceVersion(): Promise<ServiceVersion> {
  const body = await request<{
    name?: string;
    version?: string;
    stack_version?: string | null;
  }>("/version");
  return {
    name: body.name ?? "wist-cred",
    version: body.version ?? "",
    stackVersion: body.stack_version ?? null,
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  /** 解析后的响应体：少数错误会带上额外内容（例如签发成功但推送失败时的 `credential`）。 */
  readonly payload: unknown;
  /**
   * 服务端说这件事**过一会儿重试有没有意义**（`ProtocolError.retryable`）。
   *
   * `null` = 旧版 cred 没给这个字段（按下文文案保守处理）。
   * 它决定页面给「重试」按钮还是给「去修配置」的指引 —— 不要靠码猜。
   */
  readonly retryable: boolean | null;
  /** 结构化字段（`peer` / `upstream_status` / `upstream_code` …）。 */
  readonly fields: Record<string, string> | null;
  /** 与容器日志对账用的 id（响应体 `correlation_id`，同时也在 `x-request-id` 头里）。 */
  readonly correlationId: string | null;

  constructor(code: string, message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.payload = payload;

    const error = (payload as {
      error?: { retryable?: boolean; fields?: Record<string, string>; correlation_id?: string };
    } | null)?.error;
    this.retryable = typeof error?.retryable === "boolean" ? error.retryable : null;
    this.fields = error?.fields ?? null;
    this.correlationId = error?.correlation_id ?? null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const password = getPassword();
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      // 口令在页面里输入（不是反代注入）；没有就不带，服务端会回 401 让我们弹登录框。
      ...(password ? { authorization: `Bearer ${password}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const code = error?.code ?? "unknown_error";
    // 服务端**明确**说这把口令不对时就地清掉：否则页面会拿着错口令每 10s 轮询，
    // 人看到的永远是“口令错误”，却不知道为什么一直重试。清掉后页面会弹登录框。
    if (response.status === 401 && code === "invalid_admin_bearer_token") {
      clearPassword();
    }
    throw new ApiError(code, error?.message ?? `HTTP ${response.status}`, response.status, body);
  }

  return body as T;
}

export async function listCredentials(): Promise<Credential[]> {
  const body = await request<{ credentials: Credential[] }>("/credentials");
  return body.credentials;
}

export function createCredential(input: CreateInput): Promise<CreatedCredential> {
  return request<CreatedCredential>("/credentials", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function revokeCredential(credentialId: string): Promise<Credential> {
  return request<Credential>(`/credentials/${encodeURIComponent(credentialId)}/revoke`, {
    method: "POST",
  });
}

/** 重新投递的结果：同一摘要、同一 revision，只是再推一次。 */
export interface Redelivery {
  credential_id: string;
  audience: string;
  delivered_to: string;
  revision: number;
}

/** 签发时推送失败（或验证方表丢了）用它补一次；不改任何字段。 */
export function redeliverCredential(credentialId: string): Promise<Redelivery> {
  return request<Redelivery>(`/credentials/${encodeURIComponent(credentialId)}/redeliver`, {
    method: "POST",
  });
}

// ── 验证方接入（onboarding）─────────────────────────────────────────────

/** 一个认证系统（验证方 X）。后端只给元数据与心跳状态，材料一概不出。 */
export interface OnboardingPeer {
  /** 名称：页面显示名，同时也是凭证的 `audience`。 */
  name: string;
  /** 证书 SAN。null = 对方还没登记（登记时自己上报）。 */
  host: string | null;
  /** 收摘要的地址；null = 只做手工分发。 */
  endpoint: string | null;
  /** 这个系统自己能验的角色；空 = 还没上报。 */
  roles: string[];
  /** 材料目录（接入命令里的 `--dir`）；null = 由脚本按场景取默认。 */
  install_dir: string | null;
  /** 接入脚本要不要顺手写配置（`--config`）；null = 只打印片段。 */
  config_path: string | null;
  /** 写完配置要让生效的命令（`--restart`）；null = 只提示。 */
  restart_cmd: string | null;
  /** 心跳探测地址（缺省由 endpoint 推到同源 /healthz）。 */
  probe_url: string | null;
  created_at: number;
  created_by: string;
  /**
   * `no_endpoint` = 这个系统根本没有收数地址（不是“还没探过”）：
   * cred 会直接跳过它，永远不会探活、也永远不会推送。不会自愈，要人补地址。
   */
  health: "up" | "down" | "unknown" | "no_endpoint";
  last_seen_at: number | null;
  latency_ms: number | null;
  last_error: string | null;
}

export interface OnboardingState {
  peers: OnboardingPeer[];
  script_ttl_seconds: number;
  heartbeat_seconds: number;
  /** false = 这个部署没有签发 CA / 客户端 CA，接入做不了。 */
  enabled: boolean;
  /** false = 没有 [push]，凭据只能手工分发。 */
  push_enabled: boolean;
}

/** 一次性接入链接。`path` 是相对路径，绝对地址由页面按自己的 origin 拼。 */
export interface OnboardingLink {
  peer: string;
  /** null = 还没登记，主机名未知。 */
  host: string | null;
  /**
   * 一次性接入券（`wot_…`）：自注册页（`/__init`）要的就是它。
   *
   * cred 0.7 起直接给；**旧版没有这个字段**，此时用 `ticketFromPath(path)` 从
   * `/enroll/{券}/join.sh` 里取 —— 这样界面不必等 cred 发版。
   */
  ticket?: string;
  path: string;
  expires_in: number;
}

export interface CreatePeerInput {
  name: string;
  /**
   * 可选的收数地址（`https://…`）。
   *
   * 页面**不在新建时问**（后端一直允许缺省）：自注册（cred-peer 初始化）会带着它自己的
   * 地址进来；手工接入的系统建完后在列表里补。缺省时 `health` 会立刻是 `no_endpoint`。
   */
  endpoint?: string;
  /** 可选：证书 SAN；不给就从地址推。 */
  host?: string;
  healthz?: string;
  /** 可选：对方能验的角色；平常由它接入时上报。 */
  roles?: string[];
}

export function listOnboardingPeers(): Promise<OnboardingState> {
  return request<OnboardingState>("/peers");
}

export function createPeer(input: CreatePeerInput): Promise<OnboardingPeer> {
  return request<OnboardingPeer>("/peers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function mintOnboardingLink(peer: string): Promise<OnboardingLink> {
  return request<OnboardingLink>(
    `/peers/${encodeURIComponent(peer)}/enrollment-tickets`,
    { method: "POST" },
  );
}

/**
 * 删除一个认证系统（`DELETE /api/v1/peers/{name}`）。
 *
 * 只把它从注册表里去掉：不再推送、不再探活；**已签发的凭据不跟着吊销** ——
 * 想停用要逐条撤销（页面在确认框里会说清这一点）。
 */
export async function deletePeer(name: string): Promise<void> {
  await request<{ removed: string }>(`/peers/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/** 改收数地址；传 null = 退回手工分发。 */
export function setPeerEndpoint(
  peer: string,
  endpoint: string | null,
): Promise<OnboardingPeer> {
  return request<OnboardingPeer>(
    `/peers/${encodeURIComponent(peer)}/endpoint`,
    { method: "POST", body: JSON.stringify({ endpoint }) },
  );
}

