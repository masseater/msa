

import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { ExtensionAPI } from "@msa/coding-agent";

const execAsync = promisify(exec);

async function isDarkMode(): Promise<boolean> {
  try {
    const { stdout } = await execAsync(
      "osascript -e 'tell application \"System Events\" to tell appearance preferences to return dark mode'",
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export default function (msa: ExtensionAPI) {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  msa.on("session_start", async (_event, ctx) => {
    let currentTheme = (await isDarkMode()) ? "dark" : "light";
    ctx.ui.setTheme(currentTheme);

    intervalId = setInterval(async () => {
      const newTheme = (await isDarkMode()) ? "dark" : "light";
      if (newTheme !== currentTheme) {
        currentTheme = newTheme;
        ctx.ui.setTheme(currentTheme);
      }
    }, 2000);
  });

  msa.on("session_shutdown", () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
}
