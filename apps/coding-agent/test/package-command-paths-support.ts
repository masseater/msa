import testing from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import config from "../src/config.ts";
import type packageManagerTypes from "../src/core/package-manager.types.ts";
import platform from "../src/core/platform/index.ts";
import packageManagerCli from "../src/package-manager-cli.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";
import testNetworkEnv from "./test-network-env.ts";

const { readEnv } = platform;
const { ENV_AGENT_DIR, VERSION } = config;
const { handlePackageCommand } = packageManagerCli;

const { allowNetwork } = testNetworkEnv;

const { awaited, joinPath, makeDirectory, makeTempDir, removePath, toJsonText } = testing;

const toJsonTextSync = (value: unknown): string => Effect.runSync(toJsonText(value));

const restore = (name: string, value: string | undefined): void => {
  vi.stubEnv(name, value);
};

const env = { restore };

const setupPackageTest: Effect.Effect<packageCommandPathsSupportTypes.PackageTestState> =
  Effect.gen(function* () {
    allowNetwork();
    const tempDir = yield* makeTempDir("msa-package-commands-");
    const agentDir = joinPath(tempDir, "agent");
    const projectDir = joinPath(tempDir, "project");
    const packageDir = joinPath(tempDir, "local-package");
    yield* makeDirectory(agentDir);
    yield* makeDirectory(projectDir);
    yield* makeDirectory(packageDir);

    const state: packageCommandPathsSupportTypes.PackageTestState = {
      agentDir,
      originalAgentDir: readEnv(ENV_AGENT_DIR),
      originalCwd: process.cwd(),
      originalExecPath: process.execPath,
      originalExitCode: process.exitCode,
      originalMsaPackageDir: readEnv("MSA_PACKAGE_DIR"),
      originalPath: readEnv("PATH"),
      packageDir,
      projectDir,
      tempDir,
    };

    process.exitCode = undefined;
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      if (code === undefined || code === null || Number(code) === 0) {
        process.exitCode = undefined;
      } else {
        process.exitCode = code;
      }
      return undefined as never;
    }) as typeof process.exit);
    vi.stubEnv(ENV_AGENT_DIR, agentDir);
    process.chdir(projectDir);
    return state;
  });

const teardownPackageTest = (
  state: packageCommandPathsSupportTypes.PackageTestState,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.chdir(state.originalCwd);
    process.exitCode = state.originalExitCode;
    restore(ENV_AGENT_DIR, state.originalAgentDir);
    restore("MSA_PACKAGE_DIR", state.originalMsaPackageDir);
    restore("PATH", state.originalPath);
    Object.defineProperty(process, "execPath", {
      configurable: true,
      value: state.originalExecPath,
    });
    return removePath(state.tempDir);
  });

const runPackageCommandDirectly = (args: string[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!(yield* awaited(handlePackageCommand(args)))) {
      throw new Error("handlePackageCommand did not handle the arguments");
    }
  });

const getNewerPatchVersion = (): string => {
  const [major = "0", minor = "0", patch = "0"] = VERSION.split(".");
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
};

const extension = (
  packageRoot: string,
  source: string,
  scope: "user" | "project",
  names: string[],
): packageManagerTypes.ResolvedPaths => ({
  extensions: names.map((name) => ({
    enabled: true,
    metadata: { baseDir: packageRoot, origin: "package", scope, source },
    path: joinPath(packageRoot, "extensions", name),
  })),
  prompts: [],
  skills: [],
  themes: [],
});

const paths = { extension };

const packageCommandPathsSupport = {
  env,
  getNewerPatchVersion,
  paths,
  runPackageCommandDirectly,
  setupPackageTest,
  teardownPackageTest,
  toJsonTextSync,
};

export default packageCommandPathsSupport;
