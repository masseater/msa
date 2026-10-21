import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import mcpCommandSupport from "./mcp-command-support.ts";

const { afterEachHook, fixtureServer, parkedServer, run, servers2 } = mcpCommandSupport;

const { awaited, fromJsonText, runTest } = testing;

const listsServersWithTheirStateToolsAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { exitCode, output } = yield* awaited(run(["list"], servers2));
      expect(exitCode).toBe(1);
      expect(output).toContain("fixture: connected, 1 tool (codemode, global)\n");
      expect(output).toContain("  tools: echo");
      expect(output).toContain(
        "broken: failed (codemode, global)\n  msa-test-missing-mcp-server\n  spawn msa-test-missing-mcp-server ENOENT",
      );
      expect(output).toContain("parked: disabled (codemode, global)");
      expect(output).toContain("config error: ");
      expect(output).toContain('server "bad" needs either "command"');

      const ok = yield* awaited(run(["list"], { fixture: fixtureServer }));
      expect(ok.exitCode).toBe(0);
    }),
  );

const printsJsonForScripts = () =>
  runTest(
    Effect.gen(function* () {
      const { exitCode, output } = yield* awaited(
        run(["list", "--json"], {
          fixture: fixtureServer,
          parked: parkedServer,
        }),
      );
      expect(exitCode).toBe(0);
      const parsed = (yield* fromJsonText(output)) as {
        servers: { name: string; state: string; tools: string[] }[];
      };
      expect(parsed.servers.map(({ name, state, tools }) => ({ name, state, tools }))).toEqual([
        { name: "fixture", state: "connected", tools: ["echo"] },
        { name: "parked", state: "disabled", tools: [] },
      ]);
    }),
  );

const rejectsUnknownServersAndServersWithoutOauth = () =>
  runTest(
    Effect.gen(function* () {
      expect(yield* awaited(run(["login", "nope"], servers2))).toMatchObject({
        exitCode: 1,
        output: 'No MCP server named "nope". Configured: fixture, broken, parked.',
      });
      expect(yield* awaited(run(["logout", "fixture"], servers2))).toMatchObject({
        exitCode: 1,
        output:
          'MCP server "fixture" does not use OAuth. Only HTTP servers without an Authorization header do.',
      });
      expect((yield* awaited(run(["frobnicate"], servers2))).exitCode).toBe(1);
    }),
  );

describe("msa mcp", () => {
  afterEach(afterEachHook);

  it(
    "lists servers with their state, tools, and errors, and fails while anything is wrong",
    listsServersWithTheirStateToolsAnd,
  );

  it("prints JSON for scripts", printsJsonForScripts);

  it(
    "rejects unknown servers and servers without OAuth for login and logout",
    rejectsUnknownServersAndServersWithoutOauth,
  );
});
