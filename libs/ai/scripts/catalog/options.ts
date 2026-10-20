import { Data, Effect } from "effect";

import scriptFiles from "../script-files.ts";
import type optionsTypes from "./options.types.ts";

const { ScriptFiles } = scriptFiles;

class GeneratorUsageError extends Data.TaggedError("GeneratorUsageError")<{
  readonly message: string;
}> {}

const FLAGS: Readonly<Record<string, keyof Omit<optionsTypes.GeneratorOptions, "jsonOutputDir">>> =
  {
    "--data-only": "dataOnly",
    "--json-only": "jsonOnly",
    "--pretty": "pretty",
    "--strict": "strict",
  };

const usage = (message: string) => Effect.fail(new GeneratorUsageError({ message }));

const collectArgs = Effect.fn("collectArgs")(function* (args: readonly string[]) {
  const files = yield* ScriptFiles;
  const flags = { dataOnly: false, jsonOnly: false, pretty: false, strict: false };
  let jsonOutputDir: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const flag = FLAGS[arg];
    if (flag !== undefined) {
      flags[flag] = true;
      continue;
    }
    if (arg !== "--json-output") return yield* usage(`Unknown argument: ${arg}`);
    index++;
    const value = args[index];
    if (value === undefined || value === "")
      return yield* usage("--json-output requires a directory");
    jsonOutputDir = files.resolve(value);
  }
  return { ...flags, jsonOutputDir };
});

const readGeneratorOptions = Effect.fn("readGeneratorOptions")(function* (args: readonly string[]) {
  const options: optionsTypes.GeneratorOptions = yield* collectArgs(args);
  const hasJsonOutput = options.jsonOutputDir !== undefined && options.jsonOutputDir !== "";
  if (options.jsonOnly && !hasJsonOutput) return yield* usage("--json-only requires --json-output");
  if (options.dataOnly && (options.jsonOnly || hasJsonOutput))
    return yield* usage("--data-only cannot be combined with JSON catalog output");
  return options;
});

const optionsModule = {
  GeneratorUsageError,
  readGeneratorOptions,
};

export default optionsModule;
