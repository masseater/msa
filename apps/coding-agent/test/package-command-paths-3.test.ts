import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import mainModule from "../src/main.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";
import type packageCommandPathsSupportTypes from "./package-command-paths-support.types.ts";

const { main } = mainModule;
const { runPackageCommandDirectly, setupPackageTest, teardownPackageTest } =
  packageCommandPathsSupport;

const { awaited, joinPath, runTest } = testing;

let state: packageCommandPathsSupportTypes.PackageTestState;

let agentDir = "";

const assignState = (
  next: packageCommandPathsSupportTypes.PackageTestState,
): packageCommandPathsSupportTypes.PackageTestState => {
  state = next;
  agentDir = next.agentDir;
  return next;
};

const showsInstallSubcommandHelp = () =>
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
  );

const refreshesOnlyModelCatalogsWithUpdateModels = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const refresh = vi.fn(() =>
        effectRunPromise(awaited({ aborted: false, errors: new Map<string, Error>() })),
      );
      const create = vi
        .spyOn(ModelRuntime, "create")
        .mockResolvedValue({ refresh } as unknown as modelRuntimeTypes.ModelRuntime);
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      yield* runPackageCommandDirectly(["update", "--models"]);

      expect(create).toHaveBeenCalledWith({
        allowModelNetwork: false,
        authPath: joinPath(agentDir, "auth.json"),
        modelsPath: joinPath(agentDir, "models.json"),
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
  );

const rejectsUpdateModelsCombinedWithAnotherUpdate = () =>
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
  );

describe("package commands", () => {
  beforeEach(() => runTest(setupPackageTest).then(assignState));

  afterEach(() => runTest(teardownPackageTest(state)));

  it("shows install subcommand help", showsInstallSubcommandHelp);

  it(
    "refreshes only model catalogs with update --models",
    refreshesOnlyModelCatalogsWithUpdateModels,
  );

  it(
    "rejects update --models combined with another update target",
    rejectsUpdateModelsCombinedWithAnotherUpdate,
  );
});
