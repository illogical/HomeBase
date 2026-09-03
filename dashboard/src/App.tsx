import { useRef, useState, type MouseEvent } from "react";
import type { ApplicationViewState, DashboardApplication, DashboardDataSource } from "./models";
import { useApplications } from "./useApplications";
import { GitStatusPanel } from "./GitStatusPanel";
import { ScriptRunnerCardBack } from "./ScriptRunnerCardBack";

export interface AppProps {
  readonly dataSource: DashboardDataSource;
}

const stateLabels: Readonly<Record<ApplicationViewState, string>> = {
  disabled: "Disabled",
  loading: "Loading",
  initializing: "Initializing",
  ready: "Ready",
  degraded: "Degraded",
  unavailable: "Unavailable",
  stopping: "Stopping",
};

function ScriptsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  );
}

function FlipBackIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

export function App({ dataSource }: AppProps) {
  const mainRef = useRef<HTMLElement>(null);
  const { applications, error, retry } = useApplications(dataSource);

  const focusMain = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    mainRef.current?.focus();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#applications`,
    );
  };

  return (
    <>
      <a className="skip-link" href="#applications" onClick={focusMain}>
        Skip to applications
      </a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-mark" aria-hidden="true">HB</div>
          <div>
            <div className="wordmark">HomeBase</div>
            <div className="portal-label">Application portal</div>
          </div>
        </div>
      </header>
      <main id="applications" ref={mainRef} tabIndex={-1}>
        <ApplicationCollection
          applications={applications}
          error={error}
          retry={retry}
          dataSource={dataSource}
        />
      </main>
    </>
  );
}

interface ApplicationCollectionProps {
  readonly applications: readonly DashboardApplication[] | null;
  readonly error: boolean;
  readonly retry: () => void;
  readonly dataSource: DashboardDataSource;
}

function ApplicationCollection({ applications, error, retry, dataSource }: ApplicationCollectionProps) {
  if (applications === null) {
    return <LoadingApplications />;
  }

  if (applications.length === 0) {
    return (
      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-mark" aria-hidden="true">HB</div>
        <h2 id="empty-title">{error ? "Sample applications could not be loaded" : "No sample applications"}</h2>
        <p>
          {error
            ? "The prototype data source did not return an application list."
            : "This fixture intentionally shows how HomeBase looks before applications are listed."}
        </p>
        {error ? (
          <button type="button" onClick={retry}>
            Retry loading applications
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="collection-title">
      <div className="collection-heading">
        <h2 id="collection-title">Applications</h2>
        <p>{applications.length} sample applications</p>
      </div>
      <ul className="application-grid">
        {applications.map((application) => (
          <li key={application.id}>
            <ApplicationCard application={application} dataSource={dataSource} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApplicationCard({
  application,
  dataSource,
}: {
  readonly application: DashboardApplication;
  readonly dataSource: DashboardDataSource;
}) {
  const monogram = application.displayName.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  const isReady = application.state === "ready";
  const [isFlipped, setIsFlipped] = useState(false);
  const [hasBeenFlipped, setHasBeenFlipped] = useState(false);

  const flip = (): void => {
    setIsFlipped((flipped) => !flipped);
    setHasBeenFlipped(true);
  };

  const handleCardClick = (event: MouseEvent<HTMLElement>): void => {
    if (!isReady) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input")) return;
    flip();
  };

  return (
    <div className={`card-flip-container${isReady ? " is-flippable" : ""}`}>
      <article
        className={`application-card card-flip-inner state-${application.state}${isFlipped ? " is-flipped" : ""}`}
        onClick={isReady ? handleCardClick : undefined}
      >
        <div className="card-face card-front">
          <div className="card-heading">
            {isReady ? (
              <a href={application.basePath} rel="noopener noreferrer">
                <div className="app-monogram" aria-hidden="true">{monogram}</div>
              </a>
            ) : (
              <div className="app-monogram" aria-hidden="true">{monogram}</div>
            )}
            <div className="card-heading-end">
              <span className="status-badge">
                <span className="status-dot" aria-hidden="true" />
                {stateLabels[application.state]}
              </span>
              {isReady ? (
                <button
                  type="button"
                  className="card-flip-button"
                  onClick={flip}
                  aria-label={`Show run scripts for ${application.displayName}`}
                  title="Run scripts"
                >
                  <ScriptsIcon />
                </button>
              ) : null}
            </div>
          </div>
          <div className="card-copy">
            {isReady ? (
              <a href={application.basePath} rel="noopener noreferrer">
                <h3>{application.displayName}</h3>
              </a>
            ) : (
              <h3>{application.displayName}</h3>
            )}
            <p className="description">{application.description}</p>
          </div>
          <div className="card-status">
            {application.state !== "ready" ? <p>{application.statusSummary}</p> : null}
            {isReady ? (
              <a href={application.basePath} rel="noopener noreferrer">
                <code>{application.basePath}</code>
              </a>
            ) : (
              <code>{application.basePath}</code>
            )}
          </div>
          {isReady ? (
            <div className="card-git">
              <GitStatusPanel applicationId={application.id} dataSource={dataSource} />
            </div>
          ) : null}
        </div>
        {isReady ? (
          <div className="card-face card-back">
            <div className="card-back-heading">
              <span className="card-back-hint">Scripts · {application.displayName}</span>
              <button
                type="button"
                className="card-flip-button"
                onClick={flip}
                aria-label={`Back to ${application.displayName} card`}
                title="Back"
              >
                <FlipBackIcon />
              </button>
            </div>
            <div className="card-back-body">
              {hasBeenFlipped ? (
                <ScriptRunnerCardBack applicationId={application.id} dataSource={dataSource} />
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
    </div>
  );
}

function LoadingApplications() {
  return (
    <section aria-labelledby="loading-title" aria-busy="true">
      <div className="collection-heading">
        <h2 id="loading-title">Applications</h2>
        <p role="status" aria-live="polite">Loading sample applications.</p>
      </div>
      <ul className="application-grid skeleton-grid" aria-hidden="true">
        {[0, 1, 2].map((item) => (
          <li key={item}>
            <div className="application-card skeleton-card">
              <span className="skeleton-block skeleton-icon" />
              <span className="skeleton-block skeleton-title" />
              <span className="skeleton-block skeleton-copy" />
              <span className="skeleton-block skeleton-route" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
