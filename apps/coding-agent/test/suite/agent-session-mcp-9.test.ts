import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import extension from "../../src/extensions/codemode/extension.ts";
import type configTypes from "../../src/extensions/mcp/config.types.ts";
import extensionModule from "../../src/extensions/mcp/extension.ts";
import agentSessionMcpSupport from "./agent-session-mcp-support.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { cleanupAll } = harnessModule;

const { createCodemodeExtension } = extension;
const { createMcpExtension } = extensionModule;

const { fauxAssistantMessage } = ai;

const { createFakeServer } = agentSessionMcpSupport;

const { createHarness, createTestUiContext } = harnessModule;

const harnesses3: harnessTypes.Harness[] = [];

function setup3(
  plugins: extensionsTypesTypes.ExtensionFactory | extensionsTypesTypes.ExtensionFactory[],
  configured: configTypes.McpServerEntry[] = [],
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const connected: configTypes.McpServerEntry[] = [];
      const harness = yield* Effect.promise(() =>
        createHarness({
          extensionFactories: [
            ...(Array.isArray(plugins) ? plugins : [plugins]),
            createCodemodeExtension(),
            createMcpExtension({
              createTransport: (entry) => {
                connected.push(entry);
                const pair = createFakeServer([]);
                void pair.server.start();
                return pair.client;
              },
              loadConfig: () => ({ errors: [], servers: configured }),
            }),
          ],
          initialActiveToolNames: [],
        }),
      );
      harnesses3.push(harness);

      yield* Effect.promise(() =>
        harness.session.extensions.binding.bindExtensions({ uiContext: createTestUiContext() }),
      );
      return { connected, harness };
    }),
  );
}

const connectsServersRegisteredWhileExtensionsLoad = Effect.gen(function* () {
  const { harness, connected } = yield* Effect.promise(() =>
    setup3((msa) => {
      msa.registerMcpServer("plugin", { exposure: "direct", url: "http://plugin.invalid" });
    }),
  );
  harness.setResponses([fauxAssistantMessage("ready")]);
  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(connected.map((entry) => [entry.name, entry.scope])).toEqual([["plugin", "extension"]]);
  expect(harness.session.tools.loadout.getActiveToolNames()).toContain("mcp__plugin__search");
});

const connectsAndDisconnectsServersRegisteredDuring = Effect.gen(function* () {
  let api: extensionsTypesTypes.ExtensionAPI | undefined;
  const { harness, connected } = yield* Effect.promise(() =>
    setup3((msa) => {
      api = msa;
    }),
  );
  if (api === undefined) throw new Error("No extension API");
  const msa = api;

  msa.registerMcpServer("late", { url: "http://late.invalid" });
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.tools.loadout.getCallableToolNames()).toContain("mcp__late__search"),
    ),
  );
  expect(connected.map((entry) => entry.name)).toEqual(["late"]);

  expect(harness.session.tools.loadout.getActiveToolNames()).toContain("codemode");

  msa.unregisterMcpServer("late");
  yield* Effect.promise(() =>
    vi.waitFor(() =>
      expect(harness.session.tools.loadout.getCallableToolNames()).not.toContain(
        "mcp__late__search",
      ),
    ),
  );
});

const rejectsNamesAnotherExtensionRegistered = Effect.gen(function* () {
  const errors: string[] = [];
  yield* Effect.promise(() =>
    setup3([
      (msa) => {
        msa.registerMcpServer("taken", { url: "http://x.invalid" });

        msa.registerMcpServer("taken", { url: "http://y.invalid" });
        msa.registerMcpServer("my-server", { url: "http://x.invalid" });
      },
      (msa) => {
        for (const name of ["taken", "my_server"]) {
          try {
            msa.registerMcpServer(name, { url: "http://z.invalid" });
          } catch (caught) {
            errors.push(String(caught));
          }
        }
      },
    ]),
  );
  expect(errors).toEqual([
    expect.stringMatching(/MCP server "taken" is already registered by extension/u),

    'Error: MCP server "my_server" conflicts with registered server "my-server"',
  ]);
});

const reportsRegisteredServersWhenNoExtension = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => msa.registerMcpServer("orphan", { url: "http://orphan.invalid" }),
      ],
    }),
  );
  harnesses3.push(harness);
  const errors: string[] = [];
  yield* Effect.promise(() =>
    harness.session.extensions.binding.bindExtensions({
      onError: (error) => errors.push(error.error),
    }),
  );

  expect(errors).toEqual([
    expect.stringContaining('MCP server "orphan" is registered, but no loaded extension'),
  ]);
});

const connectsServersRegisteredWhileExtensionsLoad2 = () =>
  Effect.runPromise(connectsServersRegisteredWhileExtensionsLoad);

const connectsAndDisconnectsServersRegisteredDuringThe = () =>
  Effect.runPromise(connectsAndDisconnectsServersRegisteredDuring);

const rejectsNamesAnotherExtensionRegistered2 = () =>
  Effect.runPromise(rejectsNamesAnotherExtensionRegistered);

const reportsRegisteredServersWhenNoExtensionConnects = () =>
  Effect.runPromise(reportsRegisteredServersWhenNoExtension);

describe("AgentSession MCP servers registered by extensions", () => {
  afterEach(() => cleanupAll(harnesses3));
  it(
    "connects servers registered while extensions load",
    connectsServersRegisteredWhileExtensionsLoad2,
  );
  it(
    "connects and disconnects servers registered during the session",
    connectsAndDisconnectsServersRegisteredDuringThe,
  );
  it.each(["my-docs", "my_docs"])("prefers the mcp.json server over a registered %s", (name) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const configured: configTypes.McpServerEntry = {
          config: { url: "http://config.invalid" },
          name: "my-docs",
          source: "mcp.json",
        };
        const { connected } = yield* Effect.promise(() =>
          setup3(
            (msa) => {
              msa.registerMcpServer(name, { url: "http://plugin.invalid" });
            },
            [configured],
          ),
        );
        yield* Effect.promise(() => vi.waitFor(() => expect(connected).toEqual([configured])));
        yield* Effect.sleep(10);
        expect(connected).toEqual([configured]);
      }),
    ),
  );
  it("rejects names another extension registered", rejectsNamesAnotherExtensionRegistered2);
  it(
    "reports registered servers when no extension connects them",
    reportsRegisteredServersWhenNoExtensionConnects,
  );
});
