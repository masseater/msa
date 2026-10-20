import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ProjectTrustStore } from "../src/core/trust-manager.ts";
import { main } from "../src/main.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";

const { setupPackageTest, teardownPackageTest } = packageCommandPathsSupport;

const {
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  pathExists,
  readTextFile,
  realPath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let state: packageCommandPathsSupportTypes.PackageTestState;
let tempDir = "";
let agentDir = "";
let projectDir = "";
let packageDir = "";
let originalExecPath = "";

const assignState = (
  next: packageCommandPathsSupportTypes.PackageTestState,
): packageCommandPathsSupportTypes.PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  agentDir = next.agentDir;
  projectDir = next.projectDir;
  packageDir = next.packageDir;
  originalExecPath = next.originalExecPath;
  return next;
};

const usesDefaultProjectTrustForList = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      yield* writeTextFile(
        joinPath(projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["list"])).resolves.toBeUndefined());

        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stdout).toContain("Project packages:");
        expect(stdout).toContain("npm:@project/pkg");
        expect(stdout).not.toContain("No packages installed.");
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const usesProjectTrustExtensionsForPackageCommands = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(
          expect(
            main(["list"], {
              extensionFactories: [
                (msa) => {
                  msa.on("project_trust", () => ({ trusted: "yes" }));
                },
              ],
            }),
          ).resolves.toBeUndefined(),
        );

        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stdout).toContain("Project packages:");
        expect(stdout).toContain("npm:@project/pkg");
        expect(stdout).not.toContain("No packages installed.");
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const doesNotPromptOrAskExtensionsFor = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      const fakeNpmPath = joinPath(tempDir, "fake-project-npm.cjs");
      const recordPath = joinPath(tempDir, "project-update.json");
      yield* writeTextFile(
        fakeNpmPath,
        `const fs=require("node:fs");fs.writeFileSync(${yield* toJsonText(recordPath)},JSON.stringify(process.argv.slice(2)));`,
      );
      yield* writeTextFile(
        joinPath(projectDir, ".msa", "settings.json"),
        yield* toJsonText({
          npmCommand: [originalExecPath, fakeNpmPath],
          packages: ["npm:fake-package"],
        }),
      );
      let projectTrustCalled = false;
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(
          expect(
            main(["update", "--extensions"], {
              extensionFactories: [
                (msa) => {
                  msa.on("project_trust", () => {
                    projectTrustCalled = true;
                    return { trusted: "yes" };
                  });
                },
              ],
            }),
          ).resolves.toBeUndefined(),
        );

        expect(projectTrustCalled).toBe(false);
        expect(yield* pathExists(recordPath)).toBe(false);
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const usesSavedProjectTrustDuringUpdate = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      const fakeNpmPath = joinPath(tempDir, "fake-trusted-project-npm.cjs");
      const recordPath = joinPath(tempDir, "trusted-project-update.json");
      yield* writeTextFile(
        fakeNpmPath,
        `const fs=require("node:fs");fs.writeFileSync(${yield* toJsonText(recordPath)},JSON.stringify(process.argv.slice(2)));`,
      );
      yield* writeTextFile(
        joinPath(projectDir, ".msa", "settings.json"),
        yield* toJsonText({
          npmCommand: [originalExecPath, fakeNpmPath],
          packages: ["npm:fake-package"],
        }),
      );
      new ProjectTrustStore(agentDir).set(projectDir, true);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["update", "--extensions"])).resolves.toBeUndefined());

        expect(yield* pathExists(recordPath)).toBe(true);
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const letsTrustJsonOverrideDefaultProjectTrust = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      yield* writeTextFile(
        joinPath(projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      new ProjectTrustStore(agentDir).set(projectDir, false);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["list"])).resolves.toBeUndefined());

        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stdout).toContain("No packages installed.");
        expect(stdout).not.toContain("Project packages:");
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const blocksLocalPackageChangesWhenProjectIs = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(projectDir, ".msa"));
      yield* writeTextFile(joinPath(projectDir, ".msa", "settings.json"), "{}");
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["install", "-l", "./local-package"])).resolves.toBeUndefined());

        const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stderr).toContain(
          "Project is not trusted. Use --approve to modify local package config.",
        );
        expect(process.exitCode).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    }),
  );

const allowsLocalPackageInstallToInitializeFresh = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(main(["install", "-l", packageDir]));

      const settingsPath = joinPath(projectDir, ".msa", "settings.json");
      const settings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
        packages?: string[];
      };
      expect(settings.packages?.length).toBe(1);
      const stored = settings.packages?.[0] ?? "";
      expect(yield* realPath(joinPath(projectDir, ".msa", stored))).toBe(
        yield* realPath(packageDir),
      );
      expect(process.exitCode).toBeUndefined();
    }),
  );

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("uses default project trust for list", usesDefaultProjectTrustForList);

  it(
    "uses project_trust extensions for package commands",
    usesProjectTrustExtensionsForPackageCommands,
  );

  it(
    "does not prompt or ask extensions for project trust during update",
    doesNotPromptOrAskExtensionsFor,
  );

  it("uses saved project trust during update", usesSavedProjectTrustDuringUpdate);

  it("lets trust.json override default project trust", letsTrustJsonOverrideDefaultProjectTrust);

  it(
    "blocks local package changes when project is untrusted",
    blocksLocalPackageChangesWhenProjectIs,
  );

  it(
    "allows local package install to initialize fresh project settings",
    allowsLocalPackageInstallToInitializeFresh,
  );
});
