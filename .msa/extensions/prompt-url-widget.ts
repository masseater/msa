import { homedir } from "node:os";

import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DynamicBorder, type ExtensionAPI, type ExtensionContext } from "@msa/coding-agent";
import { Container, hyperlink, Text } from "@msa/tui";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";

const runtime = ManagedRuntime.make(NodeServices.layer);
const nodePath = ManagedRuntime.make(NodePath.layer).runSync(Path.Path);

const PR_PROMPT_PATTERN = /^\s*You are given one or more GitHub PR URLs:\s*(\S+)/imu;
const ISSUE_PROMPT_PATTERN = /^\s*Analyze GitHub issue\(s\):\s*(\S+)/imu;
const ADVISORY_PROMPT_PATTERN = /^\s*Update a GitHub security advisory for publication:\s*(\S+)/imu;
const ADVISORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/security\/advisories\/(GHSA-[A-Za-z0-9-]+)(?:[/?#].*)?$/iu;

type PromptMatch = {
  kind: "pr" | "issue" | "advisory";
  target: string;
};

type GhMetadata = {
  title?: string | undefined;
  detail?: string | undefined;
  displayUrl?: string;
  author?: {
    login?: string;
    name?: string | null;
  };
};

type GitHubAdvisoryMetadata = {
  ghsa_id?: string;
  summary?: string;
  severity?: string;
  state?: string;
  html_url?: string;
  cve_id?: string | null;
};

type AdvisoryRef = {
  owner: string;
  repo: string;
  ghsaId: string;
  url: string;
};

type UserContent = string | { type: string; text?: string }[] | undefined;

const isNonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

function extractPromptMatch(prompt: string): PromptMatch | undefined {
  const patterns = [
    ["pr", PR_PROMPT_PATTERN],
    ["issue", ISSUE_PROMPT_PATTERN],
    ["advisory", ADVISORY_PROMPT_PATTERN],
  ] as const;
  for (const [kind, pattern] of patterns) {
    const target = pattern.exec(prompt)?.[1];
    if (isNonEmpty(target)) return { kind, target: target.trim() };
  }
  return undefined;
}

function getPromptLabel(kind: PromptMatch["kind"]): string {
  if (kind === "pr") return "PR";
  if (kind === "issue") return "Issue";
  return "Advisory";
}

function parseAdvisoryUrl(value: string): AdvisoryRef | undefined {
  const [, owner, repo, ghsaId] = ADVISORY_URL_PATTERN.exec(value) ?? [];
  if (!isNonEmpty(owner) || !isNonEmpty(repo) || !isNonEmpty(ghsaId)) return undefined;
  return {
    owner,
    repo,
    ghsaId,
    url: `https://github.com/${owner}/${repo}/security/advisories/${ghsaId}`,
  };
}

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function resolveDraftPath(cwd: string, target: string): string {
  if (target === "~") return homedir();
  if (target.startsWith("~/")) return nodePath.resolve(homedir(), target.slice(2));
  return nodePath.resolve(cwd, target);
}

const readAdvisoryRefFromDraft = (
  cwd: string,
  target: string,
): Effect.Effect<Option.Option<AdvisoryRef>, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.use((fs) => fs.readFileString(resolveDraftPath(cwd, target))).pipe(
    Effect.map((content) => {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(content);
      const body = frontmatter?.[1] ?? content;
      const advisoryUrl = /^advisory_url:\s*(.+)$/mu.exec(body)?.[1];
      if (!isNonEmpty(advisoryUrl)) return Option.none();
      return Option.fromUndefinedOr(parseAdvisoryUrl(unquoteYamlValue(advisoryUrl)));
    }),
    Effect.catch(() => Effect.succeedNone),
  );

function formatAdvisoryDetail(advisory: GitHubAdvisoryMetadata): string | undefined {
  const parts = [advisory.ghsa_id, advisory.cve_id ?? undefined, advisory.severity, advisory.state]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

const fetchAdvisoryMetadata = (
  msa: ExtensionAPI,
  cwd: string,
  target: string,
): Effect.Effect<GhMetadata | undefined, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const advisoryRef =
      parseAdvisoryUrl(target) ??
      Option.getOrUndefined(yield* readAdvisoryRefFromDraft(cwd, target));
    if (advisoryRef === undefined) return undefined;

    return yield* Effect.promise(() =>
      msa.exec("gh", [
        "api",
        `repos/${advisoryRef.owner}/${advisoryRef.repo}/security-advisories/${advisoryRef.ghsaId}`,
      ]),
    ).pipe(
      Effect.map((result): GhMetadata => {
        if (result.code !== 0 || result.stdout === "") return { displayUrl: advisoryRef.url };
        const advisory = JSON.parse(result.stdout) as GitHubAdvisoryMetadata;
        return {
          title: advisory.summary,
          detail: formatAdvisoryDetail(advisory),
          displayUrl: advisory.html_url ?? advisoryRef.url,
        };
      }),
      Effect.catchDefect(() => Effect.succeed<GhMetadata>({ displayUrl: advisoryRef.url })),
    );
  });

const fetchGhMetadata = (
  msa: ExtensionAPI,
  match: PromptMatch,
  cwd: string,
): Effect.Effect<GhMetadata | undefined, never, FileSystem.FileSystem> => {
  if (match.kind === "advisory") return fetchAdvisoryMetadata(msa, cwd, match.target);
  return fetchIssueMetadata(msa, match).pipe(Effect.map(Option.getOrUndefined));
};

const fetchIssueMetadata = (
  msa: ExtensionAPI,
  match: PromptMatch,
): Effect.Effect<Option.Option<GhMetadata>> => {
  const args =
    match.kind === "pr"
      ? ["pr", "view", match.target, "--json", "title,author"]
      : ["issue", "view", match.target, "--json", "title,author"];

  return Effect.promise(() => msa.exec("gh", args)).pipe(
    Effect.map((result) => {
      if (result.code !== 0 || result.stdout === "") return Option.none<GhMetadata>();
      return Option.some(JSON.parse(result.stdout) as GhMetadata);
    }),
    Effect.catchDefect(() => Effect.succeedNone),
  );
};

function formatAuthor(author?: GhMetadata["author"]): string | undefined {
  if (author === undefined) return undefined;
  const name = author.name?.trim();
  const login = author.login?.trim();
  if (isNonEmpty(name) && isNonEmpty(login)) return `${name} (@${login})`;
  if (isNonEmpty(login)) return `@${login}`;
  if (isNonEmpty(name)) return name;
  return undefined;
}

function setWidget(ctx: ExtensionContext, match: PromptMatch, metadata?: GhMetadata): void {
  ctx.ui.setWidget("prompt-url", (_tui, thm) => {
    const displayTarget = metadata?.displayUrl ?? match.target;
    const titleText = isNonEmpty(metadata?.title)
      ? thm.fg("accent", metadata.title)
      : hyperlink(thm.fg("accent", displayTarget), displayTarget);
    const detailText = metadata?.detail ?? formatAuthor(metadata?.author);
    const detailLine = isNonEmpty(detailText) ? thm.fg("muted", detailText) : undefined;
    const urlLine = hyperlink(thm.fg("dim", displayTarget), displayTarget);

    const lines = [titleText];
    if (isNonEmpty(detailLine)) lines.push(detailLine);
    lines.push(urlLine);

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => thm.fg("muted", s)));
    container.addChild(new Text(lines.join("\n"), 1, 0));
    return container;
  });
}

