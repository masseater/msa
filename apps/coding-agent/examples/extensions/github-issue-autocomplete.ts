import type { ExtensionAPI } from "@msa/coding-agent";
import {
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
  fuzzyFilter,
} from "@msa/tui";

type GitHubIssue = {
  number: number;
  title: string;
  state: string;
};

type RepoResolution = { ok: true; repo: string } | { ok: false; error: string };

const MAX_ISSUES = 100;
const MAX_SUGGESTIONS = 20;

function extractIssueToken(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/(?:^|[ \t])#([^\s#]*)$/u);
  return match?.[1];
}

function parseGitHubRepo(remoteUrl: string): string | undefined {
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/u);
  if (sshMatch !== null) {
    return sshMatch[1];
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/u);
  if (httpsMatch !== null) {
    return httpsMatch[1];
  }

  return undefined;
}

async function resolveGitHubRepo(msa: ExtensionAPI, cwd: string): Promise<RepoResolution> {
  const result = await msa.exec("git", ["remote", "-v"], { cwd, timeout: 5_000 });
  if (result.code !== 0) {
    return { ok: false, error: "github-issue-autocomplete: cwd is not a git repository" };
  }

  for (const line of result.stdout.split("\n")) {
    const columns = line.trim().split(/\s+/u);
    const remoteUrl = columns[1];
    if (remoteUrl === undefined || remoteUrl.length === 0) {
      continue;
    }
    const repo = parseGitHubRepo(remoteUrl);
    if (repo !== undefined && repo.length > 0) {
      return { ok: true, repo };
    }
  }

  return { ok: false, error: "github-issue-autocomplete: cwd is not a GitHub repository" };
}

function formatIssueItem(issue: GitHubIssue): AutocompleteItem {
  return {
    value: `#${issue.number}`,
    label: `#${issue.number}`,
    description: `[${issue.state.toLowerCase()}] ${issue.title}`,
  };
}

function filterIssues(issues: GitHubIssue[], query: string): AutocompleteItem[] {
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
}

function createIssueAutocompleteProvider(
  current: AutocompleteProvider,
  getIssues: () => Promise<GitHubIssue[] | undefined>,
): AutocompleteProvider {
  return {
    async getSuggestions(
      lines,
      cursorLine,
      cursorCol,
      options,
    ): Promise<AutocompleteSuggestions | null> {
      const currentLine = lines[cursorLine] ?? "";
      const textBeforeCursor = currentLine.slice(0, cursorCol);
      const token = extractIssueToken(textBeforeCursor);
      if (token === undefined) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const issues = await getIssues();
      if (options.signal.aborted || issues === undefined || issues.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      const suggestions = filterIssues(issues, token);
      if (suggestions.length === 0) {
        return current.getSuggestions(lines, cursorLine, cursorCol, options);
      }

      return {
        items: suggestions,
        prefix: `#${token}`,
      };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

export default function (msa: ExtensionAPI): void {
  msa.on("session_start", async (_event, ctx) => {
    const resolvedRepo = await resolveGitHubRepo(msa, ctx.cwd);
    if (!resolvedRepo.ok) {
      ctx.ui.notify(resolvedRepo.error, "error");
      return;
    }

    const repo = resolvedRepo.repo;
    let issuesPromise: Promise<GitHubIssue[] | undefined> | undefined;
    let loadErrorShown = false;

    const getIssues = (): Promise<GitHubIssue[] | undefined> => {
      issuesPromise ||= (async () => {
        const result = await msa.exec(
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
        );
        if (result.code !== 0) {
          if (!loadErrorShown) {
            loadErrorShown = true;
            const details = result.stderr.trim() || `exit code ${result.code}`;
            ctx.ui.notify(`github-issue-autocomplete: failed to load issues: ${details}`, "error");
          }
          return undefined;
        }

        try {
          return JSON.parse(result.stdout) as GitHubIssue[];
        } catch {
          if (!loadErrorShown) {
            loadErrorShown = true;
            ctx.ui.notify(
              "github-issue-autocomplete: failed to parse gh issue list output",
              "error",
            );
          }
          return undefined;
        }
      })();
      return issuesPromise;
    };

    void getIssues();
    ctx.ui.addAutocompleteProvider((current) =>
      createIssueAutocompleteProvider(current, getIssues),
    );
  });
}
