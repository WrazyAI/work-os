import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["admin"],
    });
    if (auth.response) return auth.response;
    const supabase = createAdminClient();
    const [{ data: connections, error: connectionError }, { data: accounts, error: accountError }] = await Promise.all([
      supabase.from("work_provider_connections").select("*").eq("organization_id", auth.access.organizationId).order("provider"),
      supabase.from("work_source_accounts").select("*, person:work_people(id, display_name)").eq("organization_id", auth.access.organizationId).order("provider"),
    ]);
    if (connectionError) throw new Error(`load provider connections: ${connectionError.message}`);
    if (accountError) throw new Error(`load source accounts: ${accountError.message}`);
    return NextResponse.json({ connections: connections ?? [], accounts: accounts ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["admin"],
    });
    if (auth.response) return auth.response;
    const body = await req.json();
    const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
    const externalWorkspaceId = typeof body.external_workspace_id === "string" ? body.external_workspace_id.trim() : "";
    if (!provider || !externalWorkspaceId) return NextResponse.json({ error: "provider and external_workspace_id are required" }, { status: 400 });
    const supabase = createAdminClient();
    const { data: current, error: currentError } = await supabase.from("work_provider_connections").select("id,organization_id")
      .eq("provider", provider).eq("external_workspace_id", externalWorkspaceId).maybeSingle();
    if (currentError) throw new Error(`load provider connection: ${currentError.message}`);
    if (current && current.organization_id !== auth.access.organizationId) {
      return NextResponse.json({ error: "provider workspace is already connected to another organization" }, { status: 409 });
    }
    const connectionPayload = {
      organization_id: auth.access.organizationId,
      provider,
      external_workspace_id: externalWorkspaceId,
      active: body.active !== false,
      config: body.config && typeof body.config === "object" ? body.config : {},
      created_by: auth.access.ctx.user.id,
      updated_at: new Date().toISOString(),
    };
    const connectionQuery = current
      ? supabase.from("work_provider_connections").update(connectionPayload).eq("id", current.id).eq("organization_id", auth.access.organizationId)
      : supabase.from("work_provider_connections").insert(connectionPayload);
    const { data: connection, error: connectionError } = await connectionQuery.select("*").single();
    if (connectionError?.code === "23505") {
      return NextResponse.json({ error: "provider workspace is already connected" }, { status: 409 });
    }
    if (connectionError) throw new Error(`save provider connection: ${connectionError.message}`);

    const savedAccounts = [];
    for (const account of Array.isArray(body.accounts) ? body.accounts : []) {
      const externalAccountId = typeof account.external_account_id === "string" ? account.external_account_id.trim() : "";
      const personId = typeof account.person_id === "string" ? account.person_id : null;
      if (!externalAccountId) continue;
      if (personId) {
        const { data: person, error: personError } = await supabase.from("work_people").select("id")
          .eq("organization_id", auth.access.organizationId).eq("id", personId).maybeSingle();
        if (personError || !person) throw new Error("source account person must belong to the organization");
      }
      const { data, error } = await supabase.from("work_source_accounts").upsert({
        organization_id: auth.access.organizationId,
        provider,
        external_account_id: externalAccountId,
        external_email: typeof account.external_email === "string" ? account.external_email.trim() : null,
        person_id: personId,
        verified: account.verified === true && !!personId,
        verified_by: account.verified === true && personId ? auth.access.ctx.user.id : null,
        verified_at: account.verified === true && personId ? new Date().toISOString() : null,
        metadata: account.metadata && typeof account.metadata === "object" ? account.metadata : {},
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider,external_account_id" }).select("*").single();
      if (error) throw new Error(`save source account: ${error.message}`);
      savedAccounts.push(data);
    }
    const { error: auditError } = await supabase.from("work_audit_log").insert({
      organization_id: auth.access.organizationId,
      actor_user_id: auth.access.ctx.user.id,
      action: "provider_connection.saved",
      target_type: "provider_connection",
      target_id: connection.id,
      metadata: { provider, externalWorkspaceId, accountCount: savedAccounts.length },
    });
    if (auditError) throw new Error(`audit provider connection: ${auditError.message}`);
    return NextResponse.json({ connection, accounts: savedAccounts });
  } catch (error) {
    return jsonError(error);
  }
}
