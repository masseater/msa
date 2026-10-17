import { Effect } from "effect";

import { flagOption, stringOption, valueOption } from "./cli-options.ts";
import type { CliOption } from "./cli-options.ts";

interface ScanArgs {
  allSessions: boolean;
  autoSincePath: string | undefined;
  includeRecords: boolean;
  json: boolean;
  modelFilter: string | undefined;
  sessionsDir: string;
  since: string | undefined;
  top: number;
}

const parseTop = <E>(value: string, error: (message: string) => E): Effect.Effect<number, E> => {
  const top = Number.parseInt(value, 10);
  return !Number.isFinite(top) || top <= 0
    ? Effect.fail(error("--top must be a positive integer"))
    : Effect.succeed(top);
};

const stringOptions = <A extends ScanArgs>(): ReadonlyArray<
  readonly [string, CliOption<A, never>]
> => [
  [
    "--sessions-dir",
    stringOption((parsed, value) => {
      parsed.sessionsDir = value;
    }),
  ],
  [
    "--since",
    stringOption((parsed, value) => {
      parsed.since = value;
    }),
  ],
  [
    "--auto-since-path",
    stringOption((parsed, value) => {
      parsed.autoSincePath = value;
    }),
  ],
  [
    "--model",
    stringOption((parsed, value) => {
      parsed.modelFilter = value;
    }),
  ],
];

const flagOptions = <A extends ScanArgs>(): ReadonlyArray<
  readonly [string, CliOption<A, never>]
> => [
  [
    "--json",
    flagOption((parsed) => {
      parsed.json = true;
    }),
  ],
  [
    "--include-records",
    flagOption((parsed) => {
      parsed.includeRecords = true;
    }),
  ],
  [
    "--all-sessions",
    flagOption((parsed) => {
      parsed.allSessions = true;
    }),
  ],
];

const scanOptions = <A extends ScanArgs, E>(
  error: (message: string) => E,
): ReadonlyArray<readonly [string, CliOption<A, E>]> => [
  ...stringOptions<A>(),
  [
    "--top",
    valueOption((parsed, value) =>
      Effect.map(parseTop(value ?? "", error), (top) => {
        parsed.top = top;
      }),
    ),
  ],
  ...flagOptions<A>(),
];

const matchesModelFilter = (options: {
  readonly modelFilter: string | undefined;
  readonly providerModel: string;
}): boolean => {
  const model = options.modelFilter?.toLowerCase();
  return model === undefined || model === "" || options.providerModel.toLowerCase().includes(model);
};

export type { ScanArgs };
export { matchesModelFilter, scanOptions };
