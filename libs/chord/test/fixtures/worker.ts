import { Config, Effect, Option } from "effect";

import { createHost, ipcLink } from "../../src/index.ts";
import { childControl, parentChannel } from "../../src/manager.ts";
import { Echo } from "./echo.ts";
import { startNode, writeText } from "./platform.ts";

const control = childControl();

const exitSoon = Effect.sleep(200).pipe(Effect.andThen(Effect.sync(() => process.exit(1))));

const recordGrandchild = Effect.gen(function* () {
  const file = yield* Effect.orDie(Config.option(Config.String("GRANDCHILD_FILE")));
  if (Option.isNone(file) || file.value === "") return;
  const grandchild = yield* startNode(["-e", "setInterval(() => {}, 1000)"]);
  yield* writeText(file.value, String(grandchild));
});

const serve = (mode: string) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => control.lock()).pipe(
      Effect.catch(() => exitSoon.pipe(Effect.andThen(Effect.never))),
    );
    const name = yield* Effect.orDie(Config.String("HOST_NAME").pipe(Config.withDefault("worker")));
    const host = createHost({
      self: { kind: "host" },
      name,
      upstream: { link: ipcLink(parentChannel()), principal: { kind: "server" } },
      onError: () => {},
    });
    const init = (yield* Effect.promise(() => control.init)) as { greeting: string };
    host.serve(Echo, () => ({
      variant: "main",
      echo: (text: string) => `${init.greeting} ${text} from ${process.pid}`,
      pid: () => process.pid,
    }));
    yield* recordGrandchild;
    const services = yield* Effect.context<never>();
    control.onShutdown(() =>
      Effect.runPromiseWith(services)(
        Effect.gen(function* () {
          if (mode === "ignore-shutdown") return;
          yield* Effect.promise(() => host.close());
          process.exit(0);
        }),
      ),
    );
    control.ready();
  });

const main = Effect.gen(function* () {
  const mode = yield* Effect.orDie(
    Config.String("FIXTURE_MODE").pipe(Config.withDefault("normal")),
  );
  if (mode !== "fatal") return yield* serve(mode);
  control.fatal(new Error("fixture refuses to start"));
  return yield* exitSoon;
});

await Effect.runPromise(main);
