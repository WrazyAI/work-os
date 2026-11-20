import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Camera, ShieldCheck } from "lucide-react";
import { ScreenshotImage } from "../ScreenshotGallery";
import { useNotifications } from "../NotificationFlyouts";
import { formatWorkOsFullDate, formatWorkOsTime } from "../dateFormat";
import { relativeTime, requestScreenshotAccess, statusLabel } from "./data";
import { AdminButton, Drawer, Notice, Pill, TextField } from "./ui";
import {
  evidenceActor,
  evidenceAssignee,
  evidenceAutomation,
  evidenceContentLabel,
  evidenceRelationLabel,
  evidencePerson,
  evidenceScreenshot,
  evidenceStatus,
  evidenceWhoNote,
} from "./evidenceModel";
import type { EvidenceRow } from "./types";

function statusPillTone(tone: "observed" | "quiet" | "warn" | "danger") {
  if (tone === "observed") return "observed" as const;
  if (tone === "warn") return "warn" as const;
  if (tone === "danger") return "err" as const;
  return "neutral" as const;
}

function sameInstant(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return !left && !right;
  return new Date(left).getTime() === new Date(right).getTime();
}

export default function EvidenceDetailDrawer({ row, viewerPersonId = "", onClose }: {
  row: EvidenceRow | null;
  viewerPersonId?: string;
  onClose: () => void;
}) {
  const notifications = useNotifications();
  const [reason, setReason] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const generation = useRef(0);
  const activeRowId = useRef<string | null>(null);

  useEffect(() => {
    activeRowId.current = row?.id ?? null;
    generation.current += 1;
    setReason("");
    setScreenshotUrl(null);
    setScreenshotError(null);
  }, [row?.id]);

  const access = useMutation({
    mutationFn: ({ summaryId, reason: why }: { summaryId: string; reason: string; rowId: string; generation: number }) => requestScreenshotAccess(summaryId, why),
    onSuccess: (result, variables) => {
      if (variables.rowId !== activeRowId.current || variables.generation !== generation.current) return;
      setScreenshotError(null);
      setScreenshotUrl(result.url);
      notifications.success("The retained frame is ready; this view was recorded with your reason.", "Screenshot access prepared");
    },
    onError: (error, variables) => {
      if (variables.rowId !== activeRowId.current || variables.generation !== generation.current) return;
      setScreenshotError((error as Error).message);
    },
  });

  const shot = row ? evidenceScreenshot(row) : null;
  const reviewable = !!row && (row.event?.correction_status === "disputed" || (row.event?.metadata as Record<string, unknown> | undefined)?.needsReview === true);
  const own = !!row?.person?.id && !!viewerPersonId && String(row.person.id) === String(viewerPersonId);
  const status = row ? evidenceStatus(row) : null;
  const disputed = row?.event?.correction_status === "disputed";
  const occurred = row ? row.recorded_at ?? row.created_at : null;
  const mirrored = row?.created_at;
  const person = row ? evidencePerson(row) : null;
  const pendingForRow = access.isPending && (access.variables as { rowId?: string } | undefined)?.rowId === row?.id;
  const personHeading = person ? (person.tone === "context" ? `Assigned to ${person.name}` : person.name) : "Unmapped person";

  return (
    <Drawer
      open={!!row}
      onClose={onClose}
      title={row?.title ?? "Evidence"}
      subtitle={row ? `${personHeading} · ${formatWorkOsFullDate(row.evidence_date)}` : undefined}
      width={560}
    >
      {row ? (
        <div className="admin-grid admin-drawer-grid evidence-detail">
          <div className="evidence-detail-pills">
            {status ? <Pill tone={statusPillTone(status.tone)}>{status.label}</Pill> : null}
            <Pill tone="neutral">{row.source === "ghl" ? "GoHighLevel" : row.source === "worktivity" ? "Worktivity" : row.source === "github" ? "GitHub" : statusLabel(row.source)}</Pill>
            {disputed ? <Pill tone="err">Disputed</Pill> : null}
          </div>

          <section className="admin-block">
            <h3>What happened</h3>
            <p>{row.summary || "No summary was recorded for this item."}</p>
            {disputed ? <Notice tone="warn">This record is disputed. The provider event is preserved; the correction state is shown in Provenance.</Notice> : null}
          </section>

          <section className="admin-block">
            <h3>Who</h3>
            <div className="evidence-who-grid">
              <div><span>Actor</span><b>{evidenceActor(row)}</b></div>
              <div><span>Assigned</span><b>{evidenceAssignee(row) ?? "—"}</b></div>
              <div><span>Automation</span><b>{evidenceAutomation(row) ? "Yes" : "No"}</b></div>
            </div>
            <p className="admin-quiet">{evidenceWhoNote(row)}</p>
          </section>

          <section className="admin-block">
            <h3>Provider record</h3>
            <div className="admin-kv-grid">
              <div className="admin-kv"><span>Occurred</span><b>{formatWorkOsFullDate(occurred)} · {formatWorkOsTime(occurred)}</b></div>
              <div className="admin-kv"><span>Mirrored</span><b>{sameInstant(occurred, mirrored) ? "Same as occurred" : `${formatWorkOsFullDate(mirrored)} · ${formatWorkOsTime(mirrored)}`}</b></div>
              <div className="admin-kv"><span>Class</span><b>{statusLabel(row.event?.evidence_class ?? "—")}</b></div>
              <div className="admin-kv"><span>Relation</span><b>{evidenceRelationLabel(row)}</b></div>
              <div className="admin-kv"><span>Content</span><b>{evidenceContentLabel(row)}</b></div>
              {row.task ? <div className="admin-kv"><span>Task</span><b>{row.task.title}</b></div> : null}
            </div>
            <p className="admin-quiet">Rows are ordered by the provider occurrence time. The mirrored time is the write that copied the event into Work OS, not when it happened.</p>
          </section>

          <section className="admin-block">
            <h3>Provenance</h3>
            <div className="admin-kv-grid">
              <div className="admin-kv"><span>Event id</span><b className="is-mono">{row.ghl?.eventId ?? row.id}</b></div>
              <div className="admin-kv"><span>Correction</span><b>{statusLabel(row.event?.correction_status ?? "none")}</b></div>
              <div className="admin-kv"><span>Recorded</span><b>{relativeTime(row.created_at)}</b></div>
            </div>
            {row.url ? <p><a href={row.url} target="_blank" rel="noreferrer">Open the artifact</a></p> : null}
          </section>

          {shot?.id ? (
            <section className="admin-block">
              <h3><ShieldCheck size={14} aria-hidden /> Screenshot frame</h3>
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Processing</span><b>{statusLabel(shot.processing_status)}</b></div>
                <div className="admin-kv"><span>Confidence</span><b>{shot.confidence != null ? `${Math.round(shot.confidence * 100)}%` : "—"}</b></div>
              </div>
              {shot.summary ? <p className="admin-quiet">{shot.summary}</p> : null}
              {shot.deleted_at ? (
                <Notice tone="warn">This frame was flagged as sensitive and the image was deleted; the summary stays on the record.</Notice>
              ) : own ? (
                <>
                  <ScreenshotImage summaryId={shot.id} size="preview" alt="Your retained Worktivity frame for this evidence item" className="admin-shot" unavailableLabel="This frame is no longer available" />
                  <p className="admin-quiet">Your own retained frame. Each preview is recorded in the screenshot access log.</p>
                </>
              ) : reviewable ? (
                <>
                  <p className="admin-quiet">Raw frames stay limited to flagged or disputed review. Every view is recorded with the reason you give.</p>
                  <div className="admin-inline-fields">
                    <TextField label="Reason" value={reason} onChange={setReason} ariaLabel="Reason for viewing this retained screenshot" placeholder="Why this frame is being reviewed" />
                    <AdminButton
                      variant="secondary"
                      icon={Camera}
                      disabled={!reason.trim() || pendingForRow}
                      onClick={() => {
                        const requestGeneration = generation.current + 1;
                        generation.current = requestGeneration;
                        access.mutate({ summaryId: shot.id, reason: reason.trim(), rowId: row.id, generation: requestGeneration });
                      }}
                    >
                      {pendingForRow ? "Preparing…" : "View frame"}
                    </AdminButton>
                  </div>
                  {screenshotError ? <Notice tone="err">{screenshotError}</Notice> : null}
                  {screenshotUrl ? <img className="admin-shot" src={screenshotUrl} alt="Retained screenshot frame for this evidence item" /> : null}
                </>
              ) : (
                <Notice tone="info">Raw frames stay behind the flagged/disputed review rule. This item is not disputed, so only its summary is shown.</Notice>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
