import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { dual } from "effect/Function";

import { causeMessage } from "./bridge.ts";
import { DEFAULT_INTERRUPT_BUDGET, inlineLauncher } from "./inline.ts";
import {
  type HostToWorkerMessage,
  type VmChannel,
  type VmStartData,
  type WorkerToHostMessage,
} from "./launcher.ts";
import type {
  CodemodeRemoteExchange,
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
  CodemodeRemoteRequest,
  CodemodeServeOptions,
} from "./remote-types.ts";

const FLUSH_ITEMS = 1_000;
const FLUSH_CHARS = 1 << 20;

const limitMemory = (requested: number | undefined, max: number | undefined) =>
  requested === undefined ? max : max === undefined ? requested : Math.min(requested, max);

class RemoteServe {
  readonly done = Deferred.makeUnsafe<void>();
  private channel: VmChannel | undefined;
  private ended = false;
  private buffered: CodemodeRemoteMessage[] = [];
  private bufferedChars = 0;
  private readonly unsent: HostToWorkerMessage[] = [];

  private readonly exchange: CodemodeRemoteExchange;

  constructor(exchange: CodemodeRemoteExchange) {
    this.exchange = exchange;
  }

  readonly onMessage = (message: unknown): void => {
    if (this.ended) return;
    const typed = message as WorkerToHostMessage;
    switch (typed.type) {
      case "output":
        this.buffered.push(typed);
        this.bufferedChars +=
          typed.item.type === "text" ? typed.item.text.length : typed.item.data.length;
        if (this.buffered.length >= FLUSH_ITEMS || this.bufferedChars >= FLUSH_CHARS)
          this.send(this.takeBuffer());
        break;
      case "started":
        this.buffered.push(typed);
        break;
      case "call":
      case "idle":
        this.send([...this.takeBuffer(), typed]);
        break;
      default:
        this.end(typed);
    }
  };

  readonly end = (terminal: CodemodeRemoteMessage | undefined): void => {
    if (this.ended) return;
    this.ended = true;
    const batch = this.takeBuffer();
    const delivered =
      terminal === undefined
        ? Effect.void
        : Effect.tryPromise(() => this.exchange([...batch, terminal])).pipe(Effect.ignore);
    Effect.runFork(
      delivered.pipe(
        Effect.andThen(Effect.suspend(() => this.channel?.stop ?? Effect.void)),
        Effect.andThen(Deferred.succeed(this.done, undefined)),
      ),
    );
  };

  attach(channel: VmChannel): Effect.Effect<void> {
    this.channel = channel;
    if (this.ended) return channel.stop;
    return Effect.sync(() => {
      for (const message of this.unsent.splice(0)) channel.post(message);
    });
  }

  private takeBuffer(): CodemodeRemoteMessage[] {
    const batch = this.buffered;
    this.buffered = [];
    this.bufferedChars = 0;
    return batch;
  }

  private send(messages: CodemodeRemoteMessage[]): void {
    Effect.runFork(
      Effect.tryPromise(() => this.exchange(messages)).pipe(
        Effect.match({ onSuccess: this.reply, onFailure: () => this.end(undefined) }),
      ),
    );
  }

  private readonly reply = (message: CodemodeRemoteReply): void => {
    if (this.ended || message === null) return;
    if (message.type === "stop") {
      this.end(undefined);
      return;
    }
    if (this.channel === undefined) this.unsent.push(message);
    else this.channel.post(message);
  };
}

const serve = (
  request: CodemodeRemoteRequest,
  exchange: CodemodeRemoteExchange,
  options: CodemodeServeOptions,
): Promise<void> => {
  const maxBudget = options.maxInterruptBudget ?? DEFAULT_INTERRUPT_BUDGET;
  const budget = Math.min(request.interruptBudget ?? maxBudget, maxBudget);
  const memoryLimitBytes = limitMemory(request.data.memoryLimitBytes, options.maxMemoryLimitBytes);
  const data: VmStartData = { ...request.data, memoryLimitBytes };
  const server = new RemoteServe(exchange);
  const launch = inlineLauncher({ wasm: options.wasm, interruptBudget: budget })(data, {
    message: server.onMessage,
    failure: (error) => server.end({ type: "failure", error }),
  });
  Effect.runFork(
    launch.pipe(
      Effect.exit,
      Effect.flatMap((exit) =>
        Exit.isSuccess(exit)
          ? server.attach(exit.value)
          : Effect.sync(() =>
              server.end({
                type: "failure",
                error: { kind: "sandbox", message: causeMessage(exit.cause) },
              }),
            ),
      ),
    ),
  );
  return Effect.runPromise(server.done.pipe(Deferred.await));
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
} = dual(3, serve);
