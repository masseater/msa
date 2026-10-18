import { Cause, Effect, Exit, Fiber } from "effect";
import { dual } from "effect/Function";

import type { Connection } from "./connection.ts";
import { ChordError } from "./errors.ts";
import type { HostLinks } from "./host-links.ts";
import {
  beginReload,
  endReload,
  type Reload,
  type ReloadOptions,
  type ReloadReport,
  type ReloadRequest,
  reloadError,
} from "./reload.ts";

let reloadSeq = 0;

const nextReloadId = (): number => {
  reloadSeq += 1;
  return reloadSeq;
};

const modulesFor = (remote: ReloadOptions["remote"], hostName: string | undefined): string[] => {
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

const awaitVote = (connection: Connection, id: number, deadline: number): Effect.Effect<unknown> =>
  Effect.callback<unknown>((resume) => {
    connection.votes.set(id, {
      resolve: (value) => resume(Effect.succeed(value)),
      reject: (error) => resume(Effect.die(error)),
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: deadline,
      orElse: () =>
        Effect.sync(() => connection.votes.delete(id)).pipe(
          Effect.andThen(
            Effect.die(
              new ChordError("aborted", `votes missing after ${deadline} ms`, {
                reason: "vote_deadline",
              }),
            ),
          ),
        ),
    }),
  );

type Vote = readonly [string, ReloadReport | undefined];

interface Ballot {
  readonly id: number;
  readonly codeVersion: number;
  readonly deadline: number;
  readonly options: ReloadOptions;
}

const requestVote = (connection: Connection, ballot: Ballot): Effect.Effect<Fiber.Fiber<Vote>> =>
  Effect.gen(function* () {
    const { id, options } = ballot;
    const name = connection.name ?? "child";
    const vote = yield* Effect.forkChild(
      awaitVote(connection, id, ballot.deadline).pipe(
        Effect.map((report): Vote => [name, report as ReloadReport | undefined]),
        Effect.catchCause((cause) => {
          const failure = reloadError(Cause.squash(cause));
          return Effect.die(
            new ChordError(failure.code, `${name}: ${failure.message}`, {
              cause: failure,
              reason: failure.reason,
            }),
          );
        }),
      ),
      { startImmediately: true },
    );
    connection.send({
      t: "prepare",
      reload: id,
      codeVersion: ballot.codeVersion,
      plugins: modulesFor(options.remote, name),
      options: {
        remove: modulesFor(options.remoteRemove, name),
        ...(options.gateDeadline === undefined ? {} : { gateDeadline: options.gateDeadline }),
        ...(options.retireDeadline === undefined ? {} : { retireDeadline: options.retireDeadline }),
      },
    });
    return vote;
  });

const childReports = (exits: readonly Exit.Exit<Vote>[]): Record<string, ReloadReport> => {
  const children: Record<string, ReloadReport> = {};
  for (const exit of exits) {
    if (Exit.isSuccess(exit) && exit.value[1] !== undefined)
      children[exit.value[0]] = exit.value[1];
  }
  return children;
};

const voteRound = (
  host: HostLinks,
  reload: Reload,
  participants: readonly Connection[],
  ballot: Ballot,
): Effect.Effect<ReloadReport> =>
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
        connection.send({ t: "abort", reload: ballot.id });
      }
      if (local) yield* reload.rollback();
      return yield* Effect.die(Cause.squash(failed.cause));
    }
    const report = reload.commit(() => {
      for (const connection of participants) {
        connection.send({ t: "commit", reload: ballot.id });
        connection.peerCodeVersion = ballot.codeVersion;
      }
    });
    host.rememberRemoteModules(ballot.options.remote, ballot.options.remoteRemove);
    return { ...report, children: childReports(voteExits) };
  });

export const runClusterReload: {
  (request: ReloadRequest): (host: HostLinks) => Effect.Effect<ReloadReport>;
  (host: HostLinks, request: ReloadRequest): Effect.Effect<ReloadReport>;
} = dual(2, (host: HostLinks, request: ReloadRequest): Effect.Effect<ReloadReport> =>
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
        id: nextReloadId(),
        codeVersion,
        deadline,
        options,
      });
    }).pipe(Effect.ensuring(Effect.sync(() => endReload(host))));
  }),
);

export const reconcileChild: {
  (connection: Connection): (host: HostLinks) => Effect.Effect<void>;
  (host: HostLinks, connection: Connection): Effect.Effect<void>;
} = dual(2, (host: HostLinks, connection: Connection): Effect.Effect<void> =>
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
        t: "prepare",
        reload: id,
        codeVersion,
        plugins: modulesFor(host.remoteModules, connection.name),
        options: { remove: modulesFor(host.remoteRemoved, connection.name) },
      });
      yield* Fiber.join(vote);
      if (host.current.id !== codeVersion) {
        connection.send({ t: "abort", reload: id });
        continue;
      }
      connection.send({ t: "commit", reload: id });
      connection.peerCodeVersion = codeVersion;
    }
  }),
);
