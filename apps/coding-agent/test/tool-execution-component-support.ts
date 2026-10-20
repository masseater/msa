import testing from "@msa/testing";
import type { TUI } from "@msa/tui";
import { Type } from "typebox";

import type { ToolDefinition } from "../src/core/extensions/types.ts";

const { awaited, runTest } = testing;

function createBaseToolDefinition(name = "custom_tool"): ToolDefinition {
  return {
    description: "custom tool",
    execute: () =>
      runTest(
        awaited({
          content: [{ text: "ok", type: "text" as const }],
          details: {},
        }),
      ),
    label: name,
    name,
    parameters: Type.Any(),
  };
}

const TINY_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAVAQEBAAAAAAAAAAAAAAAAAAAGCf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AD3VTB3/2Q==";

function createFakeTui(): TUI {
  return {
    requestRender: () => {},
  } as unknown as TUI;
}

const toolExecutionComponentSupport = {
  TINY_JPEG,
  createBaseToolDefinition,
  createFakeTui,
};

export default toolExecutionComponentSupport;
