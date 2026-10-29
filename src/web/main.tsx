import "@mylder/perron/perron.css";
import "./styles.css";
import { PerronProvider } from "@mylder/perron";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PerronProvider>
      <App />
    </PerronProvider>
  </StrictMode>,
);
