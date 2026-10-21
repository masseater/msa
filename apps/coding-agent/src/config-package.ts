import { dual } from "effect/Function";

import type configPackageTypes from "./config-package.types.ts";
import platform from "./core/platform/index.ts";
import nodeFs from "./core/platform/node/fs.ts";
import nodeModule from "./core/platform/node/module.ts";
import nodeOs from "./core/platform/node/os.ts";
import nodeUrl from "./core/platform/node/url.ts";
import paths from "./utils/paths.ts";
import text from "./utils/text.ts";

const { createRequire } = nodeModule;
const { homedir } = nodeOs;
const { fileURLToPath } = nodeUrl;

const { existsSync, readFileSync } = nodeFs;

const { basename, dirname, join, readEnv, resolve } = platform;
const { normalizePath } = paths;
const { stripBom } = text;

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = dirname(moduleFilename);

const isBunBinary =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

const isBunRuntime = process.versions["bun"] !== undefined && process.versions["bun"] !== "";

declare const MSA_BUNDLED_NODE: boolean;
const isBundledNode = typeof MSA_BUNDLED_NODE !== "undefined" && MSA_BUNDLED_NODE;

function findNodePackageDir(startDir: string): string {
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

function getPackageDir(): string {
  const envDir = readEnv("MSA_PACKAGE_DIR");
  if (envDir !== undefined && envDir !== "") {
    return normalizePath(envDir);
  }

  if (isBunBinary) {
    return dirname(process.execPath);
  }
  return findNodePackageDir(moduleDirname);
}

function getThemesDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "theme");
  }

  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "modes", "interactive", "theme");
}

function getExportTemplateDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "export-html");
  }
  const packageDir = getPackageDir();
  const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
  return join(packageDir, srcOrDist, "core", "export-html");
}

function getPackageJsonPath(): string {
  return join(getPackageDir(), "package.json");
}

function getReadmePath(): string {
  return resolve(join(getPackageDir(), "README.md"));
}

function getDocsPath(): string {
  return resolve(join(getPackageDir(), "docs"));
}

function getExamplesPath(): string {
  return resolve(join(getPackageDir(), "examples"));
}

function getChangelogPath(): string {
  return resolve(join(getPackageDir(), "CHANGELOG.md"));
}

let quickJSWasmPath: string | undefined;

function setEmbeddedQuickJSWasmPath(path: string): void {
  quickJSWasmPath = path;
}

function getQuickJSWasmPath(): string {
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

const resolveCodemodeWorkerSpecifier: {
  (
    runtime: "bun-binary" | "bundled-node" | "unbundled",
    moduleUrl: string,
  ): string | URL | undefined;
  (
    moduleUrl: string,
  ): (runtime: "bun-binary" | "bundled-node" | "unbundled") => string | URL | undefined;
} = dual((args: IArguments) => args.length >= 2, resolveCodemodeWorkerSpecifierImpl);

let codemodeWorkerDataUrl: URL | undefined;

function getCodemodeWorkerSpecifier(): string | URL | undefined {
  const runtime = isBunBinary ? "bun-binary" : isBundledNode ? "bundled-node" : "unbundled";
  const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);
  if (runtime !== "bundled-node" || !(specifier instanceof URL)) return specifier;

  codemodeWorkerDataUrl ??= new URL(
    `data:text/javascript;base64,${readFileSync(specifier).toString("base64")}`,
  );
  return codemodeWorkerDataUrl;
}

function detectInstallChange(
  packageJsonPath = startupPackageJsonPath,
): configPackageTypes.InstallChange | undefined {
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
const PACKAGE_NAME: string = pkg.name || "@msa/coding-agent";
const APP_NAME: string = msaConfigName || "msa";
const APP_TITLE: string = msaConfigName !== undefined && msaConfigName !== "" ? APP_NAME : "msa";
const CONFIG_DIR_NAME: string = pkg.msaConfig?.configDir || ".msa";
const VERSION: string = pkg.version || "0.0.0";
const RELEASES_URL = "https://github.com/masseater/msa/releases";

const ENV_AGENT_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`;
const ENV_SESSION_DIR = `${APP_NAME.toUpperCase()}_CODING_AGENT_SESSION_DIR`;

function expandTildePath(path: string): string {
  return normalizePath(path);
}

const DEFAULT_SHARE_VIEWER_URL = "https://pi.dev/session/";

function getShareViewerUrl(gistId: string): string {
  const baseUrl = readEnv("MSA_SHARE_VIEWER_URL") || DEFAULT_SHARE_VIEWER_URL;
  return `${baseUrl}#${gistId}`;
}

function getAgentDir(): string {
  const envDir = readEnv(ENV_AGENT_DIR);
  if (envDir !== undefined && envDir !== "") {
    return expandTildePath(envDir);
  }
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

function getCustomThemesDir(): string {
  return join(getAgentDir(), "themes");
}

function getModelsPath(): string {
  return join(getAgentDir(), "models.json");
}

function getAuthPath(): string {
  return join(getAgentDir(), "auth.json");
}

function getSettingsPath(): string {
  return join(getAgentDir(), "settings.json");
}

function getToolsDir(): string {
  return join(getAgentDir(), "tools");
}

function getBinDir(): string {
  return join(getAgentDir(), "bin");
}

function getPromptsDir(): string {
  return join(getAgentDir(), "prompts");
}

function getSessionsDir(): string {
  return join(getAgentDir(), "sessions");
}

function getDebugLogPath(): string {
  return join(getAgentDir(), `${APP_NAME}-debug.log`);
}

const configPackage = {
  APP_NAME,
  APP_TITLE,
  CONFIG_DIR_NAME,
  ENV_AGENT_DIR,
  ENV_SESSION_DIR,
  PACKAGE_NAME,
  RELEASES_URL,
  VERSION,
  detectInstallChange,
  expandTildePath,
  findNodePackageDir,
  getAgentDir,
  getAuthPath,
  getBinDir,
  getChangelogPath,
  getCodemodeWorkerSpecifier,
  getCustomThemesDir,
  getDebugLogPath,
  getDocsPath,
  getExamplesPath,
  getExportTemplateDir,
  getModelsPath,
  getPackageDir,
  getPackageJsonPath,
  getPromptsDir,
  getQuickJSWasmPath,
  getReadmePath,
  getSessionsDir,
  getSettingsPath,
  getShareViewerUrl,
  getThemesDir,
  getToolsDir,
  isBunBinary,
  isBunRuntime,
  isBundledNode,
  moduleDirname,
  moduleFilename,
  resolveCodemodeWorkerSpecifier,
  setEmbeddedQuickJSWasmPath,
};

export default configPackage;
