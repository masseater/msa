import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { isWorkerToHostMessage, type VmEvents } from "./launcher.ts";
import type {
  CodemodeRemoteExchange,
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
} from "./remote-types.ts";

type Resolve = (reply: CodemodeRemoteReply) => void;

const isSettling = (message: CodemodeRemoteMessage): boolean =>
  isWorkerToHostMessage(message) && (message.type === "done" || message.type === "crash");

export class RemoteLink {
  stopped = false;
  settled = false;
  readonly waiting = new Map<number, Resolve>();

  private readonly events: VmEvents;

  constructor(events: VmEvents) {
    this.events = events;
  }

  readonly exchange: CodemodeRemoteExchange = (messages) => {
    const reply = Deferred.makeUnsafe<CodemodeRemoteReply>();
    const resolve: Resolve = (value) => Deferred.doneUnsafe(reply, Exit.succeed(value));
    if (this.stopped || !Array.isArray(messages)) resolve({ type: "stop" });
    else this.dispatch(messages, resolve);
    return Effect.runPromise(reply.pipe(Deferred.await));
  };

  stop(): void {
    this.stopped = true;
    for (const resolve of this.waiting.values()) resolve({ type: "stop" });
    this.waiting.clear();
  }

  private dispatch(messages: CodemodeRemoteMessage[], resolve: Resolve): void {
    const call = messages.find(
      (message) => isWorkerToHostMessage(message) && message.type === "call",
    );
    if (call?.type === "call") this.waiting.set(call.id, resolve);
    else resolve(null);
    for (const message of messages) {
      if (typeof message === "object" && message !== null && message.type === "failure") {
        this.settled = true;
        this.events.failure(message.error);
        continue;
      }
      this.events.message(message);
      if (isSettling(message)) this.settled = true;
    }
  }
}
