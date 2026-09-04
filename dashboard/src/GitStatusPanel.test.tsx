// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GitStatusPanel } from "./GitStatusPanel";
import { GitOperationConflictError } from "./httpDataSource";
import type { DashboardDataSource, GitMutationResult, GitStatus, RunState, ScriptsResult } from "./models";

function baseStatus(overrides: Partial<GitStatus> = {}): GitStatus {
  return {
    branch: "main",
    commit: "abc1234",
    workingTree: "clean",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

function stubDataSource(overrides: Partial<DashboardDataSource> = {}): DashboardDataSource {
  return {
    listApplications: vi.fn(async () => []),
    retryApplication: vi.fn(async () => undefined),
    getGitStatus: vi.fn(async () => baseStatus()),
    fetchGit: vi.fn(async () => baseStatus()),
    pullGit: vi.fn(async () => ({ ...baseStatus(), pulled: true }) satisfies GitMutationResult),
    listScripts: vi.fn(async () => ({ scripts: {}, checkedAt: new Date().toISOString() }) satisfies ScriptsResult),
    runScript: vi.fn(async () => new Promise<{ runId: string; startedAt: string }>(() => undefined)),
    stopScript: vi.fn(async () => undefined),
    getCurrentRun: vi.fn(async () => null as RunState | null),
    getRunReplay: vi.fn(async () => new Promise<RunState>(() => undefined)),
    subscribeToRunOutput: vi.fn(() => () => undefined),
    ...overrides,
  };
}

describe("GitStatusPanel", () => {
  it("shows a loading state then the clean branch summary", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ branch: "main", behind: 0, ahead: 0 })),
    });
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(screen.getByText("up to date")).toBeInTheDocument();
  });

  it("shows ahead/behind counts", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ ahead: 2, behind: 3 })),
    });
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    expect(await screen.findByText("↑2")).toBeInTheDocument();
    expect(screen.getByText("↓3")).toBeInTheDocument();
  });

  it("shows a no-upstream state and disables fetch", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ upstream: null, error: "no-upstream" })),
    });
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    expect(await screen.findByText("no upstream")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("disables pull when the tree is dirty", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ workingTree: "dirty", behind: 1 })),
    });
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    await screen.findByText("main");
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("disables pull when nothing is behind", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ behind: 0 })),
    });
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    await screen.findByText("main");
    expect(screen.getByRole("button", { name: "Pull" })).toBeDisabled();
  });

  it("runs fetch and shows the updated status", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ behind: 1 })),
      fetchGit: vi.fn(async () => baseStatus({ behind: 2 })),
    });
    const user = userEvent.setup();
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    await screen.findByText("↓1");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    await waitFor(() => expect(screen.getByText("↓2")).toBeInTheDocument());
    expect(dataSource.fetchGit).toHaveBeenCalledWith("app-1");
  });

  it("runs a successful pull", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ behind: 1 })),
      pullGit: vi.fn(async () => ({ ...baseStatus({ behind: 0 }), pulled: true })),
    });
    const user = userEvent.setup();
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    const pullButton = await screen.findByRole("button", { name: "Pull" });
    await waitFor(() => expect(pullButton).toBeEnabled());
    await user.click(pullButton);

    await waitFor(() => expect(screen.getByText("up to date")).toBeInTheDocument());
    expect(dataSource.pullGit).toHaveBeenCalledWith("app-1");
  });

  it("shows an inline message when a mutation is rejected as a conflict", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn(async () => baseStatus({ behind: 1 })),
      fetchGit: vi.fn(async () => {
        throw new GitOperationConflictError();
      }),
    });
    const user = userEvent.setup();
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    await screen.findByText("↓1");
    await user.click(screen.getByRole("button", { name: "Fetch" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Already running for this application.");
  });

  it("shows a retry control when the initial load fails", async () => {
    const dataSource = stubDataSource({
      getGitStatus: vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(baseStatus()),
    });
    const user = userEvent.setup();
    render(<GitStatusPanel applicationId="app-1" dataSource={dataSource} />);

    const retryButton = await screen.findByRole("button", { name: "Retry" });
    await user.click(retryButton);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
  });
});
