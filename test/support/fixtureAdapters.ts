import { fileURLToPath } from "node:url";
import type { RegistryApplication } from "../../src/config/models.js";

export const fixtureAdaptersWorkspaceRoot = fileURLToPath(new URL("../fixtures", import.meta.url));

export type FixtureAdapterName =
  | "routes"
  | "static-assets"
  | "spa-fallback"
  | "websocket"
  | "socket-io"
  | "degraded"
  | "failing"
  | "active-work"
  | "cleanup"
  | "bad-contract-version"
  | "throws-on-import"
  | "no-default-export"
  | "throwing-status"
  | "hanging-dispose";

export function fixtureApplication(
  id: string,
  adapterName: FixtureAdapterName,
  overrides: Partial<RegistryApplication> = {},
): RegistryApplication {
  return {
    id,
    displayName: overrides.displayName ?? id,
    description: overrides.description ?? `Fixture application backed by the ${adapterName} adapter.`,
    slug: overrides.slug ?? id,
    enabled: overrides.enabled ?? true,
    repoPath: `adapters/${adapterName}`,
    adapterPath: "index.ts",
    contractVersion: 1,
    ...overrides,
  };
}
