import { platform } from "os";

import platformNode from "../core/platform-node.ts";
import platformModule from "../core/platform.ts";
import nodeChildProcess from "../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../core/platform/node/child-process.types.ts";
import nodeFs from "../core/platform/node/fs.ts";

const { spawnSync } = nodeChildProcess;
const { readEnv } = platformModule;
const { join } = platformNode;
const { existsSync } = nodeFs;

function formatSpawnFailure(result: nodeChildProcessTypes.SpawnSyncReturns<Buffer>): string {
  if (result.error?.message !== undefined && result.error?.message !== "") {
    return result.error.message;
  }
  const stderr = result.stderr?.toString().trim();
  if (stderr !== "") {
    return stderr;
  }
  const stdout = result.stdout?.toString().trim();
  if (stdout !== "") {
    return stdout;
  }
  return `exit status ${result.status ?? "unknown"}`;
}

function runExtractionCommand(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { stdio: "pipe" });
  if (result.error === undefined && result.status === 0) {
    return null;
  }
  return `${command}: ${formatSpawnFailure(result)}`;
}

function extractTarGzArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failure = runExtractionCommand("tar", ["xzf", archivePath, "-C", extractDir]);
  if (failure !== null && failure !== "") {
    throw new Error(`Failed to extract ${assetName}: ${failure}`);
  }
}

function getWindowsTarCommand(): string {
  const systemRoot = readEnv("SystemRoot") ?? readEnv("WINDIR");
  if (systemRoot !== undefined && systemRoot !== "") {
    const systemTar = join(systemRoot, "System32", "tar.exe");
    if (existsSync(systemTar)) {
      return systemTar;
    }
  }
  return "tar.exe";
}

function extractZipArchive(archivePath: string, extractDir: string, assetName: string): void {
  const failures: string[] = [];

  if (platform() === "win32") {
    const tarFailure = runExtractionCommand(getWindowsTarCommand(), [
      "xf",
      archivePath,
      "-C",
      extractDir,
    ]);
    if (tarFailure === null || tarFailure === "") return;
    failures.push(tarFailure);

    const script =
      "& { param($archive, $destination) $ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force }";
    const powershellFailure = runExtractionCommand("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
      archivePath,
      extractDir,
    ]);
    if (powershellFailure === null || powershellFailure === "") return;
    failures.push(powershellFailure);
  } else {
    const unzipFailure = runExtractionCommand("unzip", ["-q", archivePath, "-d", extractDir]);
    if (unzipFailure === null || unzipFailure === "") return;
    failures.push(unzipFailure);

    const tarFailure = runExtractionCommand("tar", ["xf", archivePath, "-C", extractDir]);
    if (tarFailure === null || tarFailure === "") return;
    failures.push(tarFailure);
  }

  throw new Error(`Failed to extract ${assetName}: ${failures.join("; ")}`);
}

const toolsManagerPart3 = {
  extractTarGzArchive,
  extractZipArchive,
};

export default toolsManagerPart3;
