import { Effect } from "effect";

import {
  decodeExportedHtml,
  type DecodedSession,
  ImportReproError,
  type IssueRef,
  parseSessionJsonl,
} from "./session.ts";

const GIST_URL_IN_TEXT_RE = /https:\/\/gist\.github\.com\/(?:[^/\s]+\/)?([0-9a-fA-F]{20,})\b/gu;
const COMMENTS_PER_PAGE = 100;

const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
} as const;

interface GistFile {
  filename?: string;
  raw_url?: string;
  content?: string;
  truncated?: boolean;
}

interface GistResponse {
  files?: Record<string, GistFile>;
}

interface IssueComment {
  body?: string | null;
  user?: { login?: string } | null;
}

const toImportReproError = (error: unknown): ImportReproError =>
  new ImportReproError({ message: error instanceof Error ? error.message : String(error) });

const requestGitHub = (url: string, headers: Record<string, string>): Promise<Response> =>
  fetch(url, { headers });

const fetchResponse = (
  url: string,
  headers: Record<string, string>,
): Effect.Effect<Response, ImportReproError> =>
  Effect.tryPromise({
    try: () => requestGitHub(url, headers),
    catch: toImportReproError,
  });

const readBody = <A>(read: () => Promise<A>): Effect.Effect<A, ImportReproError> =>
  Effect.tryPromise({
    try: read,
    catch: toImportReproError,
  });

const fetchText = (url: string): Effect.Effect<string, ImportReproError> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(url, { Accept: "application/vnd.github+json" });
    if (!response.ok) {
      return yield* new ImportReproError({
        message: `failed to fetch ${url}: HTTP ${response.status}`,
      });
    }
    return yield* readBody(() => response.text());
  });

const readGistFile = (file: GistFile): Effect.Effect<string, ImportReproError> => {
  if (file.content !== undefined && file.content !== "" && file.truncated !== true) {
    return Effect.succeed(file.content);
  }
  if (file.raw_url === undefined || file.raw_url === "") {
    return Effect.fail(
      new ImportReproError({
        message: `gist file ${file.filename ?? "<unknown>"} has no raw URL`,
      }),
    );
  }
  return fetchText(file.raw_url);
};

const issueCommentsUrl = (owner: string, repo: string, issue: string, page: number): string =>
  `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(issue)}/comments?per_page=${COMMENTS_PER_PAGE}&page=${page}`;

const botGistIds = (comments: readonly IssueComment[]): string[] =>
  comments
    .filter((comment) => comment.user?.login === "github-actions[bot]")
    .flatMap((comment) =>
      Array.from((comment.body ?? "").matchAll(GIST_URL_IN_TEXT_RE), ([, gistId]) => gistId),
    )
    .filter((gistId): gistId is string => gistId !== undefined && gistId !== "");

const collectIssueGistIds = (
  owner: string,
  repo: string,
  issue: string,
  page: number,
): Effect.Effect<string[], ImportReproError> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(
      issueCommentsUrl(owner, repo, issue, page),
      GITHUB_API_HEADERS,
    );
    if (!response.ok) {
      return yield* new ImportReproError({
        message: `failed to fetch issue comments: HTTP ${response.status}`,
      });
    }

    const comments = (yield* readBody(() => response.json())) as IssueComment[];
    const gistIds = botGistIds(comments);
    if (comments.length < COMMENTS_PER_PAGE) return gistIds;
    return [...gistIds, ...(yield* collectIssueGistIds(owner, repo, issue, page + 1))];
  });

export const findIssueGistId = ({
  owner,
  repo,
  issue,
}: IssueRef): Effect.Effect<string, ImportReproError> =>
  Effect.gen(function* () {
    const gistId = (yield* collectIssueGistIds(owner, repo, issue, 1)).at(-1);
    if (gistId === undefined) {
      return yield* new ImportReproError({
        message: `no github-actions gist link found in comments on ${owner}/${repo}#${issue}`,
      });
    }
    return gistId;
  });

export const fetchGistSession = (gistId: string): Effect.Effect<DecodedSession, ImportReproError> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(
      `https://api.github.com/gists/${gistId}`,
      GITHUB_API_HEADERS,
    );
    if (!response.ok) {
      return yield* new ImportReproError({
        message: `failed to fetch gist ${gistId}: HTTP ${response.status}`,
      });
    }

    const gist = (yield* readBody(() => response.json())) as GistResponse;
    const files = Object.values(gist.files ?? {});
    const jsonlFile = files.find((file) => file.filename?.endsWith(".jsonl") === true);
    if (jsonlFile !== undefined) return parseSessionJsonl(yield* readGistFile(jsonlFile));

    const htmlFile = files.find((file) => file.filename?.endsWith(".html") === true);
    if (htmlFile !== undefined) return decodeExportedHtml(yield* readGistFile(htmlFile));

    return yield* new ImportReproError({
      message: `gist ${gistId} has no .jsonl or .html session file`,
    });
  });
