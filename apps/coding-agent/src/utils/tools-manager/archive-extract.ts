import platformModule from "../../core/platform/index.ts";
import nodeChildProcess from "../../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../../core/platform/node/child-process.types.ts";
import nodeFsPromises from "../../core/platform/node/fs-promises.ts";
import nodeOs from "../../core/platform/node/os.ts";
import type toolsManagerInternalTypes from "../tools-manager-internal.types.ts";

const { platform } = nodeOs;

const { readDirectoryEntries } = nodeFsPromises;
const { join, readEnv } = platformModule;
const { chmod, exists, rename } = platformModule.files;
const { spawnSync } = nodeChildProcess;

function findBinaryRecursively(dirs: string[], binaryFileName: string): Promise<string | null> {
  const [currentDir, ...rest] = dirs;
  if (currentDir === undefined) return Promise.resolve(null);
  return readDirectoryEntries(currentDir).then((entries) => {
    const match = entries.find((entry) => entry.isFile && entry.name === binaryFileName);
    if (match !== undefined) return join(currentDir, match.name);
    const subdirectories = entries
      .filter((entry) => entry.isDirectory)
      .map((entry) => join(currentDir, entry.name));
    return findBinaryRecursively([...subdirectories, ...rest], binaryFileName);
  });
}

function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  const [candidate, ...rest] = candidates;
  if (candidate === undefined) return Promise.resolve(undefined);
  return exists(candidate).then((found) => (found ? candidate : firstExisting(rest)));
}

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

function getWindowsTarCommand(): Promise<string> {
  const systemRoot = readEnv("SystemRoot") ?? readEnv("WINDIR");
  if (systemRoot === undefined || systemRoot === "") return Promise.resolve("tar.exe");
  const systemTar = join(systemRoot, "System32", "tar.exe");
  return exists(systemTar).then((found) => (found ? systemTar : "tar.exe"));
}

function extractZipArchive(
  archivePath: string,
  extractDir: string,
  assetName: string,
): Promise<void> {
  return platform() === "win32"
    ? getWindowsTarCommand().then((tarCommand) =>
        extractZipOnWindows({ archivePath, assetName, extractDir, tarCommand }),
      )
    : Promise.resolve(extractZipWithUnzip(archivePath, extractDir, assetName));
}

function extractZipOnWindows(options: {
  archivePath: string;
  extractDir: string;
  assetName: string;
  tarCommand: string;
}): void {
  const { archivePath, extractDir, assetName, tarCommand } = options;
  const failures: string[] = [];
  const tarFailure = runExtractionCommand(tarCommand, ["xf", archivePath, "-C", extractDir]);
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
  throw new Error(`Failed to extract ${assetName}: ${failures.join("; ")}`);
}

function extractZipWithUnzip(archivePath: string, extractDir: string, assetName: string): void {
  const failures: string[] = [];
  const unzipFailure = runExtractionCommand("unzip", ["-q", archivePath, "-d", extractDir]);
  if (unzipFailure === null || unzipFailure === "") return;
  failures.push(unzipFailure);

  const tarFailure = runExtractionCommand("tar", ["xf", archivePath, "-C", extractDir]);
  if (tarFailure === null || tarFailure === "") return;
  failures.push(tarFailure);
  throw new Error(`Failed to extract ${assetName}: ${failures.join("; ")}`);
}

function extractArchive(archivePath: string, extractDir: string, assetName: string): Promise<void> {
  if (assetName.endsWith(".tar.gz")) {
    extractTarGzArchive(archivePath, extractDir, assetName);
    return Promise.resolve();
  }
  if (assetName.endsWith(".zip")) return extractZipArchive(archivePath, extractDir, assetName);
  return Promise.reject(new Error(`Unsupported archive format: ${assetName}`));
}

function locateExtractedBinary(
  extractDir: string,
  assetName: string,
  binaryFileName: string,
): Promise<string> {
  const extractedDir = join(extractDir, assetName.replace(/\.(tar\.gz|zip)$/u, ""));
  return firstExisting([join(extractedDir, binaryFileName), join(extractDir, binaryFileName)])
    .then((found) => found ?? findBinaryRecursively([extractDir], binaryFileName))
    .then((found) => {
      if (found === null || found === undefined || found === "") {
        throw new Error(
          `Binary not found in archive: expected ${binaryFileName} under ${extractDir}`,
        );
      }
      return found;
    });
}

function extractBinary(archive: {
  archivePath: string;
  assetName: string;
  binaryExt: string;
  binaryPath: string;
  config: toolsManagerInternalTypes.ToolConfig;
  extractDir: string;
  plat: string;
}): Promise<void> {
  const { archivePath, assetName, binaryExt, binaryPath, config, extractDir, plat } = archive;
  const binaryFileName = config.binaryName + binaryExt;
  return extractArchive(archivePath, extractDir, assetName)
    .then(() => locateExtractedBinary(extractDir, assetName, binaryFileName))
    .then((extractedBinary) => rename({ from: extractedBinary, to: binaryPath }))
    .then(() => (plat === "win32" ? undefined : chmod({ mode: 0o755, path: binaryPath })));
}

const archiveExtract = { extractBinary };

export default archiveExtract;
