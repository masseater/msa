import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import mcpCommandSupport from "./mcp-command-support.ts";

const { afterEachHook, fixtureServer, run, servers2 } = mcpCommandSupport;

const { awaited, fromJsonText, joinPath, pathExists, readTextFile, runTest } = testing;

const readConfig = (path: string): Effect.Effect<Record<string, unknown>> =>
  Effect.map(
    Effect.flatMap(readTextFile(path), fromJsonText),
    (value) => value as Record<string, unknown>,
  );

const addsStdioServersAndPassesOptionsAfter = () =>
  runTest(
    Effect.gen(function* () {
      const added = yield* awaited(
        run(
          [
            "add",
            "--env",
            "A=1",
            "--env",
            "B=x=y",
            "files",
            "--",
            "npx",
            "-y",
            "server",
            "--root",
            ".",
          ],
          undefined,
        ),
      );
      expect(added.exitCode).toBe(0);
      expect(added.output).toContain('Added global MCP server "files"');
      expect(yield* readConfig(joinPath(added.agentDir, "mcp.json"))).toEqual({
        mcpServers: {
          files: {
            args: ["-y", "server", "--root", "."],
            command: "npx",
            env: { A: "1", B: "x=y" },
          },
        },
      });

      const replaced = yield* awaited(
        run(["add", "files", "node", "server.js", "--port", "1"], undefined, added.agentDir),
      );
      expect(replaced.output).toContain('Replaced global MCP server "files"');
      expect(yield* readConfig(joinPath(added.agentDir, "mcp.json"))).toEqual({
        mcpServers: { files: { args: ["server.js", "--port", "1"], command: "node" } },
      });
    }),
  );

const addsHttpServersAndKeepsOtherContentSetup = () =>
  Effect.gen(function* () {
    const { exitCode, output, agentDir } = yield* awaited(
      run(
        [
          "add",
          "docs",
          "--url",
          "https://example.com/mcp",
          "--bearer-token-env-var",
          "DOCS_TOKEN",
          "--header",
          "X-Team=core",
          "--exposure",
          "direct",
          "--description",
          "Product docs",
        ],
        { fixture: fixtureServer },
      ),
    );
    return { agentDir, exitCode, output };
  });

const addsHttpServersAndKeepsOtherContent = () =>
  runTest(
    Effect.gen(function* () {
      const { agentDir, exitCode, output } = yield* addsHttpServersAndKeepsOtherContentSetup();
      expect(exitCode).toBe(0);
      expect(output).not.toContain("mcp login");
      expect(yield* readConfig(joinPath(agentDir, "mcp.json"))).toEqual({
        mcpServers: Object.fromEntries([
          ["fixture", fixtureServer],
          [
            "docs",
            {
              description: "Product docs",

              exposure: "direct",

              headers: { Authorization: "Bearer ${DOCS_TOKEN}", "X-Team": "core" },

              url: "https://example.com/mcp",
            },
          ],
        ]),
      });

      const oauth = yield* awaited(
        run(
          [
            "add",
            "sentry",
            "--url",
            "https://mcp.sentry.dev/mcp",
            "--oauth-client-id",
            "msa",
            "--oauth-client-name",
            "Claude Code",
          ],
          undefined,
          agentDir,
        ),
      );
      expect(oauth.output).toContain("If it requires sign-in: msa mcp login sentry");
      expect((yield* readConfig(joinPath(agentDir, "mcp.json")))["mcpServers"]).toMatchObject({
        sentry: {
          oauth: { clientId: "msa", clientName: "Claude Code" },
          url: "https://mcp.sentry.dev/mcp",
        },
      });
    }),
  );

const rejectsInvalidAddInvocationsWithoutWriting = () =>
  runTest(
    Effect.gen(function* () {
      const cases = [
        ["add", "x"],
        ["add", "x", "--url", "https://example.com", "--", "cmd"],
        ["add", "bad name", "--", "cmd"],
        ["add", "x", "--url", "ftp://example.com"],
        ["add", "x", "--env", "A=1", "--url", "https://example.com"],
        ["add", "x", "--header", "A=1", "--", "cmd"],
        ["add", "x", "--env", "NOVALUE", "--", "cmd"],
        ["add", "x", "--exposure", "loud", "--", "cmd"],
      ];
      for (const args of cases) {
        const result = yield* awaited(run(args, undefined));
        expect(result.exitCode, args.join(" ")).toBe(1);
        expect(yield* pathExists(joinPath(result.agentDir, "mcp.json"))).toBe(false);
      }
    }),
  );

const addsAndRemovesProjectServers = () =>
  runTest(
    Effect.gen(function* () {
      const added = yield* awaited(
        run(["add", "-l", "local", "--", "node", "server.js"], undefined),
      );
      expect(added.output).toContain("The project is not trusted");
      const projectConfig = joinPath(added.agentDir, ".msa", "mcp.json");
      expect(yield* readConfig(projectConfig)).toEqual({
        mcpServers: { local: { args: ["server.js"], command: "node" } },
      });

      const wrongScope = yield* awaited(run(["remove", "local"], undefined, added.agentDir));
      expect(wrongScope.exitCode).toBe(1);
      expect(wrongScope.output).toContain(`It is defined in ${projectConfig}; use --local.`);

      const removed = yield* awaited(
        run(["remove", "local", "--local"], undefined, added.agentDir),
      );
      expect(removed.exitCode).toBe(0);
      expect(removed.output).toContain('Removed project MCP server "local"');
      expect(yield* readConfig(projectConfig)).toEqual({ mcpServers: {} });
    }),
  );

const removesGlobalServers = () =>
  runTest(
    Effect.gen(function* () {
      const { exitCode, agentDir } = yield* awaited(run(["remove", "broken"], servers2));
      expect(exitCode).toBe(0);
      expect(
        Object.keys((yield* readConfig(joinPath(agentDir, "mcp.json")))["mcpServers"] as object),
      ).toEqual(["fixture", "parked", "bad"]);
      const missing = yield* awaited(run(["remove", "broken"], undefined, agentDir));
      expect(missing).toMatchObject({ exitCode: 1 });
      expect(missing.output).toContain('No global MCP server named "broken"');
    }),
  );

describe("msa mcp", () => {
  afterEach(afterEachHook);

  it(
    "adds stdio servers and passes options after the command through",
    addsStdioServersAndPassesOptionsAfter,
  );

  it("adds HTTP servers and keeps other content of the file", addsHttpServersAndKeepsOtherContent);

  it("rejects invalid add invocations without writing", rejectsInvalidAddInvocationsWithoutWriting);

  it("adds and removes project servers", addsAndRemovesProjectServers);

  it("removes global servers", removesGlobalServers);
});
