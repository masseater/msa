import { accessSync, constants, existsSync, readFileSync, realpathSync } from "fs";
import { createRequire } from "module";
import { homedir } from "os";
import { fileURLToPath } from "url";

import { dual } from "effect/Function";

import { basename, dirname, join, resolve, sep } from "./core/platform-node.ts";
import { readEnv } from "./core/platform.ts";
import { spawnProcessSync } from "./utils/child-process.ts";
import { normalizePath } from "./utils/paths.ts";
import { windowsBasename, windowsDirname } from "./utils/platform-extra.ts";
import { stripBom } from "./utils/text.ts";

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = dirname(moduleFilename);

export const isBunBinary =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

export const isBunRuntime = process.versions["bun"] !== undefined && process.versions["bun"] !== "";

declare const MSA_BUNDLED_NODE: boolean;
export const isBundledNode = typeof MSA_BUNDLED_NODE !== "undefined" && MSA_BUNDLED_NODE;

export type InstallMethod = "bun-binary" | "npm" | "pnpm" | "yarn" | "bun" | "unknown";

interface SelfUpdateCommandStep {
  command: string;
  args: string[];
  display: string;
}

export interface SelfUpdateCommand extends SelfUpdateCommandStep {
  steps?: SelfUpdateCommandStep[];
}

export type SelfUpdatePackageTarget = string | { packageName: string; installSpec?: string };

function normalizeSelfUpdatePackageTarget(target: SelfUpdatePackageTarget): {
  packageName: string;
  installSpec: string;
} {
  if (typeof target === "string") {
    return { packageName: target, installSpec: target };
  }
  return { packageName: target.packageName, installSpec: target.installSpec ?? target.packageName };
}

function makeSelfUpdateCommand(
  installStep: SelfUpdateCommandStep,
  uninstallStep?: SelfUpdateCommandStep,
): SelfUpdateCommand {
  if (uninstallStep === undefined) return installStep;
  return {
    ...installStep,
    display: `${uninstallStep.display} && ${installStep.display}`,
    steps: [uninstallStep, installStep],
  };
}

function makeSelfUpdateCommandStep(command: string, args: string[]): SelfUpdateCommandStep {
  return {
    command,
    args,
    display: [command, ...args].map((arg) => (/\s/u.test(arg) ? `"${arg}"` : arg)).join(" "),
  };
}

export function detectInstallMethod(): InstallMethod {
  if (isBunBinary) {
    return "bun-binary";
  }

  const resolvedPath = `${moduleDirname}\0${process.execPath || ""}`
    .toLowerCase()
    .replace(/\\/gu, "/");

  if (resolvedPath.includes("/pnpm/") || resolvedPath.includes("/.pnpm/")) {
    return "pnpm";
  }
  if (resolvedPath.includes("/yarn/") || resolvedPath.includes("/.yarn/")) {
    return "yarn";
  }
  if (isBunRuntime || resolvedPath.includes("/install/global/node_modules/")) {
    return "bun";
  }
  if (resolvedPath.includes("/npm/") || resolvedPath.includes("/node_modules/")) {
    return "npm";
  }

  return "unknown";
}

function getInferredNpmInstall(): { root: string; prefix: string } | undefined {
  const packageDir = getPackageDir();
  const path =
    process.platform === "win32" || packageDir.includes("\\")
      ? { basename: windowsBasename, dirname: windowsDirname }
      : { basename, dirname };
  const parent = path.dirname(packageDir);
  let root: string | undefined;
  if (
    path.basename(parent).startsWith("@") &&
    path.basename(path.dirname(parent)) === "node_modules"
  ) {
    root = path.dirname(parent);
  } else if (path.basename(parent) === "node_modules") {
    root = parent;
  }
  if (root === undefined || root === "") return undefined;
  const rootParent = path.dirname(root);
  if (path.basename(rootParent) === "lib") return { root, prefix: path.dirname(rootParent) };

  return undefined;
}

