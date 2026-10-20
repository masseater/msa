import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";

import inline from "./inline.ts";
import preludeSource from "./prelude-source.ts";
import type protocolTypes from "./protocol.ts";
import RemoteCodemodeSandbox from "./remote-codemode-sandbox.ts";

const { DEFAULT_INTERRUPT_BUDGET, inlineLauncher } = inline;
const { causeMessage } = preludeSource;

const FLUSH_ITEMS = 1_000;
const FLUSH_CHARS = 1 << 20;

interface Serve {
  readonly done: Deferred.Deferred<void>;
  readonly exchange: protocolTypes.CodemodeRemoteExchange;
  readonly unsent: protocolTypes.HostToWorkerMessage[];
  channel: protocolTypes.VmChannel | undefined;
  ended: boolean;
  buffered: protocolTypes.CodemodeRemoteMessage[];
  bufferedChars: number;
}

const takeBuffer = (serve: Serve): protocolTypes.CodemodeRemoteMessage[] => {
  const batch = serve.buffered;
  serve.buffered = [];
  serve.bufferedChars = 0;
  return batch;
};

const end = (serve: Serve, terminal: protocolTypes.CodemodeRemoteMessage | undefined): void => {
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

const reply = (serve: Serve, message: protocolTypes.CodemodeRemoteReply): void => {
  if (serve.ended || message === null) return;
  if (message.type === "stop") end(serve, undefined);
  else if (serve.channel === undefined) serve.unsent.push(message);
  else serve.channel.post(message);
};

const send = (serve: Serve, messages: protocolTypes.CodemodeRemoteMessage[]): void => {
  Effect.runFork(
    Effect.tryPromise(() => serve.exchange(messages)).pipe(
      Effect.match({
        onFailure: () => end(serve, undefined),
        onSuccess: (message) => reply(serve, message),
      }),
    ),
  );
};

const onServedMessage = (serve: Serve, message: unknown): void => {
  if (serve.ended) return;
  const typed = message as protocolTypes.WorkerToHostMessage;
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

const attach = (serve: Serve, channel: protocolTypes.VmChannel): Effect.Effect<void> => {
  serve.channel = channel;
  if (serve.ended) return channel.stop;
  return Effect.sync(() => {
    for (const message of serve.unsent.splice(0)) channel.post(message);
  });
};

const limitMemory = (requested: number | undefined, max: number | undefined) =>
  requested === undefined ? max : max === undefined ? requested : Math.min(requested, max);

const serveRequest = (
  request: protocolTypes.CodemodeRemoteRequest,
  exchange: protocolTypes.CodemodeRemoteExchange,
  options: protocolTypes.CodemodeServeOptions,
): Promise<void> => {
  const maxBudget = options.maxInterruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  const budget = Math.min(request.interruptBudget ?? maxBudget, maxBudget);
  const memoryLimitBytes = limitMemory(request.data.memoryLimitBytes, options.maxMemoryLimitBytes);
  const serve: Serve = {
    buffered: [],
    bufferedChars: 0,
    channel: undefined,
    done: Deferred.makeUnsafe<void>(),
    ended: false,
    exchange,
    unsent: [],
  };
  const failure = (message: string) =>
    end(serve, { error: { kind: "sandbox", message }, type: "failure" });
  const launch = inlineLauncher({ interruptBudget: budget, wasm: options.wasm })(
    { ...request.data, memoryLimitBytes },
    {
      failure: (error) => end(serve, { error, type: "failure" }),
      message: (message) => onServedMessage(serve, message),
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

const serveCodemodeRemote: {
  (
    exchange: protocolTypes.CodemodeRemoteExchange,
    options: protocolTypes.CodemodeServeOptions,
  ): (request: protocolTypes.CodemodeRemoteRequest) => Promise<void>;
  (
    request: protocolTypes.CodemodeRemoteRequest,
    exchange: protocolTypes.CodemodeRemoteExchange,
    options: protocolTypes.CodemodeServeOptions,
  ): Promise<void>;
} = dual(3, serveRequest);

const remoteModule = {
  RemoteCodemodeSandbox,
  reply,
  serveCodemodeRemote,
};

export default remoteModule;
