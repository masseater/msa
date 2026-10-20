import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { PACKAGE_NAME, VERSION } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";

const {
  env,
  getNewerPatchVersion,
  runPackageCommandDirectly,
  setupPackageTest,
  teardownPackageTest,
} = packageCommandPathsSupport;

const {
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  readTextFile,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let state: packageCommandPathsSupportTypes.PackageTestState;

let tempDir = "";

let agentDir = "";

let projectDir = "";

let originalExecPath = "";

const assignState = (
  next: packageCommandPathsSupportTypes.PackageTestState,
): packageCommandPathsSupportTypes.PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  agentDir = next.agentDir;
  projectDir = next.projectDir;
  originalExecPath = next.originalExecPath;
  return next;
};

const allowsExplicitSelfUpdateChecksWhenAutomatic = Effect.gen(function* () {
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
});

const retriesATransientSelfUpdateVersionCheck = Effect.gen(function* () {
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
});

const selfUpdatesThroughTheGlobalNpmPrefixPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const globalPrefix = joinPath(tempDir, "global-prefix");
    const projectPrefix = joinPath(tempDir, "project-prefix");
    const selfPackageDir = joinPath(globalPrefix, "lib", "node_modules", "@msa", "coding-agent");
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
    return {
      effectRunPromise,
      fakeNpmPath,
      globalPrefix,
      projectPrefix,
      recordPath,
      selfPackageDir,
    };
  });

const selfUpdatesThroughTheGlobalNpmPrefix = Effect.gen(function* () {
  const { effectRunPromise, fakeNpmPath, globalPrefix, projectPrefix, recordPath, selfPackageDir } =
    yield* selfUpdatesThroughTheGlobalNpmPrefixPart1();
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
    configurable: true,
    value: joinPath(selfPackageDir, "dist", "cli.js"),
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
});

const installsTheLatestReleaseOfTheCurrentPart1 = () =>
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
    return { effectRunPromise, globalPrefix, selfPackageDir };
  });

const installsTheLatestReleaseOfTheCurrent = Effect.gen(function* () {
  const { effectRunPromise, globalPrefix, selfPackageDir } =
    yield* installsTheLatestReleaseOfTheCurrentPart1();
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
    configurable: true,
    value: joinPath(selfPackageDir, "dist", "cli.js"),
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
});

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("allows explicit self-update checks when automatic version checks are disabled", () =>
    runTest(allowsExplicitSelfUpdateChecksWhenAutomatic));

  it("retries a transient self-update version check", () =>
    runTest(retriesATransientSelfUpdateVersionCheck));

  it("self-updates through the global npm prefix, not the project one", () =>
    runTest(selfUpdatesThroughTheGlobalNpmPrefix));

  it("installs the latest release of the current package", () =>
    runTest(installsTheLatestReleaseOfTheCurrent));
});
