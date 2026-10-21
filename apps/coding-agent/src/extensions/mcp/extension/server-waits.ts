import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import awaitingModule from "../../../core/awaiting.ts";
import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import interop from "../../../utils/interop.ts";
import type extensionInternalTypes from "../extension-internal.types.ts";
import type McpExtensionHost from "./host.ts";
import serverState from "./server-state.ts";

const { hasDirectTools, isEnabled } = serverState;
const { awaited, awaitingWith, performed } = awaitingModule;
const { callbackPromise } = interop;

export default class McpServerWaits {
  private readonly host: McpExtensionHost;

  constructor(host: McpExtensionHost) {
    this.host = host;
  }

  readonly waitForServers = (
    waiting: readonly extensionInternalTypes.McpServer[],
    signal: AbortSignal | undefined,
  ) =>
    Effect.runPromise(
      awaitingWith(function* () {
        const readyOf = () =>
          waiting.flatMap((server) =>
            isEnabled(server) && this.host.servers.includes(server) && server.ready !== undefined
              ? [{ ready: server.ready, server }]
              : [],
          );
        const unchanged = (ready: ReturnType<typeof readyOf>) =>
          ready.every(
            (attempt) =>
              !isEnabled(attempt.server) ||
              !this.host.servers.includes(attempt.server) ||
              attempt.ready === attempt.server.ready,
          );
        for (;;) {
          const ready = readyOf();
          if (ready.length === 0 || signal?.aborted === true) return;
          let onAbort: (() => void) | undefined;
          yield* awaited(
            Promise.race([
              Promise.all(ready.map((attempt) => attempt.ready)),
              callbackPromise<void>((done) => {
                onAbort = () => done();
                signal?.addEventListener("abort", onAbort, { once: true });
              }),
            ]),
          );
          if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
          if ((signal?.aborted ?? false) || unchanged(ready)) return;
        }
      }, this),
    );

  readonly waitForDirectServers = (ctx: extensionsTypesTypes.ExtensionContext) =>
    Effect.runPromise(
      awaitingWith(function* () {
        if (this.host.waitedForStartup) return;
        this.host.waitedForStartup = true;
        const ready = this.host.servers.flatMap((server) =>
          isEnabled(server) && hasDirectTools(server.entry) && server.ready !== undefined
            ? [server.ready]
            : [],
        );
        if (ready.length === 0) return;
        const finished = Option.isSome(
          yield* performed(
            Effect.promise(() => Promise.all(ready)).pipe(
              Effect.timeoutOption(this.host.startupWaitMs),
            ),
          ),
        );
        if (!finished) {
          ctx.ui.notify(
            "MCP servers are still connecting; their tools become available once connected.",
            "info",
          );
        }
      }, this),
    );
}
