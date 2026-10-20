import { NodeServices } from "@effect/platform-node";
import env from "@msa/ai/utils/env";
import type { ExtensionAPI } from "@msa/coding-agent";
import { Effect, ManagedRuntime } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const { readProcessEnv } = env;

const runtime = ManagedRuntime.make(NodeServices.layer);

function windowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
  ].join("; ");
}

function notifyOSC777(title: string, body: string): void {
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function notifyOSC99(title: string, body: string): void {
  process.stdout.write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
  process.stdout.write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
}

function notifyWindows(title: string, body: string): void {
  runtime.runFork(
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const handle = yield* spawner.spawn(
          ChildProcess.make("powershell.exe", [
            "-NoProfile",
            "-Command",
            windowsToastScript(title, body),
          ]),
        );
        yield* handle.exitCode;
      }),
    ).pipe(Effect.ignore),
  );
}

function notify(title: string, body: string): void {
  if ((readProcessEnv("WT_SESSION") ?? "").length > 0) {
    notifyWindows(title, body);
  } else if ((readProcessEnv("KITTY_WINDOW_ID") ?? "").length > 0) {
    notifyOSC99(title, body);
  } else {
    notifyOSC777(title, body);
  }
}

export default function (msa: ExtensionAPI) {
  msa.on("agent_settled", () => {
    notify("msa", "Ready for input");
  });
}
