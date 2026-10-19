import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { homedir } from "os";
import { fileURLToPath } from "url";

import { dual } from "effect/Function";

import { basename, dirname, join, resolve } from "./core/platform-node.ts";
import { readEnv } from "./core/platform.ts";
import { normalizePath } from "./utils/paths.ts";
import { stripBom } from "./utils/text.ts";

export const moduleFilename = fileURLToPath(import.meta.url);
export const moduleDirname = dirname(moduleFilename);

export const isBunBinary =
  import.meta.url.includes("$bunfs") ||
  import.meta.url.includes("~BUN") ||
  import.meta.url.includes("%7EBUN");

export const isBunRuntime = process.versions["bun"] !== undefined && process.versions["bun"] !== "";

declare const MSA_BUNDLED_NODE: boolean;
export const isBundledNode = typeof MSA_BUNDLED_NODE !== "undefined" && MSA_BUNDLED_NODE;

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
