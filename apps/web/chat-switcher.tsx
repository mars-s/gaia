import { Menu } from "@base-ui/react/menu";
import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
import type { Experience } from "../../packages/protocol/experiences";

type Props = {
  profiles: Experience[];
  error?: string;
  currentId: Experience["id"] | null;
  mainId: Experience["id"] | null;
  onSelect(id: Experience["id"] | null): void;
};

export function ChatSwitcher({
  profiles,
  currentId,
  mainId,
  onSelect,
  error,
}: Props) {
  const ready = profiles.filter((profile) => profile.kind === "ready");
  if (!ready.length)
    return <span className="text-body-medium">Original chat</span>;
  const rows = [
    { id: null, name: "Original chat" },
    ...ready.map((profile) => ({ id: profile.id, name: profile.plan.title })),
  ];
  return (
    <Menu.Root>
      <Menu.Trigger
        className="app-control chat-switcher-trigger text-body-medium"
        aria-label="Switch chat"
      >
        <span className="truncate">
          {rows.find((row) => row.id === currentId)?.name ?? "Original chat"}
        </span>
        <RiArrowDownSLine className="size-4 shrink-0" aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="start" className="z-50">
          <Menu.Popup className="chat-switcher-menu" aria-label="Switch chat">
            <Menu.RadioGroup value={currentId ?? "original"}>
              {rows.map((row) => (
                <Menu.RadioItem
                  key={row.id ?? "original"}
                  value={row.id ?? "original"}
                  className="chat-switcher-row text-body-regular"
                  onClick={() => onSelect(row.id)}
                >
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.id === mainId && (
                    <span className="chat-main-label text-body-2-regular">
                      Main
                    </span>
                  )}
                  <span className="size-4 shrink-0">
                    <Menu.RadioItemIndicator>
                      <RiCheckLine className="size-4" aria-hidden />
                    </Menu.RadioItemIndicator>
                  </span>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            {error && <p role="alert">{error}</p>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
