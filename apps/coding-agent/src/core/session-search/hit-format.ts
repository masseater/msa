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

const SKIPPED_SHOWN = 10;

function skippedLines(skipped: readonly sessionSearchTypes.SkippedFile[]): string[] {
  if (skipped.length === 0) return [];
  const more = skipped.length - SKIPPED_SHOWN;
  return [
    `Not searched: ${skipped.length} session file${skipped.length === 1 ? "" : "s"} could not be indexed`,
    ...skipped.slice(0, SKIPPED_SHOWN).map((file) => `- ${file.path}: ${file.reason}`),
    ...(more > 0 ? [`- and ${more} more`] : []),
  ];
}

const hitFormat = { hitHeading, hitLocation, skippedLines };

export default hitFormat;
