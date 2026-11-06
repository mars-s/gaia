import { useState } from "react";
import { z } from "zod";
import { Select, SelectItem } from "@/components/base/select/select";

const Appearance = z.enum(["system", "light", "dark"]);
type Appearance = z.infer<typeof Appearance>;
let preference: Appearance = "system";
const storageKey = "gaia.appearance";

function applyAppearance() {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function initialiseAppearance() {
  try {
    preference = Appearance.catch("system").parse(
      localStorage.getItem(storageKey),
    );
  } catch {
    preference = "system";
  }
  applyAppearance();
  const theme = window.matchMedia("(prefers-color-scheme: dark)");
  theme.addEventListener("change", applyAppearance);
  return () => theme.removeEventListener("change", applyAppearance);
}

export function AppearancePicker() {
  const [value, setValue] = useState(preference);
  return (
    <div className="appearance-picker"><label id="theme-label">Theme</label>
    <Select
      aria-labelledby="theme-label"
      selectedKey={value}
      className="w-full gap-2"
      triggerClassName="w-full"
      onSelectionChange={(key) => {
        const next = Appearance.safeParse(key);
        if (!next.success) return;
        preference = next.data;
        setValue(next.data);
        try {
          localStorage.setItem(storageKey, next.data);
        } catch {
          /* The current window still uses the chosen appearance. */
        }
        applyAppearance();
      }}
    >
      <SelectItem id="system" textValue="System">
        System
      </SelectItem>
      <SelectItem id="light" textValue="Light">
        Light
      </SelectItem>
      <SelectItem id="dark" textValue="Dark">
        Dark
      </SelectItem>
    </Select></div>
  );
}
