import {
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathDelimiter,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { detectInstallMethod, getSelfUpdateCommand } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = readEnv("PATH");
const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", {
    value,
    configurable: true,
  });
}

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

const createPnpmGlobalInstall = Effect.fn("createPnpmGlobalInstall")(function* () {
  const temp = yield* makeTempDir("msa-pnpm-");
  const binDir = joinPath(temp, "bin");
  const root = joinPath(temp, "pnpm", "global", "5", "node_modules");
  const packageDir = joinPath(root, "@mariozechner", "msa-coding-agent");
  yield* makeDirectory(packageDir);
  yield* makeDirectory(binDir);
  const binPath = joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  yield* writeTextFile(binPath, createFakePnpmScript(root));
  yield* changeMode(binPath, 0o755);
  tempDir = temp;
  vi.stubEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(
    joinPath(
      root,
      ".pnpm",
      "@mariozechner+msa-coding-agent@0.0.0",
      "node_modules",
      "@mariozechner",
      "msa-coding-agent",
      "dist",
      "cli.js",
    ),
  );
  return { root, packageDir };
});

const createYarnGlobalInstall = Effect.fn("createYarnGlobalInstall")(function* () {
  const temp = yield* makeTempDir("msa-yarn-");
  const binDir = joinPath(temp, "bin");
  const globalDir = joinPath(temp, "yarn", "global");
  const packageDir = joinPath(globalDir, "node_modules", "@mariozechner", "msa-coding-agent");
  yield* makeDirectory(packageDir);
  yield* makeDirectory(binDir);
  const binPath = joinPath(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn");
  yield* writeTextFile(binPath, createFakeYarnScript(globalDir));
  yield* changeMode(binPath, 0o755);
  tempDir = temp;
  vi.stubEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(globalDir, ".yarn", "@mariozechner", "msa-coding-agent", "dist", "cli.js"));
  return { globalDir, packageDir };
});

function createFakePnpmScript(root: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="root" if "%2"=="-g" echo ${root}\r\n`;
  }
  const escapedRoot = root.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${escapedRoot}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeYarnScript(globalDir: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="global" if "%2"=="dir" echo ${globalDir}\r\n`;
  }
  const escapedGlobalDir = globalDir.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "global" ] && [ "$2" = "dir" ]; then\n\tprintf '%s\\n' '${escapedGlobalDir}'\n\texit 0\nfi\nexit 1\n`;
}

describe("detectInstallMethod 1", () => {
  test("self-updates renamed pnpm global installs by removing the old package first", () =>
    runTest(
      Effect.gen(function* () {
        yield* createPnpmGlobalInstall();
        const command = getSelfUpdateCommand(
          "@mariozechner/pi-coding-agent",
          undefined,
          "@new-scope/msa",
        );
        expect(detectInstallMethod()).toBe("pnpm");
        expect(command).toEqual({
          command: "pnpm",
          args: [
            "install",
            "-g",
            "--ignore-scripts",
            "--config.minimumReleaseAge=0",
            "@new-scope/msa",
          ],
          display:
            "pnpm remove -g @mariozechner/pi-coding-agent && pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/msa",
          steps: [
            {
              command: "pnpm",
              args: ["remove", "-g", "@mariozechner/pi-coding-agent"],
              display: "pnpm remove -g @mariozechner/pi-coding-agent",
            },
            {
              command: "pnpm",
              args: [
                "install",
                "-g",
                "--ignore-scripts",
                "--config.minimumReleaseAge=0",
                "@new-scope/msa",
              ],
              display:
                "pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/msa",
            },
          ],
        });
      }),
    ));
  test("self-updates pnpm v11 global installs resolved through the store", () =>
    runTest(
      Effect.gen(function* () {
        const temp = yield* makeTempDir("msa-pnpm11-");
        const binDir = joinPath(temp, "bin");
        const root = joinPath(temp, "Library", "pnpm", "global", "v11");
        const packageName = "@msa/coding-agent";
        const globalPackageDir = joinPath(root, "11e9a", "node_modules", "@msa", "coding-agent");
        const storePackageDir = joinPath(
          temp,
          "Library",
          "pnpm",
          "store",
          "v11",
          "links",
          "@msa",
          "coding-agent",
          "0.75.0",
          "hash",
          "node_modules",
          "@msa",
          "coding-agent",
        );
        yield* makeDirectory(globalPackageDir);
        yield* makeDirectory(storePackageDir);
        yield* makeDirectory(binDir);
        yield* writeTextFile(joinPath(globalPackageDir, "package.json"), "{}");
        const binPath = joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
        yield* writeTextFile(binPath, createFakePnpmScript(root));
        yield* changeMode(binPath, 0o755);
        tempDir = temp;
        vi.stubEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
        vi.stubEnv("MSA_PACKAGE_DIR", storePackageDir);
        process.argv[1] = joinPath(globalPackageDir, "dist", "cli.js");
        setExecPath(joinPath(storePackageDir, "dist", "cli.js"));

        const command = getSelfUpdateCommand(packageName);

        expect(detectInstallMethod()).toBe("pnpm");
        expect(command).toEqual({
          command: "pnpm",
          args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", packageName],
          display: `pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 ${packageName}`,
        });
      }),
    ));
  test("self-updates renamed yarn global installs by removing the old package first", () =>
    runTest(
      Effect.gen(function* () {
        yield* createYarnGlobalInstall();
        const command = getSelfUpdateCommand(
          "@mariozechner/pi-coding-agent",
          undefined,
          "@new-scope/msa",
        );
        expect(detectInstallMethod()).toBe("yarn");
        expect(command).toEqual({
          command: "yarn",
          args: ["global", "add", "--ignore-scripts", "@new-scope/msa"],
          display:
            "yarn global remove @mariozechner/pi-coding-agent && yarn global add --ignore-scripts @new-scope/msa",
          steps: [
            {
              command: "yarn",
              args: ["global", "remove", "@mariozechner/pi-coding-agent"],
              display: "yarn global remove @mariozechner/pi-coding-agent",
            },
            {
              command: "yarn",
              args: ["global", "add", "--ignore-scripts", "@new-scope/msa"],
              display: "yarn global add --ignore-scripts @new-scope/msa",
            },
          ],
        });
      }),
    ));
});
