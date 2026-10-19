import {
  awaited,
  runTest,
  toJsonText,
  fromJsonText,
  readTextFile,
  writeTextFile,
  makeDirectory,
  changeMode,
  joinPath,
  pathDelimiter,
} from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PACKAGE_NAME, VERSION } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";
import {
  type PackageTestState,
  env,
  getNewerPatchVersion,
  runPackageCommandDirectly,
  setupPackageTest,
  teardownPackageTest,
} from "./package-command-paths-support.ts";

let state: PackageTestState;
let tempDir = "";
let agentDir = "";
let projectDir = "";
let originalExecPath = "";

const assignState = (next: PackageTestState): PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  agentDir = next.agentDir;
  projectDir = next.projectDir;
  originalExecPath = next.originalExecPath;
  return next;
};

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("allows explicit self-update checks when automatic version checks are disabled", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const previousSkipVersionCheck = readEnv("MSA_SKIP_VERSION_CHECK");
        vi.stubEnv("MSA_SKIP_VERSION_CHECK", "1");
        const fetchMock = vi.fn(() =>
          effectRunPromise(awaited(Response.json({ tag_name: `v${VERSION}` }))),
        );
        vi.stubGlobal("fetch", fetchMock);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* runPackageCommandDirectly(["update", "--self"]);

          expect(fetchMock).toHaveBeenCalledOnce();
          expect(logSpy.mock.calls.map(([message]) => String(message)).join("\n")).toContain(
            `msa is already up to date (v${VERSION})`,
          );
          expect(errorSpy).not.toHaveBeenCalled();
          expect(process.exitCode).toBeUndefined();
        } finally {
          env.restore("MSA_SKIP_VERSION_CHECK", previousSkipVersionCheck);
        }
      }),
    ));

  it("retries a transient self-update version check", () =>
    runTest(
      Effect.gen(function* () {
        const previousSkipVersionCheck = readEnv("MSA_SKIP_VERSION_CHECK");
        vi.stubEnv("MSA_SKIP_VERSION_CHECK", undefined);
        const fetchMock = vi
          .fn()
          .mockRejectedValueOnce(new Error("fetch failed"))
          .mockRejectedValueOnce(new Error("fetch failed"))
          .mockResolvedValueOnce(Response.json({ tag_name: `v${VERSION}` }));
        vi.stubGlobal("fetch", fetchMock);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* runPackageCommandDirectly(["update", "--self"]);
          expect(fetchMock).toHaveBeenCalledTimes(3);
          expect(errorSpy).not.toHaveBeenCalled();
        } finally {
          env.restore("MSA_SKIP_VERSION_CHECK", previousSkipVersionCheck);
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }),
    ));

  it("self-updates through the global npm prefix, not the project one", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const globalPrefix = joinPath(tempDir, "global-prefix");
        const projectPrefix = joinPath(tempDir, "project-prefix");
        const selfPackageDir = joinPath(
          globalPrefix,
          "lib",
          "node_modules",
          "@msa",
          "coding-agent",
        );
        const fakeNpmPath = joinPath(tempDir, "fake-npm.cjs");
        const recordPath = joinPath(tempDir, "self-update.json");
        yield* makeDirectory(selfPackageDir);
        yield* makeDirectory(joinPath(projectDir, ".msa"));
        yield* writeTextFile(
          fakeNpmPath,
          `const fs=require("node:fs"),path=require("node:path"),args=process.argv.slice(2),prefix=args[args.indexOf("--prefix")+1];
if(args.includes("root")) console.log(path.join(prefix,"lib","node_modules"));
else fs.writeFileSync(${yield* toJsonText(recordPath)},JSON.stringify(args));
`,
        );
        yield* writeTextFile(
          joinPath(agentDir, "settings.json"),
          yield* toJsonText({
            npmCommand: [originalExecPath, fakeNpmPath, "--prefix", globalPrefix],
          }),
        );
        yield* writeTextFile(
          joinPath(projectDir, ".msa", "settings.json"),
          yield* toJsonText({
            npmCommand: [originalExecPath, fakeNpmPath, "--prefix", projectPrefix],
          }),
        );
        vi.stubEnv("MSA_PACKAGE_DIR", selfPackageDir);
        Object.defineProperty(process, "execPath", {
          value: joinPath(selfPackageDir, "dist", "cli.js"),
          configurable: true,
        });
        const fetchMock = vi.fn(() =>
          effectRunPromise(awaited(Response.json({ tag_name: `v${VERSION}` }))),
        );
        vi.stubGlobal("fetch", fetchMock);

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* runPackageCommandDirectly(["update", "--self", "--force"]);

          expect(process.exitCode).toBeUndefined();
          expect(errorSpy).not.toHaveBeenCalled();
          expect(fetchMock).toHaveBeenCalledOnce();
          const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
          const recordedArgs = (yield* fromJsonText(yield* readTextFile(recordPath))) as string[];
          expect(recordedArgs).toContain(globalPrefix);
          expect(recordedArgs).toContain(`${PACKAGE_NAME}@${VERSION}`);
          expect(recordedArgs).not.toContain(PACKAGE_NAME);
          expect(recordedArgs).not.toContain(projectPrefix);
          expect(stdout).toContain(`Updated msa from ${VERSION} to ${VERSION}`);
        } finally {
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }),
    ));

  it("installs the latest release of the current package", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const globalPrefix = joinPath(tempDir, "global-prefix");
        const selfPackageDir = joinPath(
          globalPrefix,
          "lib",
          "node_modules",
          "@mariozechner",
          "msa-coding-agent",
        );
        const fakeNpmPath = joinPath(tempDir, "fake-npm.cjs");
        const recordPath = joinPath(tempDir, "self-update.json");
        yield* makeDirectory(selfPackageDir);
        yield* writeTextFile(
          fakeNpmPath,
          `const fs=require("node:fs"),path=require("node:path"),args=process.argv.slice(2),prefix=args[args.indexOf("--prefix")+1];
if(args.includes("root")) console.log(path.join(prefix,"lib","node_modules"));
else fs.writeFileSync(${yield* toJsonText(recordPath)},JSON.stringify(args));
`,
        );
        yield* writeTextFile(
          joinPath(agentDir, "settings.json"),
          yield* toJsonText({
            npmCommand: [originalExecPath, fakeNpmPath, "--prefix", globalPrefix],
          }),
        );
        vi.stubEnv("MSA_PACKAGE_DIR", selfPackageDir);
        Object.defineProperty(process, "execPath", {
          value: joinPath(selfPackageDir, "dist", "cli.js"),
          configurable: true,
        });
        const targetVersion = getNewerPatchVersion();
        const fetchMock = vi.fn(() =>
          effectRunPromise(awaited(Response.json({ tag_name: `v${targetVersion}` }))),
        );
        vi.stubGlobal("fetch", fetchMock);

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* runPackageCommandDirectly(["update", "--self"]);

          expect(process.exitCode).toBeUndefined();
          expect(errorSpy).not.toHaveBeenCalled();
          expect(fetchMock).toHaveBeenCalledOnce();
          const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
          const recordedArgs = (yield* fromJsonText(yield* readTextFile(recordPath))) as string[];
          expect(recordedArgs).toContain(`${PACKAGE_NAME}@${targetVersion}`);
          expect(recordedArgs).not.toContain(PACKAGE_NAME);
          expect(stdout).toContain(`Updated msa from ${VERSION} to ${targetVersion}`);
        } finally {
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }),
    ));

  it("prints a pnpm metadata hint when self-update fails", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const globalRoot = joinPath(tempDir, "pnpm", "global", "v11");
        const selfPackageDir = joinPath(globalRoot, "node_modules", "@msa", "coding-agent");
        const fakeBinDir = joinPath(tempDir, "bin");
        const fakePnpmPath = joinPath(
          fakeBinDir,
          process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        );
        yield* makeDirectory(selfPackageDir);
        yield* makeDirectory(fakeBinDir);
        yield* writeTextFile(
          joinPath(selfPackageDir, "package.json"),
          yield* toJsonText({ name: PACKAGE_NAME, version: VERSION }),
        );
        const fakePnpmScript =
          process.platform === "win32"
            ? `@echo off\r\nif "%1"=="root" if "%2"=="-g" (echo ${globalRoot} & exit /b 0)\r\nexit /b 23\r\n`
            : `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${globalRoot.replaceAll("'", "'\\''")}'\n\texit 0\nfi\nexit 23\n`;
        yield* writeTextFile(fakePnpmPath, fakePnpmScript);
        yield* changeMode(fakePnpmPath, 0o755);
        const inheritedPath = readEnv("PATH");
        vi.stubEnv(
          "PATH",
          `${fakeBinDir}${inheritedPath === undefined ? "" : `${pathDelimiter}${inheritedPath}`}`,
        );
        vi.stubEnv("MSA_PACKAGE_DIR", selfPackageDir);
        Object.defineProperty(process, "execPath", {
          value: joinPath(tempDir, "pnpm", "bin", "node"),
          configurable: true,
        });
        vi.stubGlobal(
          "fetch",
          vi.fn(() =>
            effectRunPromise(awaited(Response.json({ tag_name: `v${getNewerPatchVersion()}` }))),
          ),
        );

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* runPackageCommandDirectly(["update", "--self"]);

          expect(process.exitCode).toBe(1);
          const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
          const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
          expect(stdout).not.toContain("Updated msa");
          expect(stderr).toContain("exited with code 23");
          expect(stderr).toContain("If pnpm reports missing package versions");
          expect(stderr).toContain("Run `pnpm store prune` and retry `msa update --self`.");
        } finally {
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }),
    ));
});
