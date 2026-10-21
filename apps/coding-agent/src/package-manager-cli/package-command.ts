import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../core/awaiting.ts";
import type packageManagerCliTypes from "../package-manager-cli.types.ts";
import argumentProblems from "./argument-problems.ts";
import help from "./help.ts";
import modelCatalogs from "./model-catalogs.ts";
import packageRun from "./package-run.ts";
import parseCommand from "./parse-command.ts";

const { awaited, awaiting } = awaitingModule;
const { printPackageCommandHelp } = help;
const { parsePackageCommand } = parseCommand;
const { reportArgumentProblem } = argumentProblems;
const { refreshModels } = modelCatalogs;
const { runWithPackageManager } = packageRun;

function handlePackageCommandImpl(
  args: string[],
  runtimeOptions: packageManagerCliTypes.PackageCommandRuntimeOptions = {},
): Promise<boolean> {
  return Effect.runPromise(
    awaiting(function* () {
      const options = parsePackageCommand(args);
      if (options === undefined) return false;
      if (options.help) {
        printPackageCommandHelp(options.command);
        return true;
      }
      if (reportArgumentProblem(options)) return true;
      if (options.command === "update" && options.updateTarget?.type === "models") {
        yield* awaited(refreshModels());
        return true;
      }
      yield* awaited(runWithPackageManager(options, runtimeOptions));
      return true;
    }),
  );
}

const handlePackageCommand: {
  (
    args: string[],
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): Promise<boolean>;
  (
    runtimeOptions?: packageManagerCliTypes.PackageCommandRuntimeOptions,
  ): (args: string[]) => Promise<boolean>;
} = dual((args: IArguments) => args.length >= 1, handlePackageCommandImpl);

const packageCommand = { handlePackageCommand };

export default packageCommand;
