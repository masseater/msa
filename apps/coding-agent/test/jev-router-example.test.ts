import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jevRouterHarness from "./jev-router-harness.ts";
import jevRouterProviders from "./jev-router-providers.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;
const { cleanupHarnesses, setup } = jevRouterHarness;
const { createTool } = jevRouterProviders;
const { awaited, runTest } = testing;

const call = (tool: string) =>
  fauxAssistantMessage(fauxToolCall(tool, { path: "a.ts" }), { stopReason: "toolUse" });

const letsSolMakeTheFirstEditAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { harness, dispatched, respond, phases } = yield* awaited(
        setup(0.8, [createTool("read"), createTool("edit")]),
      );

      respond(call("read"), call("edit"), fauxAssistantMessage("done"));
      yield* awaited(harness.session.run.prompting.prompt("Refactor the cache layer."));
      respond(fauxAssistantMessage("added"));
      yield* awaited(harness.session.run.prompting.prompt("Also add tests."));

      expect(dispatched()).toEqual(["sol", "sol", "luna", "luna"]);
      expect(phases()).toEqual(["planning", "implementation"]);
      expect(harness.session.model).toMatchObject({ id: "auto", provider: "jev" });
    }),
  );

const plansOnTerraAndIgnoresFailedEdits = () =>
  runTest(
    Effect.gen(function* () {
      const { harness, dispatched, respond, phases } = yield* awaited(
        setup(0.2, [createTool("edit", true), createTool("write")]),
      );

      respond(call("edit"), call("write"), fauxAssistantMessage("done"));
      yield* awaited(harness.session.run.prompting.prompt("Add a verbose flag."));

      expect(dispatched()).toEqual(["terra", "terra", "luna"]);
      expect(phases()).toEqual(["planning", "implementation"]);
    }),
  );

describe("jev-router example", () => {
  afterEach(cleanupHarnesses);

  it("lets Sol make the first edit and switches to Luna for the rest", letsSolMakeTheFirstEditAnd);

  it("plans on Terra and ignores failed edits", plansOnTerraAndIgnoresFailedEdits);
});