function getSelfUpdateCommandForMethod(
  method: InstallMethod,
  installedPackageName: string,
  updatePackageTarget: SelfUpdatePackageTarget = installedPackageName,
  npmCommand?: string[],
): SelfUpdateCommand | undefined {
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  switch (method) {
    case "bun-binary":
      return undefined;
    case "pnpm": {
      const globalRoot = readCommandOutput("pnpm", ["root", "-g"]);
      const match =
        globalRoot !== undefined && globalRoot !== ""
          ? undefined
          : /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/u.exec(getPackageDir());
      const globalDir = match?.[1];
      const binDirArgs =
        globalDir === undefined
          ? []
          : [`--config.global-bin-dir=${readEnv("PNPM_HOME") || dirname(dirname(globalDir))}`];
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("pnpm", [
          "install",
          "-g",
          "--ignore-scripts",
          "--config.minimumReleaseAge=0",
          ...binDirArgs,
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("pnpm", [
              "remove",
              "-g",
              ...binDirArgs,
              installedPackageName,
            ]),
      );
    }
    case "yarn":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("yarn", [
          "global",
          "add",
          "--ignore-scripts",
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("yarn", ["global", "remove", installedPackageName]),
      );
    case "bun":
      return makeSelfUpdateCommand(
        makeSelfUpdateCommandStep("bun", [
          "install",
          "-g",
          "--ignore-scripts",
          "--minimum-release-age=0",
          target.installSpec,
        ]),
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep("bun", ["uninstall", "-g", installedPackageName]),
      );
    case "npm": {
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      const inferred =
        npmCommand?.length !== undefined && npmCommand?.length !== 0
          ? undefined
          : getInferredNpmInstall();
      const prefixArgs = [
        ...npmArgs,
        ...(inferred === undefined ? [] : ["--prefix", inferred.prefix]),
      ];

      const installStep = makeSelfUpdateCommandStep(command, [
        ...prefixArgs,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        target.installSpec,
      ]);
      const uninstallStep =
        target.packageName === installedPackageName
          ? undefined
          : makeSelfUpdateCommandStep(command, [
              ...prefixArgs,
              "uninstall",
              "-g",
              installedPackageName,
            ]);
      return makeSelfUpdateCommand(installStep, uninstallStep);
    }
    case "unknown":
      return undefined;
  }
}

function readCommandOutput(
  command: string,
  args: string[],
  options: { requireSuccess?: boolean } = {},
): string | undefined {
  const result = spawnProcessSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return result.stdout.trim() || undefined;
  if (options.requireSuccess === true) {
    const reason =
      result.error?.message || result.stderr.trim() || `exit code ${result.status ?? "unknown"}`;
    throw new Error(`Failed to run ${[command, ...args].join(" ")}: ${reason}`);
  }
  return undefined;
}

function getGlobalPackageRoots(
  method: InstallMethod,
  _packageName: string,
  npmCommand?: string[],
): string[] {
  switch (method) {
    case "npm": {
      const configured = npmCommand?.length !== undefined && npmCommand?.length !== 0;
      const [command = "npm", ...npmArgs] = npmCommand ?? [];
      if (configured && command === "bun") {
        const bunBin = readCommandOutput(command, [...npmArgs, "pm", "bin", "-g"], {
          requireSuccess: true,
        });
        const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
        if (bunBin !== undefined && bunBin !== "") {
          roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
        }
        return roots;
      }
      const root = readCommandOutput(command, [...npmArgs, "root", "-g"], {
        requireSuccess: configured,
      });
      const inferred = configured ? undefined : getInferredNpmInstall();
      return [root, inferred?.root].filter((x): x is string => x !== undefined && x !== "");
    }
    case "pnpm": {
      const root = readCommandOutput("pnpm", ["root", "-g"]);
      if (root !== undefined && root !== "") return [root, dirname(root)];
      const match = /^(.*[\\/]global[\\/][^\\/]+)[\\/]\.pnpm[\\/]/u.exec(getPackageDir());
      const globalDir = match?.[1];
      return globalDir === undefined ? [] : [globalDir];
    }
    case "yarn": {
      const dir = readCommandOutput("yarn", ["global", "dir"]);
      return dir !== undefined && dir !== "" ? [dir, join(dir, "node_modules")] : [];
    }
    case "bun": {
      const bunBin = readCommandOutput("bun", ["pm", "bin", "-g"]);
      const roots = [join(homedir(), ".bun", "install", "global", "node_modules")];
      if (bunBin !== undefined && bunBin !== "") {
        roots.push(join(dirname(bunBin), "install", "global", "node_modules"));
      }
      return roots;
    }
    case "bun-binary":
    case "unknown":
      return [];
  }
}

function normalizeExistingPathForComparison(
  path: string,
  resolveSymlinks: boolean,
): string | undefined {
  const resolvedPath = resolve(path);
  if (!existsSync(resolvedPath)) {
    return undefined;
  }
  let normalizedPath = resolvedPath;
  if (resolveSymlinks) {
    try {
      normalizedPath = realpathSync(resolvedPath);
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    normalizedPath = normalizedPath.toLowerCase();
  }
  return normalizedPath;
}

function getPathComparisonCandidates(path: string): string[] {
  return Array.from(
    new Set(
      [
        normalizeExistingPathForComparison(path, false),
        normalizeExistingPathForComparison(path, true),
      ].filter((candidate): candidate is string => candidate !== undefined && candidate !== ""),
    ),
  );
}

function getEntrypointPackageDir(): string | undefined {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined || entrypoint === "") return undefined;
  let dir = dirname(entrypoint);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return undefined;
}

function isSelfUpdatePathWritable(): boolean {
  const packageDir = getPackageDir();
  try {
    accessSync(packageDir, constants.W_OK);
    accessSync(dirname(packageDir), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isManagedByGlobalPackageManager(
  method: InstallMethod,
  packageName: string,
  npmCommand?: string[],
): boolean {
  const packageDirs = [getPackageDir(), getEntrypointPackageDir()].filter(
    (dir): dir is string => dir !== undefined && dir !== "",
  );
  const packageDirCandidates = packageDirs.flatMap((dir) => getPathComparisonCandidates(dir));
  return getGlobalPackageRoots(method, packageName, npmCommand).some((root) =>
    getPathComparisonCandidates(root).some((normalizedRoot) => {
      const rootPrefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
      return packageDirCandidates.some((packageDir) => packageDir.startsWith(rootPrefix));
    }),
  );
}

function getSelfUpdateCommandImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: SelfUpdatePackageTarget = packageName,
): SelfUpdateCommand | undefined {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(
    method,
    packageName,
    updatePackageTarget,
    npmCommand,
  );
  if (
    command === undefined ||
    !isManagedByGlobalPackageManager(method, packageName, npmCommand) ||
    !isSelfUpdatePathWritable()
  ) {
    return undefined;
  }
  return command;
}

export const getSelfUpdateCommand: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: SelfUpdatePackageTarget,
  ): SelfUpdateCommand | undefined;
  (
    npmCommand?: string[],
    updatePackageTarget?: SelfUpdatePackageTarget,
  ): (packageName: string) => SelfUpdateCommand | undefined;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateCommandImpl);

function getSelfUpdateUnavailableInstructionImpl(
  packageName: string,
  npmCommand?: string[],
  updatePackageTarget: SelfUpdatePackageTarget = packageName,
): string {
  const method = detectInstallMethod();
  const target = normalizeSelfUpdatePackageTarget(updatePackageTarget);
  if (method === "bun-binary") {
    return `Download from: ${RELEASES_URL}/latest`;
  }
  const command = getSelfUpdateCommandForMethod(method, packageName, target, npmCommand);
  if (command !== undefined) {
    if (
      isManagedByGlobalPackageManager(method, packageName, npmCommand) &&
      !isSelfUpdatePathWritable()
    ) {
      return `This installation is managed by a global ${method} install, but the install path is not writable. Update it yourself with: ${command.display}`;
    }
    return `This installation is not managed by a global ${method} install. Update it with the package manager, wrapper, or source checkout that provides it.`;
  }
  return `Update ${target.installSpec} using the package manager, wrapper, or source checkout that provides this installation.`;
}

export const getSelfUpdateUnavailableInstruction: {
  (
    packageName: string,
    npmCommand?: string[],
    updatePackageTarget?: SelfUpdatePackageTarget,
  ): string;
  (
    npmCommand?: string[],
    updatePackageTarget?: SelfUpdatePackageTarget,
  ): (packageName: string) => string;
} = dual((args: IArguments) => args.length >= 1, getSelfUpdateUnavailableInstructionImpl);

export function getUpdateInstruction(packageName: string): string {
  const method = detectInstallMethod();
  const command = getSelfUpdateCommandForMethod(method, packageName);
  if (command !== undefined) {
    return `Run: ${command.display}`;
  }
  return getSelfUpdateUnavailableInstruction(packageName);
}

export function findNodePackageDir(startDir: string): string {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      const parent = dirname(dir);

      if (basename(dir) === "dist" && existsSync(join(parent, "package.json"))) {
        return parent;
      }
      return dir;
    }
    dir = dirname(dir);
  }
  return startDir;
}

