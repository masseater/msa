import type { Task } from "./types.ts";

function pathKeys(task: Task): string[] {
  return [
    ...task.paths.map((path) => `path:${path}`),
    ...task.repos.map((repo) => `repo:${repo}`),
  ];
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  return left.some((key) => right.some((other) => key === other || key.startsWith(`${other}/`)));
}

function conflicts(left: readonly string[], right: readonly string[]): boolean {
  return overlaps(left, right) || overlaps(right, left);
}

function clusterByPaths(tasks: readonly Task[]): Task[][] {
  const clusters: Task[][] = [];
  for (const task of tasks) {
    const keys = pathKeys(task);
    if (keys.length === 0) {
      clusters.push([task]);
      continue;
    }
    const matching = clusters.filter((cluster) =>
      conflicts(
        keys,
        cluster.flatMap((member) => pathKeys(member)),
      ),
    );
    if (matching.length === 0) {
      clusters.push([task]);
      continue;
    }
    const merged = [task, ...matching.flat()];
    for (const cluster of matching) clusters.splice(clusters.indexOf(cluster), 1);
    clusters.push(merged);
  }
  return clusters.toSorted((left, right) => {
    const priority = Math.max(...right.map((task) => task.priority)) -
      Math.max(...left.map((task) => task.priority));
    return priority === 0 ? left[0]!.createdAt - right[0]!.createdAt : priority;
  });
}

function occupiedKeys(tasks: readonly Task[]): string[] {
  return tasks.flatMap(pathKeys);
}

function blockedByPaths(task: Task, runningKeys: readonly string[]): boolean {
  const keys = pathKeys(task);
  return keys.length > 0 && conflicts(keys, runningKeys);
}

export const scheduler = { pathKeys, conflicts, clusterByPaths, occupiedKeys, blockedByPaths };
