import { ApiError } from "./api";

/**
 * 版本号统一成 `vX.Y.Z…`：构建期注入的是发布 tag（自带 `v`），服务端返回纯 semver。
 * 已带 `v` 就原样、否则补一个 —— 免得拼出 `vv0.5.0-alpha`。
 */
export function formatVersion(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "") return "—";
  return value.startsWith("v") ? value : `v${value}`;
}

/** 把接口错误翻成页面能看懂的一句话。 */
export function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `未认证：请输入页面口令（口令由部署方设置在密钥文件的 cred_web_password）。`;
    }
    if (error.code === "audience_not_configured") {
      return `受众未在服务端登记（${error.message}）：先到「认证系统」页接入它。`;
    }
    if (error.code === "roles_not_registered") {
      return `这个认证系统还没登记能验的角色（${error.message}）：到「认证系统」页生成一张接入令牌，在对方机器上带 --roles 重新登记一次。`;
    }
    if (error.code === "no_delivery_target") {
      return `这个认证系统没有收数地址（${error.message}）：到「认证系统」页点地址填一个。`;
    }
    return `${error.code}：${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString("zh-CN", { hour12: false });
}

/** 把秒数说成人话：`2592000` → `30 天`。 */
export function humanDuration(seconds: number): string {
  const days = seconds / 86400;
  if (Number.isInteger(days) && days >= 1) return `${days} 天`;
  const hours = seconds / 3600;
  if (Number.isInteger(hours) && hours >= 1) return `${hours} 小时`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} 分钟`;
}

/**
 * 从 `/enroll/{券}/join.sh` 里取出券。
 *
 * 为什么要有它：接入券本来就是这条路径里的那一段（取脚本的机器也只能从这里拿到它）。
 * 接口从 cred 0.7 起会直接回 `ticket`，但**旧版没有** —— 为了让界面不必跟着 cred 一起发版，
 * 这里保留一次提取；两边都能用，就不用为一个字段多切一趟镜像。
 */
export function ticketFromPath(path: string): string {
  const match = /^\/enroll\/([^/]+)\//.exec(path);
  return match ? match[1] : "";
}

/** 往页面上复制文本；失败时返回 false（https 之外的 origin 拿不到剪贴板）。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
