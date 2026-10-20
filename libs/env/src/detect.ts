import { Effect } from "effect";

import type detectTypes from "./detect.types.ts";
import hostKeyChangedError from "./host-key-changed-error.ts";
import hostKeyUnknownError from "./host-key-unknown-error.ts";
import runSshModule from "./run-ssh.ts";
import setupError from "./setup-error.ts";
import type setupErrorTypes from "./setup-error.types.ts";
import type sshArgsTypes from "./ssh-args.types.ts";

const { powershell, runSsh } = runSshModule;
const { SetupError } = setupError;
const { HostKeyUnknownError } = hostKeyUnknownError;
const { HostKeyChangedError } = hostKeyChangedError;

const POSIX_PROBE = `sh -c 'echo MSA-ENV-PROBE; uname -s; uname -m; uname -o 2>/dev/null || echo -; printf "%s\\n" "$HOME" "\${TMPDIR:--}" "\${LD_PRELOAD:--}"'`;

const WINDOWS_PROBE = powershell(
  "'MSA-ENV-PROBE'; 'Windows'; [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString(); '-'; $HOME; '-'; '-'",
);

function normalizeArch(machine: string): detectTypes.RemotePlatform["arch"] {
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

function parseProbe(
  target: sshArgsTypes.SshTarget,
  output: string,
): Effect.Effect<Probe, setupErrorTypes.SetupError> {
  const lines = output.split(/\r?\n/u);
  const start = lines.indexOf("MSA-ENV-PROBE");
  if (start === -1) {
    return Effect.fail(new SetupError(`Unexpected answer from ${target.host}: ${output.trim()}`));
  }
  const [system = "", machine = "", os = "", home = "", tmp = "-", preload = "-"] = lines.slice(
    start + 1,
  );
  return Effect.succeed({ home, machine, os, preload, system, tmpdir: tmp });
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

const probeWith = (
  target: sshArgsTypes.SshTarget,
  command: string,
): Effect.Effect<Probe, detectTypes.DetectFailure> =>
  runSsh({ command, target }).pipe(Effect.flatMap((output) => parseProbe(target, output)));

const probeTarget = (
  target: sshArgsTypes.SshTarget,
): Effect.Effect<Probe, detectTypes.DetectFailure> =>
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
  target: sshArgsTypes.SshTarget,
  probe: Probe,
): Effect.Effect<detectTypes.RemotePlatform, detectTypes.DetectFailure> =>
  Effect.gen(function* () {
    const arch = normalizeArch(probe.machine);
    const { system, os, home } = probe;
    if (system === "Windows") {
      const answer = yield* runSsh({ command: "echo %OS%", target });
      const shell = answer.includes("Windows_NT") ? "cmd" : "powershell";
      return { arch, home, platform: "windows", shell, warnings: [] };
    }
    if (system === "Darwin") return { arch, home, platform: "darwin", warnings: [] };
    if (system === "Linux") {
      const android = os === "Android";
      return {
        arch,
        home,
        platform: android ? "android" : "linux",
        warnings: android ? termuxWarnings(probe) : [],
      };
    }
    return yield* new SetupError(`Unsupported remote system: ${system}`);
  });

const detectPlatformEffect = (
  target: sshArgsTypes.SshTarget,
): Effect.Effect<detectTypes.RemotePlatform, detectTypes.DetectFailure> =>
  probeTarget(target).pipe(Effect.flatMap((probe) => platformOf(target, probe)));

function detectPlatform(target: sshArgsTypes.SshTarget): Promise<detectTypes.RemotePlatform> {
  return Effect.runPromise(detectPlatformEffect(target));
}

const detect = {
  SetupError: setupError.SetupError,
  detectPlatform,
  detectPlatformEffect,
  normalizeArch,
};

export default detect;
