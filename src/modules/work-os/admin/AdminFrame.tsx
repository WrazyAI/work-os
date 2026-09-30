"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AdminShell, { type AdminSection } from "./AdminShell";

function sectionFor(pathname: string): AdminSection {
  if (pathname.startsWith("/work-os/admin/people")) return "people";
  if (pathname.startsWith("/work-os/admin/tasks")) return "tasks";
  if (pathname.startsWith("/work-os/admin/review")) return "review";
  if (pathname.startsWith("/work-os/admin/insights")) return "insights";
  if (pathname.startsWith("/work-os/admin/evidence")) return "evidence";
  if (pathname.startsWith("/work-os/admin/settings")) return "settings";
  return "overview";
}

export default function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <AdminShell section={sectionFor(pathname)}>{children}</AdminShell>;
}
