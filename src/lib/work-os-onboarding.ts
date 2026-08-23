import { createAdminClient } from "@/lib/supabase/admin";
import { WorkOsConflictError, type WorkOsAccess } from "@/lib/work-os-api";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { validateWorkOsBreakWindows, validateWorkOsTime, validateWorkOsTimezone } from "@/lib/work-os-schedule-validation";
import {
  WORK_PROFILE_CATALOG_VERSION,
  inferArchetype,
  normalizeProfileItems,
  validateArchetypeSelection,
  workProfileCatalog,
} from "@/modules/work-os/onboarding";

type Json = Record<string, unknown>;

export const WORK_OS_TRACKING_POLICY = {
  version: "work-tracking-v1",
  purpose: "Employee work planning, task coordination, evidence collection, and manager-reviewable reporting within Work OS.",
  assurance: "The collected information is limited to Work OS work-tracking purposes and is not authorized for unrelated use.",
  dataCategories: [
    "identity_profile",
    "work_schedule",
    "task_project_data",
    "activity_evidence",
    "output_evidence",
    "check_ins_reports",
  ],
} as const;

export const WORK_OS_SCREENSHOT_CONSENT_PURPOSE = "Neutral screenshot summaries for approved Work OS activity context only.";
export const WORK_OS_SCREENSHOT_POLICY = {
  retention: "Encrypted raw screenshots are retained for 30 days, then deleted.",
  limitation: "Screenshots provide sampled activity context only; they do not prove productivity or task completion.",
  sensitiveCapture: "Sensitive app/domain captures are excluded before processing or deleted immediately when detected.",
} as const;

