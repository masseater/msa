import type {
  SessionGraph,
  SessionNode,
  SessionNodePatch,
  SessionNodeWithDependencies,
} from "../src/core/orchestrator/graph.ts";

/** {@link SessionGraph} in memory, held to the same contract as the Neo4j graph. */
export class MemorySessionGraph implements SessionGraph {
  private readonly nodes = new Map<string, SessionNode>();
  private readonly edges = new Map<string, string[]>();

  async add(node: SessionNode, dependsOn: readonly string[]): Promise<void> {
    const missing = dependsOn.filter((id) => this.nodes.get(id)?.project !== node.project);
    if (missing.length > 0) {
      throw new Error(`Unknown sessions in dependsOn: ${missing.join(", ")}`);
    }
    this.nodes.set(node.id, { ...node });
    this.edges.set(node.id, [...dependsOn]);
  }

  async update(id: string, patch: SessionNodePatch): Promise<void> {
    const node = this.nodes.get(id);
    if (!node) return;
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    this.nodes.set(id, { ...node, ...defined });
  }

  async setDependencies(id: string, dependsOn: readonly string[]): Promise<void> {
    if (this.nodes.has(id)) this.edges.set(id, [...dependsOn]);
  }

  async get(id: string): Promise<SessionNodeWithDependencies | undefined> {
    const node = this.nodes.get(id);
    return node ? { ...node, dependsOn: (this.edges.get(id) ?? []).toSorted() } : undefined;
  }

  async list(project: string): Promise<SessionNodeWithDependencies[]> {
    return [...this.nodes.values()]
      .filter((node) => node.project === project)
      .toSorted((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((node) => ({ ...node, dependsOn: (this.edges.get(node.id) ?? []).toSorted() }));
  }

  async ready(project: string): Promise<SessionNode[]> {
    return (await this.list(project))
      .filter(
        (node) =>
          node.status === "queued" &&
          node.dependsOn.every((id) => this.nodes.get(id)?.status === "completed"),
      )
      .flatMap((node) => this.nodes.get(node.id) ?? []);
  }

  async sinks(project: string, round: number): Promise<string[]> {
    const tasks = (await this.list(project)).filter(
      (node) => node.kind === "task" && node.round === round && node.status !== "stopped",
    );
    return tasks
      .filter((node) => !tasks.some((other) => other.dependsOn.includes(node.id)))
      .map((node) => node.id);
  }

  async close(): Promise<void> {}
}
