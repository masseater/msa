import { Effect, Exit, Scope } from "effect";

import cluster from "./cluster.ts";
import errorsModule from "./errors.ts";
import hostDispose from "./host-dispose.ts";
import HostLinks from "./host-links.ts";
import type hostTypesModule from "./host-types.types.ts";
import reloadModule from "./reload.ts";
import type reloadTypes from "./reload.types.ts";

const { ChordError } = errorsModule;
const { runClusterReload } = cluster;
const { runReload } = reloadModule;
const { disposeHoldersFirst } = hostDispose;

export default class HostImpl extends HostLinks implements hostTypesModule.Host {
  constructor(options: hostTypesModule.HostOptions) {
    super(options);
    if (options.upstream !== undefined) this.connect(options.upstream.link, options.upstream);
  }

  reload(
    plugins: readonly hostTypesModule.PluginRef[],
    options: reloadTypes.ReloadOptions = {},
  ): Promise<reloadTypes.ReloadReport> {
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
      ? Effect.runPromise(runClusterReload(this, { options, plugins }))
      : Effect.runPromise(runReload(this, { options, plugins }));
  }

  close(): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() => {
        this.closeLingering();
        this.hostObjects.clear();
        this.endFacetRuns();
        return disposeHoldersFirst({
          message: "host close: disposal failed",
          objects: [...this.objects.values()],
          reason: new ChordError("gone", `host ${this.name} closed`),
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