export function getPackageDir(): string {
  const envDir = readEnv("MSA_PACKAGE_DIR");
  if (envDir !== undefined && envDir !== "") {
    return normalizePath(envDir);
  }

  if (isBunBinary) {
    return dirname(process.execPath);
  }
  return findNodePackageDir(moduleDirname);
}

export function getThemesDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "theme");
  }

  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

export function getExportTemplateDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "export-html");
  }
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "core", "export-html");
}

export function getPackageJsonPath(): string {
  return join(getPackageDir(), "package.json");
}

export function getReadmePath(): string {
  return resolve(join(getPackageDir(), "README.md"));
}

export function getDocsPath(): string {
  return resolve(join(getPackageDir(), "docs"));
}

export function getExamplesPath(): string {
  return resolve(join(getPackageDir(), "examples"));
}

export function getChangelogPath(): string {
  return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

export function getInteractiveAssetsDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "assets");
  }
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "modes", "interactive", "assets");
}

export function getBundledInteractiveAssetPath(name: string): string {
  return join(getInteractiveAssetsDir(), name);
}

let quickJSWasmPath: string | undefined;

export function setEmbeddedQuickJSWasmPath(path: string): void {
  quickJSWasmPath = path;
}

export function getQuickJSWasmPath(): string {
  quickJSWasmPath ??= createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
  return quickJSWasmPath;
}

