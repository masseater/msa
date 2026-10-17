import { Console, Effect } from "effect";

interface CliOption<A, E> {
  readonly apply: (parsed: A, value: string | undefined) => Effect.Effect<void, E>;
  readonly takesValue: boolean;
}

type CliOptions<A, E> = ReadonlyMap<string, CliOption<A, E>>;

const flagOption = <A>(set: (parsed: A) => void): CliOption<A, never> => ({
  apply: (parsed) => Effect.sync(() => set(parsed)),
  takesValue: false,
});

const valueOption = <A, E = never>(apply: CliOption<A, E>["apply"]): CliOption<A, E> => ({
  apply,
  takesValue: true,
});

const requiredOption = <A, E>(option: {
  readonly apply: (parsed: A, value: string) => Effect.Effect<void, E>;
  readonly missing: (name: string) => E;
  readonly name: string;
}): readonly [string, CliOption<A, E>] => [
  option.name,
  valueOption((parsed, value) =>
    value === undefined ? Effect.fail(option.missing(option.name)) : option.apply(parsed, value),
  ),
];

const stringOption = <A>(set: (parsed: A, value: string) => void): CliOption<A, never> =>
  valueOption((parsed, value) => Effect.sync(() => set(parsed, value ?? "")));

const helpOptions = (help: string): ReadonlyArray<readonly [string, CliOption<unknown, never>]> => {
  const option: CliOption<unknown, never> = {
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
  options: CliOptions<A, E>,
): readonly [arg: string, value: string | undefined, next: number] => {
  const arg = args[index] ?? "";
  return options.get(arg)?.takesValue === true
    ? [arg, args[index + 1], index + 2]
    : [arg, undefined, index + 1];
};

const optionPairs = <A, E>(
  args: ReadonlyArray<string>,
  options: CliOptions<A, E>,
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
  readonly options: CliOptions<A, E>;
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

const ignoreUnknown = (): Effect.Effect<void> => Effect.void;

export type { CliOption, CliOptions };
export {
  flagOption,
  helpOptions,
  ignoreUnknown,
  parseOptions,
  requiredOption,
  stringOption,
  valueOption,
};
