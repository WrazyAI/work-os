import type { SidebarChat } from "./SidebarNav";

/** Stable fixture content used only by visual preview shells. Production passes
 * real conversation-derived rows instead of inventing history. */
export const SIDEBAR_PREVIEW_CHATS: SidebarChat[] = [
  { id: "supplier-records", label: "Supplier records" },
  { id: "workload-summary", label: "Workload summary" },
  { id: "release-review", label: "Desktop release review" },
];
