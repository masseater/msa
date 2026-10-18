import { randomUUID } from "node:crypto";

import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import neo4j from "neo4j-driver";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { SessionGraph, SessionNode } from "../src/core/orchestrator/graph.ts";
import { Neo4jSessionGraph } from "../src/core/orchestrator/neo4j-graph.ts";
import { readEnv } from "../src/core/process-env.ts";
import { MemorySessionGraph } from "./orchestrator-memory-graph.ts";

const runPrefix = `test-${randomUUID()}`;

const graphs: Array<[string, () => Promise<SessionGraph>]> = [
  ["memory", () => runTest(awaited(new MemorySessionGraph()))],
];
if (readEnv("NEO4J_PASSWORD")) graphs.push(["neo4j", () => Neo4jSessionGraph.connect()]);

afterAll(() =>
  runTest(
    Effect.gen(function* () {
      const password = readEnv("NEO4J_PASSWORD");
      if (!password) return;
      const driver = neo4j.driver(
        readEnv("NEO4J_URI") ?? "bolt://localhost:7687",
        neo4j.auth.basic(readEnv("NEO4J_USERNAME") ?? "neo4j", password),
      );
      yield* awaited(
        driver.executeQuery(
          "MATCH (s:MsaSession) WHERE s.project STARTS WITH $prefix DETACH DELETE s",
          { prefix: runPrefix },
        ),
      );
      yield* awaited(driver.close());
    }),
  ),
);

describe.each(graphs)("%s session graph", (_name, connect) => {
  const opened: SessionGraph[] = [];
  afterAll(() =>
    runTest(
      Effect.gen(function* () {
        for (const graph of opened) yield* awaited(graph.close());
      }),
    ),
  );

  function setup() {
    return runTest(
      Effect.gen(function* () {
        const graph = yield* awaited(connect());
        opened.push(graph);
        const project = `${runPrefix}-${randomUUID()}`;
        let order = 0;
        const node = (id: string, patch: Partial<SessionNode> = {}): SessionNode => ({
          id: `${project}-${id}`,
          project,
          kind: "task" as const,
          title: id,
          prompt: `do ${id}`,
          status: "queued",
          model: "faux/model",
          thinkingLevel: "off",
          cwd: "/tmp",
          round: 1,
          createdAt: order++,
          ...patch,
        });
        const id = (name: string) => `${project}-${name}`;
        return yield* awaited({ graph, project, node, id });
      }),
    );
  }

  it("rejects dependencies outside the project", () =>
    runTest(
      Effect.gen(function* () {
        const { graph, node, id } = yield* awaited(setup());
        yield* awaited(
          expect(graph.add(node("a"), [id("missing")])).rejects.toThrow(/Unknown sessions/u),
        );
        yield* awaited(expect(graph.get(id("a"))).resolves.toBeUndefined());
      }),
    ));

  it("is ready once every dependency completed", () =>
    runTest(
      Effect.gen(function* () {
        const { graph, project, node, id } = yield* awaited(setup());
        yield* awaited(graph.add(node("a"), []));
        yield* awaited(graph.add(node("b"), []));
        yield* awaited(graph.add(node("c"), [id("a"), id("b")]));
        expect((yield* awaited(graph.ready(project))).map((ready) => ready.id)).toEqual([
          id("a"),
          id("b"),
        ]);

        yield* awaited(graph.update(id("a"), { status: "completed", report: "done a" }));
        yield* awaited(graph.update(id("b"), { status: "running" }));
        expect((yield* awaited(graph.ready(project))).map((ready) => ready.id)).toEqual([]);

        yield* awaited(graph.update(id("b"), { status: "completed" }));
        expect((yield* awaited(graph.ready(project))).map((ready) => ready.id)).toEqual([id("c")]);
        expect(yield* awaited(graph.get(id("c")))).toMatchObject({ dependsOn: [id("a"), id("b")] });
        expect(yield* awaited(graph.get(id("a")))).toMatchObject({
          report: "done a",
          status: "completed",
        });
      }),
    ));

  it("finds the sinks of a round, ignoring stopped tasks and reviews", () =>
    runTest(
      Effect.gen(function* () {
        const { graph, project, node, id } = yield* awaited(setup());
        yield* awaited(graph.add(node("a"), []));
        yield* awaited(graph.add(node("b"), [id("a")]));
        yield* awaited(graph.add(node("c"), []));
        yield* awaited(graph.add(node("d"), [id("c")]));
        yield* awaited(graph.add(node("next", { round: 2 }), []));
        yield* awaited(graph.add(node("review", { kind: "review" as const }), [id("b"), id("d")]));
        expect(yield* awaited(graph.sinks(project, 1))).toEqual([id("b"), id("d")]);

        yield* awaited(graph.update(id("d"), { status: "stopped" }));
        expect(yield* awaited(graph.sinks(project, 1))).toEqual([id("b"), id("c")]);
      }),
    ));

  it("replaces dependencies", () =>
    runTest(
      Effect.gen(function* () {
        const { graph, node, id } = yield* awaited(setup());
        yield* awaited(graph.add(node("a"), []));
        yield* awaited(graph.add(node("b"), []));
        yield* awaited(graph.add(node("review", { kind: "review" as const }), [id("a")]));
        yield* awaited(graph.setDependencies(id("review"), [id("b")]));
        expect(yield* awaited(graph.get(id("review")))).toMatchObject({ dependsOn: [id("b")] });
        yield* awaited(graph.setDependencies(id("review"), []));
        expect(yield* awaited(graph.get(id("review")))).toMatchObject({ dependsOn: [] });
      }),
    ));
});
