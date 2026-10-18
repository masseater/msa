import {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  toJsonText,
} from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import { ENV_AGENT_DIR, VERSION } from "../src/config.ts";
import type { ResolvedPaths } from "../src/core/package-manager.ts";
import { readEnv } from "../src/core/process-env.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";
import { allowNetwork } from "./test-network-env.ts";

const nodeFs = process.getBuiltinModule("node:fs");

export const realpathSync = (path: string): string => nodeFs.realpathSync(path);

export const toJsonTextSync = (value: unknown): string => Effect.runSync(toJsonText(value));

const restore = (name: string, value: string | undefined): void => {
  vi.stubEnv(name, value);
};

export const env = { restore };

export interface PackageTestState {
  readonly tempDir: string;
  readonly agentDir: string;
  readonly projectDir: string;
  readonly packageDir: string;
  readonly originalCwd: string;
  readonly originalExecPath: string;
  readonly originalAgentDir: string | undefined;
  readonly originalMsaPackageDir: string | undefined;
  readonly originalPath: string | undefined;
  readonly originalExitCode: typeof process.exitCode;
}

export const setupPackageTest: Effect.Effect<PackageTestState> = Effect.gen(function* () {
  allowNetwork();
  const tempDir = yield* makeTempDir("msa-package-commands-");
  const agentDir = joinPath(tempDir, "agent");
  const projectDir = joinPath(tempDir, "project");
  const packageDir = joinPath(tempDir, "local-package");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(projectDir);
  yield* makeDirectory(packageDir);

  const state: PackageTestState = {
    tempDir,
    agentDir,
    projectDir,
    packageDir,
    originalCwd: process.cwd(),
    originalExecPath: process.execPath,
    originalAgentDir: readEnv(ENV_AGENT_DIR),
    originalMsaPackageDir: readEnv("MSA_PACKAGE_DIR"),
    originalPath: readEnv("PATH"),
    originalExitCode: process.exitCode,
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

export const teardownPackageTest = (state: PackageTestState): Effect.Effect<void> =>
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
      value: state.originalExecPath,
      configurable: true,
    });
    return removePath(state.tempDir);
  });

export const runPackageCommandDirectly = (args: string[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!(yield* awaited(handlePackageCommand(args)))) {
      throw new Error("handlePackageCommand did not handle the arguments");
    }
  });

export const getNewerPatchVersion = (): string => {
  const [major = "0", minor = "0", patch = "0"] = VERSION.split(".");
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`;
};

const extension = (
  packageRoot: string,
  source: string,
  scope: "user" | "project",
  names: string[],
): ResolvedPaths => ({
  extensions: names.map((name) => ({
    path: joinPath(packageRoot, "extensions", name),
    enabled: true,
    metadata: { source, scope, origin: "package", baseDir: packageRoot },
  })),
  skills: [],
  prompts: [],
  themes: [],
});

export const paths = { extension };
