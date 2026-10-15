/*
 * The shot lists.
 *
 * One entry per guide, one clip per numbered step in `guides.ts`. Each clip is a
 * shot of the real page for that step: it opens on a composition someone can
 * read, moves once, and lands somewhere worth holding. Watching a guide through
 * plays them in sequence; they cut between steps rather than pretending to be a
 * single continuous take, because a step that ends inside a dialog cannot also
 * be a step that begins on the page behind it.
 *
 * Three rules the camera obeys, all deliberate:
 *
 *   - It never exceeds MAX_SCALE. Capture is supersampled, but only by 2×, so
 *     the cap is what keeps every frame at or below native resolution in the
 *     modal. A camera that magnifies pixels is not a camera.
 *   - It frames a named subject, not a pixel offset. `fit: ".active-focus-panel"`
 *     means "fill the frame with this element"; `contain` means "and do not crop
 *     it". A shot therefore survives a layout change instead of quietly filming
 *     the wrong thing.
 *   - Nothing is written down as a raw coordinate that could be derived. The
 *     only literal numbers are durations.
 *
 * Every click is a real click on a real control, so whatever the interface does
 * in response is what lands in the film.
 */

export const MAX_SCALE = 1.6;

const EOD_NAV = 'button[data-sidebar-row][aria-label="EOD Review"]';
const FOCUS_EDIT = ".active-focus-panel .dashboard-secondary-action";

/*
 * Compositions the camera returns to within a guide. Naming them keeps a shot
 * list readable and keeps two clips from framing the same panel differently.
 */
const DAY = {
  top: { band: 0 },
  shift: { fit: ".active-command-panel" },
  focus: { fit: ".active-focus-panel" },
  queue: { fit: ".active-task-panel" },
  row: { scale: 1.3, band: ".dashboard-task-row", anchor: "center" },
};

