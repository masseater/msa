import { vi } from "vite-plus/test";

export function allowNetwork(): void {
  vi.stubEnv("MSA_OFFLINE", undefined);
}
