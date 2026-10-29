import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";

import chord from "../../src/index.ts";
import type chordTypes from "../../src/index.types.ts";
import type reloadTypes from "./reload.types.ts";
import timing from "./timing.ts";

const { createHost, local, method } = chord;

const { tick } = timing;
const { pollUntil } = testing;

const quiet = () => createHost({ onError: () => {}, self: { kind: "host" } });

const Greeter = local("t.greeter", {
  input: Type.Object({ id: Type.Optional(Type.String({ default: "a" })) }),
  members: { count: Type.Unknown(), greet: method(Type.String(), Type.String()) },
  version: 1,
});

const CountV1 = Type.Object({ n: Type.Number() });

function greeterFacet(spec: reloadTypes.GreeterSpec): chordTypes.Facet {
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
            greet: (name: string, ctx: chordTypes.Ctx) => {
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

const until = (check: () => Promise<boolean>): Effect.Effect<void> =>
  pollUntil(
    Effect.promise(() => check()),
    200,
    tick,
  );

const reload = {
  CountV1,
  Greeter,
  greeterFacet,
  quiet,
  until,
};

export default reload;