export async function employeeTrackingConsent(organizationId: string, personId: string) {
  const supabase = db();
  const [consentResult, screenshotConsentResult] = await Promise.all([
    supabase.from("work_consent_records").select("policy_version,decision,occurred_at")
      .eq("organization_id", organizationId).eq("person_id", personId).eq("purpose", WORK_OS_TRACKING_POLICY.purpose)
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("work_consent_records").select("policy_version,decision,occurred_at")
      .eq("organization_id", organizationId).eq("person_id", personId).eq("purpose", WORK_OS_SCREENSHOT_CONSENT_PURPOSE)
      .order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (consentResult.error) throw new Error(`load employee tracking consent: ${consentResult.error.message}`);
  if (screenshotConsentResult.error) throw new Error(`load screenshot consent: ${screenshotConsentResult.error.message}`);
  return {
    tracking: consentResult.data?.decision === "accepted" && consentResult.data.policy_version === WORK_OS_TRACKING_POLICY.version,
    screenshotAnalysis: screenshotConsentResult.data?.decision === "accepted" && screenshotConsentResult.data.policy_version === WORK_OS_TRACKING_POLICY.version,
  };
}

function db() {
  return createAdminClient();
}

function text(value: unknown, max = 160) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function normalizedEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function scheduleProposal(value: unknown) {
  const input = value && typeof value === "object" ? value as Json : {};
  const days = Array.isArray(input.daysOfWeek)
    ? [...new Set(input.daysOfWeek.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
  if (!days.length) throw new Error("schedule days are required");
  const shiftStart = validateWorkOsTime(input.shiftStart, "shift start");
  const shiftEnd = validateWorkOsTime(input.shiftEnd, "shift end");
  if (shiftStart === shiftEnd) throw new Error("shift start and end must be different");
  const breaks = validateWorkOsBreakWindows(input.breaks, shiftStart, shiftEnd);
  return { daysOfWeek: days.sort(), shiftStart, shiftEnd, breaks };
}

async function policyScheduleProposal(organizationId: string, value: unknown) {
  const proposal = scheduleProposal(value);
  return await worktivityAuthoritativeBreaks(organizationId) ? { ...proposal, breaks: [] } : proposal;
}

function currentScheduleShape(schedule: Json | null) {
  if (!schedule) return null;
  const breaks = Array.isArray(schedule.break_windows) ? schedule.break_windows : [];
  return {
    daysOfWeek: Array.isArray(schedule.days_of_week) ? schedule.days_of_week : [1, 2, 3, 4, 5],
    shiftStart: String(schedule.shift_start ?? "").slice(0, 5),
    shiftEnd: String(schedule.shift_end ?? "").slice(0, 5),
    breaks: breaks.map((item) => {
      const row = item && typeof item === "object" ? item as Json : {};
      return { start: String(row.start ?? "").slice(0, 5), end: String(row.end ?? "").slice(0, 5) };
    }),
  };
}

export async function getEmployeeOnboarding(access: WorkOsAccess) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  const supabase = db();
  const today = new Date().toISOString().slice(0, 10);
  const [personResult, onboardingResult, consentResult, screenshotConsentResult, scheduleResult, teamResult] = await Promise.all([
    supabase.from("work_people").select("id,display_name,email,role_profile_id,nifty_member_id,worktivity_employee_id,github_username,work_profile,raw,role_profile:work_role_profiles(id,slug,name)")
      .eq("organization_id", access.organizationId).eq("id", access.personId).single(),
    supabase.from("work_employee_onboarding").select("*").eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle(),
    supabase.from("work_consent_records").select("policy_version,decision,occurred_at").eq("organization_id", access.organizationId).eq("person_id", access.personId)
      .eq("purpose", WORK_OS_TRACKING_POLICY.purpose).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("work_consent_records").select("policy_version,decision,occurred_at").eq("organization_id", access.organizationId).eq("person_id", access.personId)
      .eq("purpose", WORK_OS_SCREENSHOT_CONSENT_PURPOSE).order("occurred_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("work_schedules").select("*").eq("organization_id", access.organizationId).eq("person_id", access.personId).eq("active", true)
      .lte("effective_from", today).order("effective_from", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("work_team_members").select("team_id,is_manager,team:work_teams(id,name,active)").eq("person_id", access.personId),
  ]);
  if (personResult.error) throw new Error(`load onboarding person: ${personResult.error.message}`);
  if (onboardingResult.error) throw new Error(`load employee onboarding: ${onboardingResult.error.message}`);
  if (consentResult.error) throw new Error(`load employee consent: ${consentResult.error.message}`);
  if (screenshotConsentResult.error) throw new Error(`load employee screenshot consent: ${screenshotConsentResult.error.message}`);
  if (scheduleResult.error) throw new Error(`load employee schedule: ${scheduleResult.error.message}`);
  if (teamResult.error) throw new Error(`load employee teams: ${teamResult.error.message}`);
  const authoritativeBreaks = await worktivityAuthoritativeBreaks(access.organizationId);

  const person = personResult.data as Json;
  const onboarding = onboardingResult.data as Json | null;
  const raw = person.raw && typeof person.raw === "object" ? person.raw as Json : {};
  const nifty = raw.nifty && typeof raw.nifty === "object" ? raw.nifty as Json : {};
  const worktivity = raw.worktivity && typeof raw.worktivity === "object" ? raw.worktivity as Json : {};
  const teamRows = ((teamResult.data ?? []) as unknown as Array<{ team_id: string; is_manager: boolean; team: { id: string; name: string; active: boolean } | Array<{ id: string; name: string; active: boolean }> | null }>).map((row) => ({
    ...row,
    team: Array.isArray(row.team) ? row.team[0] ?? null : row.team,
  }));
  const teamIds = teamRows.filter((row) => row.team?.active !== false).map((row) => row.team_id);
  let managers: Array<{ id: string; display_name: string }> = [];
  if (teamIds.length) {
    const { data: managerLinks, error: managerLinkError } = await supabase.from("work_team_members").select("person_id").in("team_id", teamIds).eq("is_manager", true);
    if (managerLinkError) throw new Error(`load onboarding managers: ${managerLinkError.message}`);
    const managerIds = [...new Set((managerLinks ?? []).map((row) => row.person_id as string).filter((id) => id !== access.personId))];
    if (managerIds.length) {
      const { data, error } = await supabase.from("work_people").select("id,display_name").eq("organization_id", access.organizationId).in("id", managerIds);
      if (error) throw new Error(`load onboarding manager people: ${error.message}`);
      managers = data ?? [];
    }
  }

  const latestConsent = consentResult.data;
  const consentProvided = latestConsent?.decision === "accepted" && latestConsent.policy_version === WORK_OS_TRACKING_POLICY.version;
  const notifications = onboarding?.notification_preferences && typeof onboarding.notification_preferences === "object"
    ? onboarding.notification_preferences as Json : {};
  const privacy = onboarding?.privacy_preferences && typeof onboarding.privacy_preferences === "object"
    ? onboarding.privacy_preferences as Json : {};
  // Consent history, not a mutable onboarding preference, is the legal source
  // of truth. A withdrawal must immediately make onboarding incomplete.
  const screenshotConsentProvided = screenshotConsentResult.data?.decision === "accepted" &&
    screenshotConsentResult.data.policy_version === WORK_OS_TRACKING_POLICY.version;
  const workPreferences = onboarding?.work_preferences && typeof onboarding.work_preferences === "object"
    ? onboarding.work_preferences as Json : {};
  const proposedSchedule = onboarding?.schedule_proposal && typeof onboarding.schedule_proposal === "object"
    ? onboarding.schedule_proposal as Json : null;
  const officialSchedule = scheduleResult.data as Json | null;
  const roleProfile = Array.isArray(person.role_profile) ? person.role_profile[0] : person.role_profile;
  const structuredItems = normalizeProfileItems(workPreferences.items, {
    responsibility: workPreferences.responsibilities,
    deliverable: workPreferences.outputTypes,
    evidence: workPreferences.evidenceSources,
  });
  const importedTitle = String((roleProfile as Json | null)?.name ?? nifty.role ?? "").trim() || null;
  const inferredArchetypeId = inferArchetype(importedTitle);
  const employeeRequirements = {
    consentProvided,
    screenshotConsentProvided,
    profileConfirmed: !!onboarding?.profile_confirmed_at,
    timezoneProvided: !!onboarding?.timezone,
    scheduleProvided: !!officialSchedule || !!proposedSchedule?.shiftStart,
    notificationsConfigured: typeof notifications.desktopEnabled === "boolean",
    privacyAcknowledged: !!privacy.noticeAcknowledgedAt,
  };
  const employeeComplete = Object.values(employeeRequirements).every(Boolean);
  const managerRequirements = {
    roleAssigned: !!person.role_profile_id,
    teamAssigned: teamRows.length > 0,
    managerAssigned: managers.length > 0 || access.role === "admin",
    officialScheduleConfigured: !!officialSchedule,
  };

  return {
    policy: WORK_OS_TRACKING_POLICY,
    onboardingRequired: !employeeComplete,
    employeeComplete,
    employeeRequirements,
    managerRequirements,
    profile: {
      displayName: onboarding?.preferred_name ?? person.display_name,
      email: onboarding?.confirmed_email ?? person.email,
      timezone: onboarding?.timezone ?? officialSchedule?.timezone ?? nifty.tz_iana ?? "UTC",
      language: onboarding?.language ?? nifty.language ?? "en",
      weekStart: nifty.week_start ?? 1,
      timeFormat: nifty.time_format ?? null,
      schedule: officialSchedule ? currentScheduleShape(officialSchedule) : proposedSchedule ?? {
        daysOfWeek: [1, 2, 3, 4, 5], shiftStart: "09:00", shiftEnd: "17:00", breaks: [],
      },
      notifications: { desktopEnabled: notifications.desktopEnabled ?? true },
      privacy: {
        screenshotAnalysisConsent: screenshotConsentProvided,
        sensitiveAppExclusions: Array.isArray(privacy.sensitiveAppExclusions) ? privacy.sensitiveAppExclusions : [],
      },
      workPreferences: {
        archetypeId: typeof workPreferences.archetypeId === "string" ? workPreferences.archetypeId : inferredArchetypeId,
        inferredArchetypeId,
        customRoleTitle: typeof workPreferences.customRoleTitle === "string" ? workPreferences.customRoleTitle : "",
        specialtyIds: Array.isArray(workPreferences.specialtyIds) ? workPreferences.specialtyIds : [],
        items: structuredItems,
        responsibilities: structuredItems.filter((item) => item.kind === "responsibility").map((item) => item.label),
        outputTypes: structuredItems.filter((item) => item.kind === "deliverable").map((item) => item.label),
        evidenceSources: structuredItems.filter((item) => item.kind === "evidence").map((item) => item.label),
        voiceUpdatesEnabled: workPreferences.voiceUpdatesEnabled === true,
        githubUsername: person.github_username ?? "",
      },
    },
    providerPrefill: {
      nifty: { mapped: !!person.nifty_member_id, timezone: nifty.tz_iana ?? null, language: nifty.language ?? null, team: nifty.team ?? null, role: nifty.role ?? null },
      worktivity: {
        mapped: !!person.worktivity_employee_id,
        screenshotsConfigured: typeof worktivity.EnableScreenshots === "boolean" ? worktivity.EnableScreenshots : null,
        screenshotsBlurred: typeof worktivity.BlurScreenshots === "boolean" ? worktivity.BlurScreenshots : null,
      },
    },
    organizationSetup: {
      roleProfile: roleProfile ? { id: (roleProfile as Json).id, slug: (roleProfile as Json).slug, name: (roleProfile as Json).name } : null,
      teams: teamRows.map((row) => row.team).filter(Boolean),
      managers,
      officialSchedule: officialSchedule ? currentScheduleShape(officialSchedule) : null,
    },
    status: onboarding?.status ?? "not_started",
    submittedAt: onboarding?.employee_submitted_at ?? null,
    draft: { step: onboarding?.draft_step ?? "seen", updatedAt: onboarding?.draft_updated_at ?? null, revision: Number(onboarding?.draft_revision ?? 0) },
    breakPolicy: { worktivityAuthoritative: authoritativeBreaks },
    screenshotPolicy: WORK_OS_SCREENSHOT_POLICY,
    catalog: workProfileCatalog(),
  };
}

export async function saveEmployeeOnboardingDraft(access: WorkOsAccess, body: Json) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  if ("acceptTrackingConsent" in body || "privacyNoticeAcknowledged" in body ||
    (body.privacy && typeof body.privacy === "object" && "screenshotAnalysisConsent" in body.privacy)) {
    throw new Error("Consent can only be recorded during final onboarding submission.");
  }
  const allowedSteps = ["seen", "understood", "profile", "prepared", "safe"];
  const step = text(body.step, 32);
  if (!step || !allowedSteps.includes(step)) throw new Error("A valid onboarding draft step is required.");
  const supabase = db();
  const { data: existing, error: existingError } = await supabase.from("work_employee_onboarding").select("*")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle();
  if (existingError) throw new Error(`load onboarding draft: ${existingError.message}`);
  const expectedRevision = body.revision == null ? Number(existing?.draft_revision ?? 0) : Number(body.revision);
  const mutationKey = text(body.clientMutationKey, 160) ?? text(body.idempotencyKey, 160) ?? crypto.randomUUID();
  if (existing?.draft_client_mutation_key === mutationKey) return getEmployeeOnboarding(access);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("A valid onboarding draft revision is required.");
  const currentRevision = Number(existing?.draft_revision ?? 0);
  if (expectedRevision !== currentRevision) throw new WorkOsConflictError("This onboarding draft changed on another device. Refresh before saving again.");
  const currentWork = existing?.work_preferences && typeof existing.work_preferences === "object" ? existing.work_preferences as Json : {};
  const workInput = body.workPreferences && typeof body.workPreferences === "object" ? body.workPreferences as Json : {};
  const archetypeId = workInput.archetypeId ?? currentWork.archetypeId;
  const specialtyIds = workInput.specialtyIds ?? currentWork.specialtyIds;
  let workPreferences = currentWork;
  if (archetypeId) {
    const selection = validateArchetypeSelection(archetypeId, specialtyIds);
    const items = normalizeProfileItems(workInput.items ?? currentWork.items);
    const customRoleTitle = selection.archetype.id === "custom" ? text(workInput.customRoleTitle ?? currentWork.customRoleTitle, 120) : null;
    if (selection.archetype.id === "custom" && !customRoleTitle) throw new Error("Describe your custom work role.");
    workPreferences = {
      ...currentWork,
      archetypeId: selection.archetype.id,
      specialtyIds: selection.specialtyIds,
      customRoleTitle,
      items,
      responsibilities: items.filter((item) => item.kind === "responsibility").map((item) => item.label),
      outputTypes: items.filter((item) => item.kind === "deliverable").map((item) => item.label),
      evidenceSources: items.filter((item) => item.kind === "evidence").map((item) => item.label),
      voiceUpdatesEnabled: typeof workInput.voiceUpdatesEnabled === "boolean" ? workInput.voiceUpdatesEnabled : currentWork.voiceUpdatesEnabled === true,
    };
  } else if (typeof workInput.voiceUpdatesEnabled === "boolean") {
    workPreferences = { ...currentWork, voiceUpdatesEnabled: workInput.voiceUpdatesEnabled };
  }
  const now = new Date().toISOString();
  const draft: Json = {
    organization_id: access.organizationId,
    person_id: access.personId,
    status: "in_progress",
    draft_step: step,
    draft_updated_at: now,
    catalog_version: WORK_PROFILE_CATALOG_VERSION,
    draft_revision: currentRevision + 1,
    draft_client_mutation_key: mutationKey,
    work_preferences: workPreferences,
    updated_at: now,
  };
  if (body.preferredName !== undefined) draft.preferred_name = text(body.preferredName, 120);
  if (body.email !== undefined) draft.confirmed_email = text(body.email, 320);
  if (body.timezone !== undefined) draft.timezone = validateWorkOsTimezone(body.timezone);
  if (body.language !== undefined) draft.language = text(body.language, 20) ?? "en";
  if (body.schedule !== undefined) draft.schedule_proposal = await policyScheduleProposal(access.organizationId, body.schedule);
  if (body.notifications && typeof body.notifications === "object") {
    const notifications = body.notifications as Json;
    if (typeof notifications.desktopEnabled !== "boolean") throw new Error("Desktop notification preference must be true or false.");
    draft.notification_preferences = { desktopEnabled: notifications.desktopEnabled };
  }
  if (body.privacy && typeof body.privacy === "object") {
    const privacy = body.privacy as Json;
    const currentPrivacy = (existing?.privacy_preferences && typeof existing.privacy_preferences === "object") ? existing.privacy_preferences as Json : {};
    const { screenshotAnalysisConsent: _legacyScreenshotConsent, ...privacyWithoutLegacyConsent } = currentPrivacy;
    draft.privacy_preferences = {
      ...privacyWithoutLegacyConsent,
      sensitiveAppExclusions: Array.isArray(privacy.sensitiveAppExclusions)
        ? privacy.sensitiveAppExclusions.map((entry) => text(entry, 100)).filter(Boolean).slice(0, 30)
        : [],
    };
  }
  const saved = existing
    ? await supabase.from("work_employee_onboarding").update(draft).eq("organization_id", access.organizationId).eq("person_id", access.personId).eq("draft_revision", currentRevision).select("id").maybeSingle()
    : await supabase.from("work_employee_onboarding").insert(draft).select("id").maybeSingle();
  if (saved.error) throw new Error(`save onboarding draft: ${saved.error.message}`);
  if (!saved.data) throw new WorkOsConflictError("This onboarding draft changed on another device. Refresh before saving again.");
  if (existing?.draft_step !== step) await supabase.from("work_audit_log").insert({
    organization_id: access.organizationId, actor_user_id: access.ctx.user.id,
    action: "onboarding.draft_saved", target_type: "person", target_id: access.personId,
    metadata: { step, revision: currentRevision + 1, catalogVersion: WORK_PROFILE_CATALOG_VERSION, source: "desktop" },
  });
  return getEmployeeOnboarding(access);
}

export async function submitEmployeeOnboarding(access: WorkOsAccess, body: Json) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  if (body.acceptTrackingConsent !== true) throw new Error("tracking consent must be accepted to continue");
  const privacyInput = body.privacy && typeof body.privacy === "object" ? body.privacy as Json : {};
  if (privacyInput.screenshotAnalysisConsent !== true) throw new Error("screenshot-analysis consent must be accepted to continue");
  if (body.privacyNoticeAcknowledged !== true) throw new Error("privacy notice acknowledgement is required");
  const preferredName = text(body.preferredName, 120);
  const confirmedEmail = text(body.email, 320);
  if (!preferredName || !confirmedEmail) throw new Error("preferred name and email are required");
  const { data: person, error: personError } = await db().from("work_people").select("email").eq("organization_id", access.organizationId).eq("id", access.personId).single();
  if (personError) throw new Error(`load onboarding identity: ${personError.message}`);
  if (normalizedEmail(person.email) !== normalizedEmail(confirmedEmail)) throw new Error("confirmed email must match the mapped work email");
  const timezone = validateWorkOsTimezone(body.timezone);
  const language = text(body.language, 20) ?? "en";
  const proposedSchedule = await policyScheduleProposal(access.organizationId, body.schedule);
  const notificationsInput = body.notifications && typeof body.notifications === "object" ? body.notifications as Json : {};
  if (typeof notificationsInput.desktopEnabled !== "boolean") throw new Error("desktop notification preference is required");
  const workInput = body.workPreferences && typeof body.workPreferences === "object" ? body.workPreferences as Json : {};
  const selection = validateArchetypeSelection(workInput.archetypeId, workInput.specialtyIds);
  const profileItems = normalizeProfileItems(workInput.items, {
    responsibility: workInput.responsibilities,
    deliverable: workInput.outputTypes,
    evidence: workInput.evidenceSources,
  });
  if (!profileItems.length) throw new Error("Confirm at least one responsibility, deliverable, or evidence source.");
  const customRoleTitle = selection.archetype.id === "custom" ? text(workInput.customRoleTitle, 120) : null;
  if (selection.archetype.id === "custom" && !customRoleTitle) throw new Error("Describe your custom work role.");
  const exclusions = Array.isArray(privacyInput.sensitiveAppExclusions)
    ? privacyInput.sensitiveAppExclusions.map((item) => text(item, 100)).filter(Boolean).slice(0, 30)
    : [];
  const expectedRevision = Number(body.revision ?? 0);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error("A valid onboarding draft revision is required.");
  const mutationKey = text(body.clientMutationKey, 160) ?? crypto.randomUUID();
  const workPreferences = {
    archetypeId: selection.archetype.id, specialtyIds: selection.specialtyIds, customRoleTitle, items: profileItems,
    responsibilities: profileItems.filter((item) => item.kind === "responsibility").map((item) => item.label),
    outputTypes: profileItems.filter((item) => item.kind === "deliverable").map((item) => item.label),
    evidenceSources: profileItems.filter((item) => item.kind === "evidence").map((item) => item.label),
    voiceUpdatesEnabled: workInput.voiceUpdatesEnabled === true, githubUsername: text(workInput.githubUsername, 120) ?? "",
  };
  const { error } = await db().rpc("work_submit_employee_onboarding", {
    p_organization_id: access.organizationId, p_person_id: access.personId, p_actor_user_id: access.ctx.user.id,
    p_expected_revision: expectedRevision, p_mutation_key: mutationKey,
    p_payload: {
      preferredName, email: confirmedEmail, timezone, language, schedule: proposedSchedule,
      notifications: { desktopEnabled: notificationsInput.desktopEnabled },
      privacy: { sensitiveAppExclusions: exclusions, noticeAcknowledgedAt: new Date().toISOString() },
      workPreferences, catalogVersion: WORK_PROFILE_CATALOG_VERSION, policyVersion: WORK_OS_TRACKING_POLICY.version,
      trackingPurpose: WORK_OS_TRACKING_POLICY.purpose, screenshotPurpose: WORK_OS_SCREENSHOT_CONSENT_PURPOSE,
      source: text(body.source, 20) ?? "desktop",
    },
  });
  if (error) {
    if (/another device|40001/i.test(error.message)) throw new WorkOsConflictError("This onboarding draft changed on another device. Refresh before submitting again.");
    throw new Error(`submit employee onboarding atomically: ${error.message}`);
  }
  return getEmployeeOnboarding(access);
}

export async function updateEmployeeConsent(access: WorkOsAccess, body: Json) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  const action = text(body.action, 40);
  if (!action || !["withdraw_tracking", "withdraw_screenshot_analysis"].includes(action)) {
    throw new Error("action must be withdraw_tracking or withdraw_screenshot_analysis; reacceptance requires the Safe-phase final submission");
  }
  const supabase = db();
  const { data: onboarding, error: onboardingError } = await supabase.from("work_employee_onboarding")
    .select("privacy_preferences")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId).maybeSingle();
  if (onboardingError) throw new Error(`load employee privacy preferences: ${onboardingError.message}`);
  if (!onboarding) throw new Error("employee onboarding must be submitted before consent can be changed");
  const now = new Date().toISOString();
  const loadedPrivacy = onboarding.privacy_preferences && typeof onboarding.privacy_preferences === "object"
    ? onboarding.privacy_preferences as Json : {};
  const { screenshotAnalysisConsent: _legacyScreenshotConsent, ...currentPrivacy } = loadedPrivacy;

  if (action === "withdraw_tracking") {
    const { error } = await supabase.from("work_consent_records").insert({
      organization_id: access.organizationId,
      person_id: access.personId,
      policy_version: WORK_OS_TRACKING_POLICY.version,
      purpose: WORK_OS_TRACKING_POLICY.purpose,
      data_categories: [...WORK_OS_TRACKING_POLICY.dataCategories],
      decision: "withdrawn",
      created_by: access.ctx.user.id,
      metadata: { source: text(body.source, 20) ?? "web", reason: text(body.reason, 240) },
    });
    if (error) throw new Error(`record tracking consent withdrawal: ${error.message}`);
    const { error: updateError } = await supabase.from("work_employee_onboarding").update({
      privacy_preferences: currentPrivacy,
      status: "changes_requested",
      updated_at: now,
    }).eq("organization_id", access.organizationId).eq("person_id", access.personId);
    if (updateError) throw new Error(`save withdrawn tracking preferences: ${updateError.message}`);
  } else {
    const { error } = await supabase.from("work_consent_records").insert({
      organization_id: access.organizationId,
      person_id: access.personId,
      policy_version: WORK_OS_TRACKING_POLICY.version,
      purpose: WORK_OS_SCREENSHOT_CONSENT_PURPOSE,
      data_categories: ["approved_screenshot_summaries"],
      decision: "withdrawn",
      created_by: access.ctx.user.id,
      metadata: { source: text(body.source, 20) ?? "web", reason: text(body.reason, 240) },
    });
    if (error) throw new Error(`record screenshot consent change: ${error.message}`);
    const { error: updateError } = await supabase.from("work_employee_onboarding").update({
      privacy_preferences: currentPrivacy,
      updated_at: now,
    }).eq("organization_id", access.organizationId).eq("person_id", access.personId);
    if (updateError) throw new Error(`save screenshot preferences: ${updateError.message}`);
  }

  const { error: auditError } = await supabase.from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action: `consent.${action}`,
    target_type: "person",
    target_id: access.personId,
    metadata: { policyVersion: WORK_OS_TRACKING_POLICY.version },
  });
  if (auditError) throw new Error(`audit consent change: ${auditError.message}`);
  return getEmployeeOnboarding(access);
}

