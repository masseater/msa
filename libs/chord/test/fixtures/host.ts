import { Effect } from "effect";
import { Type } from "typebox";

import { createHost, type Host, local, method } from "../../src/index.ts";
import { pollUntil, tick } from "./timing.ts";

export const quiet = (errors: unknown[] = []) =>
  createHost({ self: { kind: "host" }, onError: (error) => errors.push(error) });

export const until = (check: () => boolean) => pollUntil(check, 200, tick);

export const Counter = local("t.counter", {
  version: 1,
  input: Type.Object({ name: Type.String() }),
  members: {
    count: Type.Object({ n: Type.Number() }),
    add: method(Type.Number(), Type.Number()),
  },
});

export function serveCounter(host: Host, log: string[] = [], options: { linger?: number } = {}) {
  host.serve(
    Counter,
    ({ name }, _principal, self) => {
      log.push(`factory ${name}`);
      const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
      const conn = self.resource("conn", {
        version: 1,
        open: () =>
          Effect.runPromise(
            Effect.sync(() => {
              log.push(`open ${name}`);
              return { name };
            }),
          ),
        close: () => {
          log.push(`close ${name}`);
        },
      });
      return {
        count,
        conn,
        add: (delta: number, ctx) => {
          count.change(ctx, (draft) => {
            draft.n += delta;
          });
          return count.value.n;
        },
      };
    },
    options,
  );
}
