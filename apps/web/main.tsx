import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { initialiseAppearance } from "./appearance";
import "./styles/globals.css";
import "./style.css";

initialiseAppearance();
if (window.gaiaDesktop)
  document.documentElement.dataset.desktop = window.gaiaDesktop.platform;

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
