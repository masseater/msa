export const RELEASE_PLATFORMS = [
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-arm64",
    executable: "msa",
    name: "darwin-arm64",
    prebuilds: "native/darwin/prebuilds/darwin-arm64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-darwin-x64-baseline",
    executable: "msa",
    name: "darwin-x64",
    prebuilds: "native/darwin/prebuilds/darwin-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-x64-baseline",
    executable: "msa",
    name: "linux-x64",
    prebuilds: "native/linux/prebuilds/linux-x64",
  },
  {
    archive: "tar.gz",
    bunTarget: "bun-linux-arm64",
    executable: "msa",
    name: "linux-arm64",
    prebuilds: "native/linux/prebuilds/linux-arm64",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-x64-baseline",
    executable: "msa.exe",
    name: "windows-x64",
    prebuilds: "native/win32/prebuilds/win32-x64",
  },
  {
    archive: "zip",
    bunTarget: "bun-windows-arm64",
    executable: "msa.exe",
    name: "windows-arm64",
    prebuilds: "native/win32/prebuilds/win32-arm64",
  },
] as const;

export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

export const DIST_ENTRIES: ReadonlyArray<string> = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "theme",
  "assets",
  "export-html",
  "docs",
  "examples",
  "photon_rs_bg.wasm",
];

const HOST_OS: Readonly<Record<string, string>> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};
const HOST_ARCH: Readonly<Record<string, string>> = { arm64: "arm64", x64: "x64" };

export const hostPlatformName = (): string | undefined => {
  const os = HOST_OS[process.platform];
  const arch = HOST_ARCH[process.arch];
  return os === undefined || arch === undefined ? undefined : `${os}-${arch}`;
};

export const archiveFileNameFor = (platform: ReleasePlatform) =>
  `msa-${platform.name}.${platform.archive}`;

export const ARCHIVE_FLAGS = { "tar.gz": "-xzf", zip: "-xf" } as const;

export const archiveRootFor = (platform: ReleasePlatform) =>
  platform.archive === "zip" ? "" : "msa";
