import { Effect } from "effect";
import { Type } from "typebox";

import {
  type Ctx,
  createHost,
  type Facet,
  local,
  method,
  type Self,
  type ServeOptions,
  type StateOptions,
} from "../../src/index.ts";
import { tick } from "./timing.ts";

export const quiet = () => createHost({ self: { kind: "host" }, onError: () => {} });

export const Greeter = local("t.greeter", {
  version: 1,
  input: Type.Object({ id: Type.Optional(Type.String({ default: "a" })) }),
  members: { greet: method(Type.String(), Type.String()), count: Type.Unknown() },
});

export const CountV1 = Type.Object({ n: Type.Number() });

export interface GreeterSpec {
  readonly greeting: string;
  readonly schema?: typeof CountV1 | ReturnType<typeof Type.Object>;
  readonly initial?: object;
  readonly bump?: (draft: Record<string, number>) => void;
  readonly options?: ServeOptions;
  readonly state?: StateOptions<never>;
  readonly extra?: (self: Self, input: { id?: string }) => void;
}

export function greeterFacet(spec: GreeterSpec): Facet {
  return {
    name: "greeter",
    setup: (api) =>
      api.serve(
        Greeter,
        (input, _principal, self) => {
          spec.extra?.(self, input);
          const count = self.state(
            "count",
            spec.schema ?? CountV1,
            (spec.initial ?? { n: 0 }) as never,
            spec.state,
          );
          return {
            count,
            greet: (name: string, ctx: Ctx) => {
              count.change(ctx, (draft) => {
                const bump =
                  spec.bump ??
                  ((d: Record<string, number>) => {
                    d["n"] = (d["n"] ?? 0) + 1;
                  });
                bump(draft as Record<string, number>);
              });
              return `${spec.greeting} ${name}`;
            },
          };
        },
        spec.options,
      ),
  };
}

export const until = (check: () => Promise<boolean>): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (yield* Effect.promise(() => check())) return;
      yield* tick;
    }
    throw new Error("condition not reached");
  });
