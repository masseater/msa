import { arch } from "os";

import awaitingModule from "../../core/awaiting.ts";
import platformNode from "../../core/platform-node.ts";
import platformModule from "../../core/platform.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import type toolsManagerInternalTypes from "../tools-manager-internal.types.ts";
import downloadFileModule from "./download-file.ts";
import latestVersion from "./latest-version.ts";
import toolCatalog from "./tool-catalog.ts";

const { randomUnit, nowMs } = platformModule;
const { join } = platformNode;
const { mkdirSync } = nodeFs;
const { awaited } = awaitingModule;
const { TOOLS_DIR } = toolCatalog;
const { getLatestVersion } = latestVersion;
const { downloadFile } = downloadFileModule;

function* downloadReleaseArchive(
  tool: string,
  plat: string,
  config: toolsManagerInternalTypes.ToolConfig,
) {
  const architecture = arch();

  const version =
    tool === "fd" && plat === "darwin" && architecture === "x64"
      ? "10.3.0"
      : yield* awaited(getLatestVersion(config.repo));

  const assetName = config.getAssetName(version, plat, architecture);
  if (assetName === null || assetName === "") {
    throw new Error(`Unsupported platform: ${plat}/${architecture}`);
  }

  mkdirSync(TOOLS_DIR, { recursive: true });

  const downloadUrl = `https://github.com/${config.repo}/releases/download/${config.tagPrefix}${version}/${assetName}`;
  const archivePath = join(TOOLS_DIR, assetName);
  const binaryExt = plat === "win32" ? ".exe" : "";
  const binaryPath = join(TOOLS_DIR, config.binaryName + binaryExt);

  yield* awaited(downloadFile(downloadUrl, archivePath));

  const extractDir = join(
    TOOLS_DIR,
    `extract_tmp_${config.binaryName}_${process.pid}_${nowMs()}_${randomUnit().toString(36).slice(2, 10)}`,
  );
  return { archivePath, assetName, binaryExt, binaryPath, extractDir };
}

const releaseDownload = { downloadReleaseArchive };

export default releaseDownload;
