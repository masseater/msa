import { Effect } from "effect";
import { dual } from "effect/Function";
import { Type } from "typebox";

import { type Host, createHost, local, method } from "../../src/index.ts";
import timing from "./timing.ts";

const { pollUntil, tick } = timing;

const quiet = (errors: unknown[] = []) =>
  createHost({ onError: (error) => errors.push(error), self: { kind: "host" } });

const until = (check: () => boolean) => pollUntil(check, 200, tick);

const Counter = local("t.counter", {
  input: Type.Object({ name: Type.String() }),
  members: {
    add: method(Type.Number(), Type.Number()),
    count: Type.Object({ n: Type.Number() }),
  },
  version: 1,
});

function serveCounterImpl(host: Host, log: string[] = [], options: { linger?: number } = {}) {
  host.serve(
    Counter,
    ({ name }, _principal, self) => {
      log.push(`factory ${name}`);
      const count = self.state("count", Type.Object({ n: Type.Number() }), { n: 0 });
      const conn = self.resource("conn", {
        close: () => {
          log.push(`close ${name}`);
        },
        open: () =>
          Effect.runPromise(
            Effect.sync(() => {
              log.push(`open ${name}`);
              return { name };
            }),
          ),
        version: 1,
      });
      return {
        add: (delta: number, ctx) => {
          count.change(ctx, (draft) => {
            draft.n += delta;
          });
          return count.value.n;
        },
        conn,
        count,
      };
    },
    options,
  );
}

const isHost = (value: unknown): value is Host =>
  typeof (value as { serve?: unknown } | undefined)?.serve === "function";

const serveCounter: {
  (log?: string[], options?: { linger?: number }): (host: Host) => void;
  (host: Host, log?: string[], options?: { linger?: number }): void;
} = dual((args: IArguments) => isHost(args[0]), serveCounterImpl);

const hostModule = {
  Counter,
  quiet,
  serveCounter,
  until,
};

export default hostModule;
