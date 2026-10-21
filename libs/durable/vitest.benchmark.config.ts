import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    benchmark: {
      include: ["test/**/*.bench.ts"],
      reporters: ["verbose"],
    },
    environment: "node",
  },
});
