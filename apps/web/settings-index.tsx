import { useEffect, useState } from "react";
export const settingsSections = [["plan-title", "Account"], ["appearance-title", "Appearance"], ["setups-title", "Setups"], ["about-title", "About you"], ["changes-title", "Changes"]] as const;
export function currentSettingsSection(headings: { id: string; top: number }[], line: number) {
  return headings.filter(heading => heading.top <= line).at(-1)?.id ?? "plan-title";
}
export function SettingsIndex() {
  const [current, setCurrent] = useState("plan-title");
  useEffect(() => {
    const root = document.querySelector(".settings-page");
    if (!root) return;
    const headings = settingsSections.flatMap(([id]) => { const heading = document.getElementById(id); return heading ? [heading] : []; });
    const update = () => {
      if (root.scrollTop === 0) { setCurrent("plan-title"); return; }
      const bounds = root.getBoundingClientRect();
      setCurrent(currentSettingsSection(headings.map(heading => ({ id: heading.id, top: heading.getBoundingClientRect().top })), bounds.top + bounds.height * .4));
    };
    const observer = new IntersectionObserver(update, { root, rootMargin: "0px 0px -60% 0px", threshold: [0, 1] });
    headings.forEach(heading => observer.observe(heading));
    root.addEventListener("scroll", update);
    return () => { observer.disconnect(); root.removeEventListener("scroll", update); };
  }, []);
  return <nav className="settings-index" aria-label="Settings sections">{settingsSections.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={current === id ? "true" : undefined} onClick={event => {
    event.preventDefault();
    const heading = document.getElementById(id);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }}><span aria-hidden="true" />{label}</a>)}</nav>;
}
