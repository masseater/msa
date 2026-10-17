import * as Effect from "effect/Effect";

import type { CodemodeSandboxBaseOptions } from "../types.ts";
import { errorMessage } from "./bridge.ts";
import { LaunchError } from "./errors/launch-error.ts";
import { RemoteSandboxError } from "./errors/remote-sandbox-error.ts";
import type { VmEvents, VmLauncher } from "./launcher.ts";
import type { VmStartData } from "./protocol.ts";
import { RemoteLink } from "./remote-link.ts";
import type { CodemodeRemote, CodemodeRemoteRequest } from "./remote-types.ts";
import { CodemodeSandboxBase } from "./sandbox-base.ts";

export { serveCodemodeRemote } from "./remote-serve.ts";
export type {
  CodemodeRemote,
  CodemodeRemoteExchange,
  CodemodeRemoteMessage,
  CodemodeRemoteReply,
  CodemodeRemoteRequest,
  CodemodeServeOptions,
} from "./remote-types.ts";

export interface RemoteCodemodeSandboxOptions extends CodemodeSandboxBaseOptions {
  remote: () => CodemodeRemote;
  interruptBudget?: number;
}

const runRemote = (
  target: CodemodeRemote,
  request: CodemodeRemoteRequest,
  link: RemoteLink,
  events: VmEvents,
) =>
  Effect.tryPromise({
    try: () => target.execute(request, link.exchange),
    catch: (error) => new RemoteSandboxError({ message: errorMessage(error), cause: error }),
  }).pipe(
    Effect.match({
      onSuccess: () => {
        if (!link.settled && !link.stopped) {
          events.failure({
            kind: "sandbox",
            message: "Remote sandbox returned before the script settled",
          });
        }
      },
      onFailure: (error) => {
        if (!link.stopped)
          events.failure({
            kind: "sandbox",
            message: `Remote sandbox failed: ${error.message}`,
          });
      },
    }),
  );

function remoteLauncher(
  remote: () => CodemodeRemote,
  interruptBudget: number | undefined,
): VmLauncher {
  return (data: VmStartData, events: VmEvents) =>
    Effect.gen(function* () {
      const link = new RemoteLink(events);
      const target = yield* Effect.try({
        try: remote,
        catch: (cause) =>
          new LaunchError({
            message: `Failed to reach the remote sandbox: ${errorMessage(cause)}`,
            cause,
          }),
      });
      const request: CodemodeRemoteRequest =
        interruptBudget === undefined ? { data } : { data, interruptBudget };
      yield* Effect.forkDetach(Effect.suspend(() => runRemote(target, request, link, events)));
      return {
        post: (message) => {
          const resolve = link.waiting.get(message.id);
          if (resolve === undefined) return;
          link.waiting.delete(message.id);
          resolve(message);
        },
        stop: Effect.sync(() => link.stop()),
      };
    });
}

export class RemoteCodemodeSandbox extends CodemodeSandboxBase {
  constructor(options: RemoteCodemodeSandboxOptions) {
    super(options, remoteLauncher(options.remote, options.interruptBudget));
  }
}
