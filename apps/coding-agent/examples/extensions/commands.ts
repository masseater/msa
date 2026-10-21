import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";

const formatCommand = (cmd: codingAgentTypes.SlashCommandInfo): string => {
  const desc =
    cmd.description !== undefined && cmd.description.length > 0 ? ` - ${cmd.description}` : "";
  return `/${cmd.name}${desc}`;
};

const groupCommands = (commands: codingAgentTypes.SlashCommandInfo[]): string[] => {
  const items: string[] = [];
  const sources: Array<{ key: "extension" | "prompt" | "skill"; label: string }> = [
    { key: "extension", label: "Extensions" },
    { key: "prompt", label: "Prompts" },
    { key: "skill", label: "Skills" },
  ];

  for (const { key, label } of sources) {
    const cmds = commands.filter((c) => c.source === key);
    if (cmds.length > 0) {
      items.push(`--- ${label} ---`);
      items.push(...cmds.map(formatCommand));
    }
  }
  return items;
};

export default function commandsExtension(msa: codingAgentTypes.ExtensionAPI) {
  msa.registerCommand("commands", {
    description: "List available slash commands",
    getArgumentCompletions: (prefix) => {
      const sources = ["extension", "prompt", "skill"];
      const filtered = sources.filter((s) => s.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((s) => ({ label: s, value: s })) : null;
    },
    handler: (args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const commands = msa.getCommands();
          const sourceFilter = args.trim() as "extension" | "prompt" | "skill" | "";

          const filtered =
            sourceFilter.length > 0 ? commands.filter((c) => c.source === sourceFilter) : commands;

          if (filtered.length === 0) {
            ctx.ui.notify(
              sourceFilter.length > 0 ? `No ${sourceFilter} commands found` : "No commands found",
              "info",
            );
            return;
          }

          const items = groupCommands(filtered);

          const selected = yield* Effect.promise(() => ctx.ui.select("Available Commands", items));

          if (selected !== undefined && selected.length > 0 && !selected.startsWith("---")) {
            const cmdName = (selected.split(" - ")[0] ?? "").slice(1);
            const cmd = commands.find((c) => c.name === cmdName);
            if (cmd?.sourceInfo.path !== undefined && cmd?.sourceInfo.path.length > 0) {
              const showPath = yield* Effect.promise(() =>
                ctx.ui.confirm(cmd.name, `View source path?\n${cmd.sourceInfo.path}`),
              );
              if (showPath) {
                ctx.ui.notify(cmd.sourceInfo.path, "info");
              }
            }
          }
        }),
      ),
  });
}
