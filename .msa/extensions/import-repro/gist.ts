import { Effect, ManagedRuntime } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import session from "./session.ts";
import type sessionTypes from "./session.types.ts";

const { ImportReproError, decodeExportedHtml, parseSessionJsonl } = session;

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

const toImportReproError = (error: { readonly message: string }): sessionTypes.ImportReproError =>
  new ImportReproError({ message: error.message });

const fetchResponse = (
  url: string,
  headers: Record<string, string>,
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  sessionTypes.ImportReproError,
  HttpClient.HttpClient
> =>
  HttpClient.HttpClient.use((client) =>
    client.execute(HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers))),
  ).pipe(Effect.mapError(toImportReproError));

const isOk = (response: HttpClientResponse.HttpClientResponse): boolean =>
  response.status >= 200 && response.status < 300;

const readBody = <A, E extends { readonly message: string }>(
  read: Effect.Effect<A, E>,
): Effect.Effect<A, sessionTypes.ImportReproError> => Effect.mapError(read, toImportReproError);

const fetchText = (
  url: string,
): Effect.Effect<string, sessionTypes.ImportReproError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(url, { Accept: "application/vnd.github+json" });
    if (!isOk(response)) {
      return yield* new ImportReproError({
        message: `failed to fetch ${url}: HTTP ${response.status}`,
      });
    }
    return yield* readBody(response.text);
  });

const readGistFile = (
  file: GistFile,
): Effect.Effect<string, sessionTypes.ImportReproError, HttpClient.HttpClient> => {
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
): Effect.Effect<string[], sessionTypes.ImportReproError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(
      issueCommentsUrl(owner, repo, issue, page),
      GITHUB_API_HEADERS,
    );
    if (!isOk(response)) {
      return yield* new ImportReproError({
        message: `failed to fetch issue comments: HTTP ${response.status}`,
      });
    }

    const comments = (yield* readBody(response.json)) as unknown as IssueComment[];
    const gistIds = botGistIds(comments);
    if (comments.length < COMMENTS_PER_PAGE) return gistIds;
    return [...gistIds, ...(yield* collectIssueGistIds(owner, repo, issue, page + 1))];
  });

const findIssueGistIdWithClient = ({
  owner,
  repo,
  issue,
}: sessionTypes.IssueRef): Effect.Effect<
  string,
  sessionTypes.ImportReproError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const gistId = (yield* collectIssueGistIds(owner, repo, issue, 1)).at(-1);
    if (gistId === undefined) {
      return yield* new ImportReproError({
        message: `no github-actions gist link found in comments on ${owner}/${repo}#${issue}`,
      });
    }
    return gistId;
  });

const fetchGistSessionWithClient = (
  gistId: string,
): Effect.Effect<
  sessionTypes.DecodedSession,
  sessionTypes.ImportReproError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* fetchResponse(
      `https://api.github.com/gists/${gistId}`,
      GITHUB_API_HEADERS,
    );
    if (!isOk(response)) {
      return yield* new ImportReproError({
        message: `failed to fetch gist ${gistId}: HTTP ${response.status}`,
      });
    }

    const gist = (yield* readBody(response.json)) as unknown as GistResponse;
    const files = Object.values(gist.files ?? {});
    const jsonlFile = files.find((file) => file.filename?.endsWith(".jsonl") === true);
    if (jsonlFile !== undefined) return parseSessionJsonl(yield* readGistFile(jsonlFile));

    const htmlFile = files.find((file) => file.filename?.endsWith(".html") === true);
    if (htmlFile !== undefined) return decodeExportedHtml(yield* readGistFile(htmlFile));

    return yield* new ImportReproError({
      message: `gist ${gistId} has no .jsonl or .html session file`,
    });
  });

const httpRuntime = ManagedRuntime.make(FetchHttpClient.layer);

const withHttpClient = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient>,
): Effect.Effect<A, E> =>
  Effect.flatMap(httpRuntime.contextEffect, (context) => Effect.provideContext(effect, context));

const findIssueGistId = (
  issue: sessionTypes.IssueRef,
): Effect.Effect<string, sessionTypes.ImportReproError> =>
  withHttpClient(findIssueGistIdWithClient(issue));

const fetchGistSession = (
  gistId: string,
): Effect.Effect<sessionTypes.DecodedSession, sessionTypes.ImportReproError> =>
  withHttpClient(fetchGistSessionWithClient(gistId));

const gist = {
  fetchGistSession,
  findIssueGistId,
};

export default gist;
