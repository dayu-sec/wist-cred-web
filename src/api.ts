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

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
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
    throw new ApiError(code, error?.message ?? `HTTP ${response.status}`, response.status);
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
  /** 心跳探测地址（缺省由 endpoint 推到同源 /healthz）。 */
  probe_url: string | null;
  created_at: number;
  created_by: string;
  health: "up" | "down" | "unknown";
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
  path: string;
  expires_in: number;
}

export interface CreatePeerInput {
  name: string;
  /** 一般不用给：主机名与收数地址都由对方登记时上报。 */
  host?: string;
  endpoint?: string;
  healthz?: string;
  /** 一般也不用给：由对方登记时上报。 */
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
