import { ApiError } from "./api";

/** 把接口错误翻成页面能看懂的一句话。 */
export function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return `未认证（${error.code}）：dev 下由 vite 代理注入操作者头，发布态由入口 nginx 注入。`;
    }
    if (error.code === "audience_not_configured") {
      return `受众未在服务端登记（${error.message}）：先到「认证系统」页接入它。`;
    }
    if (error.code === "roles_not_registered") {
      return `这个认证系统还没登记能验的角色（${error.message}）：到「认证系统」页重新生成接入命令，在它本机带 --roles 跑一次。`;
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
 * 拼成可直接粘贴的一条命令：origin 用页面自己的，cred 只返回相对路径。
 *
 * `-k`：入口的 TLS 证书通常是自签的（平台惯例，center 的安装脚本同样如此）。
 * 收据的真伪不靠 TLS，而是脚本里的两条硬校验：证书公钥必须匹配本机私钥、SAN 必须对。
 */
export function linkCommand(path: string): string {
  return `curl -fsSLk ${window.location.origin}${path} | bash`;
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
