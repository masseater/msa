import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";

import { RuntimeError } from "./bridge.ts";
import { isWorkerToHostMessage } from "./execution.ts";
import { DEFAULT_INTERRUPT_BUDGET, inlineLauncher } from "./inline.ts";
import { causeMessage, errorMessage } from "./prelude-source.ts";
import type {
  CodemodeRemote,
  CodemodeRemoteExchange,
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
  CodemodeRemoteRequest,
  CodemodeServeOptions,
  HostToWorkerMessage,
  RemoteCodemodeSandboxOptions,
  VmChannel,
  VmEvents,
  VmLauncher,
  WorkerToHostMessage,
} from "./protocol.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";

export type {
  CodemodeRemote,
  CodemodeRemoteExchange,
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
  CodemodeRemoteRequest,
  CodemodeServeOptions,
  RemoteCodemodeSandboxOptions,
} from "./protocol.ts";

const FLUSH_ITEMS = 1_000;
const FLUSH_CHARS = 1 << 20;

interface Serve {
  readonly done: Deferred.Deferred<void>;
  readonly exchange: CodemodeRemoteExchange;
  readonly unsent: HostToWorkerMessage[];
  channel: VmChannel | undefined;
  ended: boolean;
  buffered: CodemodeRemoteMessage[];
  bufferedChars: number;
}

const takeBuffer = (serve: Serve): CodemodeRemoteMessage[] => {
  const batch = serve.buffered;
  serve.buffered = [];
  serve.bufferedChars = 0;
  return batch;
};

const end = (serve: Serve, terminal: CodemodeRemoteMessage | undefined): void => {
  if (serve.ended) return;
  serve.ended = true;
  const batch = takeBuffer(serve);
  const delivered =
    terminal === undefined
      ? Effect.void
      : Effect.tryPromise(() => serve.exchange([...batch, terminal])).pipe(Effect.ignore);
  Effect.runFork(
    delivered.pipe(
      Effect.andThen(Effect.suspend(() => serve.channel?.stop ?? Effect.void)),
      Effect.andThen(Deferred.succeed(serve.done, undefined)),
    ),
  );
};

const reply = (serve: Serve, message: CodemodeRemoteReply): void => {
  if (serve.ended || message === null) return;
  if (message.type === "stop") end(serve, undefined);
  else if (serve.channel === undefined) serve.unsent.push(message);
  else serve.channel.post(message);
};

const send = (serve: Serve, messages: CodemodeRemoteMessage[]): void => {
  Effect.runFork(
    Effect.tryPromise(() => serve.exchange(messages)).pipe(
      Effect.match({
        onSuccess: (message) => reply(serve, message),
        onFailure: () => end(serve, undefined),
      }),
    ),
  );
};

const onServedMessage = (serve: Serve, message: unknown): void => {
  if (serve.ended) return;
  const typed = message as WorkerToHostMessage;
  switch (typed.type) {
    case "output":
      serve.buffered.push(typed);
      serve.bufferedChars +=
        typed.item.type === "text" ? typed.item.text.length : typed.item.data.length;
      if (serve.buffered.length >= FLUSH_ITEMS || serve.bufferedChars >= FLUSH_CHARS)
        send(serve, takeBuffer(serve));
      break;
    case "started":
      serve.buffered.push(typed);
      break;
    case "call":
    case "idle":
      send(serve, [...takeBuffer(serve), typed]);
      break;
    default:
      end(serve, typed);
  }
};

const attach = (serve: Serve, channel: VmChannel): Effect.Effect<void> => {
  serve.channel = channel;
  if (serve.ended) return channel.stop;
  return Effect.sync(() => {
    for (const message of serve.unsent.splice(0)) channel.post(message);
  });
};

const limitMemory = (requested: number | undefined, max: number | undefined) =>
  requested === undefined ? max : max === undefined ? requested : Math.min(requested, max);

