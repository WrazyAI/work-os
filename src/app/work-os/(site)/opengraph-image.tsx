import { ImageResponse } from "next/og";

export const alt = "Work OS by Wrazy — a clearer workday";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** A self-contained social card: no external image/font requests for crawlers. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "68px 76px",
          color: "#f4f7fa",
          background: "linear-gradient(135deg, #101c20 0%, #10191c 58%, #153c32 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", width: 64, height: 64, borderRadius: 18, alignItems: "center", justifyContent: "center", background: "#1b493b", color: "#80e4b8", fontSize: 38, fontWeight: 800 }}>W</div>
          <div style={{ display: "flex", fontSize: 29, fontWeight: 700, letterSpacing: 1 }}>WRAZY</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 4, fontWeight: 700, color: "#85e9ba" }}>YOUR WORKDAY, SIMPLIFIED</div>
          <div style={{ display: "flex", fontSize: 102, lineHeight: 1.05, fontWeight: 800, letterSpacing: -5 }}>Work OS</div>
          <div style={{ display: "flex", fontSize: 34, color: "#c2cfca" }}>A clearer way to plan, work, and wrap up.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 21, color: "#9cb5ac" }}>
          <span>Desktop companion for Windows & macOS</span>
          <span>app.wrazyos.com/work-os</span>
        </div>
      </div>
    ),
    size,
  );
}
