import { ConfigurationError } from "./config/ConfigurationError.js";
import { DashboardInitializationError } from "./dashboardHost.js";
import { startServer } from "./startServer.js";
import { registerShutdownSignals } from "./shutdownSignals.js";

try {
  const started = await startServer({ mode: "development" });
  console.log(`HomeBase development server is listening on port ${started.configService.server.port}.`);
  registerShutdownSignals(started.close);
} catch (error) {
  if (error instanceof ConfigurationError || error instanceof DashboardInitializationError) {
    console.error(error.message);
  } else {
    console.error("HomeBase failed to start.", error);
  }
  process.exitCode = 1;
}
