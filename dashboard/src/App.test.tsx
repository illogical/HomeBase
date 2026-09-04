// @vitest-environment jsdom

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { FixtureDashboardDataSource } from "./fixtures";
import type {
  DashboardApplication,
  DashboardDataSource,
  GitMutationResult,
  GitStatus,
  RunStarted,
  RunState,
  ScriptsResult,
} from "./models";

function neverGitStatus(): Promise<GitStatus> {
  return new Promise<GitStatus>(() => undefined);
}

function neverGitMutation(): Promise<GitMutationResult> {
  return new Promise<GitMutationResult>(() => undefined);
}

function neverScripts(): Promise<ScriptsResult> {
  return new Promise<ScriptsResult>(() => undefined);
}

function neverRunStarted(): Promise<RunStarted> {
  return new Promise<RunStarted>(() => undefined);
}

function neverVoid(): Promise<void> {
  return new Promise<void>(() => undefined);
}

function neverCurrentRun(): Promise<RunState | null> {
  return new Promise<RunState | null>(() => undefined);
}

function neverRunReplay(): Promise<RunState> {
  return new Promise<RunState>(() => undefined);
}

function noopSubscribeToRunOutput(): () => void {
  return () => undefined;
}

const scriptStubs = {
  listScripts: neverScripts,
  runScript: neverRunStarted,
  stopScript: neverVoid,
  getCurrentRun: neverCurrentRun,
  getRunReplay: neverRunReplay,
  subscribeToRunOutput: noopSubscribeToRunOutput,
} satisfies Pick<
  DashboardDataSource,
  "listScripts" | "runScript" | "stopScript" | "getCurrentRun" | "getRunReplay" | "subscribeToRunOutput"
>;

