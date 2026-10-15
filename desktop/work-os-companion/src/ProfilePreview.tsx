import { useMemo } from "react";
import { X } from "lucide-react";
import { ProfileSettings } from "./ProfileSettings";
import { PREVIEW_DATA } from "./OnboardingPreview";
import type { OnboardingData } from "./types";
import { workProfileCatalog } from "../../../src/modules/work-os/onboarding";

/** Dev-only fixture for the Profile settings modal: the real modal against the
 * shared preview person, with the reviewed catalog and mapped evidence
 * accounts, so the pill groups and the connected-account group can be reviewed
 * without a signed-in workspace. */
function profilePreviewData(): OnboardingData {
  const catalog = workProfileCatalog();
  const engineering = catalog.archetypes.find((entry) => entry.id === "engineering") ?? catalog.archetypes[0];
  const pick = (label: string) => {
    const found = engineering.items.find((entry) => entry.label === label);
    if (!found) throw new Error(`preview catalog lost ${label}`);
    return found;
  };
  return {
    ...PREVIEW_DATA,
    catalog,
    profile: {
      ...PREVIEW_DATA.profile,
      workPreferences: {
        archetypeId: engineering.id,
        inferredArchetypeId: engineering.id,
        customRoleTitle: "",
        specialtyIds: ["engineering:frontend", "engineering:platform"],
        items: ["Design and implement software", "Review and improve code", "Maintain technical quality", "Code changes", "Pull requests", "Nifty", "GitHub", "Build and deployment systems"].map(pick),
        responsibilities: ["Design and implement software", "Review and improve code", "Maintain technical quality"],
        outputTypes: ["Code changes", "Pull requests"],
        evidenceSources: ["Nifty", "GitHub", "Build and deployment systems"],
        voiceUpdatesEnabled: true,
        githubUsername: "jamie-mensah",
      },
      privacy: { screenshotAnalysisConsent: true, sensitiveAppExclusions: ["1password.com", "bank.example"] },
    },
    // One real provider each plus two GitHub accounts and the shared Actions
    // actor, so the quiet account pills are reviewed with their real content.
    providerAccounts: {
      nifty: { mapped: true, email: "jamie@wrazy.com" },
      worktivity: { mapped: true, email: "jamie@wrazy.com" },
      github: {
        accounts: [
          { login: "jamie-mensah", id: "9001", verified: true, bot: false },
          { login: "jamie-builds", id: "9002", verified: true, bot: false },
          { login: "wrazy-ci[bot]", id: "9003", verified: true, bot: true },
        ],
      },
    },
  };
}

export default function ProfilePreview() {
  const data = useMemo(() => profilePreviewData(), []);
  return <div className="task-modal-backdrop profile-backdrop">
    <section className="task-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" aria-describedby="profile-settings-description">
      <header>
        <div>
          <span>Workspace settings</span>
          <h2 id="profile-settings-title">Profile settings</h2>
          <p id="profile-settings-description">Identity, schedule, privacy, notifications, and work context.</p>
        </div>
        <button type="button" aria-label="Close profile settings"><X size={18} /></button>
      </header>
      <ProfileSettings data={data} mode="modal" busy={false} onSave={async () => undefined} onNotify={() => undefined} />
    </section>
  </div>;
}
