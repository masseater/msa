import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import ProjectTrustStore from "../src/core/project-trust-store.ts";
import mainModule from "../src/main.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";

const { main } = mainModule;
const { usePackageTest } = packageCommandPathsSupport;

const pkg = usePackageTest();

const {
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  readTextFile,
  realPath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const shouldPersistGlobalRelativeLocalPackagePaths = () =>
  runTest(
    Effect.gen(function* () {
      const relativePkgDir = joinPath(pkg.projectDir, "packages", "local-package");
      yield* makeDirectory(relativePkgDir);

      yield* awaited(main(["install", "./packages/local-package"]));

      const settingsPath = joinPath(pkg.agentDir, "settings.json");
      const settings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
        packages?: string[];
      };
      expect(settings.packages?.length).toBe(1);
      const stored = settings.packages?.[0] ?? "";
      const resolvedFromSettings = yield* realPath(joinPath(pkg.agentDir, stored));
      expect(resolvedFromSettings).toBe(yield* realPath(relativePkgDir));
    }),
  );

const shouldRemoveLocalPackagesUsingAPath = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(main(["install", `${pkg.packageDir}/`]));

      const settingsPath = joinPath(pkg.agentDir, "settings.json");
      const installedSettings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
        packages?: string[];
      };
      expect(installedSettings.packages?.length).toBe(1);

      yield* awaited(main(["remove", `${pkg.packageDir}/`]));

      const removedSettings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
        packages?: string[];
      };
      expect(removedSettings.packages ?? []).toHaveLength(0);
    }),
  );

const skipsUntrustedProjectPackageSettings = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["list"])).resolves.toBeUndefined());

        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stdout).toContain("No packages installed.");
        expect(stdout).not.toContain("Project packages:");
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const usesRememberedProjectTrustForList = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      yield* awaited(new ProjectTrustStore(pkg.agentDir).set(pkg.projectDir, true));
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

const overridesRememberedTrustForListWithNo = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      yield* awaited(new ProjectTrustStore(pkg.agentDir).set(pkg.projectDir, true));
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["list", "--no-approve"])).resolves.toBeUndefined());

        const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stdout).toContain("No packages installed.");
        expect(stdout).not.toContain("Project packages:");
        expect(process.exitCode).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    }),
  );

const approvesProjectTrustForListWithApprove = () =>
  runTest(
    Effect.gen(function* () {
      yield* makeDirectory(joinPath(pkg.projectDir, ".msa"));
      yield* writeTextFile(
        joinPath(pkg.projectDir, ".msa", "settings.json"),
        yield* toJsonText({ packages: ["npm:@project/pkg"] }),
      );
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      try {
        yield* awaited(expect(main(["list", "--approve"])).resolves.toBeUndefined());

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

describe("package commands", () => {
  it(
    "should persist global relative local package paths relative to settings.json",
    shouldPersistGlobalRelativeLocalPackagePaths,
  );

  it(
    "should remove local packages using a path with a trailing slash",
    shouldRemoveLocalPackagesUsingAPath,
  );

  it("skips untrusted project package settings", skipsUntrustedProjectPackageSettings);

  it("uses remembered project trust for list", usesRememberedProjectTrustForList);

  it(
    "overrides remembered trust for list with --no-approve",
    overridesRememberedTrustForListWithNo,
  );

  it("approves project trust for list with --approve", approvesProjectTrustForListWithApprove);
});