describe("dashboard application", () => {
  it("renders the semantic mixed fixture without launch controls", async () => {
    render(<App dataSource={new FixtureDashboardDataSource("mixed")} />);

    const list = await screen.findByRole("list");
    const cards = within(list).getAllByRole("article");
    expect(cards).toHaveLength(4);

    const expectations = [
      ["DevPlanner", "Ready", "/devplanner/"],
      ["LMApi", "Degraded", "/lmapi/"],
      ["MemoryApi", "Disabled", "/memoryapi/"],
      ["LMEval", "Unavailable", "/lmeval/"],
    ] as const;

    for (const [name, state, route] of expectations) {
      const card = screen.getByRole("heading", { level: 3, name }).closest("article");
      expect(card).not.toBeNull();
      const scoped = within(card as HTMLElement);
      expect(scoped.getByText(state)).toBeInTheDocument();
      expect(scoped.getByText(route)).toBeInTheDocument();
      if (state === "Ready") {
        expect(scoped.getByRole("link", { name: `Open ${name}` })).toBeInTheDocument();
        expect(scoped.getByRole("link", { name })).toBeInTheDocument();
        expect(scoped.getByRole("link", { name: route })).toBeInTheDocument();
        // The ready card renders a GitStatusPanel with Refresh/Fetch/Pull controls.
        await waitFor(() => expect(scoped.queryAllByRole("button").length).toBeGreaterThan(0));
      } else if (state === "Unavailable") {
        expect(scoped.queryByRole("link")).not.toBeInTheDocument();
        expect(scoped.getByRole("button", { name: `Retry loading ${name}` })).toBeInTheDocument();
      } else {
        expect(scoped.queryByRole("link")).not.toBeInTheDocument();
        expect(scoped.queryByRole("button")).not.toBeInTheDocument();
      }
    }
  });

  it("renders an accessible stable loading presentation", () => {
    const { container } = render(<App dataSource={new FixtureDashboardDataSource("loading")} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading applications.");
    expect(screen.getByRole("heading", { level: 2, name: "Applications" }).closest("section")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".skeleton-grid")).toHaveAttribute("aria-hidden", "true");
  });

  it("renders the calm empty fixture", async () => {
    render(<App dataSource={new FixtureDashboardDataSource("empty")} />);

    expect(await screen.findByRole("heading", { level: 2, name: "No applications" })).toBeInTheDocument();
    expect(screen.getByText(/intentionally shows how HomeBase looks/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("aborts the data source when the app unmounts", () => {
    let receivedSignal: AbortSignal | undefined;
    const dataSource: DashboardDataSource = {
      listApplications(signal) {
        receivedSignal = signal;
        return new Promise<readonly DashboardApplication[]>(() => undefined);
      },
      retryApplication: neverVoid,
      getGitStatus: neverGitStatus,
      fetchGit: neverGitStatus,
      pullGit: neverGitMutation,
      ...scriptStubs,
    };
    const { unmount } = render(<App dataSource={dataSource} />);

    expect(receivedSignal?.aborted).toBe(false);
    unmount();
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("makes the skip link first in keyboard order and moves focus to main", async () => {
    const user = userEvent.setup();
    render(<App dataSource={new FixtureDashboardDataSource("mixed")} />);

    await user.tab();
    const skipLink = screen.getByRole("link", { name: "Skip to applications" });
    expect(skipLink).toHaveFocus();
    await user.click(skipLink);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it.each(["mixed", "loading", "empty"] as const)(
    "has no automated accessibility violations in the %s fixture",
    async (scenario) => {
      const { container } = render(<App dataSource={new FixtureDashboardDataSource(scenario)} />);
      if (scenario !== "loading") {
        await waitFor(() => {
          expect(screen.queryByRole("status")).not.toBeInTheDocument();
        });
      }

      const result = await axe.run(container);
      expect(result.violations).toEqual([]);
    },
  );

  it("has no automated accessibility violations in the failure/retry state", async () => {
    const dataSource: DashboardDataSource = {
      listApplications: vi.fn(async () => Promise.reject(new Error("fixture failure"))),
      retryApplication: neverVoid,
      getGitStatus: neverGitStatus,
      fetchGit: neverGitStatus,
      pullGit: neverGitMutation,
      ...scriptStubs,
    };
    const { container } = render(<App dataSource={dataSource} />);
    await screen.findByRole("button", { name: "Retry loading applications" });

    const result = await axe.run(container);
    expect(result.violations).toEqual([]);
  });

  it("shows a quiet empty-state failure with a keyboard-operable retry control for unexpected data-source errors", async () => {
    const dataSource: DashboardDataSource = {
      listApplications: vi
        .fn()
        .mockRejectedValueOnce(new Error("fixture failure"))
        .mockResolvedValueOnce(
          await new FixtureDashboardDataSource("mixed").listApplications(),
        ),
      retryApplication: neverVoid,
      getGitStatus: neverGitStatus,
      fetchGit: neverGitStatus,
      pullGit: neverGitMutation,
      ...scriptStubs,
    };
    const user = userEvent.setup();
    render(<App dataSource={dataSource} />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Applications could not be loaded" }),
    ).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Retry loading applications" });

    await user.tab();
    await user.tab();
    expect(retryButton).toHaveFocus();

    await user.click(retryButton);

    expect(await screen.findByRole("heading", { level: 3, name: "DevPlanner" })).toBeInTheDocument();
    expect(dataSource.listApplications).toHaveBeenCalledTimes(2);
  });

  it("retries an unavailable application and follows it through to ready", { timeout: 8000 }, async () => {
    const user = userEvent.setup();
    const dataSource = new FixtureDashboardDataSource("mixed");
    render(<App dataSource={dataSource} />);

    const card = (await screen.findByRole("heading", { level: 3, name: "LMEval" })).closest("article") as HTMLElement;
    const scoped = within(card);
    expect(scoped.getByText("Unavailable")).toBeInTheDocument();

    await user.click(scoped.getByRole("button", { name: "Retry loading LMEval" }));

    await waitFor(() => expect(within(card).getByText("Loading")).toBeInTheDocument());
    await waitFor(() => expect(within(card).getByText("Ready")).toBeInTheDocument(), {
      timeout: 4000,
    });
  });

  it(
    "polls for updates while an application is loading, then stops once it becomes ready",
    async () => {
      const loadingApp: DashboardApplication = {
        id: "slow-app",
        displayName: "Slow App",
        description: "A sibling application that is still starting up.",
        basePath: "/slow-app/",
        state: "loading",
        statusSummary: "Installing dependencies.",
      };
      const readyApp: DashboardApplication = { ...loadingApp, state: "ready", statusSummary: "Ready." };
      const listApplications = vi
        .fn()
        .mockResolvedValueOnce([loadingApp])
        .mockResolvedValueOnce([readyApp]);
      const dataSource: DashboardDataSource = {
        listApplications,
        retryApplication: neverVoid,
        getGitStatus: neverGitStatus,
        fetchGit: neverGitStatus,
        pullGit: neverGitMutation,
        ...scriptStubs,
      };

      render(<App dataSource={dataSource} />);

      await screen.findByText("Loading");
      await waitFor(() => expect(listApplications).toHaveBeenCalledTimes(2), { timeout: 3000 });
      await screen.findByText("Ready");

      await new Promise((resolve) => setTimeout(resolve, 2200));
      expect(listApplications).toHaveBeenCalledTimes(2);
    },
    8000,
  );
});
