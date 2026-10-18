import { homedir } from "os";

import type { ExtensionAPI } from "@msa/coding-agent";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatReadLineRange,
} from "@msa/coding-agent";
import { Text } from "@msa/tui";

function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function createBuiltInTools(cwd: string) {
  return {
    read: createReadToolDefinition(cwd),
    bash: createBashToolDefinition(cwd),
    edit: createEditToolDefinition(cwd),
    write: createWriteToolDefinition(cwd),
    find: createFindToolDefinition(cwd),
    grep: createGrepToolDefinition(cwd),
    ls: createLsToolDefinition(cwd),
  };
}

export default function (msa: ExtensionAPI) {
  const tools = createBuiltInTools(process.cwd());

  msa.registerTool({
    ...tools.read,

    renderCall(args, theme, _context) {
      const path = shortenPath(args.path || "");
      let pathDisplay = path.length > 0 ? theme.fg("accent", path) : theme.fg("toolOutput", "...");

      const lineRange = formatReadLineRange(args.offset, args.limit);
      if (lineRange.length > 0) {
        pathDisplay += theme.fg("warning", lineRange);
      }

      return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const lines = textContent.text.split("\n");
      const output = lines.map((line) => theme.fg("toolOutput", line)).join("\n");
      return new Text(`\n${output}`, 0, 0);
    },
  });

  msa.registerTool({
    ...tools.bash,

    renderCall(args, theme, _context) {
      const command = args.command || "...";
      const timeout = args.timeout as number | undefined;
      const timeoutSuffix =
        timeout !== undefined ? theme.fg("muted", ` (timeout ${timeout}s)`) : "";

      return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const output = textContent.text
        .trim()
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");

      if (output.length === 0) {
        return new Text("", 0, 0);
      }

      return new Text(`\n${output}`, 0, 0);
    },
  });

  msa.registerTool({
    ...tools.write,

    renderCall(args, theme, _context) {
      const path = shortenPath(args.path || "");
      const pathDisplay =
        path.length > 0 ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
      const lineCount = args.content.length > 0 ? args.content.split("\n").length : 0;
      const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";

      return new Text(
        `${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        return new Text("", 0, 0);
      }

      if (result.content.some((c) => c.type === "text" && c.text)) {
        const textContent = result.content.find((c) => c.type === "text");
        if (textContent?.type === "text" && textContent.text.length > 0) {
          return new Text(`\n${theme.fg("error", textContent.text)}`, 0, 0);
        }
      }

      return new Text("", 0, 0);
    },
  });

  msa.registerTool({
    ...tools.edit,
    renderShell: "default",

    renderCall(args, theme, _context) {
      const path = shortenPath(args.path || "");
      const pathDisplay =
        path.length > 0 ? theme.fg("accent", path) : theme.fg("toolOutput", "...");

      return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const text = textContent.text;
      if (text.includes("Error") || text.includes("error")) {
        return new Text(`\n${theme.fg("error", text)}`, 0, 0);
      }

      return new Text(`\n${theme.fg("toolOutput", text)}`, 0, 0);
    },
  });

  msa.registerTool({
    ...tools.find,

    renderCall(args, theme, _context) {
      const pattern = args.pattern || "";
      const path = shortenPath(args.path || ".");
      const limit = args.limit;

      let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
      text += theme.fg("toolOutput", ` in ${path}`);
      if (limit !== undefined) {
        text += theme.fg("toolOutput", ` (limit ${limit})`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        const textContent = result.content.find((c) => c.type === "text");
        if (textContent?.type === "text") {
          const count = textContent.text.trim().split("\n").filter(Boolean).length;
          if (count > 0) {
            return new Text(theme.fg("muted", ` → ${count} files`), 0, 0);
          }
        }
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const output = textContent.text
        .trim()
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");

      return new Text(`\n${output}`, 0, 0);
    },
  });

  msa.registerTool({
    ...tools.grep,

    renderCall(args, theme, _context) {
      const pattern = args.pattern || "";
      const path = shortenPath(args.path || ".");
      const glob = args.glob;
      const limit = args.limit;

      let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
      text += theme.fg("toolOutput", ` in ${path}`);
      if (glob !== undefined && glob.length > 0) {
        text += theme.fg("toolOutput", ` (${glob})`);
      }
      if (limit !== undefined) {
        text += theme.fg("toolOutput", ` limit ${limit}`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        const textContent = result.content.find((c) => c.type === "text");
        if (textContent?.type === "text") {
          const count = textContent.text.trim().split("\n").filter(Boolean).length;
          if (count > 0) {
            return new Text(theme.fg("muted", ` → ${count} matches`), 0, 0);
          }
        }
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const output = textContent.text
        .trim()
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");

      return new Text(`\n${output}`, 0, 0);
    },
  });

  msa.registerTool({
    ...tools.ls,

    renderCall(args, theme, _context) {
      const path = shortenPath(args.path || ".");
      const limit = args.limit;

      let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
      if (limit !== undefined) {
        text += theme.fg("toolOutput", ` (limit ${limit})`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme, _context) {
      if (!expanded) {
        const textContent = result.content.find((c) => c.type === "text");
        if (textContent?.type === "text") {
          const count = textContent.text.trim().split("\n").filter(Boolean).length;
          if (count > 0) {
            return new Text(theme.fg("muted", ` → ${count} entries`), 0, 0);
          }
        }
        return new Text("", 0, 0);
      }

      const textContent = result.content.find((c) => c.type === "text");
      if (textContent === undefined || textContent.type !== "text") {
        return new Text("", 0, 0);
      }

      const output = textContent.text
        .trim()
        .split("\n")
        .map((line) => theme.fg("toolOutput", line))
        .join("\n");

      return new Text(`\n${output}`, 0, 0);
    },
  });
}
