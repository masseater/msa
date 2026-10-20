import { dual } from "effect/Function";

type SessionPlatform = "windows" | "unix" | "unknown";

function escapeJsonString(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function trimTrailingPathSeparators(value: string): string {
  return value.replace(/[\\/]+$/u, "");
}

function getPathTailName(value: string): string {
  const trimmed = trimTrailingPathSeparators(value);
  return (
    trimmed
      .split(/[\\/]/u)
      .filter((segment) => segment !== "")
      .at(-1) ?? ""
  );
}

function getWindowsDrivePathParts(value: string): { drive: string; rest: string } | undefined {
  const trimmed = trimTrailingPathSeparators(value);
  const [, drive, rest] =
    /^([A-Za-z]):[\\/](.*)$/u.exec(trimmed) ?? /^\/([A-Za-z])\/(.*)$/u.exec(trimmed) ?? [];
  if (drive !== undefined && rest !== undefined) {
    return { drive: drive.toUpperCase(), rest: rest.replaceAll(/[\\/]+/gu, "/") };
  }

  return undefined;
}

function getCwdRewriteVariants(sourceCwd: string): string[] {
  const trimmed = trimTrailingPathSeparators(sourceCwd);
  const variants = new Set<string>();
  if (trimmed !== "") variants.add(trimmed);

  const driveParts = getWindowsDrivePathParts(trimmed);
  if (driveParts !== undefined) {
    const rest = driveParts.rest.replaceAll(/^\/+|\/+$/gu, "");
    const backslashRest = rest.replaceAll("/", "\\");
    variants.add(`${driveParts.drive}:\\${backslashRest}`);
    variants.add(`${driveParts.drive}:/${rest}`);
    variants.add(`/${driveParts.drive.toLowerCase()}/${rest}`);
    variants.add(`/${driveParts.drive}/${rest}`);
  }

  return Array.from(variants)
    .filter((variant) => variant !== "")
    .toSorted((a, b) => b.length - a.length);
}

function getCiWorkdirName(sourceCwd: string): string | undefined {
  const name = getPathTailName(sourceCwd);
  return /^msa-ci-[0-9a-f]{32}$/iu.test(name) ? name : undefined;
}

function detectSessionPlatform(cwd: string): SessionPlatform {
  if (/^[A-Za-z]:[\\/]/u.test(cwd) || /^\/[A-Za-z]\//u.test(cwd)) return "windows";
  if (cwd.startsWith("/")) return "unix";
  return "unknown";
}

function getLocalPlatform(): Exclude<SessionPlatform, "unknown"> {
  return process.platform === "win32" ? "windows" : "unix";
}

function getPlatformContinuationNotice(sourceCwd: string): string | undefined {
  const sourcePlatform = detectSessionPlatform(sourceCwd);
  const localPlatform = getLocalPlatform();
  if (sourcePlatform === "unknown" || sourcePlatform === localPlatform) return undefined;
  if (localPlatform === "unix") {
    return "This session was continued on a non-Windows machine; paths are now Unix style.";
  }
  return "This session was continued on a Windows machine; paths are now Windows style.";
}

const rewriteSessionCwd: {
  (sourceCwd: string, targetCwd: string): (raw: string) => string;
  (raw: string, sourceCwd: string, targetCwd: string): string;
} = dual(3, (raw: string, sourceCwd: string, targetCwd: string): string => {
  const target = escapeJsonString(targetCwd);
  let rewritten = raw;

  for (const sourceVariant of getCwdRewriteVariants(sourceCwd)) {
    if (sourceVariant === targetCwd) continue;
    rewritten = rewritten.split(escapeJsonString(sourceVariant)).join(target);
  }

  const ciWorkdirName = getCiWorkdirName(sourceCwd);
  if (ciWorkdirName !== undefined) {
    const escapedName = escapeRegExp(ciWorkdirName);
    const windowsPathPatterns = [
      new RegExp(`[A-Za-z]:(?:[^"\\r\\n])*?${escapedName}`, "gu"),
      new RegExp(`/[A-Za-z]/(?:[^"\\r\\n])*?${escapedName}`, "gu"),
    ];
    for (const pattern of windowsPathPatterns) {
      rewritten = rewritten.replace(pattern, target);
    }
  }

  return rewritten;
});

const cwdRewrite = {
  getPlatformContinuationNotice,
  rewriteSessionCwd,
};

export default cwdRewrite;
