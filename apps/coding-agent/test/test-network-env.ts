import { vi } from "vite-plus/test";

function allowNetwork(): void {
  vi.stubEnv("MSA_OFFLINE", undefined);
}

const testNetworkEnv = {
  allowNetwork,
};

export default testNetworkEnv;
