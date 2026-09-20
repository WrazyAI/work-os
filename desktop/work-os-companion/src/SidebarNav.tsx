import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import wordmark from "./assets/work-os-mark.png";

export type SidebarView = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";

export type SidebarStatusTone = "live" | "observed" | "paused" | "idle" | "offline" | "loading";

export type SidebarStatus = {
  label: string;
  detail: string;
  tone: SidebarStatusTone;
};

export type SidebarChat = {
  id: string;
  label: string;
  active?: boolean;
};

export type SidebarNavProps = {
  activeView: SidebarView;
  onNavigate: (view: SidebarView) => void;
  onNewChat: () => void;
  onSelectChat?: (id: string) => void;
  onSignOut?: () => void;
  reviewCount?: number;
  evidenceEnabled?: boolean;
  status: SidebarStatus;
  chats?: SidebarChat[];
  initiallyCollapsed?: boolean;
};

type Destination = {
  id: SidebarView;
  label: string;
  icon: LucideIcon;
};

const DESTINATIONS: Destination[] = [
  { id: "day", label: "My Day", icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "EOD Review", icon: MessageSquareText },
  { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

const PRIMARY_DESTINATION_IDS = new Set<SidebarView>(["day", "tasks", "review"]);
const CONTEXT_DESTINATION_IDS = new Set<SidebarView>(["insights", "evidence"]);

const menuWidth = 228;

function statusClass(tone: SidebarStatusTone) {
  return tone === "live" ? "live" : tone === "observed" ? "observed" : tone === "paused" ? "paused" : tone === "loading" ? "loading" : tone === "offline" ? "offline" : "idle";
}

function SidebarGlideGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [highlight, setHighlight] = useState({ visible: false, top: 0, height: 0 });

  const moveHighlight = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>("[data-sidebar-row]");
    const group = groupRef.current;
    if (!row || !group) return;
    const groupRect = group.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setHighlight({ visible: true, top: rowRect.top - groupRect.top, height: rowRect.height });
  };

  return (
    <div
      ref={groupRef}
      className={`sidebar-glide-group ${className}`}
      onPointerMove={(event) => moveHighlight(event.target)}
      onFocusCapture={(event) => moveHighlight(event.target)}
      onPointerLeave={() => setHighlight((current) => ({ ...current, visible: false }))}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHighlight((current) => ({ ...current, visible: false }));
        }
      }}
    >
      <span
        aria-hidden="true"
        className={`sidebar-glide-highlight${highlight.visible ? " is-visible" : ""}`}
        style={{ transform: `translateY(${highlight.top}px)`, height: highlight.height }}
      />
      {children}
    </div>
  );
}

function SidebarRow({
  icon: Icon,
  label,
  active = false,
  badge,
  onClick,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-sidebar-row
      data-label={label}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`sidebar-row ${active ? "active" : ""} ${className}`}
      onClick={onClick}
    >
      <span className="sidebar-row-icon"><Icon size={18} strokeWidth={1.85} /></span>
      <span className="sidebar-row-copy">{label}</span>
      {badge !== undefined && badge > 0 && <span className="sidebar-row-badge">{badge > 99 ? "99+" : badge}</span>}
    </button>
  );
}

function WorkspaceMenu({
  anchor,
  onClose,
  onSettings,
  onSignOut,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onSettings: () => void;
  onSignOut?: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => {
    const rect = anchor.getBoundingClientRect();
    return { top: rect.bottom + 8, left: rect.left };
  });

  useEffect(() => {
    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(rect.left, window.innerWidth - menuWidth - 12);
      setPosition({ top: rect.bottom + 8, left: Math.max(12, left) });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-sidebar-workspace-trigger]") && !target?.closest("[data-sidebar-workspace-menu]")) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        anchor.focus();
        onClose();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={menuRef}
      data-sidebar-workspace-menu
      role="menu"
      aria-label="Work OS workspace menu"
      className="sidebar-workspace-menu"
      style={{ top: position.top, left: position.left }}
    >
      <div className="sidebar-menu-heading">
        <span className="sidebar-menu-mark"><img src={wordmark} alt="" /></span>
        <span><strong>Work OS</strong><small>Current workspace</small></span>
        <Check size={16} aria-hidden="true" />
      </div>
      <div className="sidebar-menu-rule" />
      <button type="button" role="menuitem" onClick={() => { onClose(); onSettings(); }}>
        <Settings size={16} aria-hidden="true" />
        <span>Workspace settings</span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {onSignOut && (
        <button type="button" role="menuitem" onClick={() => { onClose(); onSignOut(); }}>
          <LogOut size={16} aria-hidden="true" />
          <span>Sign out</span>
        </button>
      )}
    </div>,
    document.body,
  );
}

