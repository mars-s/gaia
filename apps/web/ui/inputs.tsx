import type { ComponentProps } from "react";
import { Input } from "@base-ui/react/input";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Select } from "@base-ui/react/select";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { RiCheckLine } from "@remixicon/react";
import { usePreviewState } from "./preview";

/** A token-themed Base UI text field. @example <TextField aria-label="Task" /> */
export function TextField(props: ComponentProps<typeof Input>) {
  const state = usePreviewState(undefined);
  return <Input className="ui-text-field" data-ui="text-field" data-preview-state={state} {...props} />;
}

/** A token-themed Base UI checkbox. @example <Checkbox aria-label="Complete task" /> */
export function Checkbox(props: ComponentProps<typeof BaseCheckbox.Root>) {
  const state = usePreviewState(undefined);
  return <BaseCheckbox.Root className="ui-checkbox" data-ui="checkbox" data-preview-state={state} {...props}><BaseCheckbox.Indicator><RiCheckLine className="size-4" aria-hidden /></BaseCheckbox.Indicator></BaseCheckbox.Root>;
}
function MenuPopup(props: ComponentProps<typeof BaseMenu.Popup>) {
  const state = usePreviewState(undefined);
  return <BaseMenu.Popup className="settings-section-menu" data-ui="menu" data-preview-state={state} {...props} />;
}
/** Base UI menu parts with a themed popup. @example <Menu.Root><Menu.Trigger>Open</Menu.Trigger></Menu.Root> */
export const Menu = { ...BaseMenu, Popup: MenuPopup };
function ListboxPopup(props: ComponentProps<typeof Select.Popup>) {
  const state = usePreviewState(undefined);
  return <Select.Popup className="settings-section-menu" data-ui="listbox" data-preview-state={state} {...props} />;
}
/** Base UI select parts for a themed listbox. @example <Listbox.Root><Listbox.Trigger>Choose</Listbox.Trigger></Listbox.Root> */
export const Listbox = { ...Select, Popup: ListboxPopup };
function TooltipPopup(props: ComponentProps<typeof BaseTooltip.Popup>) {
  const state = usePreviewState(undefined);
  return <BaseTooltip.Popup className="ui-tooltip" data-ui="tooltip" data-preview-state={state} {...props} />;
}
/** Base UI tooltip parts with a themed popup. @example <Tooltip.Root><Tooltip.Trigger>Help</Tooltip.Trigger></Tooltip.Root> */
export const Tooltip = { ...BaseTooltip, Popup: TooltipPopup };
