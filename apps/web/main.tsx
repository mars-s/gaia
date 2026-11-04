import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./styles/globals.css";
import "./style.css";

const theme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", theme.matches);
applyTheme();
theme.addEventListener("change", applyTheme);
if (window.gaiaDesktop)
  document.documentElement.dataset.desktop = window.gaiaDesktop.platform;

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
