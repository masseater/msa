import type codingAgentTypes from "@msa/coding-agent/index.types";

export default function (msa: codingAgentTypes.ExtensionAPI) {
  const protectedPaths = [".env", ".git/", "node_modules/"];

  msa.on("tool_call", (event, ctx) => {
    if (event.toolName !== "write" && event.toolName !== "edit") {
      return undefined;
    }

    const path = event.input.path as string;
    const isProtected = protectedPaths.some((p) => path.includes(p));

    if (isProtected) {
      if (ctx.hasUI) {
        ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
      }
      return { block: true, reason: `Path "${path}" is protected` };
    }

    return undefined;
  });
}
