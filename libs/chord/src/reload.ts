import { Cause, Effect } from "effect";
import { dual } from "effect/Function";

import type errorsTypes from "./errors.types.ts";
import type hostLinksTypes from "./host-links.types.ts";
import type reloadCandidateTypes from "./reload-candidate.types.ts";
import Reload from "./reload-class.ts";
import reloadKit from "./reload-kit.ts";
import type reloadTypes from "./reload.types.ts";

const { errors: errorsModule } = reloadKit;

const { ChordError, asChordError } = errorsModule;

const reloadError = (error: unknown): errorsTypes.ChordError => {
  const cause = asChordError(error, "reload");
  if (/^reload aborted/u.test(cause.message.replace(/^[^:]*: /u, ""))) return cause;
  return ChordError.create(cause.code, `reload aborted: ${cause.message}`, {
    cause,
    details: cause.details,
    reason: cause.reason,
  });
};

const dieWith =
  (map: (error: unknown) => unknown) =>
  (cause: Cause.Cause<unknown>): Effect.Effect<never> =>
    Effect.die(map(Cause.squash(cause)));

const endReload = (host: hostLinksTypes.HostLinks): void => {
  host.reloadEnded();
};

const beginReload: {
  (request: reloadTypes.ReloadRequest): (host: hostLinksTypes.HostLinks) => Effect.Effect<Reload>;
  (host: hostLinksTypes.HostLinks, request: reloadTypes.ReloadRequest): Effect.Effect<Reload>;
} = dual(
  2,
  (host: hostLinksTypes.HostLinks, request: reloadTypes.ReloadRequest): Effect.Effect<Reload> =>
    Effect.gen(function* () {
      if (host.reloading) {
        throw ChordError.create("unavailable", "a reload is already running", {
          reason: "reload_running",
        });
      }
      host.reloading = true;
      const facets = yield* host
        .resolve(request.plugins)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => host.reloadEnded()).pipe(Effect.andThen(dieWith(reloadError)(cause))),
          ),
        );
      return new Reload(host, facets, request);
    }),
);

const runReload: {
  (
    request: reloadTypes.ReloadRequest,
  ): (host: hostLinksTypes.HostLinks) => Effect.Effect<reloadCandidateTypes.ReloadReport>;
  (
    host: hostLinksTypes.HostLinks,
    request: reloadTypes.ReloadRequest,
  ): Effect.Effect<reloadCandidateTypes.ReloadReport>;
} = dual(
  2,
  (
    host: hostLinksTypes.HostLinks,
    request: reloadTypes.ReloadRequest,
  ): Effect.Effect<reloadCandidateTypes.ReloadReport> =>
    Effect.gen(function* () {
      const reload = yield* beginReload(host, request);
      return yield* reload
        .prepare()
        .pipe(
          Effect.andThen(Effect.sync(() => reload.commit())),
          Effect.ensuring(Effect.sync(() => endReload(host))),
        );
    }),
);

const reloadModule = {
  Reload,
  beginReload,
  dieWith,
  endReload,
  reloadError,
  runReload,
};

export default reloadModule;
