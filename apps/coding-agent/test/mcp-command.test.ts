import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  awaited,
  runTest,
  toJsonText,
  fromJsonText,
  writeTextFile,
  pathExists,
  joinPath,
  resolvePath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { runMcpCommand } from "../src/extensions/mcp/cli.ts";

const FIXTURE = resolvePath(
  import.meta.dirname,
  "../../../libs/mcp/test/fixtures/stdio-server.mjs",
);

describe("msa mcp", () => {
  const dirs: string[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        while (dirs.length > 0) yield* removePath(dirs.pop() ?? "");
      }),
    ),
  );

  function run(args: string[], servers: Record<string, unknown> | undefined, dir?: string) {
    return runTest(
      Effect.gen(function* () {
        const agentDir = dir ?? mkdtempSync(joinPath(tmpdir(), "msa-mcp-command-"));
        if (!(dir !== undefined && dir.length > 0)) dirs.push(agentDir);
        if (servers !== undefined)
          yield* writeTextFile(
            joinPath(agentDir, "mcp.json"),
            yield* toJsonText({ mcpServers: servers }),
          );
        const output: string[] = [];
        const exitCode = yield* awaited(
          runMcpCommand(args, {
            cwd: agentDir,
            agentDir,
            log: (line) => output.push(line),
            error: (line) => output.push(line),
          }),
        );
        return yield* awaited({ exitCode, output: output.join("\n"), agentDir });
      }),
    );
  }

  const readConfig = (path: string) =>
    JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;

  const servers = {
    fixture: { command: process.execPath, args: [FIXTURE] },
    broken: { command: "msa-test-missing-mcp-server" },
    parked: { command: process.execPath, args: [FIXTURE], enabled: false },
    bad: { args: ["no command"] },
  };

  it("lists servers with their state, tools, and errors, and fails while anything is wrong", () =>
    runTest(
      Effect.gen(function* () {
        const { exitCode, output } = yield* awaited(run(["list"], servers));
        expect(exitCode).toBe(1);
        expect(output).toContain("fixture: connected, 1 tool (codemode, global)\n");
        expect(output).toContain("  tools: echo");
        expect(output).toContain(
          "broken: failed (codemode, global)\n  msa-test-missing-mcp-server\n  spawn msa-test-missing-mcp-server ENOENT",
        );
        expect(output).toContain("parked: disabled (codemode, global)");
        expect(output).toContain("config error: ");
        expect(output).toContain('server "bad" needs either "command"');

        const ok = yield* awaited(run(["list"], { fixture: servers.fixture }));
        expect(ok.exitCode).toBe(0);
      }),
    ));

  it("prints JSON for scripts", () =>
    runTest(
      Effect.gen(function* () {
        const { exitCode, output } = yield* awaited(
          run(["list", "--json"], {
            fixture: servers.fixture,
            parked: servers.parked,
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
    ));

  it("rejects unknown servers and servers without OAuth for login and logout", () =>
    runTest(
      Effect.gen(function* () {
        expect(yield* awaited(run(["login", "nope"], servers))).toMatchObject({
          exitCode: 1,
          output: 'No MCP server named "nope". Configured: fixture, broken, parked.',
        });
        expect(yield* awaited(run(["logout", "fixture"], servers))).toMatchObject({
          exitCode: 1,
          output:
            'MCP server "fixture" does not use OAuth. Only HTTP servers without an Authorization header do.',
        });
        expect((yield* awaited(run(["frobnicate"], servers))).exitCode).toBe(1);
      }),
    ));

  it("adds stdio servers and passes options after the command through", () =>
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
        expect(readConfig(joinPath(added.agentDir, "mcp.json"))).toEqual({
          mcpServers: {
            files: {
              command: "npx",
              args: ["-y", "server", "--root", "."],
              env: { A: "1", B: "x=y" },
            },
          },
        });

        const replaced = yield* awaited(
          run(["add", "files", "node", "server.js", "--port", "1"], undefined, added.agentDir),
        );
        expect(replaced.output).toContain('Replaced global MCP server "files"');
        expect(readConfig(joinPath(added.agentDir, "mcp.json"))).toEqual({
          mcpServers: { files: { command: "node", args: ["server.js", "--port", "1"] } },
        });
      }),
    ));

  it("adds HTTP servers and keeps other content of the file", () =>
    runTest(
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
            { fixture: servers.fixture },
          ),
        );
        expect(exitCode).toBe(0);
        expect(output).not.toContain("mcp login");
        expect(readConfig(joinPath(agentDir, "mcp.json"))).toEqual({
          mcpServers: {
            fixture: servers.fixture,
            docs: {
              url: "https://example.com/mcp",

              headers: { "X-Team": "core", Authorization: "Bearer ${DOCS_TOKEN}" },
              exposure: "direct",
              description: "Product docs",
            },
          },
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
        expect(readConfig(joinPath(agentDir, "mcp.json"))["mcpServers"]).toMatchObject({
          sentry: {
            url: "https://mcp.sentry.dev/mcp",
            oauth: { clientId: "msa", clientName: "Claude Code" },
          },
        });
      }),
    ));

  it("rejects invalid add invocations without writing", () =>
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
    ));

  it("adds and removes project servers", () =>
    runTest(
      Effect.gen(function* () {
        const added = yield* awaited(
          run(["add", "-l", "local", "--", "node", "server.js"], undefined),
        );
        expect(added.output).toContain("The project is not trusted");
        const projectConfig = joinPath(added.agentDir, ".msa", "mcp.json");
        expect(readConfig(projectConfig)).toEqual({
          mcpServers: { local: { command: "node", args: ["server.js"] } },
        });

        const wrongScope = yield* awaited(run(["remove", "local"], undefined, added.agentDir));
        expect(wrongScope.exitCode).toBe(1);
        expect(wrongScope.output).toContain(`It is defined in ${projectConfig}; use --local.`);

        const removed = yield* awaited(
          run(["remove", "local", "--local"], undefined, added.agentDir),
        );
        expect(removed.exitCode).toBe(0);
        expect(removed.output).toContain('Removed project MCP server "local"');
        expect(readConfig(projectConfig)).toEqual({ mcpServers: {} });
      }),
    ));

  it("removes global servers", () =>
    runTest(
      Effect.gen(function* () {
        const { exitCode, agentDir } = yield* awaited(run(["remove", "broken"], servers));
        expect(exitCode).toBe(0);
        expect(
          Object.keys(readConfig(joinPath(agentDir, "mcp.json"))["mcpServers"] as object),
        ).toEqual(["fixture", "parked", "bad"]);
        const missing = yield* awaited(run(["remove", "broken"], undefined, agentDir));
        expect(missing).toMatchObject({ exitCode: 1 });
        expect(missing.output).toContain('No global MCP server named "broken"');
      }),
    ));
});
