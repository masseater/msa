import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import config from "../src/config.ts";
import processEnv from "../src/core/process-env.ts";
import config2Support from "./config-2-support.ts";

const { readEnv } = processEnv;
const { detectInstallMethod, getSelfUpdateCommand, getUpdateInstruction } = config;

const { setExecPath } = config2Support;

const { joinPath, makeDirectory, makeTempDir, removePath, runTest } = testing;

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

const detectsPnpmFromWindowsPnpmInstallPaths = () => {
  setExecPath(
    "C:\\Users\\Admin\\Documents\\pnpm-repository\\global\\5\\.pnpm\\@msa+coding-agent@0.67.68\\node_modules\\@msa\\coding-agent\\dist\\cli.js",
  );

  expect(detectInstallMethod()).toBe("pnpm");
  expect(getUpdateInstruction("@msa/coding-agent")).toBe(
    "Run: pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @msa/coding-agent",
  );
};

const doesNotSelfUpdateUnknownWrapperInstalls = () => {
  setExecPath("/usr/local/bin/node");

  expect(detectInstallMethod()).toBe("unknown");
  expect(getSelfUpdateCommand("@msa/coding-agent")).toBeUndefined();
  expect(getUpdateInstruction("@msa/coding-agent")).toBe(
    "Update @msa/coding-agent using the package manager, wrapper, or source checkout that provides this installation.",
  );
};

const selfUpdatesNpmInstallsFromCustomPrefixes = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall();
      const command = getSelfUpdateCommand("@msa/coding-agent");
      expect(detectInstallMethod()).toBe("npm");
      expect(command).toEqual({
        args: [
          "--prefix",
          prefix,
          "install",
          "-g",
          "--ignore-scripts",
          "--min-release-age=0",
          "@msa/coding-agent",
        ],
        command: "npm",
        display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
      });
    }),
  );

const selfUpdatesExactNpmVersionsWithoutUninstalling = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall();
      const command = getSelfUpdateCommand("@msa/coding-agent", undefined, {
        installSpec: "@msa/coding-agent@1.2.3",
        packageName: "@msa/coding-agent",
      });
      expect(command).toEqual({
        args: [
          "--prefix",
          prefix,
          "install",
          "-g",
          "--ignore-scripts",
          "--min-release-age=0",
          "@msa/coding-agent@1.2.3",
        ],
        command: "npm",
        display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent@1.2.3`,
      });
    }),
  );

const selfUpdatesRenamedPackagesFromTheCurrent = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall();
      const command = getSelfUpdateCommand(
        "@mariozechner/pi-coding-agent",
        undefined,
        "@new-scope/msa",
      );
      expect(command).toEqual({
        args: [
          "--prefix",
          prefix,
          "install",
          "-g",
          "--ignore-scripts",
          "--min-release-age=0",
          "@new-scope/msa",
        ],
        command: "npm",
        display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent && npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/msa`,
        steps: [
          {
            args: ["--prefix", prefix, "uninstall", "-g", "@mariozechner/pi-coding-agent"],
            command: "npm",
            display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent`,
          },
          {
            args: [
              "--prefix",
              prefix,
              "install",
              "-g",
              "--ignore-scripts",
              "--min-release-age=0",
              "@new-scope/msa",
            ],
            command: "npm",
            display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/msa`,
          },
        ],
      });
    }),
  );

const selfUpdateRespectsConfiguredNpmcommand = () =>
  runTest(
    Effect.gen(function* () {
      const { prefix } = yield* createNpmPrefixInstall();
      const command = getSelfUpdateCommand("@msa/coding-agent", ["npm", "--prefix", prefix]);
      expect(command).toEqual({
        args: [
          "--prefix",
          prefix,
          "install",
          "-g",
          "--ignore-scripts",
          "--min-release-age=0",
          "@msa/coding-agent",
        ],
        command: "npm",
        display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
      });
    }),
  );

describe("detectInstallMethod", () => {
  test("detects pnpm from Windows .pnpm install paths", detectsPnpmFromWindowsPnpmInstallPaths);

  test("does not self-update unknown wrapper installs", doesNotSelfUpdateUnknownWrapperInstalls);

  test("self-updates npm installs from custom prefixes", selfUpdatesNpmInstallsFromCustomPrefixes);

  test(
    "self-updates exact npm versions without uninstalling the current package",
    selfUpdatesExactNpmVersionsWithoutUninstalling,
  );

  test(
    "self-updates renamed packages from the current install prefix",
    selfUpdatesRenamedPackagesFromTheCurrent,
  );

  test("self-update respects configured npmCommand", selfUpdateRespectsConfiguredNpmcommand);
});