function applySessionName(msa: ExtensionAPI, match: PromptMatch, metadata?: GhMetadata): void {
  const label = getPromptLabel(match.kind);
  const displayTarget = metadata?.displayUrl ?? match.target;
  const trimmedTitle = metadata?.title?.trim();
  const fallbackName = `${label}: ${match.target}`;
  const desiredFallbackName = `${label}: ${displayTarget}`;
  const desiredName = isNonEmpty(trimmedTitle)
    ? `${label}: ${trimmedTitle} (${displayTarget})`
    : desiredFallbackName;
  const currentName = msa.getSessionName()?.trim();
  if (!isNonEmpty(currentName)) {
    msa.setSessionName(desiredName);
    return;
  }
  if (
    currentName === match.target ||
    currentName === fallbackName ||
    currentName === desiredFallbackName
  ) {
    msa.setSessionName(desiredName);
  }
}

function updatePromptContext(msa: ExtensionAPI, ctx: ExtensionContext, match: PromptMatch): void {
  setWidget(ctx, match);
  applySessionName(msa, match);
  runtime.runFork(
    fetchGhMetadata(msa, match, ctx.cwd).pipe(
      Effect.tap((meta) =>
        Effect.sync(() => {
          setWidget(ctx, match, meta);
          applySessionName(msa, match, meta);
        }),
      ),
    ),
  );
}

function getUserText(content: UserContent): string {
  if (content === undefined || content === "") return "";
  if (typeof content === "string") return content;
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function rebuildFromSession(msa: ExtensionAPI, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  const entries = ctx.sessionManager.getEntries();
  const lastMatch = entries.findLast((entry) => {
    if (entry.type !== "message" || entry.message.role !== "user") return false;
    return extractPromptMatch(getUserText(entry.message.content)) !== undefined;
  });

  const content =
    lastMatch?.type === "message" && lastMatch.message.role === "user"
      ? lastMatch.message.content
      : undefined;
  const text = getUserText(content);
  const match = text === "" ? undefined : extractPromptMatch(text);
  if (match === undefined) {
    ctx.ui.setWidget("prompt-url", undefined);
    return;
  }

  updatePromptContext(msa, ctx, match);
}

export default function promptUrlWidgetExtension(msa: ExtensionAPI) {
  msa.on("before_agent_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.messageType !== "user") return;
    const match = extractPromptMatch(event.prompt);
    if (match === undefined) return;
    updatePromptContext(msa, ctx, match);
  });

  msa.on("session_start", (_event, ctx) => {
    rebuildFromSession(msa, ctx);
  });

  msa.on("session_start", (_event, ctx) => {
    rebuildFromSession(msa, ctx);
  });
}
