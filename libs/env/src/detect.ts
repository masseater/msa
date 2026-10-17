import { Effect } from "effect";

import { HostKeyChangedError } from "./host-key-changed-error.ts";
import { HostKeyUnknownError } from "./host-key-unknown-error.ts";
import { powershell, runSsh, type SshFailure } from "./run-ssh.ts";
import { SetupError } from "./setup-error.ts";

export { SetupError } from "./setup-error.ts";
import type { SshTarget } from "./ssh-args.ts";

export type RemotePlatform = {
  platform: "linux" | "android" | "darwin" | "windows";
  arch: "x64" | "arm64";
  home: string;
  shell?: "cmd" | "powershell";
  warnings: string[];
};

const POSIX_PROBE = `sh -c 'echo MSA-ENV-PROBE; uname -s; uname -m; uname -o 2>/dev/null || echo -; printf "%s\\n" "$HOME" "\${TMPDIR:--}" "\${LD_PRELOAD:--}"'`;

const WINDOWS_PROBE = powershell(
  "'MSA-ENV-PROBE'; 'Windows'; [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString(); '-'; $HOME; '-'; '-'",
);

export function normalizeArch(machine: string): RemotePlatform["arch"] {
  const lower = machine.toLowerCase();
  if (lower === "x86_64" || lower === "amd64" || lower === "x64") return "x64";
  if (lower === "aarch64" || lower === "arm64") return "arm64";
  throw new Error(`Unsupported remote architecture: ${machine}`);
}

type Probe = {
  system: string;
  machine: string;
  os: string;
  home: string;
  tmpdir: string;
  preload: string;
};

export type DetectFailure = SshFailure | SetupError;

function parseProbe(target: SshTarget, output: string): Effect.Effect<Probe, SetupError> {
  const lines = output.split(/\r?\n/u);
  const start = lines.indexOf("MSA-ENV-PROBE");
  if (start === -1) {
    return Effect.fail(new SetupError(`Unexpected answer from ${target.host}: ${output.trim()}`));
  }
  const [system = "", machine = "", os = "", home = "", tmp = "-", preload = "-"] = lines.slice(
    start + 1,
  );
  return Effect.succeed({ system, machine, os, home, tmpdir: tmp, preload });
}

function termuxWarnings(probe: Probe): string[] {
  const warnings: string[] = [];
  if (probe.tmpdir === "-") {
    warnings.push("TMPDIR is not set; Termux's sshd normally sets it to $PREFIX/tmp.");
  }
  if (!probe.preload.includes("termux-exec")) {
    warnings.push(
      "termux-exec is not loaded (LD_PRELOAD); scripts with #!/usr/bin/env shebangs will fail.",
    );
  }
  warnings.push(
    "Android may suspend Termux; run termux-wake-lock on the device to keep the connection alive.",
  );
  return warnings;
}

const probeWith = (target: SshTarget, command: string): Effect.Effect<Probe, DetectFailure> =>
  runSsh({ target, command }).pipe(Effect.flatMap((output) => parseProbe(target, output)));

const probeTarget = (target: SshTarget): Effect.Effect<Probe, DetectFailure> =>
  probeWith(target, POSIX_PROBE).pipe(
    Effect.catchIf(
      (error) => !(error instanceof HostKeyUnknownError || error instanceof HostKeyChangedError),
      () => probeWith(target, WINDOWS_PROBE),
    ),
    Effect.filterOrElse(
      (probe) => !/^(MINGW|MSYS|CYGWIN)/u.test(probe.system),
      () => probeWith(target, WINDOWS_PROBE),
    ),
  );

const platformOf = (
  target: SshTarget,
  probe: Probe,
): Effect.Effect<RemotePlatform, DetectFailure> =>
  Effect.gen(function* () {
    const arch = normalizeArch(probe.machine);
    const { system, os, home } = probe;
    if (system === "Windows") {
      const answer = yield* runSsh({ target, command: "echo %OS%" });
      const shell = answer.includes("Windows_NT") ? "cmd" : "powershell";
      return { platform: "windows", arch, home, shell, warnings: [] };
    }
    if (system === "Darwin") return { platform: "darwin", arch, home, warnings: [] };
    if (system === "Linux") {
      const android = os === "Android";
      return {
        platform: android ? "android" : "linux",
        arch,
        home,
        warnings: android ? termuxWarnings(probe) : [],
      };
    }
    return yield* new SetupError(`Unsupported remote system: ${system}`);
  });

export const detectPlatformEffect = (
  target: SshTarget,
): Effect.Effect<RemotePlatform, DetectFailure> =>
  probeTarget(target).pipe(Effect.flatMap((probe) => platformOf(target, probe)));

export function detectPlatform(target: SshTarget): Promise<RemotePlatform> {
  return Effect.runPromise(detectPlatformEffect(target));
}
