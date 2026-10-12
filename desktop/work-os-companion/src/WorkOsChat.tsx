/* Work OS shared chat language — public module.
 *
 * The implementation lives in ./chat/*; this file keeps the historical
 * import surface (`./WorkOsChat`) stable for the dock, the floating
 * companion, and the tests. One interaction, two delivery surfaces.
 */

export { ChatTabs } from "./chat/ChatTabs";
export { ChatComposer as WorkOsPromptBar } from "./chat/ChatComposer";
export { ChatWelcome, firstNameFromDisplayName, getChatWelcomeCopy, type ChatWelcomeMode } from "./chat/ChatWelcome";
export { ConversationLauncher, type ConversationLauncherMode } from "./chat/ConversationLauncher";
export { ChatSection, StreamingText } from "./chat/StreamingText";
export { ChatTurn, ChatTimeDivider, type ChatTurnRole } from "./chat/ChatTurn";
export { CHAT_DIVIDER_GAP_MS, shouldShowChatDivider } from "./chat/timeNotes";
export { ConversationSurface, type ConversationSurfaceKind } from "./chat/ConversationSurface";
export { GlideMenu, type GlideRow } from "./chat/GlideMenu";
export {
  WORK_OS_CHAT_SOURCES,
  workOsChatCommands,
  parseChatToken,
  isThreadNearBottom,
  threadScrollTarget,
  type ThreadScrollInput,
  isWideDraft,
  collapseConsecutiveAssistantDuplicates,
  type ChatTab,
  type ChatToken,
  type WorkOsChatSource,
  type WorkOsChatCommand,
  type CollapsibleTurn,
} from "./chat/core";