export async function resetEmployeeOnboarding(access: WorkOsAccess) {
  if (!access.personId) throw new Error("Work OS person mapping required");
  const supabase = db();
  const now = new Date().toISOString();
  const { error: resetError } = await supabase.from("work_employee_onboarding").upsert({
    organization_id: access.organizationId,
    person_id: access.personId,
    preferred_name: null,
    confirmed_email: null,
    timezone: null,
    language: null,
    schedule_proposal: {},
    notification_preferences: {},
    privacy_preferences: {},
    work_preferences: {},
    catalog_version: null,
    draft_step: null,
    draft_updated_at: null,
    profile_confirmed_at: null,
    employee_submitted_at: null,
    status: "not_started",
    reviewed_by: null,
    reviewed_at: null,
    review_note: null,
    updated_at: now,
  }, { onConflict: "organization_id,person_id" });
  if (resetError) throw new Error(`reset employee onboarding: ${resetError.message}`);

  const { error: profileError } = await supabase.from("work_people").update({
    github_username: null,
    updated_at: now,
  }).eq("organization_id", access.organizationId).eq("id", access.personId);
  if (profileError) throw new Error(`reset employee profile preferences: ${profileError.message}`);

  const { error: auditError } = await supabase.from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action: "onboarding.employee_reset",
    target_type: "person",
    target_id: access.personId,
    metadata: {
      source: "desktop",
      preserved: ["role_profile", "team", "manager", "official_schedule", "consent_history"],
    },
  });
  if (auditError) throw new Error(`audit employee onboarding reset: ${auditError.message}`);
  return getEmployeeOnboarding(access);
}
