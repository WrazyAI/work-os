import type { ReactNode } from "react";
import type { GuideView } from "./guideState";

/**
 * Custom line art for each page guide. Each scene has three meaningful phases:
 * the modal plays them once, and the numbered steps can select them directly.
 * The SVG stays in the workspace palette and remains crisp at any zoom.
 */

function Scene({ view, activeStep, children }: { view: GuideView; activeStep: number; children: ReactNode }) {
  return (
    <div
      id="page-guide-art"
      className="guide-art"
      data-guide-view={view}
      data-active-step={activeStep}
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

function DayArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="day" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <circle cx="58" cy="42" r="11" fill="var(--signal, #b8ff5a)" />
        <line x1="58" y1="22" x2="58" y2="27" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="58" y1="57" x2="58" y2="62" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="38" y1="42" x2="43" y2="42" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="73" y1="42" x2="78" y2="42" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <rect x="96" y="32" width="196" height="20" rx="10" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="108" y1="42" x2="222" y2="42" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <line x1="44" y1="104" x2="316" y2="104" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="44" cy="104" r="7" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" strokeWidth="1.6" />
        <circle cx="180" cy="104" r="7" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" strokeWidth="1.6" />
        <rect x="34" y="120" width="56" height="6" rx="3" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <rect x="170" y="120" width="64" height="6" rx="3" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <circle cx="316" cy="104" r="11" fill="var(--signal, #b8ff5a)" />
        <Check x={316} y={104} />
        <rect x="296" y="120" width="42" height="6" rx="3" fill="var(--signal, #b8ff5a)" opacity="0.65" />
      </Phase>
    </Scene>
  );
}

function TasksArt({ activeStep }: { activeStep: number }) {
  const rows = [40, 76];
  return (
    <Scene view="tasks" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        {rows.map((y) => (
          <g key={y}>
            <rect x="34" y={y} width="212" height="26" rx="9" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
            <rect x="46" y={y + 7} width="11" height="11" rx="3.5" fill="none" stroke="var(--line, #dcdcd3)" strokeWidth="1.4" />
            <line x1="68" y1={y + 13} x2="196" y2={y + 13} stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
          </g>
        ))}
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="34" y="112" width="212" height="26" rx="9" fill="var(--signal, #b8ff5a)" opacity="0.28" />
        <rect x="46" y="119" width="11" height="11" rx="3.5" fill="var(--signal, #b8ff5a)" />
        <Check x={52} y={124.5} width={1.5} />
        <line x1="68" y1="125" x2="168" y2="125" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <path d="M258 100 C 288 100, 292 86, 300 82" fill="none" stroke="var(--line, #dcdcd3)" strokeWidth="1.8" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M298 78 l6 4 l-6 4" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="256" y="40" width="70" height="42" rx="11" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <line x1="266" y1="54" x2="316" y2="54" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="266" y1="64" x2="306" y2="64" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="266" y1="74" x2="312" y2="74" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
    </Scene>
  );
}

function ReviewArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="review" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="28" y="50" width="58" height="40" rx="12" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <circle cx="46" cy="70" r="3" fill="var(--muted, #696c64)" />
        <circle cx="58" cy="70" r="3" fill="var(--muted, #696c64)" />
        <path d="M66 76 q6 4 -4 4" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M92 70 h18" stroke="var(--line, #dcdcd3)" strokeWidth="1.8" strokeDasharray="4 4" strokeLinecap="round" />
        <path d="M108 66 l6 4 l-6 4" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="122" y="26" width="150" height="100" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="138" y1="44" x2="214" y2="44" stroke="var(--ink, #171914)" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
        <line x1="138" y1="60" x2="256" y2="60" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="138" y1="72" x2="248" y2="72" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <line x1="138" y1="84" x2="252" y2="84" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <circle cx="236" cy="106" r="14" fill="var(--signal, #b8ff5a)" />
        <Check x={236} y={106} />
        <path d="M286 76 h28" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        <path d="M308 70 l6 6 l-6 6" fill="none" stroke="var(--ink, #171914)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
      </Phase>
    </Scene>
  );
}

function InsightsArt({ activeStep }: { activeStep: number }) {
  const panels = [30, 134, 238];
  const bars = [
    [26, 44, 62],
    [54, 30, 48],
    [38, 58, 34],
  ];
  return (
    <Scene view="insights" activeStep={activeStep}>
      {panels.map((x, panel) => (
        <Phase key={x} step={panel} activeStep={activeStep}>
          <rect x={x} y="30" width="92" height="88" rx="10" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
          <circle cx={x + 16} cy="46" r="3.5" fill={panel === 1 ? "var(--signal, #b8ff5a)" : "var(--muted, #696c64)"} />
          <line x1={x + 26} y1="46" x2={x + 74} y2="46" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
          {bars[panel]!.map((height, index) => (
            <rect
              key={index}
              x={x + 12 + index * 24}
              y={104 - height}
              width="14"
              height={height}
              rx="4"
              fill={panel === 1 && index === 1 ? "var(--signal, #b8ff5a)" : "var(--paper, #f5f4ed)"}
              stroke="var(--line, #dcdcd3)"
            />
          ))}
        </Phase>
      ))}
    </Scene>
  );
}

function SettingsArt({ activeStep }: { activeStep: number }) {
  return (
    <Scene view="settings" activeStep={activeStep}>
      <Phase step={0} activeStep={activeStep}>
        <rect x="30" y="34" width="120" height="82" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <circle cx="62" cy="62" r="15" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
        <circle cx="62" cy="57" r="5" fill="var(--muted, #696c64)" />
        <path d="M52 71 q10 -8 20 0" fill="none" stroke="var(--muted, #696c64)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="88" y1="56" x2="134" y2="56" stroke="var(--ink, #171914)" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
        <line x1="88" y1="68" x2="122" y2="68" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
      </Phase>
      <Phase step={1} activeStep={activeStep}>
        <rect x="46" y="96" width="56" height="18" rx="9" fill="var(--signal, #b8ff5a)" />
        <circle cx="93" cy="105" r="6.5" fill="var(--white, #fbfaf4)" stroke="none" />
        <rect x="112" y="96" width="26" height="18" rx="9" fill="var(--paper, #f5f4ed)" stroke="var(--line, #dcdcd3)" />
      </Phase>
      <Phase step={2} activeStep={activeStep}>
        <rect x="180" y="34" width="150" height="82" rx="12" fill="var(--white, #fbfaf4)" stroke="var(--line, #dcdcd3)" />
        <line x1="196" y1="54" x2="296" y2="54" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="256" cy="54" r="6" fill="var(--signal, #b8ff5a)" />
        <line x1="196" y1="74" x2="314" y2="74" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="226" cy="74" r="6" fill="var(--ink, #171914)" opacity="0.45" />
        <line x1="196" y1="94" x2="300" y2="94" stroke="var(--line, #dcdcd3)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="286" cy="94" r="6" fill="var(--ink, #171914)" opacity="0.45" />
      </Phase>
    </Scene>
  );
}

const ART: Record<GuideView, ({ activeStep }: { activeStep: number }) => ReactNode> = {
  day: DayArt,
  tasks: TasksArt,
  review: ReviewArt,
  insights: InsightsArt,
  settings: SettingsArt,
};

export function PageGuideArt({ view, activeStep }: { view: GuideView; activeStep: number }) {
  const Art = ART[view];
  return <Art activeStep={activeStep} />;
}
