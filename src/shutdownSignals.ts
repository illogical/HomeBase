const SIGNALS = ["SIGTERM", "SIGINT"] as const;

export function registerShutdownSignals(close: () => Promise<void>): void {
  let handled = false;
  const handle = (signal: NodeJS.Signals): void => {
    if (handled) return;
    handled = true;
    for (const registeredSignal of SIGNALS) {
      process.off(registeredSignal, handle);
    }
    close()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        console.error(`HomeBase failed to shut down cleanly after ${signal}.`, error);
        process.exit(1);
      });
  };

  for (const signal of SIGNALS) {
    process.on(signal, handle);
  }
}
