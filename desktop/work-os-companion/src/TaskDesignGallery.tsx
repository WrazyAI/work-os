import { CalendarDays, Check, CheckCircle2, ChevronRight, Clock3, Filter, LayoutGrid, ListFilter, MoreHorizontal, Plus, Search, SlidersHorizontal, Sparkles, Target, X } from "lucide-react";
import type { ReactNode } from "react";
import wordmark from "./assets/work-os-mark.png";

type TaskPreview = {
  title: string;
  project: string;
  due: string;
  priority: "High" | "Medium" | "Low";
  completed?: boolean;
  progress?: string;
};

const tasks: TaskPreview[] = [
  { title: "Redesign Work OS companion connect screen", project: "Work OS · Product", due: "Today", priority: "High", progress: "2 / 4" },
  { title: "Overhaul Work OS companion dashboard and Tasks workspace", project: "Work OS · Product", due: "Sep 23", priority: "High" },
  { title: "Visually exercise the avatar chat surfaces", project: "Work OS · QA", due: "Today", priority: "Medium" },
  { title: "Run the me-context-update routine", project: "Operations", due: "Sep 24", priority: "Low" },
];

function GalleryRail({ active = "Tasks" }: { active?: string }) {
  return <aside className="task-gallery-rail">
    <img src={wordmark} alt="" />
    <div className="task-gallery-rail-group">
      {["Today", "Tasks", "Review", "Insights"].map((item, index) => <button key={item} className={item === active ? "active" : ""} aria-label={item}>{index === 0 ? <Target size={16} /> : index === 1 ? <ListFilter size={16} /> : index === 2 ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}</button>)}
    </div>
    <button className="task-gallery-rail-bottom" aria-label="Settings"><SlidersHorizontal size={16} /></button>
  </aside>;
}

function TaskCheck({ completed = false }: { completed?: boolean }) {
  return <span className={`task-gallery-check${completed ? " completed" : ""}`}>{completed && <Check size={13} />}</span>;
}

function Priority({ value }: { value: TaskPreview["priority"] }) {
  return <span className={`task-gallery-priority ${value.toLowerCase()}`}><i />{value}</span>;
}

function TaskLine({ task, selected = false, compact = false }: { task: TaskPreview; selected?: boolean; compact?: boolean }) {
  return <article className={`task-gallery-line${selected ? " selected" : ""}${compact ? " compact" : ""}`}>
    <TaskCheck completed={task.completed} />
    <div className="task-gallery-line-copy"><strong>{task.title}</strong><span>{task.project}</span>{!compact && <small>{task.priority === "High" ? "This is the next visible move for the workday." : "Keep the record concise and easy to pick up."}</small>}</div>
    {!compact && <span className="task-gallery-due">{task.due}</span>}
    {!compact && <Priority value={task.priority} />}
    {task.progress && <span className="task-gallery-progress">{task.progress}</span>}
    <button className="task-gallery-more" aria-label={`More actions for ${task.title}`}><MoreHorizontal size={15} /></button>
  </article>;
}

function OptionFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`task-option-frame ${className}`}><GalleryRail /><section className="task-option-stage">{children}</section></div>;
}

function OptionHeader({ eyebrow, title, description, action = "Add task" }: { eyebrow: string; title: string; description: string; action?: string }) {
  return <header className="task-option-header"><div><span>{eyebrow}</span><h2>{title}</h2><p>{description}</p></div><button className="task-gallery-primary"><Plus size={15} />{action}</button></header>;
}

