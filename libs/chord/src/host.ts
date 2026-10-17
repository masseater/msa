import { Effect, Exit, Scope } from "effect";

import { runClusterReload } from "./cluster.ts";
import { ChordError } from "./errors.ts";
import { disposeHoldersFirst } from "./host-dispose.ts";
import { HostLinks } from "./host-links.ts";
import type { Host, HostOptions, PluginRef } from "./host-types.ts";
import { type ReloadOptions, type ReloadReport, runReload } from "./reload.ts";

export class HostImpl extends HostLinks implements Host {
  constructor(options: HostOptions) {
    super(options);
    if (options.upstream !== undefined) this.connect(options.upstream.link, options.upstream);
  }

  reload(plugins: readonly PluginRef[], options: ReloadOptions = {}): Promise<ReloadReport> {
    if (this.kind !== "client" && this.upstream !== undefined) {
      return Promise.reject(
        new ChordError("unavailable", "reloads are coordinated by the server", {
          reason: "not_coordinator",
        }),
      );
    }
    const children = [...this.connections].some(
      (connection) => connection.role === "downstream" && connection.peer.kind === "host",
    );
    return children || options.remote !== undefined || options.remoteRemove !== undefined
      ? Effect.runPromise(runClusterReload(this, { plugins, options }))
      : Effect.runPromise(runReload(this, { plugins, options }));
  }

  close(): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() => {
        this.closeLingering();
        this.hostObjects.clear();
        this.endFacetRuns();
        return disposeHoldersFirst({
          objects: [...this.objects.values()],
          reason: new ChordError("gone", `host ${this.name} closed`),
          message: "host close: disposal failed",
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              for (const connection of [...this.connections]) connection.link.close("host closed");
            }),
          ),
          Effect.ensuring(Scope.close(this.scope, Exit.void)),
        );
      }),
    );
  }
}

export const createHost = <P = unknown>(options: HostOptions<P>): Host<P> =>
  new HostImpl(options as HostOptions) as unknown as Host<P>;
