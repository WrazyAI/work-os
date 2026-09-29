import type React from "react";

/** One settings row: what it is, its plain-language consequence, and the
 * control. Shared by every settings group. */
export function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>;
}
