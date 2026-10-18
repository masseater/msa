import { awaited, runTest } from "@msa/testing";
import type { TUI } from "@msa/tui";
import { Type } from "typebox";

import type { ToolDefinition } from "../src/core/extensions/types.ts";

export function createBaseToolDefinition(name = "custom_tool"): ToolDefinition {
  return {
    name,
    label: name,
    description: "custom tool",
    parameters: Type.Any(),
    execute: () =>
      runTest(
        awaited({
          content: [{ type: "text" as const, text: "ok" }],
          details: {},
        }),
      ),
  };
}

export const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AD3VTB3/2Q==";

export function createFakeTui(): TUI {
  return {
    requestRender: () => {},
  } as unknown as TUI;
}
