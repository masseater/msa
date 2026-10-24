import { Cause, Effect, Exit, Fiber } from "effect";
import { dual } from "effect/Function";

import type connectionTypes from "./connection.types.ts";
import errorsModule from "./errors.ts";
import type hostLinksTypes from "./host-links.types.ts";
import reloadModule from "./reload.ts";
import type reloadTypes from "./reload.types.ts";

const { ChordError } = errorsModule;
const { beginReload, endReload, reloadError } = reloadModule;

let reloadSeq = 0;

const nextReloadId = (): number => {
  reloadSeq += 1;
  return reloadSeq;
};

const modulesFor = (
  remote: reloadTypes.ReloadOptions["remote"],
  hostName: string | undefined,
): string[] => {
  let best: [string, readonly string[]] | undefined;
  for (const entry of Object.entries(remote ?? {})) {
    if (
      hostName?.startsWith(entry[0]) === true &&
      (best === undefined || entry[0].length > best[0].length)
    )
      best = entry;
  }
  return [...(best?.[1] ?? [])];
};

const awaitVote = (
  connection: connectionTypes.Connection,
  id: number,
  deadline: number,
): Effect.Effect<unknown> =>
  Effect.callback<unknown>((resume) => {
    connection.votes.set(id, {
      reject: (error) => resume(Effect.die(error)),
      resolve: (value) => resume(Effect.succeed(value)),
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () =>
        Effect.sync(() => connection.votes.delete(id)).pipe(
          Effect.andThen(
            Effect.die(
              ChordError.create("aborted", `votes missing after ${deadline} ms`, {
                reason: "vote_deadline",
              }),
            ),
          ),
        ),
    }),
  );

type Vote = readonly [string, reloadTypes.ReloadReport | undefined];

interface Ballot {
  readonly id: number;
  readonly codeVersion: number;
  readonly deadline: number;
  readonly options: reloadTypes.ReloadOptions;
}

const requestVote = (
  connection: connectionTypes.Connection,
  ballot: Ballot,
): Effect.Effect<Fiber.Fiber<Vote>> =>
  Effect.gen(function* () {
    const { id, options } = ballot;
    const name = connection.name ?? "child";
    const vote = yield* Effect.forkChild(
      awaitVote(connection, id, ballot.deadline).pipe(
        Effect.map((report): Vote => [name, report as reloadTypes.ReloadReport | undefined]),
        Effect.catchCause((cause) => {
          const failure = reloadError(Cause.squash(cause));
          return Effect.die(
            ChordError.create(failure.code, `${name}: ${failure.message}`, {
              cause: failure,
              reason: failure.reason,
            }),
          );
        }),
      ),
      { startImmediately: true },
    );
    connection.send({
      codeVersion: ballot.codeVersion,
      options: {
        remove: modulesFor(options.remoteRemove, name),
        ...(options.gateDeadline === undefined ? {} : { gateDeadline: options.gateDeadline }),
        ...(options.retireDeadline === undefined ? {} : { retireDeadline: options.retireDeadline }),
      },
      plugins: modulesFor(options.remote, name),
      reload: id,
      t: "prepare",
    });
    return vote;
  });

const childReports = (
  exits: readonly Exit.Exit<Vote>[],
): Record<string, reloadTypes.ReloadReport> => {
  const children: Record<string, reloadTypes.ReloadReport> = {};
  for (const exit of exits) {
    if (Exit.isSuccess(exit) && exit.value[1] !== undefined)
      children[exit.value[0]] = exit.value[1];
  }
  return children;
};

const voteRound = (
  host: hostLinksTypes.HostLinks,
  reload: reloadTypes.Reload,
  participants: readonly connectionTypes.Connection[],
  ballot: Ballot,
): Effect.Effect<reloadTypes.ReloadReport> =>
  Effect.gen(function* () {
    const votes = yield* Effect.forEach(participants, (connection) =>
      requestVote(connection, ballot),
    );
    let local = false;
    const [localExit, voteExits] = yield* Effect.all(
      [
        Effect.exit(
          reload.prepare().pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                local = true;
              }),
            ),
          ),
        ),
        Effect.forEach(votes, (vote) => Effect.exit(Fiber.join(vote)), {
          concurrency: "unbounded",
        }),
      ],
      { concurrency: "unbounded" },
    );
    const exits: readonly Exit.Exit<unknown>[] = [localExit, ...voteExits];
    const failed = exits.find(Exit.isFailure);
    if (failed !== undefined) {
      for (const connection of participants) {
        connection.votes.delete(ballot.id);
        connection.send({ reload: ballot.id, t: "abort" });
      }
      if (local) yield* reload.rollback();
      return yield* Effect.die(Cause.squash(failed.cause));
    }
    const report = reload.commit(() => {
      for (const connection of participants) {
        connection.send({ reload: ballot.id, t: "commit" });
        connection.peerCodeVersion = ballot.codeVersion;
      }
    });
    host.rememberRemoteModules(ballot.options.remote, ballot.options.remoteRemove);
    return { ...report, children: childReports(voteExits) };
  });

