import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import config from "../src/config.ts";
import platform from "../src/core/platform/index.ts";
import config2Support from "./config-2-support.ts";

const { readEnv } = platform;
const { detectInstallMethod, getSelfUpdateCommand, getUpdateInstruction } = config;

const { setExecPath } = config2Support;

const {
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathDelimiter,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");

const originalPath = readEnv("PATH");

const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");

const originalArgv1 = process.argv[1];

let tempDir: string | undefined;

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      vi.unstubAllEnvs();
      if (execPathDescriptor !== undefined) {
        Object.defineProperty(process, "execPath", execPathDescriptor);
      }
      if (originalPath === undefined) vi.stubEnv("PATH", undefined);
      else vi.stubEnv("PATH", originalPath);
      if (originalMsaPackageDir === undefined) vi.stubEnv("MSA_PACKAGE_DIR", undefined);
      else vi.stubEnv("MSA_PACKAGE_DIR", originalMsaPackageDir);
      if (originalArgv1 === undefined) process.argv.splice(1, 1);
      else process.argv[1] = originalArgv1;
      if (tempDir !== undefined && tempDir.length > 0) {
        yield* removePath(tempDir);
        tempDir = undefined;
      }
    }),
  ),
);

const createNpmPrefixInstall = Effect.fn("createNpmPrefixInstall")(function* (
  template = "msa-prefix-",
) {
  const prefix = yield* makeTempDir(template);
  const root = joinPath(prefix, "lib", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  yield* makeDirectory(packageDir);
  tempDir = prefix;
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { packageDir, prefix };
});

const createBunGlobalInstall = Effect.fn("createBunGlobalInstall")(function* () {
  const temp = yield* makeTempDir("msa-bun-");
  const prefix = joinPath(temp, ".bun");
  const bunBin = joinPath(prefix, "bin");
  const root = joinPath(prefix, "install", "global", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  yield* makeDirectory(packageDir);
  yield* makeDirectory(bunBin);
  const bunPath = joinPath(bunBin, process.platform === "win32" ? "bun.cmd" : "bun");
  yield* writeTextFile(bunPath, createFakeBunScript(bunBin));
  yield* changeMode(bunPath, 0o755);
  tempDir = temp;
  vi.stubEnv("PATH", `${bunBin}${pathDelimiter}${originalPath ?? ""}`);
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { packageDir };
});

function createFakeBunScript(bunBin: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
  }
  const escapedBunBin = bunBin.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

const selfUpdateTreatsEmptyNpmcommandAsUnset = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall();
      const command = getSelfUpdateCommand("@msa/coding-agent", []);
      expect(command?.args).toEqual([
        "--prefix",
        prefix,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        "@msa/coding-agent",
      ]);
    }),
  );

const quotesNpmSelfUpdateDisplayPaths = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall("msa prefix ");
      const command = getSelfUpdateCommand("@msa/coding-agent");
      expect(command?.display).toBe(
        `npm --prefix "${prefix}" install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
      );
    }),
  );

const doesNotInferWindowsNpmCustomPrefixes = () => {
  const packageDir = "C:\\Users\\Admin\\npm prefix\\node_modules\\@msa\\coding-agent";
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(`${packageDir}\\dist\\cli.js`);

  expect(detectInstallMethod()).toBe("npm");
  expect(getUpdateInstruction("@msa/coding-agent")).toBe(
    "Run: npm install -g --ignore-scripts --min-release-age=0 @msa/coding-agent",
  );
};

const selfUpdatesBunGlobalInstallsFromBun = () =>
  runTest(
    Effect.gen(function* () {
      yield* createBunGlobalInstall();
      const command = getSelfUpdateCommand("@msa/coding-agent");
      expect(detectInstallMethod()).toBe("bun");
      expect(command).toEqual({
        args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@msa/coding-agent"],
        command: "bun",
        display: "bun install -g --ignore-scripts --minimum-release-age=0 @msa/coding-agent",
      });
    }),
  );

describe("detectInstallMethod", () => {
  test("self-update treats empty npmCommand as unset", selfUpdateTreatsEmptyNpmcommandAsUnset);

  test("quotes npm self-update display paths", quotesNpmSelfUpdateDisplayPaths);

  test(
    "does not infer Windows npm custom prefixes from package paths",
    doesNotInferWindowsNpmCustomPrefixes,
  );

  test("self-updates bun global installs from bun pm bin", selfUpdatesBunGlobalInstallsFromBun);
});
