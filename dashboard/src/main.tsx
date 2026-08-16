import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createFixtureDataSource } from "./fixtures";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Dashboard root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App dataSource={createFixtureDataSource(window.location.search)} />
  </StrictMode>,
);
