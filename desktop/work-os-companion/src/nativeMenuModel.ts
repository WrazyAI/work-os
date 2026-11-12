import type { AppMenuGroup } from "./AppMenuBar";

/** The macOS menu bar mirrors the in-window menu. Ids are positional, so a
 * click maps back to the exact action without the native side knowing how
 * routing works. */
export const NATIVE_MENU_EVENT = "work-os:menu-select";

export type NativeMenuItem = {
  id: string;
  label: string;
  accelerator?: string;
  checked: boolean;
  enabled: boolean;
};

export type NativeMenuGroup = { label: string; items: NativeMenuItem[] };

export function nativeMenuModel(groups: AppMenuGroup[]): { groups: NativeMenuGroup[]; actions: Map<string, () => void> } {
  const actions = new Map<string, () => void>();
  const native: NativeMenuGroup[] = [];
  groups.forEach((group, groupIndex) => {
    if (!group.label || group.items.length === 0) return;
    native.push({
      label: group.label,
      items: group.items.map((item, itemIndex) => {
        // Position is only a fallback: a rebuild while the menu is open must
        // never turn a click into a different destination.
        const id = `menu:${item.id ?? `${groupIndex}:${itemIndex}`}`;
        if (item.onSelect && item.disabled !== true) actions.set(id, item.onSelect);
        return {
          id,
          label: item.label,
          ...(item.accelerator ? { accelerator: item.accelerator } : {}),
          checked: item.checked === true,
          enabled: item.disabled !== true,
        };
      }),
    });
  });
  return { groups: native, actions };
}
