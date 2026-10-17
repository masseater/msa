import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { dual } from "effect/Function";

import { nodePlatform, type RemoteInfo } from "./remote-info.ts";

const DRIVE_RELATIVE = /^([a-zA-Z]:)(?![\\/])/u;

function fromFileUrl(path: string, windows: boolean): string {
  try {
    return fileURLToPath(path, { windows });
  } catch {
    return path;
  }
}

function expandHome(path: string, info: RemoteInfo, windows: boolean): string {
  const paths = windows ? win32 : posix;
  if (path === "~") return info.home;
  if (path.startsWith("~/") || (windows && path.startsWith("~\\"))) {
    return paths.join(info.home, path.slice(2));
  }
  if (path.startsWith("file://")) return fromFileUrl(path, windows);
  return path;
}

function resolveOtherDrive(normalized: string, cwd: string, info: RemoteInfo): string | undefined {
  const drive = DRIVE_RELATIVE.exec(normalized)?.[1];
  if (drive === undefined || drive.toLowerCase() === cwd.slice(0, 2).toLowerCase()) {
    return undefined;
  }
  let base = info.driveCwds[drive.toUpperCase()] ?? info.cwd;
  if (base.slice(0, 2).toLowerCase() !== drive.toLowerCase() && base[2] === "\\") {
    base = `${drive}\\`;
  }
  return win32.resolve(base, normalized);
}

export const resolveRemotePath: {
  (info: RemoteInfo, cwd: string): (path: string) => string;
  (path: string, info: RemoteInfo, cwd: string): string;
} = dual(3, (path: string, info: RemoteInfo, cwd: string): string => {
  const windows = nodePlatform(info).platform === "win32";
  const paths = windows ? win32 : posix;
  const normalized = expandHome(path, info, windows);
  if (paths.isAbsolute(normalized)) return paths.resolve(normalized);
  if (windows) {
    const otherDrive = resolveOtherDrive(normalized, cwd, info);
    if (otherDrive !== undefined) return otherDrive;
  }
  return paths.resolve(cwd, normalized);
});
