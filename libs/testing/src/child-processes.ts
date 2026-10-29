import { subscribe } from "node:diagnostics_channel";

type Closable = { readonly once: (event: "close", listener: () => void) => unknown };

const isClosable = (value: unknown): value is Closable =>
  typeof value === "object" &&
  value !== null &&
  "once" in value &&
  typeof value.once === "function";

const live = new Set<Closable>();

subscribe("child_process", (message) => {
  const child =
    typeof message === "object" && message !== null && "process" in message
      ? message.process
      : undefined;
  if (!isClosable(child)) return;
  live.add(child);
  child.once("close", () => {
    live.delete(child);
  });
});

const childProcessesRunning = (): boolean => live.size > 0;

const childProcesses = { childProcessesRunning };

export default childProcesses;
