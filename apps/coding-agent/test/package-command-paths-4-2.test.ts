import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import config from "../src/config.ts";
import platform from "../src/core/platform/index.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";

const { PACKAGE_NAME, VERSION } = config;
const { readEnv } = platform;

const { getNewerPatchVersion, runPackageCommandDirectly, setupPackageTest, teardownPackageTest } =
  packageCommandPathsSupport;

const { changeMode, joinPath, makeDirectory, pathDelimiter, runTest, toJsonText, writeTextFile } =
  testing;

let state: packageCommandPathsSupportTypes.PackageTestState;

let tempDir = "";

const assignState = (
  next: packageCommandPathsSupportTypes.PackageTestState,
): packageCommandPathsSupportTypes.PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  return next;
};

const fakePnpmScriptFor = (globalRoot: string): string =>
  process.platform === "win32"
    ? `@echo off\r\nif "%1"=="root" if "%2"=="-g" (echo ${globalRoot} & exit /b 0)\r\nexit /b 23\r\n`
    : `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${globalRoot.replaceAll("'", "'\\''")}'\n\texit 0\nfi\nexit 23\n`;

const installFailingPnpm = Effect.fn("installFailingPnpm")(function* () {
  const globalRoot = joinPath(tempDir, "pnpm", "global", "v11");
  const selfPackageDir = joinPath(globalRoot, "node_modules", "@msa", "coding-agent");
  const fakeBinDir = joinPath(tempDir, "bin");
  const fakePnpmPath = joinPath(fakeBinDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  yield* makeDirectory(selfPackageDir);
  yield* makeDirectory(fakeBinDir);
  yield* writeTextFile(
    joinPath(selfPackageDir, "package.json"),
    yield* toJsonText({ name: PACKAGE_NAME, version: VERSION }),
  );
  yield* writeTextFile(fakePnpmPath, fakePnpmScriptFor(globalRoot));
  yield* changeMode(fakePnpmPath, 0o755);
  const inheritedPath = readEnv("PATH");
  vi.stubEnv(
    "PATH",
    `${fakeBinDir}${inheritedPath === undefined ? "" : `${pathDelimiter}${inheritedPath}`}`,
  );
  vi.stubEnv("MSA_PACKAGE_DIR", selfPackageDir);
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value: joinPath(tempDir, "pnpm", "bin", "node"),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ tag_name: `v${getNewerPatchVersion()}` }))),
  );
});

const printsAPnpmMetadataHintWhenSelf = Effect.gen(function* () {
  yield* installFailingPnpm();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const joined = (spy: typeof logSpy) =>
    spy.mock.calls.map(([message]) => String(message)).join("\n");
  const { stderr, stdout } = yield* runPackageCommandDirectly(["update", "--self"]).pipe(
    Effect.map(() => ({ stderr: joined(errorSpy), stdout: joined(logSpy) })),
    Effect.ensuring(
      Effect.sync(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
      }),
    ),
  );
  expect(process.exitCode).toBe(1);
  expect(stdout).not.toContain("Updated msa");
  expect(stderr).toContain("exited with code 23");
  expect(stderr).toContain("If pnpm reports missing package versions");
  expect(stderr).toContain("Run `pnpm store prune` and retry `msa update --self`.");
});

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("prints a pnpm metadata hint when self-update fails", () =>
    runTest(printsAPnpmMetadataHintWhenSelf));
});
