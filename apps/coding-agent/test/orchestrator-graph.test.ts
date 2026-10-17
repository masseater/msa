import { randomUUID } from "node:crypto";

import neo4j from "neo4j-driver";
import { afterAll, describe, expect, it } from "vitest";

import type { SessionGraph, SessionNode } from "../src/core/orchestrator/graph.ts";
import { Neo4jSessionGraph } from "../src/core/orchestrator/neo4j-graph.ts";
import { MemorySessionGraph } from "./orchestrator-memory-graph.ts";

const runPrefix = `test-${randomUUID()}`;

const graphs: Array<[string, () => Promise<SessionGraph>]> = [
  ["memory", async () => new MemorySessionGraph()],
];
if (process.env["NEO4J_PASSWORD"]) graphs.push(["neo4j", () => Neo4jSessionGraph.connect()]);

afterAll(async () => {
  const password = process.env["NEO4J_PASSWORD"];
  if (!password) return;
  const driver = neo4j.driver(
    process.env["NEO4J_URI"] ?? "bolt://localhost:7687",
    neo4j.auth.basic(process.env["NEO4J_USERNAME"] ?? "neo4j", password),
  );
  await driver.executeQuery(
    "MATCH (s:MsaSession) WHERE s.project STARTS WITH $prefix DETACH DELETE s",
    { prefix: runPrefix },
  );
  await driver.close();
});

describe.each(graphs)("%s session graph", (_name, connect) => {
  const opened: SessionGraph[] = [];
  afterAll(async () => {
    for (const graph of opened) await graph.close();
  });

  async function setup() {
    const graph = await connect();
    opened.push(graph);
    const project = `${runPrefix}-${randomUUID()}`;
    let order = 0;
    const node = (id: string, patch: Partial<SessionNode> = {}): SessionNode => ({
      id: `${project}-${id}`,
      project,
      kind: "task",
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
    return { graph, project, node, id };
  }

  it("rejects dependencies outside the project", async () => {
    const { graph, node, id } = await setup();
    await expect(graph.add(node("a"), [id("missing")])).rejects.toThrow(/Unknown sessions/);
    await expect(graph.get(id("a"))).resolves.toBeUndefined();
  });

  it("is ready once every dependency completed", async () => {
    const { graph, project, node, id } = await setup();
    await graph.add(node("a"), []);
    await graph.add(node("b"), []);
    await graph.add(node("c"), [id("a"), id("b")]);
    expect((await graph.ready(project)).map((ready) => ready.id)).toEqual([id("a"), id("b")]);

    await graph.update(id("a"), { status: "completed", report: "done a" });
    await graph.update(id("b"), { status: "running" });
    expect((await graph.ready(project)).map((ready) => ready.id)).toEqual([]);

    await graph.update(id("b"), { status: "completed" });
    expect((await graph.ready(project)).map((ready) => ready.id)).toEqual([id("c")]);
    expect(await graph.get(id("c"))).toMatchObject({ dependsOn: [id("a"), id("b")] });
    expect(await graph.get(id("a"))).toMatchObject({ report: "done a", status: "completed" });
  });

  it("finds the sinks of a round, ignoring stopped tasks and reviews", async () => {
    const { graph, project, node, id } = await setup();
    await graph.add(node("a"), []);
    await graph.add(node("b"), [id("a")]);
    await graph.add(node("c"), []);
    await graph.add(node("d"), [id("c")]);
    await graph.add(node("next", { round: 2 }), []);
    await graph.add(node("review", { kind: "review" }), [id("b"), id("d")]);
    expect(await graph.sinks(project, 1)).toEqual([id("b"), id("d")]);

    await graph.update(id("d"), { status: "stopped" });
    expect(await graph.sinks(project, 1)).toEqual([id("b"), id("c")]);
  });

  it("replaces dependencies", async () => {
    const { graph, node, id } = await setup();
    await graph.add(node("a"), []);
    await graph.add(node("b"), []);
    await graph.add(node("review", { kind: "review" }), [id("a")]);
    await graph.setDependencies(id("review"), [id("b")]);
    expect(await graph.get(id("review"))).toMatchObject({ dependsOn: [id("b")] });
    await graph.setDependencies(id("review"), []);
    expect(await graph.get(id("review"))).toMatchObject({ dependsOn: [] });
  });
});
