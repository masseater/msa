const queue: (() => void)[] = [];
let held = 0;
let draining = false;

export function enqueue(task: () => void): void {
  queue.push(task);
  drain();
}

export function holdPublications<T>(fn: () => T): T {
  held++;
  try {
    return fn();
  } finally {
    held--;
    drain();
  }
}

function drain(): void {
  if (draining || held > 0) return;
  draining = true;
  try {
    for (let task = queue.shift(); task !== undefined; task = queue.shift()) task();
  } finally {
    draining = false;
  }
}
