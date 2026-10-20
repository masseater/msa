import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Effect, Option, Schema } from "effect";

const { fuzzyFilter } = tui;

const GitHubIssueSchema = Schema.Struct({
  number: Schema.Finite,
  state: Schema.String,
  title: Schema.String,
});

type GitHubIssue = typeof GitHubIssueSchema.Type;

const parseIssues = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(GitHubIssueSchema)),
);

type RepoResolution = { ok: true; repo: string } | { ok: false; error: string };

const MAX_ISSUES = 100;
const MAX_SUGGESTIONS = 20;

const extractIssueToken = (textBeforeCursor: string): string | undefined => {
  const match = textBeforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/u);
  return match?.[1];
};

const parseGitHubRepo = (remoteUrl: string): string | undefined => {
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u);
  if (sshMatch !== null) {
    return sshMatch[1];
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u);
  if (httpsMatch !== null) {
    return httpsMatch[1];
  }

  return undefined;
};

const resolveGitHubRepo = (msa: ExtensionAPI, cwd: string) =>
  Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      msa.exec("git", ["remote", "-v"], { cwd, timeout: 5_000 }),
    );
    if (result.code !== 0) {
      return {
        error: "github-issue-autocomplete: cwd is not a git repository",
        ok: false,
      } satisfies RepoResolution;
    }

    for (const line of result.stdout.split("\n")) {
      const remoteUrl = line.trim().split(/\s+/u)[1];
      if (remoteUrl === undefined || remoteUrl.length === 0) continue;
      const repo = parseGitHubRepo(remoteUrl);
      if (repo !== undefined && repo.length > 0) {
        return { ok: true, repo } satisfies RepoResolution;
      }
    }

    return {
      error: "github-issue-autocomplete: cwd is not a GitHub repository",
      ok: false,
    } satisfies RepoResolution;
  });

const formatIssueItem = (issue: GitHubIssue): tuiTypes.AutocompleteItem => ({
  description: `[${issue.state.toLowerCase()}] ${issue.title}`,
  label: `#${issue.number}`,
  value: `#${issue.number}`,
});

const filterIssues = (issues: GitHubIssue[], query: string): tuiTypes.AutocompleteItem[] => {
  if (query.trim().length === 0) {
    return issues.slice(0, MAX_SUGGESTIONS).map(formatIssueItem);
  }

  if (/^\d+$/u.test(query)) {
    const numericMatches = issues
      .filter((issue) => String(issue.number).startsWith(query))
      .slice(0, MAX_SUGGESTIONS)
      .map(formatIssueItem);
    if (numericMatches.length > 0) {
      return numericMatches;
    }
  }

  return fuzzyFilter(issues, query, (issue) => `${issue.number} ${issue.title}`)
    .slice(0, MAX_SUGGESTIONS)
    .map(formatIssueItem);
};

const makeIssueLoader = (msa: ExtensionAPI, ctx: ExtensionContext, repo: string) => {
  let issuesPromise: Promise<GitHubIssue[] | undefined> | undefined;
  let errorShown = false;

  const notifyError = (message: string): void => {
    if (errorShown) return;
    errorShown = true;
    ctx.ui.notify(`github-issue-autocomplete: ${message}`, "error");
  };

  const load = Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      msa.exec(
        "gh",
        [
          "issue",
          "list",
          "--repo",
          repo,
          "--state",
          "open",
          "--limit",
          String(MAX_ISSUES),
          "--json",
          "number,title,state",
        ],
        { cwd: ctx.cwd, timeout: 5_000 },
      ),
    );

    if (result.code !== 0) {
      notifyError(`failed to load issues: ${result.stderr.trim() || `exit code ${result.code}`}`);
      return undefined;
    }

    const parsed = parseIssues(result.stdout);
    if (Option.isNone(parsed)) {
      notifyError("failed to parse gh issue list output");
      return undefined;
    }
    return [...parsed.value];
  });

  return (): Promise<GitHubIssue[] | undefined> => {
    issuesPromise ??= Effect.runPromise(load);
    return issuesPromise;
  };
};

const createIssueAutocompleteProvider = (
  current: tuiTypes.AutocompleteProvider,
  getIssues: () => Promise<GitHubIssue[] | undefined>,
): tuiTypes.AutocompleteProvider => ({
  applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
    current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),

  getSuggestions: (lines, cursorLine, cursorCol, options) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const currentLine = lines[cursorLine] ?? "";
        const token = extractIssueToken(currentLine.slice(0, cursorCol));
        if (token === undefined) {
          return yield* Effect.promise(() =>
            current.getSuggestions(lines, cursorLine, cursorCol, options),
          );
        }

        const issues = yield* Effect.promise(getIssues);
        if (options.signal.aborted || issues === undefined || issues.length === 0) {
          return yield* Effect.promise(() =>
            current.getSuggestions(lines, cursorLine, cursorCol, options),
          );
        }

        const suggestions = filterIssues(issues, token);
        if (suggestions.length === 0) {
          return yield* Effect.promise(() =>
            current.getSuggestions(lines, cursorLine, cursorCol, options),
          );
        }

        return {
          items: suggestions,
          prefix: `#${token}`,
        } satisfies tuiTypes.AutocompleteSuggestions;
      }),
    ),

  shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
    current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true,
});

export default function (msa: ExtensionAPI): void {
  msa.on("session_start", (_event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const resolvedRepo = yield* resolveGitHubRepo(msa, ctx.cwd);
        if (!resolvedRepo.ok) {
          ctx.ui.notify(resolvedRepo.error, "error");
          return;
        }

        const getIssues = makeIssueLoader(msa, ctx, resolvedRepo.repo);
        void getIssues();
        ctx.ui.addAutocompleteProvider((current) =>
          createIssueAutocompleteProvider(current, getIssues),
        );
      }),
    ),
  );
}
