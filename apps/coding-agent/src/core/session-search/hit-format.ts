import platform from "../platform/index.ts";
import type sessionSearchTypes from "./session-search.types.ts";

const { formatLocalDateTime } = platform;

function sessionLabel(session: sessionSearchTypes.SessionInfo): string {
  const { link } = session;
  const ids =
    link === undefined
      ? []
      : [
          ...link.taskIds.map((id) => `task ${id}`),
          ...link.rounds.map((round) => `round ${round}`),
          `thread ${link.threadId}`,
        ];
  return [session.role, ...ids].join(", ");
}

const formatTime = (value: number | null): string =>
  value === null ? "unknown time" : formatLocalDateTime(value);

function hitHeading(hit: sessionSearchTypes.Hit): string {
  const what = hit.tool === null ? hit.kind : `${hit.kind} ${hit.tool}`;
  return `${formatTime(hit.at)} ${what} [${sessionLabel(hit.session)}]`;
}

function hitLocation(hit: sessionSearchTypes.Hit): string[] {
  return [
    `session: ${hit.session.path} entry: ${hit.entryId ?? "?"}`,
    `cwd: ${hit.session.cwd ?? "?"}, started ${formatTime(hit.session.startedAt)}`,
  ];
}

const hitFormat = { hitHeading, hitLocation };

export default hitFormat;
