import {
  awaited,
  runTest,
  toJsonText,
  fromJsonText,
  readTextFile,
  writeTextFile,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ModelRuntime } from "../src/core/model-runtime.ts";
import { DefaultPackageManager } from "../src/core/package-manager.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import { main } from "../src/main.ts";
import { ConfigSelectorComponent } from "../src/modes/interactive/components/config-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import {
  type PackageTestState,
  paths,
  runPackageCommandDirectly,
  setupPackageTest,
  teardownPackageTest,
  toJsonTextSync,
} from "./package-command-paths-support.ts";

let state: PackageTestState;
let tempDir = "";
let agentDir = "";
let projectDir = "";

const assignState = (next: PackageTestState): PackageTestState => {
  state = next;
  tempDir = next.tempDir;
  agentDir = next.agentDir;
  projectDir = next.projectDir;
  return next;
};

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("shows install subcommand help", () =>
    runTest(
      Effect.gen(function* () {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* awaited(expect(main(["install", "--help"])).resolves.toBeUndefined());

          const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
          expect(stdout).toContain("Usage:");
          expect(stdout).toContain("msa install <source> [-l]");
          expect(errorSpy).not.toHaveBeenCalled();
          expect(process.exitCode).toBeUndefined();
        } finally {
          logSpy.mockRestore();
          errorSpy.mockRestore();
        }
      }),
    ));

  it("refreshes only model catalogs with update --models", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const refresh = vi.fn(() =>
          effectRunPromise(awaited({ aborted: false, errors: new Map<string, Error>() })),
        );
        const create = vi
          .spyOn(ModelRuntime, "create")
          .mockResolvedValue({ refresh } as unknown as ModelRuntime);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        yield* runPackageCommandDirectly(["update", "--models"]);

        expect(create).toHaveBeenCalledWith({
          authPath: joinPath(agentDir, "auth.json"),
          modelsPath: joinPath(agentDir, "models.json"),
          allowModelNetwork: false,
          signal: expect.any(AbortSignal),
        });
        expect(refresh).toHaveBeenCalledWith({
          allowNetwork: true,
          force: true,
          signal: expect.any(AbortSignal),
        });
        expect(logSpy.mock.calls.map(([message]) => String(message)).join("\n")).toContain(
          "Model catalogs refreshed",
        );
        expect(errorSpy).not.toHaveBeenCalled();
        expect(process.exitCode).toBeUndefined();
      }),
    ));

  it("rejects update --models combined with another update target", () =>
    runTest(
      Effect.gen(function* () {
        const create = vi.spyOn(ModelRuntime, "create");
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        yield* runPackageCommandDirectly(["update", "--models", "--self"]);

        expect(create).not.toHaveBeenCalled();
        expect(errorSpy.mock.calls.map(([message]) => String(message)).join("\n")).toContain(
          "--models cannot be combined with --self",
        );
        expect(process.exitCode).toBe(1);
      }),
    ));

  it("cycles project package overrides in config local mode", () =>
    runTest(
      Effect.sync(() => {
        const storage = new InMemorySettingsStorage();
        storage.withLock("global", () => toJsonTextSync({ packages: ["npm:msa-tools"] }));
        const settingsManager = SettingsManager.fromStorage(storage, { projectTrusted: true });
        const resolvedPaths = paths.extension(joinPath(tempDir, "pkg"), "npm:msa-tools", "user", [
          "bar.ts",
        ]);
        const selector = new ConfigSelectorComponent(
          { global: resolvedPaths, project: resolvedPaths },
          settingsManager,
          projectDir,
          agentDir,
          () => {},
          () => {},
          () => {},
          24,
          "project",
        );

        selector.getResourceList().handleInput(" ");
        expect(settingsManager.getProjectSettings().packages).toEqual([
          { source: "npm:msa-tools", autoload: false, extensions: ["-extensions/bar.ts"] },
        ]);

        selector.getResourceList().handleInput(" ");
        expect(settingsManager.getProjectSettings().packages).toEqual([
          { source: "npm:msa-tools", autoload: false, extensions: ["+extensions/bar.ts"] },
        ]);

        selector.getResourceList().handleInput(" ");
        expect(settingsManager.getProjectSettings().packages).toEqual([]);
      }),
    ));

  it("toggles built-in extensions in config global mode", () =>
    runTest(
      Effect.gen(function* () {
        const settingsManager = SettingsManager.fromStorage(new InMemorySettingsStorage(), {
          projectTrusted: true,
        });
        const resolvedPaths = yield* awaited(
          new DefaultPackageManager({
            cwd: projectDir,
            agentDir,
            settingsManager,
            builtinExtensions: ["llama.cpp", "mcp"],
          }).resolve(),
        );
        const selector = new ConfigSelectorComponent(
          { global: resolvedPaths, project: resolvedPaths },
          settingsManager,
          projectDir,
          agentDir,
          () => {},
          () => {},
          () => {},
          24,
          "global",
        );

        const list = selector.getResourceList();
        initTheme("dark");
        expect(list.render(80).join("\n")).toContain("Built-in");
        expect(list.render(80).join("\n")).toContain("llama.cpp");
        list.handleInput(" ");
        expect(settingsManager.getGlobalSettings().extensions).toEqual(["-builtin:llama.cpp"]);
        list.handleInput(" ");
        expect(settingsManager.getGlobalSettings().extensions).toEqual(["+builtin:llama.cpp"]);
      }),
    ));

  it("cycles project built-in extension overrides in config local mode", () =>
    runTest(
      Effect.gen(function* () {
        const storage = new InMemorySettingsStorage();
        storage.withLock("global", () => toJsonTextSync({ extensions: ["-builtin:mcp"] }));
        const settingsManager = SettingsManager.fromStorage(storage, { projectTrusted: true });
        const resolvedPaths = yield* awaited(
          new DefaultPackageManager({
            cwd: projectDir,
            agentDir,
            settingsManager,
            builtinExtensions: ["mcp"],
          }).resolve(),
        );
        const selector = new ConfigSelectorComponent(
          { global: resolvedPaths, project: resolvedPaths },
          settingsManager,
          projectDir,
          agentDir,
          () => {},
          () => {},
          () => {},
          24,
          "project",
        );

        const list = selector.getResourceList();
        list.handleInput(" ");
        expect(settingsManager.getProjectSettings().extensions).toEqual(["+builtin:mcp"]);
        list.handleInput(" ");
        expect(settingsManager.getProjectSettings().extensions).toEqual(["-builtin:mcp"]);
        list.handleInput(" ");
        expect(settingsManager.getProjectSettings().extensions).toEqual([]);
      }),
    ));

  it("shows a friendly error for unknown install options", () =>
    runTest(
      Effect.gen(function* () {
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        try {
          yield* awaited(expect(main(["install", "--unknown"])).resolves.toBeUndefined());

          const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
          expect(stderr).toContain('Unknown option --unknown for "install".');
          expect(stderr).toContain(
            'Use "msa --help" or "msa install <source> [-l] [--approve|--no-approve]".',
          );
          expect(process.exitCode).toBe(1);
        } finally {
          errorSpy.mockRestore();
        }
      }),
    ));

  it("suggests the configured source when update input omits the npm prefix", () =>
    runTest(
      Effect.gen(function* () {
        const settingsPath = joinPath(agentDir, "settings.json");
        yield* writeTextFile(settingsPath, yield* toJsonText({ packages: ["npm:msa-formatter"] }));

        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        try {
          yield* awaited(expect(main(["update", "msa-formatter"])).resolves.toBeUndefined());

          const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
          const stdout = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
          expect(stderr).toContain("Did you mean npm:msa-formatter?");
          expect(stdout).not.toContain("Updated msa-formatter");
          expect(process.exitCode).toBe(1);

          const settings = (yield* fromJsonText(yield* readTextFile(settingsPath))) as {
            packages?: string[];
          };
          expect(settings.packages).toContain("npm:msa-formatter");
        } finally {
          errorSpy.mockRestore();
          logSpy.mockRestore();
        }
      }),
    ));
});
