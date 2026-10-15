import type { ReactNode } from "react";
import type { GuideView } from "./guideState";

/**
 * Drawn scenes for the page guides that were never filmed.
 *
 * The employee pages play film of the real companion; the administration
 * sections have no footage, so their guides keep the earlier scene
 * vocabulary: one inline SVG per page, in the workspace palette, decorative
 * to assistive technology, with one visible phase per numbered step. A scene
 * says what the page is for; the step copy beside it says everything the
 * scene shows in words, which is the accessible path (§8.11).
 */

function Scene({ view, activeStep, children }: { view: GuideView; activeStep: number; children: ReactNode }) {
  return (
    <div
      id="page-guide-art"
      className="guide-art"
      data-guide-view={view}
      data-active-step={activeStep}
      role="presentation"
      aria-hidden="true"
    >
      <svg viewBox="0 0 360 150" focusable="false">
        <rect x="0.5" y="0.5" width="359" height="149" rx="14" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        {children}
      </svg>
    </div>
  );
}

function Phase({ step, activeStep, children }: { step: number; activeStep: number; children: ReactNode }) {
  return (
    <g className={`guide-phase${step === activeStep ? " is-active" : ""}`} data-phase={step}>
      {children}
    </g>
  );
}

function Check({ x, y, color = "var(--ink, #171914)", width = 1.6 }: { x: number; y: number; color?: string; width?: number }) {
  return <path d={`M${x - 4.5} ${y + 0.5} l3.2 3.2 l6.2 -6.6`} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
}

/** A roster row: avatar, name line, and an attendance dot with its freshness line. */
function RosterRow({ y, tone }: { y: number; tone: "signal" | "paper" | "muted" }) {
  const dot = tone === "signal" ? "var(--signal, #b8ff5a)" : tone === "muted" ? "var(--muted, #696c64)" : "var(--paper, #f5f4ed)";
  return (
    <g>
      <circle cx="46" cy={y + 10} r="9" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      <line x1="62" y1={y + 6} x2="150" y2={y + 6} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <line x1="62" y1={y + 15} x2="118" y2={y + 15} stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="168" cy={y + 10} r="4" fill={dot} stroke={tone === "paper" ? "var(--line, #dcdcd3)" : "none"} />
    </g>
  );
}

/** A list row with a leading marker: the attention and queue vocabulary. */
function MarkerRow({ y, active = false, width = 200 }: { y: number; active?: boolean; width?: number }) {
  return (
    <g>
      <rect x="34" y={y} width={width} height="22" rx="8" fill={active ? "var(--signal, #b8ff5a)" : "var(--white, #fbfaf4)"} opacity={active ? 0.3 : 1} stroke="var(--line, #dcdcd3)" />
      <circle cx="48" cy={y + 11} r="3.5" fill={active ? "var(--signal, #b8ff5a)" : "var(--muted, #696c64)"} />
      <line x1="60" y1={y + 11} x2={34 + width - 18} y2={y + 11} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity={active ? 0.6 : 0.4} />
    </g>
  );
}

function AdminOverviewArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_overview" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <RosterRow y={30} tone="signal" />
        <RosterRow y={62} tone="muted" />
        <RosterRow y={94} tone="paper" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <MarkerRow y={26} active />
        <MarkerRow y={54} />
        <MarkerRow y={82} />
        <MarkerRow y={110} width={170} />
        <path d="M286 30 l10 16 h-20 z" fill="var(--signal, #b8ff5a)" opacity="0.7" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <line x1="52" y1="34" x2="52" y2="120" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        {[38, 74, 110].map((y, index) => (
          <g key={y}>
            <circle cx="52" cy={y} r="5" fill={index === 0 ? "var(--signal, #b8ff5a)" : "var(--paper, #f5f4ed)"} stroke="var(--line, #dcdcd3)" />
            <line x1="68" y1={y} x2={180 - index * 24} y2={y} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
          </g>
        ))}
      </Phase>
    </Scene>
  );
}

function AdminPeopleArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_people" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <MarkerRow y={34} active />
        <MarkerRow y={66} />
        <MarkerRow y={98} />
        <rect x="220" y="30" width="46" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="252" y="62" width="46" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="252" y="94" width="46" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="120" y="20" width="210" height="110" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <circle cx="152" cy="50" r="15" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="176" y1="44" x2="270" y2="44" stroke="var(--ink, #171914)" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
        <line x1="176" y1="57" x2="240" y2="57" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="136" y="78" width="54" height="15" rx="7.5" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="198" y="78" width="54" height="15" rx="7.5" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="136" y1="110" x2="300" y2="110" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="30" y="24" width="150" height="102" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        {[40, 66, 92].map((y, index) => (
          <g key={y}>
            <circle cx="52" cy={y} r="5" fill={index === 2 ? "var(--signal, #b8ff5a)" : "var(--muted, #696c64)"} />
            <line x1="66" y1={y} x2={150} y2={y} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
          </g>
        ))}
        <rect x="200" y="30" width="130" height="72" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <rect x="214" y="70" width="16" height={18} rx="4" fill="var(--signal, #b8ff5a)" />
        <rect x="238" y="56" width="16" height="32" rx="4" fill="var(--signal, #b8ff5a)" opacity="0.55" />
        <rect x="262" y="44" width="16" height="44" rx="4" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="214" y1="42" x2="296" y2="42" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
    </Scene>
  );
}

function AdminTasksArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_tasks" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="30" y="28" width="300" height="24" rx="9" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <rect x="40" y="34" width="58" height="12" rx="6" fill="var(--signal, #b8ff5a)" opacity="0.55" />
        <rect x="104" y="34" width="52" height="12" rx="6" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="162" y="34" width="52" height="12" rx="6" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <MarkerRow y={70} active />
        <rect x="34" y="98" width="120" height="13" rx="6.5" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="162" y="98" width="72" height="13" rx="6.5" fill="var(--signal, #b8ff5a)" opacity="0.5" />
        <line x1="250" y1="104" x2="318" y2="104" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="34" y="30" width="200" height="24" rx="9" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" strokeDasharray="5 4" />
        <path d="M46 42 h12 M52 36 v12" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <rect x="248" y="30" width="82" height="24" rx="9" fill="var(--signal, #b8ff5a)" />
        <Check x={286} y={42} width={1.5} />
        <MarkerRow y={78} />
        <MarkerRow y={110} />
      </Phase>
    </Scene>
  );
}

function AdminReviewArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_review" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <MarkerRow y={26} width={130} active />
        <MarkerRow y={58} width={130} />
        <MarkerRow y={90} width={130} />
        <rect x="34" y="122" width="80" height="8" rx="4" fill="var(--line, #dcdcd3)" opacity="0.7" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="120" y="20" width="210" height="110" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="136" y1="40" x2="230" y2="40" stroke="var(--ink, #171914)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <line x1="136" y1="58" x2="310" y2="58" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="136" y1="72" x2="298" y2="72" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="136" y1="86" x2="304" y2="86" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="136" y="102" width="60" height="14" rx="7" fill="var(--signal, #b8ff5a)" opacity="0.55" />
        <rect x="202" y="102" width="60" height="14" rx="7" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="40" y="36" width="140" height="78" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="54" y1="54" x2="150" y2="54" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="54" y1="68" x2="166" y2="68" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="54" y1="82" x2="132" y2="82" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="200" y="44" width="124" height="26" rx="10" fill="var(--signal, #b8ff5a)" />
        <Check x={262} y={57} width={1.6} />
        <rect x="200" y="80" width="94" height="22" rx="9" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
    </Scene>
  );
}

function AdminInsightsArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_insights" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="30" y="26" width="64" height="24" rx="12" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="102" y="26" width="64" height="24" rx="12" fill="var(--signal, #b8ff5a)" />
        <rect x="174" y="26" width="64" height="24" rx="12" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="30" y1="70" x2="330" y2="70" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="30" y1="98" x2="270" y2="98" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="30" y="24" width="140" height="60" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="42" y1="42" x2="158" y2="42" stroke="var(--ink, #171914)" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
        <line x1="42" y1="56" x2="146" y2="56" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="42" y1="68" x2="152" y2="68" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        {[186, 240, 294].map((x, index) => (
          <g key={x}>
            <rect x={x - 42} y="24" width="42" height="60" rx="9" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
            <line x1={x - 32} y1="38" x2={x - 12} y2="38" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
            <rect x={x - 32} y={66 - (index === 1 ? 14 : 8)} width="22" height={index === 1 ? 14 : 8} rx="4" fill={index === 1 ? "var(--signal, #b8ff5a)" : "var(--paper, #f5f4ed)"} stroke="var(--line, #dcdcd3)" />
          </g>
        ))}
        <line x1="30" y1="102" x2="330" y2="102" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="30" y="26" width="206" height="96" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        {[46, 70, 94].map((y, index) => (
          <g key={y}>
            <circle cx="50" cy={y} r="6" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
            <line x1="64" y1={y} x2={140} y2={y} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
            <rect x={150} y={y - 4} width={40 + index * 18} height="8" rx="4" fill="var(--signal, #b8ff5a)" opacity={index === 0 ? 0.9 : 0.5} />
          </g>
        ))}
        <rect x="252" y="26" width="78" height="96" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="266" y1="48" x2="316" y2="48" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="266" y1="66" x2="306" y2="66" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="266" y1="84" x2="312" y2="84" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
    </Scene>
  );
}

function AdminEvidenceArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_evidence" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="30" y="24" width="52" height="16" rx="8" fill="var(--signal, #b8ff5a)" opacity="0.55" />
        <rect x="90" y="24" width="52" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="150" y="24" width="62" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="30" y1="58" x2="62" y2="58" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <MarkerRow y={70} />
        <MarkerRow y={100} width={170} />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="30" y="24" width="150" height="50" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <circle cx="54" cy="49" r="11" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <path d="M50 45 v8 M50 49 h6 a3 3 0 0 0 0 -6 h-2" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="74" y1="42" x2="160" y2="42" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="74" y1="56" x2="140" y2="56" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="166" cy="36" r="4" fill="var(--signal, #b8ff5a)" />
        <MarkerRow y={86} width={150} />
        <MarkerRow y={114} width={120} />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="34" y="26" width="180" height="100" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="50" y1="46" x2="150" y2="46" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="50" y1="62" x2="176" y2="62" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="50" y1="78" x2="132" y2="78" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <path d="M232 34 v54" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <path d="M232 36 h28 l-7 9 l7 9 h-28" fill="var(--signal, #b8ff5a)" stroke="var(--signal, #b8ff5a)" strokeWidth="1" strokeLinejoin="round" />
        <rect x="238" y="96" width="18" height="14" rx="3" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <path d="M242 96 v-4 a5 5 0 0 1 10 0 v4" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.6" strokeLinecap="round" />
        <line x1="266" y1="106" x2="330" y2="106" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
    </Scene>
  );
}

function AdminSettingsArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="admin_settings" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="30" y="26" width="210" height="82" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="46" y1="46" x2="150" y2="46" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <rect x="46" y="68" width="46" height="16" rx="8" fill="var(--signal, #b8ff5a)" />
        <circle cx="83" cy="76" r="5.5" fill="var(--white, #fbfaf4)" />
        <line x1="112" y1="76" x2="200" y2="76" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="252" y="44" width="78" height="46" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="266" y1="58" x2="316" y2="58" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="266" y1="72" x2="306" y2="72" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <circle cx="52" cy="44" r="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="70" y1="40" x2="160" y2="40" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <rect x="172" y="34" width="52" height="16" rx="8" fill="var(--signal, #b8ff5a)" opacity="0.6" />
        <circle cx="52" cy="82" r="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="70" y1="78" x2="146" y2="78" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <rect x="172" y="72" width="52" height="16" rx="8" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="246" y="30" width="84" height="66" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" strokeDasharray="5 4" />
        <line x1="260" y1="48" x2="316" y2="48" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="260" y1="66" x2="304" y2="66" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="30" y="30" width="140" height="84" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <circle cx="58" cy="62" r="6" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.8" />
        <circle cx="104" cy="62" r="6" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.8" />
        <line x1="66" y1="62" x2="96" y2="62" stroke="var(--muted, #696c64)" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="46" y1="88" x2="154" y2="88" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="200" y="30" width="130" height="84" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="216" y1="52" x2="300" y2="52" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="216" y1="70" x2="286" y2="70" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="310" cy="42" r="4" fill="var(--signal, #b8ff5a)" />
      </Phase>
    </Scene>
  );
}

const SCENES: Partial<Record<GuideView, (props: { activeStep: number }) => ReactNode>> = {
  admin_overview: AdminOverviewArt,
  admin_people: AdminPeopleArt,
  admin_tasks: AdminTasksArt,
  admin_review: AdminReviewArt,
  admin_insights: AdminInsightsArt,
  admin_evidence: AdminEvidenceArt,
  admin_settings: AdminSettingsArt,
};

/** The drawn scene for a guide, or null when that page has film instead. */
export default function PageGuideArt({ view, activeStep }: { view: GuideView; activeStep: number }) {
  const Art = SCENES[view];
  return Art ? <Art activeStep={activeStep} /> : null;
}
