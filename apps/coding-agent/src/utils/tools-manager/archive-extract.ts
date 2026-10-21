import platformModule from "../../core/platform/index.ts";
import nodeChildProcess from "../../core/platform/node/child-process.ts";
import type nodeChildProcessTypes from "../../core/platform/node/child-process.types.ts";
import nodeFs from "../../core/platform/node/fs.ts";
import nodeOs from "../../core/platform/node/os.ts";
import type toolsManagerInternalTypes from "../tools-manager-internal.types.ts";

const { platform } = nodeOs;

const { chmodSync, renameSync, existsSync, readdirSync } = nodeFs;
const { join, readEnv } = platformModule;
const { spawnSync } = nodeChildProcess;

function findBinaryRecursively(rootDir: string, binaryFileName: string): string | null {
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (currentDir === undefined || currentDir === "") continue;

    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isFile() && entry.name === binaryFileName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
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

function extractBinary(archive: {
  archivePath: string;
  assetName: string;
  binaryExt: string;
  binaryPath: string;
  config: toolsManagerInternalTypes.ToolConfig;
  extractDir: string;
  plat: string;
}): void {
  const { archivePath, assetName, binaryExt, binaryPath, config, extractDir, plat } = archive;
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
    throw new Error(`Binary not found in archive: expected ${binaryFileName} under ${extractDir}`);
  }

  if (plat !== "win32") {
    chmodSync(binaryPath, 0o755);
  }
}

const archiveExtract = { extractBinary };

export default archiveExtract;
