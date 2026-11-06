import { Select, SelectItem } from "./components/base/select/select";
export const settingsSections = [["plan-title", "Account"], ["appearance-title", "Appearance"], ["setups-title", "Setups"], ["about-title", "About you"], ["changes-title", "Change history"]] as const;
export type SettingsSection = typeof settingsSections[number][0];
export function SettingsIndex({ current, onSelect }: { current: SettingsSection; onSelect(section: SettingsSection): void }) {
  return <>
    <nav className="settings-index" aria-label="Settings sections">{settingsSections.map(([id, label]) => <button key={id} aria-current={current === id ? "page" : undefined} aria-controls={id} onClick={() => onSelect(id)}>{label}</button>)}</nav>
    <div className="settings-picker"><Select aria-label="Settings section" selectedKey={current} triggerClassName="w-full" onSelectionChange={key => {
      const section = settingsSections.find(([id]) => id === key);
      if (section) onSelect(section[0]);
    }}>{settingsSections.map(([id, label]) => <SelectItem key={id} id={id} textValue={label}>{label}</SelectItem>)}</Select></div>
  </>;
}