export const GUIDE_SHOTS = {
  day: {
    1: {
      chapter: "Start with a plan",
      url: "/?offline",
      await: [".active-focus-panel"],
      opening: DAY.top,
      entry: { x: 934, y: 452 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { ...DAY.shift, ms: 1250 } },
        { point: ".active-command-panel", ms: 640 },
        { cam: { ...DAY.focus, ms: 1350 } },
        { point: FOCUS_EDIT, ms: 660 },
        { wait: 160 },
        { click: FOCUS_EDIT, ms: 660, after: 820 },
        // The plan sheet is the point of this step, so the camera settles on it
        // whole rather than leaving it hanging off the top of the frame.
        { cam: { contain: ".planning-session", ms: 720 } },
        { wait: 260 },
      ],
    },
    2: {
      chapter: "Work the day",
      url: "/?offline",
      await: [".active-task-panel"],
      opening: DAY.shift,
      entry: ".active-command-actions",
      hold: 380,
      tail: 300,
      shots: [
        { point: ".active-command-panel", ms: 620 },
        { cam: { ...DAY.row, ms: 1300 } },
        { point: ".dashboard-task-check", ms: 640 },
        { wait: 160 },
        { click: ".dashboard-task-check", ms: 640, after: 900 },
        { cam: { ...DAY.queue, ms: 800 } },
        { wait: 280 },
      ],
    },
    3: {
      chapter: "Close it out",
      url: "/?offline",
      await: [".active-task-panel"],
      opening: DAY.queue,
      entry: ".active-task-tabs [role=tab]",
      hold: 380,
      tail: 320,
      shots: [
        { point: ".active-task-tabs [role=tab]", ms: 520 },
        { cam: { ...DAY.top, ms: 1350 } },
        { wait: 200 },
        { point: EOD_NAV, ms: 780 },
        { wait: 140 },
        { click: EOD_NAV, ms: 620, after: 980 },
        { wait: 560 },
      ],
    },
  },

  /*
   * Tasks: the view chips, the composer, and the table. The third step ends on a
   * row being completed, so the film shows the same checkbox the first step
   * talks about being used.
   */
  tasks: {
    1: {
      chapter: "Pick a view",
      url: "/?offline",
      nav: "Tasks",
      await: [".tasks-toolbar"],
      opening: { fit: ".task-list-panel", anchor: "top" },
      entry: { x: 900, y: 440 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { fit: ".tasks-toolbar", anchor: "center", ms: 1200 } },
        { point: ".agenda-strip-chip", ms: 620 },
        { wait: 180 },
        // A real view change: the table behind the chips re-reads itself.
        { click: ".agenda-strip-chip:nth-of-type(2)", ms: 620, after: 900 },
        { cam: { fit: ".task-list-panel", anchor: "top", ms: 900 } },
        { wait: 260 },
      ],
    },
    2: {
      chapter: "Add and change work",
      url: "/?offline",
      nav: "Tasks",
      await: [".tasks-toolbar"],
      opening: { fit: ".tasks-toolbar", anchor: "center" },
      entry: ".tasks-toolbar .primary",
      hold: 380,
      tail: 300,
      shots: [
        { point: ".tasks-toolbar .primary", ms: 620 },
        { wait: 160 },
        { click: ".tasks-toolbar .primary", ms: 620, after: 880 },
        { cam: { contain: ".task-modal", ms: 720 } },
        { wait: 240 },
      ],
    },
    3: {
      chapter: "Complete or archive",
      url: "/?offline",
      nav: "Tasks",
      await: [".task-list-panel"],
      opening: { fit: ".task-list-panel", anchor: "top" },
      entry: ".task-check",
      hold: 380,
      tail: 320,
      shots: [
        { cam: { fit: ".task-list-panel", anchor: "center", ms: 1100 } },
        { point: ".task-check", ms: 620 },
        { wait: 160 },
        { click: ".task-check", ms: 620, after: 950 },
        { wait: 300 },
      ],
    },
  },

  /*
   * EOD Review: the three steps are draft, read, submit — so the film walks the
   * same path. The page's own end-of-day state is what carries a real report, so
   * these clips are shot on a day that has one.
   */
  review: {
    1: {
      chapter: "Draft it",
      url: "/?offline&day=eod",
      nav: "EOD Review",
      await: [".eod-composer"],
      tag: { draft: "Draft with AI" },
      opening: { fit: ".eod-composer", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 420,
      tail: 320,
      shots: [
        { cam: { fit: ".eod-composer", anchor: "center", ms: 1000 } },
        { point: "[data-film-target=draft]", ms: 620 },
        { wait: 180 },
        { click: "[data-film-target=draft]", ms: 620, after: 1500 },
        { wait: 380 },
      ],
    },
    2: {
      chapter: "Read the record",
      url: "/?offline&day=eod",
      nav: "EOD Review",
      await: [".eod-composer"],
      tag: { preview: "Preview" },
      opening: { fit: ".eod-composer", anchor: "top" },
      entry: "[data-film-target=preview]",
      hold: 420,
      tail: 320,
      shots: [
        { point: "[data-film-target=preview]", ms: 620 },
        { wait: 180 },
        // A real view change: the same record rendered a different way.
        { click: "[data-film-target=preview]", ms: 620, after: 1200 },
        { cam: { band: 430, scale: 1.24, ms: 1300 } },
        { wait: 380 },
      ],
    },
    3: {
      chapter: "Submit",
      url: "/?offline&day=eod",
      nav: "EOD Review",
      await: [".eod-composer"],
      tag: { submit: "Submit EOD" },
      opening: { band: 430, scale: 1.24 },
      entry: "[data-film-target=submit]",
      hold: 420,
      tail: 340,
      shots: [
        { cam: { fit: ".eod-composer", anchor: "bottom", ms: 1300 } },
        { point: "[data-film-target=submit]", ms: 660 },
        { wait: 260 },
        { cam: { fit: ".eod-composer", anchor: "bottom", ms: 700, pad: -40 } },
        { wait: 300 },
      ],
    },
  },

  /*
   * Insights: the range control, then two different streams read in turn. This
   * page is long, so the camera's travel is what carries the film.
   */
  insights: {
    1: {
      chapter: "Choose the range",
      url: "/?offline",
      nav: "Insights",
      await: [".insight-kpi-strip"],
      opening: { band: 0, scale: 1 },
      entry: { x: 930, y: 430 },
      hold: 420,
      tail: 300,
      shots: [
        { cam: { fit: ".insights-heading", anchor: "center", ms: 1100 } },
        { point: ".range-switch button:nth-of-type(3)", ms: 620 },
        { wait: 180 },
        { click: ".range-switch button:nth-of-type(3)", ms: 620, after: 1000 },
        { cam: { fit: ".insight-kpi-strip", anchor: "top", ms: 1100 } },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Read one stream at a time",
      url: "/?offline",
      nav: "Insights",
      await: [".insight-kpi-strip"],
      opening: { fit: ".insight-kpi-strip", anchor: "top" },
      entry: { x: 930, y: 430 },
      hold: 400,
      tail: 320,
      shots: [
        { point: ".insight-kpi-strip", ms: 560 },
        { cam: { fit: ".insight-primary-chart", anchor: "center", ms: 1400 } },
        { wait: 420 },
        { point: ".daily-rhythm-hit", focus: "right", ms: 700 },
        { wait: 260 },
      ],
    },
    3: {
      chapter: "Keep the labels",
      url: "/?offline",
      nav: "Insights",
      await: [".insight-kpi-strip"],
      opening: { fit: ".insight-synthesis", anchor: "center" },
      entry: { x: 930, y: 430 },
      hold: 400,
      tail: 320,
      shots: [
        { point: ".insight-synthesis", ms: 560 },
        { cam: { fit: ".insight-band-evidence", anchor: "top", ms: 1500 } },
        { wait: 460 },
        { point: ".insight-band-evidence", ms: 640 },
        { cam: { fit: ".insight-band-evidence", anchor: "center", ms: 900 } },
        { wait: 320 },
      ],
    },
  },

  /*
   * Settings: the three steps are the three bands, so the camera walks down the
   * page the way the reader would.
   */
  settings: {
    1: {
      chapter: "Workspace settings",
      url: "/?offline",
      nav: "Settings",
      await: [".settings-lead"],
      opening: { band: 0, scale: 1 },
      entry: { x: 930, y: 430 },
      hold: 420,
      tail: 300,
      shots: [
        { cam: { fit: ".settings-group", anchor: "center", ms: 1100 } },
        { point: ".settings-group .quiet-action", ms: 620 },
        { wait: 180 },
        { click: ".settings-group .quiet-action", ms: 620, after: 1900 },
        { cam: { contain: ".task-modal", ms: 720 } },
        { wait: 260 },
      ],
    },
    2: {
      chapter: "This device",
      url: "/?offline",
      nav: "Settings",
      await: [".settings-lead"],
      opening: { band: 336, scale: 1.2 },
      entry: { x: 930, y: 430 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { band: 336, scale: 1.2, ms: 900 } },
        { point: ".settings-switch:nth-of-type(1)", ms: 640 },
        { wait: 240 },
        // A real preference change on this device.
        { click: ".settings-switch", ms: 620, after: 820 },
        { wait: 300 },
      ],
    },
    3: {
      chapter: "Workday",
      url: "/?offline",
      nav: "Settings",
      await: [".settings-lead"],
      opening: { band: 1010, scale: 1.16 },
      entry: { x: 930, y: 430 },
      hold: 400,
      tail: 320,
      shots: [
        { cam: { band: 674, scale: 1.16, ms: 1300 } },
        { wait: 240 },
        { point: ".settings-group:nth-of-type(5)", ms: 620 },
        { cam: { band: 1010, scale: 1.16, ms: 1300 } },
        { wait: 420 },
      ],
    },
  },
};
