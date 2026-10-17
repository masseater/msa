import type { Json } from "./remote-error.ts";

export interface RemoteInfo {
  protocol: number;
  version: string;
  os: string;
  arch: string;
  home: string;
  tmpdir: string;
  separator: string;
  cwd: string;
  driveCwds: Record<string, string>;
  pid: number;
  features?: string[];
}

export function nodePlatform(info: Pick<RemoteInfo, "os" | "arch">): {
  platform: string;
  arch: string;
} {
  const platforms: Record<string, string> = { windows: "win32", macos: "darwin" };
  const archs: Record<string, string> = { x86_64: "x64", aarch64: "arm64", x86: "ia32" };
  return { platform: platforms[info.os] ?? info.os, arch: archs[info.arch] ?? info.arch };
}

export interface ConnectionOptions {
  command: readonly string[] | (() => Promise<readonly string[]>);
  onLog?: (text: string) => void;
}

export interface RequestOptions {
  payload?: Uint8Array;
  signal?: AbortSignal;
  onEvent?: (json: Json, payload: Uint8Array) => void;
  onStart?: (id: number, session: number) => void;
  session?: number;
}