function resolveCodemodeWorkerSpecifierImpl(
  runtime: "bun-binary" | "bundled-node" | "unbundled",
  moduleUrl: string,
): string | URL | undefined {
  if (runtime === "bun-binary") return "./src/extensions/codemode/worker.ts";
  if (runtime === "bundled-node") return new URL("./codemode-worker.js", moduleUrl);
  return undefined;
}

export const resolveCodemodeWorkerSpecifier: {
  (
    runtime: "bun-binary" | "bundled-node" | "unbundled",
    moduleUrl: string,
  ): string | URL | undefined;
  (
    moduleUrl: string,
  ): (runtime: "bun-binary" | "bundled-node" | "unbundled") => string | URL | undefined;
} = dual((args: IArguments) => args.length >= 2, resolveCodemodeWorkerSpecifierImpl);

let codemodeWorkerDataUrl: URL | undefined;

export function getCodemodeWorkerSpecifier(): string | URL | undefined {
  const runtime = isBunBinary ? "bun-binary" : isBundledNode ? "bundled-node" : "unbundled";
  const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);
  if (runtime !== "bundled-node" || !(specifier instanceof URL)) return specifier;

  codemodeWorkerDataUrl ??= new URL(
    `data:text/javascript;base64,${readFileSync(specifier).toString("base64")}`,
  );
  return codemodeWorkerDataUrl;
}

export type InstallChange = { kind: "updated"; version: string } | { kind: "removed" };

export function detectInstallChange(
  packageJsonPath = startupPackageJsonPath,
): InstallChange | undefined {
  if (isBunBinary || packageJsonPath === undefined || packageJsonPath === "") return undefined;
  let installed: PackageJson;
  try {
    installed = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as PackageJson;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "removed" } : undefined;
  }
  return installed.version !== undefined &&
    installed.version !== "" &&
    installed.version !== VERSION
    ? { kind: "updated", version: installed.version }
    : undefined;
}

interface PackageJson {
  name?: string;
  version?: string;
  msaConfig?: {
    name?: string;
    configDir?: string;
  };
}

let pkg: PackageJson = {};

let startupPackageJsonPath: string | undefined;
try {
  const packageJsonPath = getPackageJsonPath();
  pkg = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8"))) as PackageJson;
  startupPackageJsonPath = packageJsonPath;
} catch (e: unknown) {
  const err = e as NodeJS.ErrnoException;
  if (err.code !== "ENOENT") throw e;
}

const msaConfigName: string | undefined = pkg.msaConfig?.name;
export const PACKAGE_NAME: string = pkg.name || "@msa/coding-agent";
export const APP_NAME: string = msaConfigName || "msa";
export const APP_TITLE: string =
  msaConfigName !== undefined && msaConfigName !== "" ? APP_NAME : "msa";
export const CONFIG_DIR_NAME: string = pkg.msaConfig?.configDir || ".msa";
export const VERSION: string = pkg.version || "0.0.0";
export const RELEASES_URL = "https://github.com/masseater/msa/releases";

export const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
export const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

export function expandTildePath(path: string): string {
  return normalizePath(path);
}

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

export function getShareViewerUrl(gistId: string): string {
  const baseUrl = readEnv("MSA_SHARE_VIEWER_URL") || DEFAULT_SHARE_VIEWER_URL;
  return `${baseUrl}#${gistId}`;
}

export function getAgentDir(): string {
  const envDir = readEnv(ENV_AGENT_DIR);
  if (envDir !== undefined && envDir !== "") {
    return expandTildePath(envDir);
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

export function getCustomThemesDir(): string {
  return join(getAgentDir(), "themes");
}

export function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

export function getAuthPath(): string {
  return join(getAgentDir(), "auth.json");
}

export function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

export function getToolsDir(): string {
  return join(getAgentDir(), "tools");
}

export function getBinDir(): string {
  return join(getAgentDir(), "bin");
}

export function getPromptsDir(): string {
  return join(getAgentDir(), "prompts");
}

export function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

export function getDebugLogPath(): string {
  return join(getAgentDir(), `${APP_NAME}-debug.log`);
}