const serveRequest = (
  request: CodemodeRemoteRequest,
  exchange: CodemodeRemoteExchange,
  options: CodemodeServeOptions,
): Promise<void> => {
  const maxBudget = options.maxInterruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  const budget = Math.min(request.interruptBudget ?? maxBudget, maxBudget);
  const memoryLimitBytes = limitMemory(request.data.memoryLimitBytes, options.maxMemoryLimitBytes);
  const serve: Serve = {
    done: Deferred.makeUnsafe<void>(),
    exchange,
    unsent: [],
    channel: undefined,
    ended: false,
    buffered: [],
    bufferedChars: 0,
  };
  const failure = (message: string) =>
    end(serve, { type: "failure", error: { kind: "sandbox", message } });
  const launch = inlineLauncher({ wasm: options.wasm, interruptBudget: budget })(
    { ...request.data, memoryLimitBytes },
    {
      message: (message) => onServedMessage(serve, message),
      failure: (error) => end(serve, { type: "failure", error }),
    },
  );
  Effect.runFork(
    launch.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Exit.isSuccess(exit)
          ? attach(serve, exit.value)
          : Effect.sync(() => exit.cause.pipe(causeMessage, failure)),
      ),
    ),
  );
  return Effect.runPromise(serve.done.pipe(Deferred.await));
};

export const serveCodemodeRemote: {
  (
    exchange: CodemodeRemoteExchange,
    options: CodemodeServeOptions,
  ): (request: CodemodeRemoteRequest) => Promise<void>;
  (
    request: CodemodeRemoteRequest,
    exchange: CodemodeRemoteExchange,
    options: CodemodeServeOptions,
  ): Promise<void>;
} = dual(3, serveRequest);

type Resolve = (reply: CodemodeRemoteReply) => void;

interface Link {
  readonly events: VmEvents;
  readonly waiting: Map<number, Resolve>;
  stopped: boolean;
  settled: boolean;
}

const dispatch = (link: Link, messages: CodemodeRemoteMessage[], resolve: Resolve): void => {
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
  (link: Link): CodemodeRemoteExchange =>
  (messages) => {
    const answer = Deferred.makeUnsafe<CodemodeRemoteReply>();
    const resolve: Resolve = (value) => Deferred.doneUnsafe(answer, Exit.succeed(value));
    if (link.stopped || !Array.isArray(messages)) resolve({ type: "stop" });
    else dispatch(link, messages, resolve);
    return Effect.runPromise(answer.pipe(Deferred.await));
  };

const runRemote = (target: CodemodeRemote, request: CodemodeRemoteRequest, link: Link) =>
  Effect.tryPromise({
    try: () => target.execute(request, exchangeWith(link)),
    catch: (error) =>
      new RuntimeError({ reason: "remote", message: errorMessage(error), cause: error }),
  }).pipe(
    Effect.match({
      onSuccess: () => {
        if (!link.settled && !link.stopped) {
          const message = "Remote sandbox returned before the script settled";
          link.events.failure({ kind: "sandbox", message });
        }
      },
      onFailure: (error) => {
        if (!link.stopped)
          link.events.failure({
            kind: "sandbox",
            message: `Remote sandbox failed: ${error.message}`,
          });
      },
    }),
  );

const remoteLauncher =
  (remote: () => CodemodeRemote, interruptBudget: number | undefined): VmLauncher =>
  (data, events) =>
    Effect.gen(function* () {
      const link: Link = { events, waiting: new Map(), stopped: false, settled: false };
      const target = yield* Effect.try({
        try: remote,
        catch: (cause) =>
          new RuntimeError({
            reason: "launch",
            message: `Failed to reach the remote sandbox: ${errorMessage(cause)}`,
            cause,
          }),
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

export class RemoteCodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: RemoteCodemodeSandboxOptions) {
    super(options, remoteLauncher(options.remote, options.interruptBudget));
  }
}
