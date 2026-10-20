import { NodeServices } from "@effect/platform-node";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, FileSystem, ManagedRuntime, Option, Path } from "effect";

const runtime = ManagedRuntime.make(NodeServices.layer);

interface ConflictBlock {
  file: string;
  startLine: number;
  separatorLine: number;
  endLine: number;
}

const collectBlocks = (file: string, content: string): ConflictBlock[] => {
  const blocks: ConflictBlock[] = [];
  let blockStart: number | undefined;
  let separatorLine: number | undefined;
  content.split("\n").forEach((line, index) => {
    const lineNo = index + 1;
    if (line.startsWith("<<<<<<<")) {
      blockStart = lineNo;
      separatorLine = undefined;
    } else if (line.startsWith("=======") && blockStart !== undefined) {
      separatorLine = lineNo;
    } else if (
      line.startsWith(">>>>>>>") &&
      blockStart !== undefined &&
      separatorLine !== undefined
    ) {
      blocks.push({ endLine: lineNo, file, separatorLine, startLine: blockStart });
      blockStart = undefined;
      separatorLine = undefined;
    }
  });
  return blocks;
};

const findConflicts = (msa: codingAgentTypes.ExtensionAPI, cwd: string) =>
  Effect.gen(function* () {
    const { stdout, code } = yield* Effect.promise(() =>
      msa.exec("git", ["diff", "--name-only", "--diff-filter=U"]),
    );
    if (code !== 0 || stdout.trim().length === 0) return [];

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const blocks: ConflictBlock[] = [];
    for (const file of stdout.trim().split("\n")) {
      const content = yield* fs.readFileString(path.join(cwd, file)).pipe(Effect.option);
      if (Option.isSome(content)) {
        blocks.push(...collectBlocks(file, content.value));
      }
    }
    return blocks;
  });

function formatRange(start: number, end: number): string {
  if (start > end) return "empty";
  if (start === end) return `${start}`;
  return `${start}-${end}`;
}

function formatConflicts(ref: string, blocks: ConflictBlock[]): string {
  const lines = [`Merged ${ref} with conflicts:`, ""];
  for (const b of blocks) {
    const ours = formatRange(b.startLine + 1, b.separatorLine - 1);
    const theirs = formatRange(b.separatorLine + 1, b.endLine - 1);
    lines.push(`  ${b.file}:${b.startLine}-${b.endLine} (ours ${ours}, theirs ${theirs})`);
  }
  lines.push("", "Resolve these conflicts.");
  return lines.join("\n");
}

const git = (msa: codingAgentTypes.ExtensionAPI, args: string[]) =>
  Effect.promise(() => msa.exec("git", args));

const findMergeRef = (
  msa: codingAgentTypes.ExtensionAPI,
  ctx: { cwd: string; ui: { notify: (m: string, l: "info" | "warning") => void } },
) =>
  Effect.gen(function* () {
    const { code: revParseCode } = yield* git(msa, ["rev-parse", "--git-dir"]);
    if (revParseCode !== 0) return undefined;

    const { code: mergeHeadCode } = yield* git(msa, ["rev-parse", "MERGE_HEAD"]);
    if (mergeHeadCode === 0) return "MERGE_HEAD";

    const { stdout: status } = yield* git(msa, ["status", "--porcelain"]);
    if (status.trim().length > 0) return undefined;

    const { stdout: upstream, code: upstreamCode } = yield* git(msa, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (upstreamCode !== 0) return undefined;

    const ref = upstream.trim();
    const remote = ref.split("/")[0] ?? "";
    ctx.ui.notify(`git-merge-and-resolve: fetching ${remote}, merging ${ref}`, "info");

    const { code: fetchCode, stderr: fetchErr } = yield* git(msa, ["fetch", remote]);
    if (fetchCode !== 0) {
      ctx.ui.notify(`git-merge-and-resolve: fetch failed: ${fetchErr.trim()}`, "warning");
      return undefined;
    }

    const { code: mergeCode } = yield* git(msa, ["merge", "--no-ff", ref]);
    return mergeCode === 0 ? undefined : ref;
  });

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("agent_end", (_event, ctx) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const ref = yield* findMergeRef(msa, ctx);
        if (ref === undefined) return;

        const conflicts = yield* findConflicts(msa, ctx.cwd);
        if (conflicts.length === 0) return;

        msa.sendUserMessage(formatConflicts(ref, conflicts), { deliverAs: "followUp" });
      }),
    ),
  );
}