export default function SidebarNav({
  activeView,
  onNavigate,
  onNewChat,
  onSelectChat,
  onSignOut,
  reviewCount = 0,
  evidenceEnabled = true,
  status,
  chats = [],
  initiallyCollapsed = true,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const visibleDestinations = useMemo(() => DESTINATIONS.filter((item) => item.id !== "evidence" || evidenceEnabled), [evidenceEnabled]);
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? chats.filter((chat) => chat.label.toLowerCase().includes(normalized)) : chats;
  }, [chats, query]);

  const setCollapsedState = (next: boolean) => {
    setCollapsed(next);
    setWorkspaceOpen(false);
    if (next) {
      setSearchOpen(false);
      setQuery("");
    }
  };

  const primary = visibleDestinations.filter(({ id }) => PRIMARY_DESTINATION_IDS.has(id));
  const context = visibleDestinations.filter(({ id }) => CONTEXT_DESTINATION_IDS.has(id));
  const settings = visibleDestinations.filter(({ id }) => id === "settings");

  return (
    <aside
      className="rail sidebar-nav"
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      aria-label="Workspace navigation"
    >
      <div className="sidebar-shell">
        <div className="sidebar-header">
          <button
            ref={workspaceButtonRef}
            type="button"
            data-sidebar-workspace-trigger
            className="sidebar-workspace-trigger"
            aria-label="Work OS workspace menu"
            title="Work OS workspace menu"
            aria-haspopup="menu"
            aria-expanded={workspaceOpen}
            onClick={() => setWorkspaceOpen((current) => !current)}
          >
            <span className="sidebar-workspace-mark"><img src={wordmark} alt="" /></span>
            <span className="sidebar-workspace-copy"><strong>Work OS</strong><small>Workspace</small></span>
            <ChevronDown className="sidebar-workspace-chevron" size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sidebar-collapse-control"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsedState(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </button>
        </div>

        <div className="sidebar-new-chat-wrap">
          <button type="button" data-sidebar-row data-label="New chat" title="New chat" aria-label="New chat" className="sidebar-row sidebar-new-chat" onClick={onNewChat}>
            <span className="sidebar-row-icon"><SquarePen size={18} strokeWidth={1.85} /></span>
            <span className="sidebar-row-copy">New chat</span>
          </button>
        </div>

        <nav className="sidebar-navigation" aria-label="Work OS">
          <SidebarGlideGroup className="nav-group nav-core">
            {primary.map(({ id, label, icon: Icon }) => (
              <SidebarRow key={id} icon={Icon} label={label} active={activeView === id} badge={id === "review" ? reviewCount : undefined} onClick={() => onNavigate(id)} />
            ))}
          </SidebarGlideGroup>
          <SidebarGlideGroup className="nav-group nav-context">
            {context.map(({ id, label, icon: Icon }) => (
              <SidebarRow key={id} icon={Icon} label={label} active={activeView === id} onClick={() => onNavigate(id)} />
            ))}
          </SidebarGlideGroup>
        </nav>

        <section className="sidebar-chats" aria-label="Recent chats">
          <div className="sidebar-chats-heading">
            <div className="sidebar-chats-label"><ChevronDown size={15} aria-hidden="true" /><span>Chats</span></div>
            <button
              type="button"
              className="sidebar-search-trigger"
              aria-label={searchOpen ? "Close chat search" : "Search chats"}
              title={searchOpen ? "Close chat search" : "Search chats"}
              aria-expanded={searchOpen}
              onClick={() => {
                if (collapsed) {
                  setCollapsedState(false);
                  setSearchOpen(true);
                  return;
                }
                setSearchOpen((current) => !current);
                if (searchOpen) setQuery("");
              }}
            >
              {searchOpen ? <X size={16} aria-hidden="true" /> : <Search size={16} aria-hidden="true" />}
            </button>
          </div>
          {searchOpen && (
            <label className="sidebar-search-field">
              <Search size={14} aria-hidden="true" />
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" />
              {query && <button type="button" aria-label="Clear chat search" onClick={() => setQuery("")}><X size={14} /></button>}
            </label>
          )}
          <SidebarGlideGroup className="sidebar-chat-list">
            {visibleChats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                data-sidebar-row
                data-label={chat.label}
                title={chat.label}
                aria-label={chat.label}
                aria-current={chat.active ? "page" : undefined}
                className={`sidebar-row sidebar-chat-row ${chat.active ? "active" : ""}`}
                onClick={() => onSelectChat?.(chat.id)}
              >
                <span className="sidebar-row-copy">{chat.label}</span>
              </button>
            ))}
            {visibleChats.length === 0 && <span className="sidebar-chat-empty">{query ? "No chats found" : "No recent chats"}</span>}
          </SidebarGlideGroup>
        </section>

        <div className="sidebar-footer">
          <SidebarGlideGroup className="nav-group nav-settings">
            {settings.map(({ id, label, icon: Icon }) => (
              <SidebarRow key={id} icon={Icon} label={label} active={activeView === id} onClick={() => onNavigate(id)} />
            ))}
          </SidebarGlideGroup>
          <div className="rail-foot sidebar-status" data-label={`${status.label} · ${status.detail}`} title={`${status.label} · ${status.detail}`} aria-label={`${status.label}. ${status.detail}`}>
            <span className={`presence ${statusClass(status.tone)}`} aria-hidden="true" />
            <span className="sidebar-status-copy"><strong>{status.label}</strong><small>{status.detail}</small></span>
          </div>
        </div>
      </div>

      {workspaceOpen && workspaceButtonRef.current && (
        <WorkspaceMenu
          anchor={workspaceButtonRef.current}
          onClose={() => setWorkspaceOpen(false)}
          onSettings={() => onNavigate("settings")}
          onSignOut={onSignOut}
        />
      )}
    </aside>
  );
}
