/**
 * 与 `wist-cred` 的接口契约。
 *
 * 页面只调这四条，且**从不自己设置 `x-wist-operator`**：
 * 发布态由入口 nginx（basic auth 之后）注入，dev 由 vite 代理注入。
 */

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
  subject: string;
  purpose: string;
  roles: string[];
  audience: string;
  resources?: Record<string, string[]>;
  ttl_seconds?: number;
  break_glass?: boolean;
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
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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
    throw new ApiError(
      error?.code ?? "unknown_error",
      error?.message ?? `HTTP ${response.status}`,
      response.status,
    );
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
