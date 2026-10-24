const RELEASE_PLATFORMS = [
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-arm64",
    executable: "msa",
    name: "darwin-arm64",
    nodeLlamaCpp: { deployFlags: ["--os=darwin", "--cpu=arm64"], prebuilt: "mac-arm64-metal" },
    prebuilds: "native/darwin/prebuilds/darwin-arm64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-x64-baseline",
    executable: "msa",
    name: "darwin-x64",
    nodeLlamaCpp: { deployFlags: ["--os=darwin", "--cpu=x64"], prebuilt: "mac-x64" },
    prebuilds: "native/darwin/prebuilds/darwin-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-x64-baseline",
    executable: "msa",
    name: "linux-x64",
    nodeLlamaCpp: {
      deployFlags: ["--os=linux", "--cpu=x64", "--libc=glibc"],
      prebuilt: "linux-x64",
    },
    prebuilds: "native/linux/prebuilds/linux-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-arm64",
    executable: "msa",
    name: "linux-arm64",
    nodeLlamaCpp: {
      deployFlags: ["--os=linux", "--cpu=arm64", "--libc=glibc"],
      prebuilt: "linux-arm64",
    },
    prebuilds: "native/linux/prebuilds/linux-arm64",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-x64-baseline",
    executable: "msa.exe",
    name: "windows-x64",
    nodeLlamaCpp: { deployFlags: ["--os=win32", "--cpu=x64"], prebuilt: "win-x64" },
    prebuilds: "native/win32/prebuilds/win32-x64",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-arm64",
    executable: "msa.exe",
    name: "windows-arm64",
    nodeLlamaCpp: { deployFlags: ["--os=win32", "--cpu=arm64"], prebuilt: "win-arm64" },
    prebuilds: "native/win32/prebuilds/win32-arm64",
  },
] as const;

const releasePlatformsData = {
  RELEASE_PLATFORMS,
};

export default releasePlatformsData;
