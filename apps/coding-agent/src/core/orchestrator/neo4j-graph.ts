import { Effect } from "effect";
import neo4j, { type Driver, type Record as Neo4jRecord } from "neo4j-driver";

import { fromPromise, platformRuntime, ToolFailure, unwrapForeign } from "../platform/index.ts";
import type {
  SessionGraph,
  SessionNode,
  SessionNodePatch,
  SessionNodeWithDependencies,
} from "./graph.ts";

const DEFAULT_URI = "bolt://localhost:7687";
const DEFAULT_USERNAME = "neo4j";

const NODE_FIELDS = [
  "id",
  "project",
  "kind",
  "title",
  "prompt",
  "status",
  "model",
  "thinkingLevel",
  "cwd",
  "round",
  "createdAt",
  "sessionFile",
  "report",
] as const satisfies readonly (keyof SessionNode)[];

function definedProperties(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined));
}

function toNode(properties: Record<string, unknown>): SessionNode {
  const node: Record<string, unknown> = {};
  for (const field of NODE_FIELDS) {
    if (properties[field] !== undefined && properties[field] !== null) {
      node[field] = properties[field];
    }
  }
  return node as unknown as SessionNode;
}

function toNodeWithDependencies(record: Neo4jRecord): SessionNodeWithDependencies {
  return {
    ...toNode(record.get("s").properties),
    dependsOn: (record.get("dependsOn") as string[]).toSorted(),
  };
}

const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  platformRuntime.runPromise(unwrapForeign(effect));

const connectDriver = (env: NodeJS.ProcessEnv) =>
  Effect.gen(function* () {
    const password = env["NEO4J_PASSWORD"];
    if (password === undefined || password === "") {
      return yield* new ToolFailure({
        message:
          "NEO4J_PASSWORD is not set. The orchestrator keeps session dependencies in Neo4j (NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD).",
      });
    }
    const driver = neo4j.driver(
      env["NEO4J_URI"] ?? DEFAULT_URI,
      neo4j.auth.basic(env["NEO4J_USERNAME"] ?? DEFAULT_USERNAME, password),
      { disableLosslessIntegers: true },
    );
    yield* fromPromise(() =>
      driver.executeQuery(
        "CREATE CONSTRAINT msa_session_id IF NOT EXISTS FOR (s:MsaSession) REQUIRE s.id IS UNIQUE",
      ),
    ).pipe(Effect.tapError(() => fromPromise(() => driver.close()).pipe(Effect.ignore)));
    return driver;
  });

export class Neo4jSessionGraph implements SessionGraph {
  private readonly driver: Driver;

  private constructor(driver: Driver) {
    this.driver = driver;
  }

  static connect(env: NodeJS.ProcessEnv = process.env): Promise<Neo4jSessionGraph> {
    return run(connectDriver(env).pipe(Effect.map((driver) => new Neo4jSessionGraph(driver))));
  }

  add(node: SessionNode, dependsOn: readonly string[]): Promise<void> {
    return run(
      Effect.gen({ self: this }, function* () {
        const { records } = yield* this.query(
          `MATCH (d:MsaSession {project: $project}) WHERE d.id IN $dependsOn
       RETURN collect(d.id) AS found`,
          { project: node.project, dependsOn: [...dependsOn] },
        );
        const found = new Set(records[0]?.get("found") as string[]);
        const missing = dependsOn.filter((id) => !found.has(id));
        if (missing.length > 0) {
          return yield* new ToolFailure({
            message: `Unknown sessions in dependsOn: ${missing.join(", ")}`,
          });
        }
        yield* this.query(
          `CREATE (s:MsaSession) SET s = $properties
       WITH s
       UNWIND $dependsOn AS dependencyId
       MATCH (d:MsaSession {id: dependencyId})
       CREATE (s)-[:DEPENDS_ON]->(d)`,
          { properties: definedProperties(node), dependsOn: [...dependsOn] },
        );
      }),
    );
  }

  update(id: string, patch: SessionNodePatch): Promise<void> {
    return run(
      this.query("MATCH (s:MsaSession {id: $id}) SET s += $patch", {
        id,
        patch: definedProperties(patch),
      }).pipe(Effect.asVoid),
    );
  }

  setDependencies(id: string, dependsOn: readonly string[]): Promise<void> {
    return run(
      this.query(
        `MATCH (s:MsaSession {id: $id})
       OPTIONAL MATCH (s)-[old:DEPENDS_ON]->()
       DELETE old
       WITH DISTINCT s
       UNWIND $dependsOn AS dependencyId
       MATCH (d:MsaSession {id: dependencyId})
       CREATE (s)-[:DEPENDS_ON]->(d)`,
        { id, dependsOn: [...dependsOn] },
      ).pipe(Effect.asVoid),
    );
  }

  get(id: string): Promise<SessionNodeWithDependencies | undefined> {
    return run(
      this.query(
        `MATCH (s:MsaSession {id: $id})
       OPTIONAL MATCH (s)-[:DEPENDS_ON]->(d)
       RETURN s, collect(d.id) AS dependsOn`,
        { id },
      ).pipe(
        Effect.map(({ records }) =>
          records[0] === undefined ? undefined : toNodeWithDependencies(records[0]),
        ),
      ),
    );
  }

  list(project: string): Promise<SessionNodeWithDependencies[]> {
    return run(
      this.query(
        `MATCH (s:MsaSession {project: $project})
       OPTIONAL MATCH (s)-[:DEPENDS_ON]->(d)
       RETURN s, collect(d.id) AS dependsOn
       ORDER BY s.createdAt, s.id`,
        { project },
      ).pipe(Effect.map(({ records }) => records.map(toNodeWithDependencies))),
    );
  }

  ready(project: string): Promise<SessionNode[]> {
    return run(
      this.query(
        `MATCH (s:MsaSession {project: $project, status: "queued"})
       WHERE NOT EXISTS {
         MATCH (s)-[:DEPENDS_ON]->(d:MsaSession) WHERE d.status <> "completed"
       }
       RETURN s
       ORDER BY s.createdAt, s.id`,
        { project },
      ).pipe(
        Effect.map(({ records }) => records.map((record) => toNode(record.get("s").properties))),
      ),
    );
  }

  sinks(project: string, round: number): Promise<string[]> {
    return run(
      this.query(
        `MATCH (s:MsaSession {project: $project, kind: "task", round: $round})
       WHERE s.status <> "stopped" AND NOT EXISTS {
         MATCH (t:MsaSession {project: $project, kind: "task", round: $round})-[:DEPENDS_ON]->(s)
         WHERE t.status <> "stopped"
       }
       RETURN s.id AS id
       ORDER BY s.createdAt, s.id`,
        { project, round },
      ).pipe(Effect.map(({ records }) => records.map((record) => record.get("id") as string))),
    );
  }

  close(): Promise<void> {
    return run(fromPromise(() => this.driver.close()));
  }

  private query(cypher: string, parameters: Record<string, unknown>) {
    return fromPromise(() => this.driver.executeQuery(cypher, parameters));
  }
}
