import { createContext, useContext, useRef, type ReactNode } from "react";
import { Select } from "@base-ui/react/select";
import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
export const settingsSections = [["plan-title", "Account"], ["appearance-title", "Appearance"], ["setups-title", "Setups"], ["about-title", "About you"], ["changes-title", "Change history"]] as const;
export type SettingsSection = typeof settingsSections[number][0];
export function SettingsIndex({ current, onSelect }: { current: SettingsSection; onSelect(section: SettingsSection): void }) {
  return <>
    <nav className="settings-index" aria-label="Settings sections">{settingsSections.map(([id, label]) => <button className="quiet-action" key={id} aria-current={current === id ? "page" : undefined} aria-controls={id} onClick={() => onSelect(id)}>{label}</button>)}</nav>

  </>;
}

export const SettingsNavigation = createContext<(section: SettingsSection) => void>(() => {});
export function SettingsHeading({ id, children }: { id: SettingsSection; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const onSelect = useContext(SettingsNavigation);
  const label = settingsSections.find(([key]) => key === id)?.[1];
  return <h2 ref={heading} tabIndex={-1} id={id} className="settings-pane-heading">
    <span>{children}</span>
    <Select.Root value={id} onValueChange={value => {
      const section = settingsSections.find(([key]) => key === value);
      if (section) onSelect(section[0]);
    }}>
      <Select.Trigger render={props => <button {...props} role="button" />} aria-label={`Settings section: ${label}`} aria-haspopup="listbox" className="quiet-action settings-section-trigger"><RiArrowDownSLine className="size-4" aria-hidden /></Select.Trigger>
      <Select.Portal><Select.Positioner anchor={heading} sideOffset={4} align="start" alignItemWithTrigger={false} className="z-50">
        <Select.Popup className="settings-section-menu" aria-label="Settings section">
          <Select.List>{settingsSections.map(([key, name]) => <Select.Item key={key} value={key} className="settings-section-option"><Select.ItemText>{name}</Select.ItemText><Select.ItemIndicator><RiCheckLine className="size-4" aria-hidden /></Select.ItemIndicator></Select.Item>)}</Select.List>
        </Select.Popup>
      </Select.Positioner></Select.Portal>
    </Select.Root>
  </h2>;
}
