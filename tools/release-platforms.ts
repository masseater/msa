import releasePlatformsData from "./release-platforms-data.ts";
import type releasePlatformsTypes from "./release-platforms.types.ts";

const { RELEASE_PLATFORMS } = releasePlatformsData;

const DIST_ENTRIES: ReadonlyArray<string> = [
  "package.json",
  "README.md",
  "CHANGELOG.md",
  "theme",
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

const hostPlatformName = (): string | undefined => {
  const os = HOST_OS[process.platform];
  const arch = HOST_ARCH[process.arch];
  return os === undefined || arch === undefined ? undefined : `${os}-${arch}`;
};

const archiveFileNameFor = (platform: releasePlatformsTypes.ReleasePlatform): string =>
  `msa-${platform.name}.${platform.archive}`;

const ARCHIVE_FLAGS = { "tar.gz": "-xzf", zip: "-xf" } as const;

const archiveRootFor = (platform: releasePlatformsTypes.ReleasePlatform): string =>
  platform.archive === "zip" ? "" : "msa";

const releasePlatforms = {
  ARCHIVE_FLAGS,
  DIST_ENTRIES,
  RELEASE_PLATFORMS,
  archiveFileNameFor,
  archiveRootFor,
  hostPlatformName,
};

export default releasePlatforms;