function FocusListOption() {
  return <OptionFrame className="task-option-focus-list">
    <OptionHeader eyebrow="Monday · September 20" title="Tasks" description="A calm, task-first workspace for deciding what moves next." />
    <section className="task-gallery-focus-strip"><div><span className="task-gallery-kicker"><Target size={12} /> Today’s focus</span><strong>Make the next move visible.</strong><p>One clear queue, with the context you need and none of the noise.</p></div><div className="task-gallery-focus-stats"><span><b>66</b><small>open today</small></span><span><b>8</b><small>due soon</small></span><span><b>4</b><small>completed</small></span></div></section>
    <nav className="task-gallery-view-tabs" aria-label="Task views"><button className="active">My day <b>66</b></button><button>Unfinished <b>67</b></button><button>Completed <b>717</b></button><button>All tasks <b>788</b></button></nav>
    <div className="task-gallery-toolbar"><label><Search size={15} /><input placeholder="Search tasks" /></label><button><CalendarDays size={15} /> September 20</button><button><Filter size={15} /> Filters</button></div>
    <section className="task-gallery-list-panel"><header><div><span className="task-gallery-kicker">Scheduled today</span><strong>Make progress without losing the thread.</strong></div><span>Sorted by due date <ChevronRight size={14} /></span></header><div className="task-gallery-column-labels"><span>Task</span><span>Due</span><span>Priority</span><span /></div>{tasks.slice(0, 3).map((task, index) => <TaskLine key={task.title} task={task} selected={index === 1} />)}</section>
    <div className="task-gallery-callout"><span className="task-gallery-callout-icon"><LayoutGrid size={15} /></span><div><strong>Option 1 · Focus list</strong><p>Dense enough for daily work, with soft selection and a predictable side-sheet detail view.</p></div><span className="task-gallery-tag">Best for speed</span></div>
  </OptionFrame>;
}

function BoardOption() {
  return <OptionFrame className="task-option-board">
    <OptionHeader eyebrow="Monday · September 20" title="Workboard" description="A visual flow from today’s commitments to finished work." action="New task" />
    <section className="task-gallery-board-summary"><div><span className="task-gallery-kicker"><Sparkles size={12} /> Weekly momentum</span><strong>Keep the work moving.</strong><p>See what is active, what is waiting, and what you have already closed.</p></div><div className="task-gallery-board-metric"><b>24</b><span>completed this week</span><i style={{ width: "74%" }} /></div></section>
    <div className="task-gallery-board-toolbar"><nav className="task-gallery-view-tabs"><button className="active">Today <b>8</b></button><button>All work <b>66</b></button></nav><div><button><Search size={14} /> Search</button><button><SlidersHorizontal size={14} /> Group by</button></div></div>
    <section className="task-gallery-board"><div className="task-gallery-lane"><header><span><i className="lane-dot today" />Today</span><b>3</b><button><Plus size={14} /></button></header><div className="task-gallery-card selected"><div><TaskCheck /><Priority value="High" /></div><strong>Redesign Work OS companion connect screen</strong><p>Make the first run feel clear, safe, and ready.</p><footer><span><CalendarDays size={12} />Today</span><span>2 / 4</span></footer></div><div className="task-gallery-card"><div><TaskCheck /><Priority value="Medium" /></div><strong>Visually exercise the avatar chat surfaces</strong><p>Verify both the in-app and floating surfaces.</p><footer><span><CalendarDays size={12} />Today</span></footer></div></div><div className="task-gallery-lane"><header><span><i className="lane-dot next" />Next up</span><b>2</b><button><Plus size={14} /></button></header><div className="task-gallery-card"><div><TaskCheck /><Priority value="High" /></div><strong>Overhaul the Tasks workspace</strong><p>Choose the visual direction before implementation.</p><footer><span><CalendarDays size={12} />Sep 23</span></footer></div><div className="task-gallery-card muted"><div><TaskCheck /><Priority value="Low" /></div><strong>Run the context update routine</strong><p>Provider-backed operational follow-up.</p><footer><span><CalendarDays size={12} />Sep 24</span></footer></div></div><div className="task-gallery-lane done"><header><span><i className="lane-dot done" />Done</span><b>4</b><button><ChevronRight size={14} /></button></header><div className="task-gallery-card completed"><div><TaskCheck completed /><span className="task-gallery-done-label">Completed today</span></div><strong>Review the release checklist</strong><p>All acceptance notes are recorded.</p><footer><span><CheckCircle2 size={12} />Closed 10:42 AM</span></footer></div><div className="task-gallery-card completed"><div><TaskCheck completed /><span className="task-gallery-done-label">Completed today</span></div><strong>Confirm chat surface parity</strong><p>In-app and floating views match.</p><footer><span><CheckCircle2 size={12} />Closed yesterday</span></footer></div></div></section>
    <div className="task-gallery-callout"><span className="task-gallery-callout-icon"><LayoutGrid size={15} /></span><div><strong>Option 2 · Workboard</strong><p>More visual and motivating, with fast drag-free triage across Today, Next up, and Done.</p></div><span className="task-gallery-tag">Best for flow</span></div>
  </OptionFrame>;
}

