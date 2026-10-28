import { dual } from "effect/Function";

import type configPackageTypes from "./config-package.types.ts";
import platform from "./core/platform/index.ts";
import nodeModule from "./core/platform/node/module.ts";
import nodeLlamaCppModule from "./core/platform/node/node-llama-cpp.ts";
import nodeOs from "./core/platform/node/os.ts";
import packageFiles from "./core/platform/node/package-files.ts";
import nodeUrl from "./core/platform/node/url.ts";
import paths from "./utils/paths.ts";
import text from "./utils/text.ts";

const { createRequire } = nodeModule;
const { homedir } = nodeOs;
const { fileURLToPath } = nodeUrl;
const { importNodeLlamaCppAt } = nodeLlamaCppModule;

const { locatePackageDir, readStartupPackageJson, sourceLayoutOf } = packageFiles;

const { dirname, join, readEnv, resolve } = platform;
const { readFile, readText } = platform.files;
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

let nodePackageDir: string | undefined;

const sourceLayouts = new Map<string, "dist" | "src">();

function sourceLayout(packageDir: string): "dist" | "src" {
  const known = sourceLayouts.get(packageDir) ?? sourceLayoutOf(packageDir);
  sourceLayouts.set(packageDir, known);
  return known;
}

function getPackageDir(): string {
  const envDir = readEnv("MSA_PACKAGE_DIR");
  if (envDir !== undefined && envDir !== "") {
    return normalizePath(envDir);
  }

  if (isBunBinary) {
    return dirname(process.execPath);
  }
  nodePackageDir ??= locatePackageDir(moduleDirname);
  return nodePackageDir;
}

function getThemesDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "theme");
  }

  const packageDir = getPackageDir();
  return join(packageDir, sourceLayout(packageDir), "modes", "interactive", "theme");
}

function getExportTemplateDir(): string {
  if (isBunBinary) {
    return join(getPackageDir(), "export-html");
  }
  const packageDir = getPackageDir();
  return join(packageDir, sourceLayout(packageDir), "core", "export-html");
}

function nodeLlamaCppLoader(): (() => ReturnType<typeof importNodeLlamaCppAt>) | undefined {
  if (!isBunBinary) return undefined;
  const entry = join(getPackageDir(), "node_modules", "node-llama-cpp", "dist", "index.js");
  return () => importNodeLlamaCppAt(entry);
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
  if (runtime === "bun-binary") return "./dist/extensions/codemode/worker.js";
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

let codemodeWorkerDataUrl: Promise<URL> | undefined;

function getCodemodeWorkerSpecifier(): Promise<string | URL | undefined> {
  const runtime = isBunBinary ? "bun-binary" : isBundledNode ? "bundled-node" : "unbundled";
  const specifier = resolveCodemodeWorkerSpecifier(runtime, import.meta.url);
  if (runtime !== "bundled-node" || !(specifier instanceof URL)) return Promise.resolve(specifier);

  codemodeWorkerDataUrl ??= readFile(fileURLToPath(specifier)).then(
    (bytes) => new URL(`data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`),
  );
  return codemodeWorkerDataUrl;
}

const installChangeOf = (installed: PackageJson): configPackageTypes.InstallChange | undefined =>
  installed.version !== undefined && installed.version !== "" && installed.version !== VERSION
    ? { kind: "updated", version: installed.version }
    : undefined;

function detectInstallChange(
  packageJsonPath = startupPackageJsonPath,
): Promise<configPackageTypes.InstallChange | undefined> {
  if (isBunBinary || packageJsonPath === undefined || packageJsonPath === "")
    return Promise.resolve(undefined);
  return readText(packageJsonPath).then(
    (manifest) => installChangeOf(JSON.parse(stripBom(manifest)) as PackageJson),
    (error: unknown) => (platform.isMissingPath(error) ? { kind: "removed" as const } : undefined),
  );
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
{
  const packageJsonPath = getPackageJsonPath();
  const packageJsonText = readStartupPackageJson(packageJsonPath);
  if (packageJsonText !== undefined) {
    pkg = JSON.parse(stripBom(packageJsonText)) as PackageJson;
    startupPackageJsonPath = packageJsonPath;
  }
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
  findNodePackageDir: locatePackageDir,
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
  nodeLlamaCppLoader,
  resolveCodemodeWorkerSpecifier,
  setEmbeddedQuickJSWasmPath,
};

export default configPackage;
