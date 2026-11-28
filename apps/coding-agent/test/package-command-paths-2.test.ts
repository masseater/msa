import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ProjectTrustStore from "../src/core/project-trust-store.ts";
import mainModule from "../src/main.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";

const { main } = mainModule;
const { captureConsole, mainOutput, usePackageTest } = packageCommandPathsSupport;

const pkg = usePackageTest();

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

const usesDefaultProjectTrustForList = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const stdout = yield* mainOutput(["list"]);
      expect(stdout).toContain("Project packages:");
      expect(stdout).toContain("npm:@project/pkg");
      expect(stdout).not.toContain("No packages installed.");
      expect(process.exitCode).toBeUndefined();
    }),
  );

const usesProjectTrustExtensionsForPackageCommands = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const output = captureConsole();

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

      const stdout = output.stdout();
      expect(stdout).toContain("Project packages:");
      expect(stdout).toContain("npm:@project/pkg");
      expect(stdout).not.toContain("No packages installed.");
      expect(process.exitCode).toBeUndefined();
    }),
  );

const doesNotPromptOrAskExtensionsFor = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      const fakeNpmPath = joinPath(pkg.tempDir, "fake-project-npm.cjs");
      const recordPath = joinPath(pkg.tempDir, "project-update.json");
      yield* writeTextFile(
        fakeNpmPath,
        `const fs=require("node:fs");fs.promises.writeFile(${yield* toJsonText(recordPath)},JSON.stringify(process.argv.slice(2)));`,
      );
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({
          npmCommand: [pkg.originalExecPath, fakeNpmPath],
          packages: ["npm:fake-package"],
        }),
      );
      let projectTrustCalled = false;
      captureConsole();

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
    }),
  );

const usesSavedProjectTrustDuringUpdate = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      const fakeNpmPath = joinPath(pkg.tempDir, "fake-trusted-project-npm.cjs");
      const recordPath = joinPath(pkg.tempDir, "trusted-project-update.json");
      yield* writeTextFile(
        fakeNpmPath,
        `const fs=require("node:fs");fs.promises.writeFile(${yield* toJsonText(recordPath)},JSON.stringify(process.argv.slice(2)));`,
      );
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({
          npmCommand: [pkg.originalExecPath, fakeNpmPath],
          packages: ["npm:fake-package"],
        }),
      );
      yield* awaited(new ProjectTrustStore(pkg.agentDir).set(pkg.projectDir, true));
      captureConsole();

      yield* awaited(expect(main(["update", "--extensions"])).resolves.toBeUndefined());

      expect(yield* pathExists(recordPath)).toBe(true);
      expect(process.exitCode).toBeUndefined();
    }),
  );

const letsTrustJsonOverrideDefaultProjectTrust = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.agentDir, "settings.json"),
        yield* toJsonText({ defaultProjectTrust: "always" }),
      );
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      yield* awaited(new ProjectTrustStore(pkg.agentDir).set(pkg.projectDir, false));
      const stdout = yield* mainOutput(["list"]);
      expect(stdout).toContain("No packages installed.");
      expect(stdout).not.toContain("Project packages:");
      expect(process.exitCode).toBeUndefined();
    }),
  );

const blocksLocalPackageChangesWhenProjectIs = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(joinPath(pkg.projectDir, ".msa", "settings.json"), "{}");
      const stderr = yield* mainOutput(["install", "-l", "./local-package"], "error");
      expect(stderr).toContain(
        "Project is not trusted. Use --approve to modify local package config.",
      );
      expect(process.exitCode).toBe(1);
    }),
  );

const allowsLocalPackageInstallToInitializeFresh = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(main(["install", "-l", pkg.packageDir]));

      const settingsPath = joinPath(pkg.projectDir, ".msa", "settings.json");
      const settings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
        packages?: string[];
      };
      expect(settings.packages?.length).toBe(1);
      const stored = settings.packages?.[0] ?? "";
      expect(yield* realPath(joinPath(pkg.projectDir, ".msa", stored))).toBe(
        yield* realPath(pkg.packageDir),
      );
      expect(process.exitCode).toBeUndefined();
    }),
  );

describe("package commands", () => {
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
