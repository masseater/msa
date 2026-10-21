function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string } | undefined)?.code === "EPERM";
  }
}

function currentPid(): number {
  return process.pid;
}

const processAliveModule = { currentPid, processAlive };

export default processAliveModule;
