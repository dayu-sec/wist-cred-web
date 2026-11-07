import { ApiError } from "./api";
import { dateLocale, t } from "./i18n";

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
      return t(
        "未认证：请输入页面口令（口令由部署方设置在密钥文件的 cred_web_password）。",
        "Not authenticated: enter the page password (set by the operator as cred_web_password in the secret file).",
      );
    }
    if (error.code === "audience_not_configured") {
      return t(
        "受众未在服务端登记（{msg}）：先到「认证系统」页接入它。",
        "The audience is not registered on the server ({msg}): enroll it under Auth systems first.",
        { msg: error.message },
      );
    }
    if (error.code === "roles_not_registered") {
      return t(
        "这个认证系统还没登记能验的角色（{msg}）：到「认证系统」页生成一张接入令牌，在对方机器上带 --roles 重新登记一次。",
        "This auth system has not registered any roles yet ({msg}): issue an onboarding token under Auth systems and enroll again with --roles on that machine.",
        { msg: error.message },
      );
    }
    if (error.code === "no_delivery_target") {
      return t(
        "这个认证系统没有收数地址（{msg}）：到「认证系统」页点地址填一个。",
        "This auth system has no endpoint ({msg}): add one by clicking its address under Auth systems.",
        { msg: error.message },
      );
    }
    if (error.code === "verifier_rejected") {
      // 对端**收到并拒绝**：4xx 是配置/契约问题（重试无用），5xx 才是暂时性。
      const peer = error.fields?.peer ?? t("对方", "the verifier");
      const upstream = error.fields?.upstream_code;
      if (error.retryable === false) {
        const hint =
          upstream === "audience_mismatch"
            ? t(
                "两边受众名不一致 —— 把认证系统名和对方配置里的 audience 改成同一个，再重新登记。",
                "The audience names disagree — make the auth-system name and the verifier's audience the same, then re-enroll.",
              )
            : t(
                "这是配置层面的拒绝，重试不会成功。",
                "This is a configuration-level rejection; retrying will not help.",
              );
        return t(
          "{peer} 拒绝了这条凭据（{code}）：{msg}。{hint}",
          "{peer} rejected this credential ({code}): {msg}. {hint}",
          { peer, code: upstream ?? "—", msg: error.message, hint },
        );
      }
      return t(
        "{peer} 暂时没能接受（{msg}）：这不是凭据本身的问题，稍后重试即可。",
        "{peer} could not accept it for now ({msg}): the credential is fine — retry later.",
        { peer, msg: error.message },
      );
    }
    if (error.code === "verifier_unreachable") {
      const peer = error.fields?.peer ?? t("认证系统", "the verifier");
      return t(
        "连不上 {peer}（{msg}）：确认对端在线、地址与证书有效后再重试。",
        "Could not reach {peer} ({msg}): check that it is up, and that the endpoint and certificate are valid, then retry.",
        { peer, msg: error.message },
      );
    }
    if (error.code === "enrollment_disabled") {
      // 没配 CA / 签发材料：部署方的配置问题，重试永远不会成功。
      return t(
        "这个部署没配签发所需的 CA（{msg}）：让部署方补上配置后再试，重试不会自己变好。",
        "This deployment is missing the CA it needs to enroll ({msg}): ask the operator to fix the configuration; retrying will not help.",
        { msg: error.message },
      );
    }
    if (error.code === "push_internal") {
      // 本地就失败了（签名 / 序列化）：确定性故障，重试不会自己变好。
      if (error.retryable === false) {
        return t(
          "凭据已存下，但推送在本地就没成功（{msg}）：这是服务端自身的问题，重试不会变好 —— 让运维看服务端日志（{id}）。",
          "The credential was stored but the push failed locally ({msg}): this is a server-side fault — retrying will not help. Ask the operator to check the service log ({id}).",
          { msg: error.message, id: error.correlationId ?? "—" },
        );
      }
      return t(
        "凭据已存下，但推送在本地就没成功（{msg}）：稍后重试即可。",
        "The credential was stored but the push failed locally ({msg}): retry later.",
        { msg: error.message },
      );
    }
    if (error.code === "credential_delivery_pending") {
      // 旧版 cred（< 0.8.2）：它只给一句“retry later”，且可能根本没回令牌。
      return t(
        "凭据已签发，但没送达对端（旧版服务端）：如果上面没有令牌，这条凭据的明文已经丢失，只能撤销后重新签发。",
        "The credential was issued but not delivered (older server). If no token is shown above, its plaintext is lost — revoke it and issue a new one.",
      );
    }
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function formatTime(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString(dateLocale(), { hour12: false });
}

/** 把秒数说成人话：`2592000` → `30 天` / `30 days`。 */
export function humanDuration(seconds: number): string {
  const days = seconds / 86400;
  if (Number.isInteger(days) && days >= 1) return t(`${days} 天`, `${days} day(s)`);
  const hours = seconds / 3600;
  if (Number.isInteger(hours) && hours >= 1) return t(`${hours} 小时`, `${hours} hour(s)`);
  const minutes = Math.round(seconds / 60);
  return t(`${minutes} 分钟`, `${minutes} min`);
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
