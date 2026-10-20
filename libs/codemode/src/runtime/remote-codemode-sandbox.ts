import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import bridge from "./bridge.ts";
import executionModule from "./execution.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import sandboxBase from "./sandbox-base.ts";

const { errorMessage } = preludeSource;
const { isWorkerToHostMessage } = executionModule;
const { RuntimeError } = bridge;
const { CodemodeSandboxBase } = sandboxBase;
type Resolve = (reply: protocolTypes.CodemodeRemoteReply) => void;

interface Link {
  readonly events: protocolTypes.VmEvents;
  readonly waiting: Map<number, Resolve>;
  stopped: boolean;
  settled: boolean;
}

const dispatch = (
  link: Link,
  messages: protocolTypes.CodemodeRemoteMessage[],
  resolve: Resolve,
): void => {
  const call = messages.find(
    (message) => isWorkerToHostMessage(message) && message.type === "call",
  );
  if (call?.type === "call") link.waiting.set(call.id, resolve);
  else resolve(null);
  for (const message of messages) {
    if (typeof message === "object" && message !== null && message.type === "failure") {
      link.settled = true;
      link.events.failure(message.error);
      continue;
    }
    link.events.message(message);
    if (isWorkerToHostMessage(message) && (message.type === "done" || message.type === "crash"))
      link.settled = true;
  }
};

const exchangeWith =
  (link: Link): protocolTypes.CodemodeRemoteExchange =>
  (messages) => {
    const answer = Deferred.makeUnsafe<protocolTypes.CodemodeRemoteReply>();
    const resolve: Resolve = (value) => Deferred.doneUnsafe(answer, Exit.succeed(value));
    if (link.stopped || !Array.isArray(messages)) resolve({ type: "stop" });
    else dispatch(link, messages, resolve);
    return Effect.runPromise(answer.pipe(Deferred.await));
  };

const runRemote = (
  target: protocolTypes.CodemodeRemote,
  request: protocolTypes.CodemodeRemoteRequest,
  link: Link,
) =>
  Effect.tryPromise({
    catch: (error) =>
      new RuntimeError({ cause: error, message: errorMessage(error), reason: "remote" }),
    try: () => target.execute(request, exchangeWith(link)),
  }).pipe(
    Effect.match({
      onFailure: (error) => {
        if (!link.stopped)
          link.events.failure({
            kind: "sandbox",
            message: `Remote sandbox failed: ${error.message}`,
          });
      },
      onSuccess: () => {
        if (!link.settled && !link.stopped) {
          const message = "Remote sandbox returned before the script settled";
          link.events.failure({ kind: "sandbox", message });
        }
      },
    }),
  );

const remoteLauncher =
  (
    remote: () => protocolTypes.CodemodeRemote,
    interruptBudget: number | undefined,
  ): protocolTypes.VmLauncher =>
  (data, events) =>
    Effect.gen(function* () {
      const link: Link = { events, settled: false, stopped: false, waiting: new Map() };
      const target = yield* Effect.try({
        catch: (cause) =>
          new RuntimeError({
            cause,
            message: `Failed to reach the remote sandbox: ${errorMessage(cause)}`,
            reason: "launch",
          }),
        try: remote,
      });
      const request = interruptBudget === undefined ? { data } : { data, interruptBudget };
      yield* Effect.forkDetach(Effect.suspend(() => runRemote(target, request, link)));
      return {
        post: (message) => {
          const resolve = link.waiting.get(message.id);
          if (resolve === undefined) return;
          link.waiting.delete(message.id);
          resolve(message);
        },
        stop: Effect.sync(() => {
          link.stopped = true;
          for (const resolve of link.waiting.values()) resolve({ type: "stop" });
          link.waiting.clear();
        }),
      };
    });

export default class RemoteCodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: protocolTypes.RemoteCodemodeSandboxOptions) {
    super(options, remoteLauncher(options.remote, options.interruptBudget));
  }
}
