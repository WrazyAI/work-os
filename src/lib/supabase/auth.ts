// Server helpers for reading the current user in Server Components / Route
// Handlers. The proxy already gates routes, but use requireUser() in API routes
// and Server Actions to get the verified user id for RLS-scoped writes.
import { redirect } from "next/navigation";
import { createClient } from "./server";
import { isAdminDbRole, type DbUserRole } from "@/lib/userRoles";

export interface AppProfile {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: DbUserRole;
  createdAt: string;
}

function toProfile(row: {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: DbUserRole;
  created_at: string;
}): AppProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: row.created_at,
  };
}

async function getProfileById(userId: string): Promise<AppProfile | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_url, role, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load current profile: ${error.message}`);
  }
  return data ? toProfile(data) : null;
}

export async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentProfile() {
  const user = await getUser();
  if (!user) return null;
  return getProfileById(user.id);
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireUserProfile() {
  const user = await requireUser();
  const profile = await getProfileById(user.id);
  if (!profile) {
    throw new Error("Current user has no profile row.");
  }
  return { user, profile };
}

export async function requireAdminPage() {
  const ctx = await requireUserProfile();
  if (!isAdminDbRole(ctx.profile.role)) redirect("/");
  return ctx;
}
