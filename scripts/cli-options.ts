import { Console, Effect } from "effect";

import type cliOptionsTypes from "./cli-options.types.ts";

const flagOption = <A>(set: (parsed: A) => void): cliOptionsTypes.CliOption<A, never> => ({
  apply: (parsed) => Effect.sync(() => set(parsed)),
  takesValue: false,
});

const valueOption = <A, E = never>(
  apply: cliOptionsTypes.CliOption<A, E>["apply"],
): cliOptionsTypes.CliOption<A, E> => ({
  apply,
  takesValue: true,
});

const requiredOption = <A, E>(option: {
  readonly apply: (parsed: A, value: string) => Effect.Effect<void, E>;
  readonly missing: (name: string) => E;
  readonly name: string;
}): readonly [string, cliOptionsTypes.CliOption<A, E>] => [
  option.name,
  valueOption((parsed, value) =>
    value === undefined ? Effect.fail(option.missing(option.name)) : option.apply(parsed, value),
  ),
];

const stringOption = <A>(
  set: (parsed: A, value: string) => void,
): cliOptionsTypes.CliOption<A, never> =>
  valueOption((parsed, value) => Effect.sync(() => set(parsed, value ?? "")));

const helpOptions = (
  help: string,
): ReadonlyArray<readonly [string, cliOptionsTypes.CliOption<unknown, never>]> => {
  const option: cliOptionsTypes.CliOption<unknown, never> = {
    apply: () => Console.log(help).pipe(Effect.andThen(Effect.sync(() => process.exit(0)))),
    takesValue: false,
  };
  return [
    ["--help", option],
    ["-h", option],
  ];
};

const optionAt = <A, E>(
  args: ReadonlyArray<string>,
  index: number,
  options: cliOptionsTypes.CliOptions<A, E>,
): readonly [arg: string, value: string | undefined, next: number] => {
  const arg = args[index] ?? "";
  return options.get(arg)?.takesValue === true
    ? [arg, args[index + 1], index + 2]
    : [arg, undefined, index + 1];
};

const optionPairs = <A, E>(
  args: ReadonlyArray<string>,
  options: cliOptionsTypes.CliOptions<A, E>,
): ReadonlyArray<readonly [arg: string, value: string | undefined]> => {
  const pairs: Array<readonly [string, string | undefined]> = [];
  let index = 0;
  while (index < args.length) {
    const [arg, value, next] = optionAt(args, index, options);
    pairs.push([arg, value]);
    index = next;
  }
  return pairs;
};

const parseOptions = <A, E>(config: {
  readonly args: ReadonlyArray<string>;
  readonly options: cliOptionsTypes.CliOptions<A, E>;
  readonly parsed: A;
  readonly unknown: (arg: string) => Effect.Effect<void, E>;
}): Effect.Effect<A, E> =>
  Effect.forEach(
    optionPairs(config.args, config.options),
    ([arg, value]) => {
      const option = config.options.get(arg);
      return option === undefined ? config.unknown(arg) : option.apply(config.parsed, value);
    },
    { discard: true },
  ).pipe(Effect.as(config.parsed));

const parseCommandLine = <A, E>(config: {
  readonly defaults: A;
  readonly fail: (message: string) => E;
  readonly help: string;
  readonly options: ReadonlyArray<readonly [string, cliOptionsTypes.CliOption<A, E>]>;
}): Effect.Effect<A, E> =>
  parseOptions({
    args: process.argv.slice(2),
    options: new Map([...config.options, ...helpOptions(config.help)]),
    parsed: config.defaults,
    unknown: (arg) => Effect.fail(config.fail(`Unknown argument: ${arg}`)),
  });

const ignoreUnknown = (): Effect.Effect<void> => Effect.void;

const cliOptions = {
  flagOption,
  helpOptions,
  ignoreUnknown,
  parseCommandLine,
  parseOptions,
  requiredOption,
  stringOption,
  valueOption,
};

export default cliOptions;
