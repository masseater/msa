import { platform } from "os";

import * as Effect from "effect/Effect";

import awaitingModule from "../core/awaiting.ts";
import platformNode from "../core/platform-node.ts";
import nodeFs from "../core/platform/node/fs.ts";
import toolsManagerPart1 from "./tools-manager-part1.ts";
import toolsManagerPart2 from "./tools-manager-part2.ts";
import toolsManagerPart3 from "./tools-manager-part3.ts";
import toolsManagerPart4 from "./tools-manager-part4.ts";

const { awaiting } = awaitingModule;
const { chmodSync, existsSync, mkdirSync, renameSync, rmSync } = nodeFs;
const { join } = platformNode;
const { TOOLS } = toolsManagerPart1;
const { downloadToolPart1 } = toolsManagerPart4;
const { extractTarGzArchive, extractZipArchive } = toolsManagerPart3;
const { findBinaryRecursively } = toolsManagerPart2;

function downloadTool(tool: "fd" | "rg"): Promise<string> {
  return Effect.runPromise(
    awaiting(function* () {
      const config = TOOLS[tool];
      if (config === undefined) throw new Error(`Unknown tool: ${tool}`);

      const plat = platform();
      const { extractDir, assetName, archivePath, binaryExt, binaryPath } =
        yield* downloadToolPart1(tool, plat, config);
      mkdirSync(extractDir, { recursive: true });

      try {
        if (assetName.endsWith(".tar.gz")) {
          extractTarGzArchive(archivePath, extractDir, assetName);
        } else if (assetName.endsWith(".zip")) {
          extractZipArchive(archivePath, extractDir, assetName);
        } else {
          throw new Error(`Unsupported archive format: ${assetName}`);
        }

        const binaryFileName = config.binaryName + binaryExt;
        const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/u, ""));
        const extractedBinaryCandidates = [
          join(extractedDir, binaryFileName),
          join(extractDir, binaryFileName),
        ];
        let extractedBinary = extractedBinaryCandidates.find((candidate) => existsSync(candidate));

        if (extractedBinary === undefined || extractedBinary === "") {
          extractedBinary = findBinaryRecursively(extractDir, binaryFileName) ?? undefined;
        }

        if (extractedBinary !== undefined && extractedBinary !== "") {
          renameSync(extractedBinary, binaryPath);
        } else {
          throw new Error(
            `Binary not found in archive: expected ${binaryFileName} under ${extractDir}`,
          );
        }

        if (plat !== "win32") {
          chmodSync(binaryPath, 0o755);
        }
      } finally {
        rmSync(archivePath, { force: true });
        rmSync(extractDir, { force: true, recursive: true });
      }

      return binaryPath;
    }),
  );
}

const TERMUX_PACKAGES: Record<string, string> = {
  fd: "fd",
  rg: "ripgrep",
};

const toolsManagerPart5 = {
  TERMUX_PACKAGES,
  downloadTool,
};

export default toolsManagerPart5;
