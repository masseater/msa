import type remoteInfoTypes from "./remote-info.types.ts";

function nodePlatform(info: Pick<remoteInfoTypes.RemoteInfo, "os" | "arch">): {
  platform: string;
  arch: string;
} {
  const platforms: Record<string, string> = { macos: "darwin", windows: "win32" };
  const archs: Record<string, string> = { aarch64: "arm64", x86: "ia32", x86_64: "x64" };
  return { arch: archs[info.arch] ?? info.arch, platform: platforms[info.os] ?? info.os };
}

const remoteInfo = {
  nodePlatform,
};

export default remoteInfo;
