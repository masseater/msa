import { Effect } from "effect";

import type {
  SessionGraph,
  SessionNode,
  SessionNodePatch,
  SessionNodeWithDependencies,
} from "../src/core/orchestrator/graph.ts";

export class MemorySessionGraph implements SessionGraph {
  private readonly nodes = new Map<string, SessionNode>();
  private readonly edges = new Map<string, string[]>();

  add(node: SessionNode, dependsOn: readonly string[]): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        const missing = dependsOn.filter((id) => this.nodes.get(id)?.project !== node.project);
        if (missing.length > 0) {
          throw new Error(`Unknown sessions in dependsOn: ${missing.join(", ")}`);
        }
        this.nodes.set(node.id, { ...node });
        this.edges.set(node.id, [...dependsOn]);
      }),
    );
  }

  update(id: string, patch: SessionNodePatch): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        const node = this.nodes.get(id);
        if (node === undefined) return;
        const defined = Object.fromEntries(
          Object.entries(patch).filter(([, value]) => value !== undefined),
        );
        this.nodes.set(id, { ...node, ...defined });
      }),
    );
  }

  setDependencies(id: string, dependsOn: readonly string[]): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        if (this.nodes.has(id)) this.edges.set(id, [...dependsOn]);
      }),
    );
  }

  get(id: string): Promise<SessionNodeWithDependencies | undefined> {
    return Effect.runPromise(Effect.sync(() => this.withDependencies(id)));
  }

  list(project: string): Promise<SessionNodeWithDependencies[]> {
    return Effect.runPromise(Effect.sync(() => this.listSync(project)));
  }

  ready(project: string): Promise<SessionNode[]> {
    return Effect.runPromise(
      Effect.sync(() =>
        this.listSync(project)
          .filter(
            (node) =>
              node.status === "queued" &&
              node.dependsOn.every((id) => this.nodes.get(id)?.status === "completed"),
          )
          .flatMap((node) => this.nodes.get(node.id) ?? []),
      ),
    );
  }

  sinks(project: string, round: number): Promise<string[]> {
    return Effect.runPromise(
      Effect.sync(() => {
        const tasks = this.listSync(project).filter(
          (node) => node.kind === "task" && node.round === round && node.status !== "stopped",
        );
        return tasks
          .filter((node) => !tasks.some((other) => other.dependsOn.includes(node.id)))
          .map((node) => node.id);
      }),
    );
  }

  close(): Promise<void> {
    return Effect.runPromise(Effect.void);
  }

  private listSync(project: string): SessionNodeWithDependencies[] {
    return [...this.nodes.values()]
      .filter((node) => node.project === project)
      .toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((node) =>
        Object.assign({}, node, { dependsOn: (this.edges.get(node.id) ?? []).toSorted() }),
      );
  }

  private withDependencies(id: string): SessionNodeWithDependencies | undefined {
    const node = this.nodes.get(id);
    if (node === undefined) return undefined;
    return { ...node, dependsOn: (this.edges.get(id) ?? []).toSorted() };
  }
}
