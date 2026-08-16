import { ConfigurationError } from "./config/ConfigurationError.js";
import { startServer } from "./startServer.js";

try {
  const { configService } = await startServer();
  console.log(`HomeBase is listening on port ${configService.server.port}.`);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else {
    console.error("HomeBase failed to start.", error);
  }
  process.exitCode = 1;
}
