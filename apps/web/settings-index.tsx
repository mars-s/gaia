export const settingsSections = [["plan-title", "Account"], ["appearance-title", "Appearance"], ["setups-title", "Setups"], ["about-title", "About you"], ["changes-title", "Change history"]] as const;
export type SettingsSection = typeof settingsSections[number][0];
export function SettingsIndex({ current, onSelect }: { current: SettingsSection; onSelect(section: SettingsSection): void }) {
  return <>
    <nav className="settings-index" aria-label="Settings sections">{settingsSections.map(([id, label]) => <button className="quiet-action" key={id} aria-current={current === id ? "page" : undefined} aria-controls={id} onClick={() => onSelect(id)}>{label}</button>)}</nav>

  </>;
}
