import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";

const { cleanupAll } = closeAgentSessionModule;
const { harnesses4, loadDocsSearch, setup4 } = agentSessionMcpSupport;

describe("AgentSession MCP tools after resume and reload", () => {
  afterEach(() => cleanupAll(harnesses4));

  it.each([
    ["drops", ["read"], false],
    ["keeps", undefined, true],
  ] as const)(
    "%s restored tools when an extension sets the loadout before they register",
    (_, loadout, kept) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* Effect.promise(() => setup4());
          yield* Effect.promise(() => loadDocsSearch(first.harness));

          const setLoadout: extensionsTypesTypes.ExtensionFactory = (msa) => {
            msa.on("session_start", () =>
              msa.setActiveTools(
                loadout === undefined ? [...msa.getActiveTools(), "read"] : [...loadout],
              ),
            );
          };
          const second = yield* Effect.promise(() =>
            setup4(first.harness.sessionManager, [setLoadout]),
          );
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(
                second.harness.session.tools.registry
                  .getAllTools()
                  .some((tool) => tool.name === "mcp__docs__search"),
              ).toBe(true),
            ),
          );

          expect(
            second.harness.session.tools.loadout.getActiveToolNames().includes("mcp__docs__search"),
          ).toBe(kept);
        }),
      ),
  );
});