const runClusterReload: {
  (
    request: reloadTypes.ReloadRequest,
  ): (host: hostLinksTypes.HostLinks) => Effect.Effect<reloadTypes.ReloadReport>;
  (
    host: hostLinksTypes.HostLinks,
    request: reloadTypes.ReloadRequest,
  ): Effect.Effect<reloadTypes.ReloadReport>;
} = dual(
  2,
  (
    host: hostLinksTypes.HostLinks,
    request: reloadTypes.ReloadRequest,
  ): Effect.Effect<reloadTypes.ReloadReport> =>
    Effect.gen(function* () {
      const { options } = request;
      const synced = [...host.connections].filter(
        (connection) =>
          connection.role === "downstream" &&
          connection.peer.kind === "host" &&
          connection.open &&
          connection.synced,
      );
      const codeVersion = host.peekNextCodeVersion();
      const reload = yield* beginReload(host, { ...request, codeVersion });
      return yield* Effect.gen(function* () {
        yield* reload.waitForRetirement();
        const participants = synced.filter((connection) => connection.open);
        const deadline =
          options.voteDeadline ??
          (options.gateDeadline ?? 5000) + (options.retireDeadline ?? 5000) + 5000;
        return yield* voteRound(host, reload, participants, {
          codeVersion,
          deadline,
          id: nextReloadId(),
          options,
        });
      }).pipe(Effect.ensuring(Effect.sync(() => endReload(host))));
    }),
);

const reconcileChild: {
  (connection: connectionTypes.Connection): (host: hostLinksTypes.HostLinks) => Effect.Effect<void>;
  (host: hostLinksTypes.HostLinks, connection: connectionTypes.Connection): Effect.Effect<void>;
} = dual(
  2,
  (host: hostLinksTypes.HostLinks, connection: connectionTypes.Connection): Effect.Effect<void> =>
    Effect.gen(function* () {
      for (;;) {
        if (!connection.open) return;
        if (host.reloading) {
          yield* host.whenReloadEnded();
          continue;
        }
        const codeVersion = host.current.id;
        if (connection.peerCodeVersion === codeVersion) {
          connection.markSynced(codeVersion);
          host.announceRetired(connection);
          return;
        }
        host.announceRetired(connection);
        const id = nextReloadId();
        const vote = yield* Effect.forkChild(awaitVote(connection, id, 30_000), {
          startImmediately: true,
        });
        connection.send({
          codeVersion,
          options: { remove: modulesFor(host.remoteRemoved, connection.name) },
          plugins: modulesFor(host.remoteModules, connection.name),
          reload: id,
          t: "prepare",
        });
        yield* Fiber.join(vote);
        if (host.current.id !== codeVersion) {
          connection.send({ reload: id, t: "abort" });
          continue;
        }
        connection.send({ reload: id, t: "commit" });
        connection.peerCodeVersion = codeVersion;
      }
    }),
);

const cluster = {
  reconcileChild,
  runClusterReload,
};

export default cluster;
