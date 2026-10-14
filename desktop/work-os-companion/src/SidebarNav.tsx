import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Gauge,
  Images,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SquarePen,
  Users,
  type LucideIcon,
} from "lucide-react";
import wordmark from "./assets/work-os-mark.png";
import type { AdminSection } from "./admin/types";

export type SidebarView = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";

export type SidebarNavProps = {
  activeView: SidebarView;
  onNavigate: (view: SidebarView) => void;
  onNewChat: () => void;
  onSignOut?: () => void;
  initiallyCollapsed?: boolean;
  /** "admin" swaps the rail to the administration destinations. */
  mode?: "employee" | "admin";
  adminSection?: AdminSection;
  onAdminNavigate?: (section: AdminSection) => void;
  /** When present, the workspace menu offers the workspace switch. */
  onSwitchWorkspace?: () => void;
  switchLabel?: string;
};

type Destination = {
  id: SidebarView;
  label: string;
  icon: LucideIcon;
};

type AdminDestination = {
  id: AdminSection;
  label: string;
  icon: LucideIcon;
};

const DESTINATIONS: Destination[] = [
  { id: "day", label: "My Day", icon: LayoutDashboard },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "EOD Review", icon: MessageSquareText },
  { id: "insights", label: "Insights", icon: Gauge },
  { id: "settings", label: "Settings", icon: Settings },
];

const ADMIN_DESTINATIONS: AdminDestination[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "people", label: "People", icon: Users },
  { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "EOD Review", icon: MessageSquareText },
  { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: Images },
  { id: "settings", label: "Settings", icon: Settings },
];

const PRIMARY_DESTINATION_IDS = new Set<SidebarView>(["day", "tasks", "review"]);
const CONTEXT_DESTINATION_IDS = new Set<SidebarView>(["insights"]);
const ADMIN_PRIMARY_IDS = new Set<AdminSection>(["overview", "people", "tasks"]);
const ADMIN_CONTEXT_IDS = new Set<AdminSection>(["review", "insights", "evidence"]);

const menuWidth = 228;

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
  hint,
  onClick,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  hint?: string | undefined;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-sidebar-row
      data-sidebar-nav-option
      data-label={label}
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={`sidebar-row ${active ? "active" : ""} ${className}`}
      onClick={onClick}
    >
      <span className="sidebar-row-icon"><Icon size={18} strokeWidth={1.85} /></span>
      <span className="sidebar-row-copy">{label}</span>
    </button>
  );
}