function MasterDetailOption() {
  return <OptionFrame className="task-option-master-detail">
    <OptionHeader eyebrow="Monday · September 20" title="Task desk" description="A focused two-pane workspace: browse on the left, understand and act on the right." action="Add task" />
    <div className="task-gallery-desk-toolbar"><label><Search size={15} /><input placeholder="Search your work" /></label><button className="active">My day <b>66</b></button><button>Unfinished <b>67</b></button><button><CalendarDays size={14} /> Sep 20</button></div>
    <section className="task-gallery-desk"><div className="task-gallery-desk-list"><header><div><span className="task-gallery-kicker">Today</span><strong>8 tasks in view</strong></div><button><ListFilter size={14} /> Sort</button></header><div className="task-gallery-desk-group"><span>Scheduled today <b>3</b></span>{tasks.slice(0, 3).map((task, index) => <TaskLine key={task.title} task={task} selected={index === 0} compact />)}</div><div className="task-gallery-desk-group secondary"><span>Later this week <b>2</b></span><TaskLine task={tasks[3]} compact /></div></div><aside className="task-gallery-detail"><header><span className="task-gallery-kicker">Active task</span><button aria-label="Close detail"><X size={16} /></button></header><div className="task-gallery-detail-breadcrumb">Today <ChevronRight size={12} /> Work OS <ChevronRight size={12} /> Product</div><h3>Redesign Work OS companion connect screen</h3><p>Make the first run feel clear, safe, and ready. Validate the selected preview direction across responsive and accessibility states.</p><div className="task-gallery-detail-meta"><span><CalendarDays size={14} /><small>Due</small><strong>September 23</strong></span><span><Clock3 size={14} /><small>Added</small><strong>September 20</strong></span><span><Target size={14} /><small>Priority</small><strong>High</strong></span></div><div className="task-gallery-detail-progress"><header><span>Subtasks <b>2 / 4</b></span><span>50%</span></header><div><i style={{ width: "50%" }} /></div></div><section className="task-gallery-detail-subtasks"><header><strong>Next steps</strong><button><Plus size={14} /> Add</button></header><label><TaskCheck completed /><span>Map the connect-screen states</span><CheckCircle2 size={14} /></label><label><TaskCheck /><span>Verify custom-server auth recovery</span><span className="task-gallery-subtask-empty" /></label><label><TaskCheck /><span>Review responsive screenshots</span><span className="task-gallery-subtask-empty" /></label></section><footer><button className="task-gallery-secondary">Edit task</button><button className="task-gallery-primary">Mark complete <Check size={14} /></button></footer></aside></section>
    <div className="task-gallery-callout"><span className="task-gallery-callout-icon"><Target size={15} /></span><div><strong>Option 3 · Task desk</strong><p>Best for deep work: opening a task never loses the list context, and the detail pane stays collision-safe beside chat.</p></div><span className="task-gallery-tag recommended">Recommended</span></div>
  </OptionFrame>;
}

export default function TaskDesignGallery() {
  return <main className="task-design-gallery"><header className="task-design-gallery-intro"><div><span className="task-gallery-kicker">Design review · Tasks</span><h1>Choose the workspace rhythm.</h1><p>Three directions for the Tasks page and task-opening flow. These are visual-only previews; the production Tasks workspace is unchanged.</p></div><div className="task-design-gallery-legend"><span><i className="legend-signal" />Soft selection</span><span><i className="legend-line" />Detached detail</span><span><i className="legend-dot" />Truthful status</span></div></header><section className="task-design-gallery-options"><article><header><span>01</span><h2>Focus list</h2><p>Quiet, dense, and optimized for finishing today’s queue.</p></header><FocusListOption /></article><article><header><span>02</span><h2>Workboard</h2><p>Visual lanes for momentum, triage, and completion.</p></header><BoardOption /></article><article><header><span>03</span><h2>Task desk</h2><p>Master-detail browsing for context-rich task work.</p></header><MasterDetailOption /></article></section></main>;
}
