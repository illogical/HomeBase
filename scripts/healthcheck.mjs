import { get } from "node:http";

const port = process.env.HOMEBASE_PORT ?? "17106";

const request = get({ host: "127.0.0.1", port, path: "/health", timeout: 2000 }, (response) => {
  process.exit(response.statusCode === 200 ? 0 : 1);
});

request.on("timeout", () => {
  request.destroy();
  process.exit(1);
});

request.on("error", () => {
  process.exit(1);
});