function WorkspaceMenu({
  anchor,
  onClose,
  onSettings,
  onSignOut,
  onSwitchWorkspace,
  switchLabel,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  onSettings: () => void;
  onSignOut?: () => void;
  onSwitchWorkspace?: (() => void) | undefined;
  switchLabel?: string | undefined;
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
      {onSwitchWorkspace ? (
        <button type="button" role="menuitem" onClick={() => { onClose(); onSwitchWorkspace(); }}>
          <ArrowLeftRight size={16} aria-hidden="true" />
          <span>{switchLabel ?? "Switch workspace"}</span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      ) : null}
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
  onSignOut,
  initiallyCollapsed = true,
  mode = "employee",
  adminSection,
  onAdminNavigate,
  onSwitchWorkspace,
  switchLabel,
}: SidebarNavProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [collapsedSurfaceHover, setCollapsedSurfaceHover] = useState(false);
  const workspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const admin = mode === "admin";
  const activeId: SidebarView | AdminSection = admin ? adminSection ?? "overview" : activeView;
  const navigate = (id: SidebarView | AdminSection) => {
    if (admin) onAdminNavigate?.(id as AdminSection);
    else onNavigate(id as SidebarView);
  };

  const setCollapsedState = (next: boolean) => {
    setCollapsed(next);
    setCollapsedSurfaceHover(false);
    setWorkspaceOpen(false);
  };

  const primary = admin
    ? ADMIN_DESTINATIONS.filter(({ id }) => ADMIN_PRIMARY_IDS.has(id))
    : DESTINATIONS.filter(({ id }) => PRIMARY_DESTINATION_IDS.has(id));
  const context = admin
    ? ADMIN_DESTINATIONS.filter(({ id }) => ADMIN_CONTEXT_IDS.has(id))
    : DESTINATIONS.filter(({ id }) => CONTEXT_DESTINATION_IDS.has(id));
  const settings = admin
    ? ADMIN_DESTINATIONS.filter(({ id }) => id === "settings")
    : DESTINATIONS.filter(({ id }) => id === "settings");

  const updateCollapsedSurfaceHover = (target: EventTarget | null) => {
    if (!collapsed || !(target instanceof Element)) {
      setCollapsedSurfaceHover(false);
      return;
    }
    setCollapsedSurfaceHover(
      !target.closest("[data-sidebar-nav-option]") && !target.closest("[data-sidebar-workspace-trigger]"),
    );
  };

  const handleSidebarPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    updateCollapsedSurfaceHover(event.target);
  };

  const handleSidebarClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!collapsed || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-sidebar-nav-option]") || event.target.closest("[data-sidebar-workspace-trigger]")) return;
    setCollapsedState(false);
  };

  return (
    <aside
      className="sidebar-nav"
      data-sidebar-collapsed={collapsed ? "true" : "false"}
      data-sidebar-surface-hover={collapsed && collapsedSurfaceHover ? "true" : "false"}
      aria-label="Workspace navigation"
      onPointerMove={handleSidebarPointerMove}
      onPointerLeave={() => setCollapsedSurfaceHover(false)}
      onClick={handleSidebarClick}
    >
      <div className="sidebar-shell">
        <div className="sidebar-header">
          <button
            ref={workspaceButtonRef}
            type="button"
            data-sidebar-workspace-trigger
            className="sidebar-workspace-trigger"
            aria-label={collapsed ? "Expand sidebar" : "Work OS workspace menu"}
            title={collapsed ? "Expand sidebar" : "Work OS workspace menu"}
            aria-haspopup={collapsed ? undefined : "menu"}
            aria-expanded={collapsed ? undefined : workspaceOpen}
            onClick={() => {
              if (collapsed) {
                setCollapsedState(false);
                return;
              }
              setWorkspaceOpen((current) => !current);
            }}
          >
            <span className="sidebar-workspace-mark">
              <img src={wordmark} alt="" />
              <PanelLeftOpen className="sidebar-workspace-expand-icon" size={18} aria-hidden="true" />
            </span>
            <span className="sidebar-workspace-copy"><strong>Work OS</strong><small>Workspace</small></span>
            <ChevronDown className="sidebar-workspace-chevron" size={16} aria-hidden="true" />
          </button>
          {!collapsed && (
            <button
              type="button"
              className="sidebar-collapse-control"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              aria-expanded="true"
              onClick={() => setCollapsedState(true)}
            >
              <PanelLeftClose size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {!admin && (
          <>
            <div className="sidebar-new-chat-wrap">
              <button type="button" data-sidebar-row data-sidebar-nav-option data-label="New chat" title="New chat" aria-label="New chat" className="sidebar-row sidebar-new-chat" onClick={onNewChat}>
                <span className="sidebar-row-icon"><SquarePen size={18} strokeWidth={1.85} /></span>
                <span className="sidebar-row-copy">New chat</span>
              </button>
            </div>

            <nav className="sidebar-navigation" aria-label="Work OS">
              <SidebarGlideGroup className="nav-group nav-core">
                {primary.map(({ id, label, icon: Icon }) => (
                  <SidebarRow key={id} icon={Icon} label={label} active={activeId === id} onClick={() => navigate(id)} />
                ))}
              </SidebarGlideGroup>
              <SidebarGlideGroup className="nav-group nav-context">
                {context.map(({ id, label, icon: Icon }) => (
                  <SidebarRow key={id} icon={Icon} label={label} active={activeId === id} onClick={() => navigate(id)} />
                ))}
              </SidebarGlideGroup>
            </nav>
          </>
        )}
        {admin ? (
          <nav className="sidebar-navigation" aria-label="Work OS administration">
            <SidebarGlideGroup className="nav-group nav-core">
              {primary.map(({ id, label, icon: Icon }) => (
                <SidebarRow key={id} icon={Icon} label={label} active={activeId === id} onClick={() => navigate(id)} />
              ))}
            </SidebarGlideGroup>
            <SidebarGlideGroup className="nav-group nav-context">
              {context.map(({ id, label, icon: Icon }) => (
                <SidebarRow key={id} icon={Icon} label={label} active={activeId === id} onClick={() => navigate(id)} />
              ))}
            </SidebarGlideGroup>
          </nav>
        ) : null}

        <div className="sidebar-footer">
          <SidebarGlideGroup className="nav-group nav-settings">
            {settings.map(({ id, label, icon: Icon }) => (
              <SidebarRow key={id} icon={Icon} label={label} active={activeId === id} hint={id === "settings" && !admin ? "Ctrl + ," : undefined} onClick={() => navigate(id)} />
            ))}
          </SidebarGlideGroup>
        </div>
      </div>

      {workspaceOpen && workspaceButtonRef.current && (
        <WorkspaceMenu
          anchor={workspaceButtonRef.current}
          onClose={() => setWorkspaceOpen(false)}
          onSettings={() => onNavigate("settings")}
          onSignOut={onSignOut}
          onSwitchWorkspace={onSwitchWorkspace}
          switchLabel={switchLabel}
        />
      )}
    </aside>
  );
}
