import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import ModelRuntime from "../src/core/model-runtime.ts";
import type modelRuntimeTypes from "../src/core/model-runtime.types.ts";
import mainModule from "../src/main.ts";
import packageCommandPathsSupport from "./package-command-paths-support.ts";

const { main } = mainModule;
const { captureConsole, runPackageCommandDirectly, usePackageTest } = packageCommandPathsSupport;

const pkg = usePackageTest();

const { awaited, joinPath, runTest } = testing;

const showsInstallSubcommandHelp = () =>
  runTest(
    Effect.gen(function* () {
      const output = captureConsole();

      yield* awaited(expect(main(["install", "--help"])).resolves.toBeUndefined());

      const stdout = output.stdout();
      expect(stdout).toContain("Usage:");
      expect(stdout).toContain("msa install <source> [-l]");
      expect(output.errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
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
      const output = captureConsole();

      yield* runPackageCommandDirectly(["update", "--models"]);

      expect(create).toHaveBeenCalledWith({
        allowModelNetwork: false,
        authPath: joinPath(pkg.agentDir, "auth.json"),
        modelsPath: joinPath(pkg.agentDir, "models.json"),
        signal: expect.any(AbortSignal),
      });
      expect(refresh).toHaveBeenCalledWith({
        allowNetwork: true,
        force: true,
        signal: expect.any(AbortSignal),
      });
      expect(output.stdout()).toContain("Model catalogs refreshed");
      expect(output.errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    }),
  );

const rejectsUpdateModelsCombinedWithAnotherUpdate = () =>
  runTest(
    Effect.gen(function* () {
      const create = vi.spyOn(ModelRuntime, "create");
      const output = captureConsole();

      yield* runPackageCommandDirectly(["update", "--models", "--self"]);

      expect(create).not.toHaveBeenCalled();
      expect(output.stderr()).toContain("--models cannot be combined with --self");
      expect(process.exitCode).toBe(1);
    }),
  );

describe("package commands", () => {
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
