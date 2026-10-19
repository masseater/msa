import { readEnv } from "./platform.ts";

export type EvalCliOptions = {
  provider?: string | undefined;
  model?: string | undefined;
  runsPerVariant: number;
  requestedFiles: string[];
  discoveryArgs: string[];
};

type ParsedArguments = {
  provider: string | undefined;
  model: string | undefined;
  runsText: string | undefined;
  cliSelectedModel: boolean;
  requestedFiles: string[];
  discoveryArgs: string[];
};

const RUNNER_OPTIONS = new Set(["--provider", "--model", "--runs-per-variant"]);
const FILTER_OPTIONS = new Set(["-t", "--testNamePattern"]);

const nonEmpty = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

function nextValue(iterator: Iterator<string>): string | undefined {
  const next = iterator.next();
  return next.done === true ? undefined : next.value;
}

function readRunnerOption(
  parsed: ParsedArguments,
  argument: string,
  remaining: Iterator<string>,
): boolean {
  const equals = argument.indexOf("=");
  const name = equals === -1 ? argument : argument.slice(0, equals);
  if (!RUNNER_OPTIONS.has(name)) return false;
  const value: string | undefined =
    equals === -1 ? nextValue(remaining) : argument.slice(equals + 1);
  if (value === undefined || value === "" || (equals === -1 && value.startsWith("-"))) {
    throw new Error(`Missing value for ${name}.`);
  }
  if (name === "--provider") parsed.provider = value;
  else if (name === "--model") parsed.model = value;
  else parsed.runsText = value;
  if (name !== "--runs-per-variant") parsed.cliSelectedModel = true;
  return true;
}

function readFilterOption(
  parsed: ParsedArguments,
  argument: string,
  remaining: Iterator<string>,
): boolean {
  if (FILTER_OPTIONS.has(argument)) {
    const value = nextValue(remaining);
    if (value === undefined || value === "") throw new Error(`Missing value for ${argument}.`);
    parsed.discoveryArgs.push(argument, value);
    return true;
  }
  if (!argument.startsWith("--testNamePattern=")) return false;
  if (argument.length === "--testNamePattern=".length) {
    throw new Error("Missing value for --testNamePattern.");
  }
  parsed.discoveryArgs.push(argument);
  return true;
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const parsed: ParsedArguments = {
    provider: undefined,
    model: undefined,
    runsText: undefined,
    cliSelectedModel: false,
    requestedFiles: [],
    discoveryArgs: [],
  };
  const remaining = args[Symbol.iterator]();
  for (let next = remaining.next(); next.done !== true; next = remaining.next()) {
    const argument = next.value;
    if (argument.endsWith(".docs.eval.ts")) {
      parsed.requestedFiles.push(argument);
    } else if (!readFilterOption(parsed, argument, remaining)) {
      if (!readRunnerOption(parsed, argument, remaining)) {
        throw new Error(`Unsupported eval argument: ${argument}`);
      }
    }
  }
  return parsed;
}

function selectModel(parsed: ParsedArguments): { provider?: string; model?: string } {
  const provider = nonEmpty(parsed.provider);
  const model = nonEmpty(parsed.model);
  if (parsed.cliSelectedModel) {
    if (provider === undefined || model === undefined) {
      throw new Error("CLI model selection requires both --provider and --model.");
    }
    return { provider, model };
  }
  const envProvider = nonEmpty(readEnv("MSA_PROVIDER"));
  const envModel = nonEmpty(readEnv("MSA_MODEL"));
  if ((envProvider === undefined) !== (envModel === undefined)) {
    throw new Error("Set both MSA_PROVIDER and MSA_MODEL, or neither.");
  }
  return {
    ...(envProvider === undefined ? {} : { provider: envProvider }),
    ...(envModel === undefined ? {} : { model: envModel }),
  };
}

export function parseEvalCli(args: readonly string[]): EvalCliOptions {
  const parsed = parseArguments(args);
  const configuredRuns = nonEmpty(parsed.runsText ?? readEnv("MSA_EVAL_RUNS_PER_VARIANT"));
  const runsPerVariant = configuredRuns === undefined ? 1 : Number(configuredRuns);
  if (!Number.isSafeInteger(runsPerVariant) || runsPerVariant < 1) {
    throw new Error("Runs per variant must be a positive integer.");
  }
  return {
    ...selectModel(parsed),
    runsPerVariant,
    requestedFiles: parsed.requestedFiles,
    discoveryArgs: parsed.discoveryArgs,
  };
}
