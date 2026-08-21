export type DbUserRole = "owner" | "member";
export type UiUserRole = "admin" | "user";

export function isAdminDbRole(role: DbUserRole): boolean {
  return role === "owner";
}

export function dbRoleToUiRole(role: DbUserRole): UiUserRole {
  return role === "owner" ? "admin" : "user";
}

export function uiRoleToDbRole(role: string): DbUserRole | null {
  const value = role.trim().toLowerCase();
  if (value === "admin" || value === "owner") return "owner";
  if (value === "user" || value === "member") return "member";
  return null;
}

export function dbRoleLabel(role: DbUserRole): string {
  return role === "owner" ? "Admin" : "User";
}
