import type { ImageContent, TextContent, Tool } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";

const claudeCodeVersion = "2.1.280";

const claudeCodeTools = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "KillShell",
  "NotebookEdit",
  "Skill",
  "Task",
  "TaskOutput",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
];

const ccToolLookup = new Map(claudeCodeTools.map((t) => [t.toLowerCase(), t]));

const toClaudeCodeName = (name: string) => ccToolLookup.get(name.toLowerCase()) ?? name;

interface ClaudeCodeNameInput {
  readonly name: string;
  readonly tools?: Tool[] | undefined;
}

const fromClaudeCodeName = (input: ClaudeCodeNameInput): string => {
  const { name, tools } = input;
  if (tools !== undefined && tools.length > 0) {
    const lowerName = name.toLowerCase();
    const matchedTool = tools.find((tool) => tool.name.toLowerCase() === lowerName);
    if (matchedTool !== undefined) return matchedTool.name;
  }
  return name;
};

type AnthropicImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
};

type AnthropicTextBlock = { type: "text"; text: string };

function toImageBlock(block: ImageContent): AnthropicImageBlock {
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data: block.data,
    },
  };
}

function convertContentBlocks(
  content: (TextContent | ImageContent)[],
): string | Array<AnthropicTextBlock | AnthropicImageBlock> {
  const hasImages = content.some((c) => c.type === "image");
  if (!hasImages) {
    return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
  }

  const blocks: Array<AnthropicTextBlock | AnthropicImageBlock> = content.map((block) =>
    block.type === "text"
      ? { type: "text", text: sanitizeSurrogates(block.text) }
      : toImageBlock(block),
  );

  const hasText = blocks.some((b) => b.type === "text");
  if (!hasText) {
    blocks.unshift({
      type: "text",
      text: "(see attached image)",
    });
  }

  return blocks;
}

export { claudeCodeVersion, convertContentBlocks, fromClaudeCodeName, toClaudeCodeName };
