import type { Effect } from "effect";

declare namespace cliOptionsTypes {
  interface CliOption<A, E> {
    readonly apply: (parsed: A, value: string | undefined) => Effect.Effect<void, E>;
    readonly takesValue: boolean;
  }

  type CliOptions<A, E> = ReadonlyMap<string, CliOption<A, E>>;
}

export type { cliOptionsTypes as default };
