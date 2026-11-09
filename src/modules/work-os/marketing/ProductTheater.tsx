"use client";

import { useState } from "react";
import Companion from "./Companion";
import styles from "./landing.module.css";

const VIEWS = [
  {
    id: "today",
    label: "My Day",
    src: "/site/work-os/workspace-today.webp",
    alt: "Work OS desktop My Day with the workday surface, counts, focus, task queue and weekly record; demonstration data",
  },
  {
    id: "tasks",
    label: "Tasks",
    src: "/site/work-os/workspace-tasks.webp",
    alt: "Work OS desktop Tasks with focus, views, search, due dates and status; demonstration data",
  },
  {
    id: "insights",
    label: "Insights",
    src: "/site/work-os/workspace-insights.webp",
    alt: "Work OS desktop Insights with measured outcomes, plan reliability and the weekly chart; demonstration data",
  },
] as const;

export default function ProductTheater() {
  const [active, setActive] = useState<(typeof VIEWS)[number]["id"]>("tasks");
  const view = VIEWS.find((item) => item.id === active) ?? VIEWS[0];
  return (
    <div className={styles.stage} data-hero-stage aria-label="A look inside Work OS">
      <div className={styles.orbit} aria-hidden="true" />
      <p className={styles.stageCaption}>A clearer day begins here.</p>
      <div className={styles.window} data-product-window>
        <div className={styles.windowBar}>
          <span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span>
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
        <img src={view.src} alt={view.alt} width={1600} height={1000} data-product-capture />
      </div>
      <div className={styles.companion}><Companion /></div>
      <p className={styles.speech}>You bring the work.<br />I&apos;ll help keep the pieces together.</p>
      <div className={styles.motionTools}><span>Actual desktop companion · Demonstration data</span></div>
    </div>
  );
}
