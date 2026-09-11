/* Work OS shared chat language — public module.
 *
 * The implementation lives in ./chat/*; this file keeps the historical
 * import surface (`./WorkOsChat`) stable for the dock, the floating
 * companion, and the tests. One interaction, two delivery surfaces.
 */

export { ChatTabs } from "./chat/ChatTabs";
export { ChatComposer as WorkOsPromptBar } from "./chat/ChatComposer";
export { ChatSection, StreamingText } from "./chat/StreamingText";
export { ChatTurn, type ChatTurnRole } from "./chat/ChatTurn";
export { GlideMenu, type GlideRow } from "./chat/GlideMenu";
export {
  WORK_OS_CHAT_SOURCES,
  workOsChatCommands,
  parseChatToken,
  isWideDraft,
  collapseConsecutiveAssistantDuplicates,
  type ChatTab,
  type ChatToken,
  type WorkOsChatSource,
  type WorkOsChatCommand,
  type CollapsibleTurn,
} from "./chat/core";
