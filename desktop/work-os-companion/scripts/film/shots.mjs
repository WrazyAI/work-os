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

/*
 * The administration workspace. Its seven guides boot the real shell through
 * the admin-shell harness (`?admin-shell`), which fabricates the admin session
 * and seeds every section from fixtures — no backend contact, no writes.
 * `&guides=seen` boots the flags of an account that has already met every
 * guide, so a take films the page instead of the guide standing on top of it.
 */
const ADMIN_BOOT = "/?admin-shell&guides=seen";

/** Every administration take starts from the same quiet page: the harness's
 * notification flyouts and the overview's standing stale-snapshot card are
 * dismissed the way a person would dismiss them, so they never sit in shot. */
const quietAdmin = async (page) => {
  await page.evaluate(() => {
    for (const button of document.querySelectorAll("button.notification-dismiss")) button.click();
  });
  await page.waitForTimeout(320);
};

/** A take's own setup, after the shared quieting. */
const adminBefore = (extra) => async (page) => {
  await quietAdmin(page);
  if (extra) await extra(page);
};

/* Compositions the administration camera returns to, named once so two clips
 * frame the same card the same way. A card is found by what it carries, never
 * by where it sits in a list. */
const ADMIN = {
  top: { band: 0 },
  roster: { fit: ".admin-card:has(.admin-table)", anchor: "top" },
  attention: { fit: ".admin-card:has(.admin-attention)", anchor: "top" },
  activity: { fit: ".admin-card:has(.admin-activity)", anchor: "top" },
  drawer: { contain: ".admin-drawer" },
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

  /*
   * Overview: the roster, what needs attention, and the activity stream — the
   * same three bands the steps name, walked top to bottom.
   */
  admin_overview: {
    1: {
      chapter: "See who is working",
      url: ADMIN_BOOT,
      await: [".admin-kpi-strip", ".admin-table"],
      before: adminBefore(),
      opening: ADMIN.top,
      entry: { x: 934, y: 452 },
      hold: 420,
      tail: 300,
      shots: [
        { cam: { fit: ".admin-kpi-strip", anchor: "top", ms: 1200 } },
        { point: ".admin-kpi-strip", ms: 560 },
        { cam: { ...ADMIN.roster, ms: 1250 } },
        { point: ".admin-table tbody tr", ms: 620 },
        { wait: 160 },
        // One push into a row, so the attendance pill and today's counts are
        // readable rather than merely present.
        { cam: { scale: 1.25, band: ".admin-table tbody tr:nth-of-type(2)", anchor: "center", ms: 900 } },
        { point: ".admin-table tbody tr:nth-of-type(2) .admin-pill", ms: 620 },
        { wait: 320 },
      ],
    },
    2: {
      chapter: "Clear what needs attention",
      url: ADMIN_BOOT,
      await: [".admin-attention"],
      before: adminBefore(),
      opening: ADMIN.attention,
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { ...ADMIN.attention, ms: 1150 } },
        { point: ".admin-attention li button", ms: 640 },
        { wait: 180 },
        { point: ".admin-attention li:nth-of-type(2) button", ms: 620 },
        { wait: 300 },
      ],
    },
    3: {
      chapter: "Follow the activity",
      url: ADMIN_BOOT,
      await: [".admin-activity"],
      before: adminBefore(),
      opening: ADMIN.activity,
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 320,
      shots: [
        { cam: { ...ADMIN.activity, ms: 1250 } },
        { point: ".admin-activity li button", ms: 640 },
        { wait: 200 },
        // A real row opens the record behind it.
        { click: ".admin-activity li button", ms: 620, after: 1100 },
        { cam: { ...ADMIN.drawer, ms: 820 } },
        { wait: 320 },
      ],
    },
  },

  /*
   * People: the roster, the person drawer, and what the drawer holds.
   */
  admin_people: {
    1: {
      chapter: "Find the person",
      url: ADMIN_BOOT,
      nav: "People",
      await: [".admin-table"],
      before: adminBefore(),
      opening: ADMIN.roster,
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { ...ADMIN.roster, ms: 1050 } },
        { point: ".admin-search input", ms: 620 },
        { wait: 200 },
        { point: ".admin-table tbody tr", ms: 640 },
        { wait: 160 },
        { point: ".admin-table tbody tr:nth-of-type(3)", ms: 620 },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Open the record",
      url: ADMIN_BOOT,
      nav: "People",
      await: [".admin-table"],
      before: adminBefore(),
      opening: ADMIN.roster,
      entry: ".admin-table tbody tr",
      hold: 380,
      tail: 320,
      shots: [
        { point: ".admin-table tbody tr", ms: 620 },
        { wait: 180 },
        { click: ".admin-table tbody tr", ms: 620, after: 1200 },
        { cam: { ...ADMIN.drawer, ms: 850 } },
        { wait: 340 },
      ],
    },
    3: {
      chapter: "Read what they filed",
      url: ADMIN_BOOT,
      nav: "People",
      await: [".admin-table"],
      before: adminBefore(async (page) => {
        await page.click(".admin-table tbody tr");
        await page.waitForSelector(".admin-drawer-body", { timeout: 8000 });
        await page.waitForTimeout(700);
        // The drawer's own scroll region: the take shows the sections a
        // record-holder reads, not the mechanics of reaching them. It ends at
        // the record's foot, where the reports and the evidence summary live.
        await page.evaluate(() => {
          const body = document.querySelector(".admin-drawer-body");
          if (body) body.scrollTop = body.scrollHeight;
        });
        await page.waitForTimeout(420);
      }),
      opening: ADMIN.drawer,
      entry: { x: 700, y: 470 },
      hold: 420,
      tail: 320,
      shots: [
        { cam: { ...ADMIN.drawer, ms: 900 } },
        { point: ".admin-drawer-grid .admin-block:nth-of-type(6)", ms: 620 },
        { wait: 200 },
        { cam: { fit: ".admin-drawer-grid .admin-block:nth-of-type(6)", anchor: "center", ms: 1000 } },
        { wait: 200 },
        { cam: { fit: ".admin-drawer-grid .admin-block:nth-of-type(7)", anchor: "center", ms: 1000 } },
        { wait: 380 },
      ],
    },
  },

  /*
   * Tasks: the filters, a task's own drawer, and the add flow.
   */
  admin_tasks: {
    1: {
      chapter: "Filter the record",
      url: ADMIN_BOOT,
      nav: "Tasks",
      await: [".admin-table"],
      before: adminBefore(),
      opening: { fit: ".admin-card-controls", anchor: "center" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { fit: ".admin-card-controls", anchor: "center", ms: 1050 } },
        { point: ".admin-search input", ms: 620 },
        { wait: 200 },
        { cam: { fit: ".admin-table", anchor: "top", ms: 1050 } },
        { point: ".admin-table tbody tr", ms: 640 },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Open a task",
      url: ADMIN_BOOT,
      nav: "Tasks",
      await: [".admin-table"],
      before: adminBefore(),
      opening: ADMIN.roster,
      entry: ".admin-table tbody tr",
      hold: 380,
      tail: 320,
      shots: [
        { point: ".admin-table tbody tr", ms: 620 },
        { wait: 180 },
        { click: ".admin-table tbody tr", ms: 620, after: 1200 },
        { cam: { ...ADMIN.drawer, ms: 850 } },
        { wait: 340 },
      ],
    },
    3: {
      chapter: "Add work for the team",
      url: ADMIN_BOOT,
      nav: "Tasks",
      await: [".admin-table"],
      tag: { add: "Add task" },
      before: adminBefore(),
      opening: { fit: ".admin-card-controls", anchor: "center" },
      entry: "[data-film-target=add]",
      hold: 380,
      tail: 320,
      shots: [
        { point: "[data-film-target=add]", ms: 620 },
        { wait: 180 },
        { click: "[data-film-target=add]", ms: 620, after: 1100 },
        { cam: { ...ADMIN.drawer, ms: 850 } },
        { wait: 320 },
      ],
    },
  },

  /*
   * EOD Review: the queue, the document, and the decision.
   */
  admin_review: {
    1: {
      chapter: "Work the queue",
      url: ADMIN_BOOT,
      nav: "EOD Review",
      await: [".admin-table"],
      before: adminBefore(),
      opening: ADMIN.roster,
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { ...ADMIN.roster, ms: 1100 } },
        { point: ".admin-table tbody tr", ms: 640 },
        { wait: 160 },
        { point: ".admin-table tbody tr:nth-of-type(2)", ms: 620 },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Read the document",
      url: ADMIN_BOOT,
      nav: "EOD Review",
      await: [".admin-table"],
      before: adminBefore(),
      opening: ADMIN.roster,
      entry: ".admin-table tbody tr",
      hold: 380,
      tail: 320,
      shots: [
        { point: ".admin-table tbody tr", ms: 620 },
        { wait: 180 },
        { click: ".admin-table tbody tr", ms: 620, after: 1200 },
        { cam: { fit: ".admin-details", anchor: "top", ms: 1000 } },
        { wait: 340 },
      ],
    },
    3: {
      chapter: "Decide",
      url: ADMIN_BOOT,
      nav: "EOD Review",
      await: [".admin-table"],
      before: adminBefore(async (page) => {
        await page.click(".admin-table tbody tr");
        await page.waitForSelector(".admin-decision", { timeout: 8000 });
        await page.waitForTimeout(700);
        await page.evaluate(() => document.querySelector(".admin-decision")?.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(420);
      }),
      opening: { fit: ".admin-decision", anchor: "center" },
      entry: { x: 700, y: 470 },
      hold: 420,
      tail: 320,
      shots: [
        { cam: { fit: ".admin-decision", anchor: "center", ms: 1050 } },
        { point: "[aria-label='Manager notes']", ms: 640 },
        { wait: 200 },
        { point: ".admin-decision-actions button", ms: 640 },
        { wait: 340 },
      ],
    },
  },

  /*
   * Insights: the range control, the brief and measurements, and a person's
   * facts.
   */
  admin_insights: {
    1: {
      chapter: "Set the range",
      url: ADMIN_BOOT,
      nav: "Insights",
      await: [".admin-kpi-strip"],
      before: adminBefore(),
      opening: ADMIN.top,
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { fit: ".admin-card-controls", anchor: "center", ms: 1050 } },
        { point: '[aria-label="Insight range"] button:nth-of-type(2)', ms: 620 },
        { wait: 200 },
        // A real range change: every measurement behind it re-reads itself.
        { click: '[aria-label="Insight range"] button:nth-of-type(2)', ms: 620, after: 1100 },
        { cam: { fit: ".admin-kpi-strip", anchor: "top", ms: 1100 } },
        { wait: 320 },
      ],
    },
    2: {
      chapter: "Read the brief and measurements",
      url: ADMIN_BOOT,
      nav: "Insights",
      await: [".admin-brief-columns"],
      before: adminBefore(),
      opening: { fit: ".admin-brief-columns", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 420,
      tail: 320,
      shots: [
        { cam: { fit: ".admin-brief-columns", anchor: "top", ms: 1100 } },
        { point: ".admin-brief-lead", ms: 560 },
        { wait: 240 },
        { cam: { fit: ".admin-kpi-strip", anchor: "top", ms: 1050 } },
        { point: ".admin-kpi-strip", ms: 560 },
        { wait: 320 },
      ],
    },
    3: {
      chapter: "Open a person's facts",
      url: ADMIN_BOOT,
      nav: "Insights",
      await: [".admin-band-facts"],
      before: adminBefore(),
      opening: { fit: ".admin-band-facts", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 320,
      shots: [
        { cam: { fit: ".admin-band-facts", anchor: "top", ms: 1100 } },
        { point: ".admin-band-facts .admin-table tbody tr", ms: 640 },
        { wait: 180 },
        { click: ".admin-band-facts .admin-table tbody tr", ms: 620, after: 1200 },
        { cam: { ...ADMIN.drawer, ms: 850 } },
        { wait: 320 },
      ],
    },
  },

  /*
   * Evidence: the filters, the integrations band, and a flagged frame.
   */
  admin_evidence: {
    1: {
      chapter: "Filter the record",
      url: ADMIN_BOOT,
      nav: "Evidence",
      await: [".admin-groups"],
      before: adminBefore(),
      opening: { fit: ".admin-card:has(.admin-groups)", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { fit: ".admin-card:has(.admin-groups)", anchor: "top", ms: 1100 } },
        { point: '[aria-label="Filter by source"]', ms: 620 },
        { wait: 200 },
        { point: ".admin-check", ms: 620 },
        { wait: 200 },
        { cam: { fit: ".admin-groups", anchor: "top", ms: 1000 } },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Check the integrations",
      url: ADMIN_BOOT,
      nav: "Evidence",
      await: [".admin-integration-row"],
      before: adminBefore(),
      opening: { fit: ".admin-card:has(.admin-integration-row)", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 420,
      tail: 320,
      shots: [
        { cam: { fit: ".admin-card:has(.admin-integration-row)", anchor: "top", ms: 1150 } },
        { point: ".admin-integration-row", ms: 640 },
        { wait: 200 },
        { point: ".admin-card:has(.admin-integration-row) .admin-button", ms: 620 },
        { wait: 320 },
      ],
    },
    3: {
      chapter: "Open a flagged frame",
      url: ADMIN_BOOT,
      nav: "Evidence",
      await: [".admin-groups"],
      before: adminBefore(async (page) => {
        // The disputed row is the one carrying the failing pill, and the
        // drawer is opened before the take so the camera can frame the reason
        // the rule asks for rather than the mechanics of reaching it.
        await page.click(".admin-groups button:has(.admin-pill.err)");
        await page.waitForSelector(".admin-drawer [aria-label='Reason for viewing this retained screenshot']", { timeout: 8000 });
        await page.waitForTimeout(700);
      }),
      opening: ADMIN.drawer,
      entry: { x: 700, y: 470 },
      hold: 420,
      tail: 340,
      shots: [
        { cam: { ...ADMIN.drawer, ms: 900 } },
        { point: "[aria-label='Reason for viewing this retained screenshot']", ms: 640 },
        { wait: 240 },
        { point: ".admin-drawer .admin-inline-fields .admin-button", ms: 620 },
        { wait: 320 },
      ],
    },
  },

  /*
   * Settings: features and status, members and teams, connections.
   */
  admin_settings: {
    1: {
      chapter: "Features and status",
      url: ADMIN_BOOT,
      nav: "Settings",
      await: [".admin-feature-list"],
      before: adminBefore(),
      opening: { fit: ".admin-grid > .admin-card:nth-of-type(2)", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 300,
      shots: [
        { cam: { fit: ".admin-grid > .admin-card:nth-of-type(2)", anchor: "top", ms: 1150 } },
        { point: ".admin-toggle", ms: 640 },
        { wait: 240 },
        { cam: { fit: ".admin-grid > .admin-card:nth-of-type(1)", anchor: "top", ms: 1000 } },
        { wait: 300 },
      ],
    },
    2: {
      chapter: "Members and teams",
      url: ADMIN_BOOT,
      nav: "Settings",
      await: [".admin-grid > .admin-card:nth-of-type(3)"],
      before: adminBefore(),
      opening: { fit: ".admin-grid > .admin-card:nth-of-type(3)", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 320,
      shots: [
        { cam: { fit: ".admin-grid > .admin-card:nth-of-type(3)", anchor: "top", ms: 1100 } },
        { point: ".admin-grid > .admin-card:nth-of-type(3) .admin-table tbody tr", ms: 640 },
        { wait: 200 },
        { cam: { fit: ".admin-grid > .admin-card:nth-of-type(4)", anchor: "top", ms: 1000 } },
        { point: ".admin-grid > .admin-card:nth-of-type(4) .admin-rows li", ms: 620 },
        { wait: 300 },
      ],
    },
    3: {
      chapter: "Provider connections",
      url: ADMIN_BOOT,
      nav: "Settings",
      await: [".admin-grid > .admin-card:nth-of-type(5)"],
      before: adminBefore(),
      opening: { fit: ".admin-grid > .admin-card:nth-of-type(5)", anchor: "top" },
      entry: { x: 930, y: 470 },
      hold: 400,
      tail: 320,
      shots: [
        // Connections and field mappings share one band; blueprints follow it.
        { cam: { fit: ".admin-grid > .admin-band", anchor: "top", ms: 1150 } },
        { point: ".admin-grid > .admin-band .admin-rows li", ms: 640 },
        { wait: 200 },
        { cam: { fit: ".admin-grid > .admin-card:nth-of-type(5)", anchor: "top", ms: 1000 } },
        { wait: 320 },
      ],
    },
  },
};
