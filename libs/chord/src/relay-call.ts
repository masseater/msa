import { Effect } from "effect";

import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import RelayCall from "./relay-call-class.ts";
import type relayCallTypes from "./relay-call.types.ts";

const { ChordError } = errorsModule;

const abortedWith = (signal: AbortSignal, error: () => unknown): Effect.Effect<never> =>
  Effect.callback<never>((resume) => {
    const abort = (): void => resume(Effect.die(error()));
    signal.addEventListener("abort", abort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

const relayCall = (request: relayCallTypes.RelayRequest): Effect.Effect<unknown> => {
  const { relay, frame, root, signal } = request;
  const abortError = (): errorsTypes.ChordError =>
    new ChordError("aborted", "call cancelled", { cause: signal.reason });
  return Effect.gen(function* () {
    if (signal.aborted) throw abortError();
    const down = yield* Effect.raceFirst(relay.ready(), abortedWith(signal, abortError));
    if (relay.closed) throw new ChordError("gone", "relayed hold closed");
    let detach = (): void => {};
    return yield* Effect.callback<unknown>((resume) => {
      const call = new RelayCall(relay, frame.id, down.nextId(), {
        reject: (error) => resume(Effect.die(error)),
        resolve: (value) => resume(Effect.succeed(value)),
      });
      const cancel = (): void => call.cancel(abortError(), true);
      signal.addEventListener("abort", cancel, { once: true });
      detach = () => signal.removeEventListener("abort", cancel);
      request.rootSent(root.rootId, down);
      down.send({
        args: frame.args,
        hold: relay.downId,
        id: call.downId,
        member: frame.member,
        root,
        t: "call",
      });
    }).pipe(Effect.ensuring(Effect.sync(() => detach())));
  });
};

const relayCallModule = {
  RelayCall,
  relayCall,
};

export default relayCallModule;
