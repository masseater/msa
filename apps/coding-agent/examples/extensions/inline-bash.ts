import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect, Option } from "effect";

const PATTERN = /!\{([^}]+)\}/gu;
const TIMEOUT_MS = 30000;

interface Expansion {
  command: string;
  output: string;
  error?: string;
}

const collectMatches = (text: string): Array<{ full: string; command: string }> => {
  const matches: Array<{ full: string; command: string }> = [];
  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(text);
  while (match !== null) {
    const [full, command] = match;
    if (command !== undefined) matches.push({ command, full });
    match = PATTERN.exec(text);
  }
  return matches;
};

const formatSummary = (expansions: Expansion[]): string =>
  expansions
    .map((e) => {
      const status = e.error !== undefined && e.error.length > 0 ? ` (${e.error})` : "";
      const preview = e.output.length > 50 ? `${e.output.slice(0, 50)}...` : e.output;
      return `!{${e.command}}${status} -> "${preview}"`;
    })
    .join("\n");

const expandCommands = (
  msa: codingAgentTypes.ExtensionAPI,
  text: string,
  matches: Array<{ full: string; command: string }>,
) =>
  Effect.gen(function* () {
    let result = text;
    const expansions: Expansion[] = [];

    for (const { full, command } of matches) {
      const bashResult = yield* Effect.promise(() =>
        msa.exec("bash", ["-c", command], { timeout: TIMEOUT_MS }),
      ).pipe(Effect.option);

      if (Option.isNone(bashResult)) {
        expansions.push({ command, error: "command failed", output: "" });
        result = result.replace(full, "[error]");
        continue;
      }

      const { stdout, stderr, code } = bashResult.value;
      const trimmed = (stdout || stderr || "").trim();
      if (code !== 0 && stderr.length > 0) {
        expansions.push({ command, error: `exit code ${code}`, output: trimmed });
      } else {
        expansions.push({ command, output: trimmed });
      }
      result = result.replace(full, trimmed);
    }

    return { expanded: result, expansions };
  });

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.on("input", (event, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const text = event.text;

        if (text.trimStart().startsWith("!") && !text.trimStart().startsWith("!{")) {
          return { action: "continue" };
        }

        if (!PATTERN.test(text)) {
          return { action: "continue" };
        }

        const matches = collectMatches(text);
        const { expansions, expanded } = yield* expandCommands(msa, text, matches);

        if (ctx.hasUI && expansions.length > 0) {
          ctx.ui.notify(
            `Expanded ${expansions.length} inline command(s):\n${formatSummary(expansions)}`,
            "info",
          );
        }

        return {
          action: "transform",
          text: expanded,
          ...(event.images === undefined ? {} : { images: event.images }),
        };
      }),
    ),
  );
}
