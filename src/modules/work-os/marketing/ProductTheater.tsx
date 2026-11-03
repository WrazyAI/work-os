"use client";

import { useState } from "react";
import styles from "./landing.module.css";

const VIEWS = [
  {
    id: "today",
    label: "My Day",
    src: "/work-os/workspace-today.webp",
    alt: "Work OS desktop My Day with the workday surface, counts, focus, task queue and weekly record; demonstration data",
  },
  {
    id: "tasks",
    label: "Tasks",
    src: "/work-os/workspace-tasks.webp",
    alt: "Work OS desktop Tasks with focus, views, search, due dates and status; demonstration data",
  },
  {
    id: "insights",
    label: "Insights",
    src: "/work-os/workspace-insights.webp",
    alt: "Work OS desktop Insights with measured outcomes, plan reliability and the weekly chart; demonstration data",
  },
] as const;

export default function ProductTheater() {
  const [active, setActive] = useState<(typeof VIEWS)[number]["id"]>("today");
  const view = VIEWS.find((item) => item.id === active) ?? VIEWS[0];
  return (
    <div className={styles.theater}>
      <div className={styles.theaterTop}>
        <span>Your workday, brought together.</span>
        <div className={styles.views} role="group" aria-label="Product screenshots">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={active === item.id}
              onClick={() => setActive(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.window}>
        <div className={styles.windowBar}>Work OS · Desktop companion</div>
        <img src={view.src} alt={view.alt} width={1600} height={1000} />
      </div>
      <p className={styles.theaterNote}>
        <span aria-hidden="true" className={styles.dot} />
        Actual desktop companion · Demonstration data
      </p>
    </div>
  );
}
