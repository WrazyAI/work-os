import { useEffect, useRef, useState } from "react";

/** Reports whether a scroll container still has content past each edge, so fade
 * affordances only appear while there is more to reveal in that direction. */
export function useScrollEdges<T extends HTMLElement>(axis: "x" | "y") {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const size = axis === "x" ? node.clientWidth : node.clientHeight;
      const total = axis === "x" ? node.scrollWidth : node.scrollHeight;
      const offset = axis === "x" ? node.scrollLeft : node.scrollTop;
      const overflow = total - size > 1;
      setEdges({ start: overflow && offset > 1, end: overflow && offset < total - size - 1 });
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [axis]);
  return { ref, edges };
}

/** Appends an edge class for each direction that still has content to reveal. */
export function edgeClasses(edges: { start: boolean; end: boolean }, startName: string, endName: string) {
  return `${edges.start ? ` ${startName}` : ""}${edges.end ? ` ${endName}` : ""}`;
}

/** A bounded scroll region: fixed height, internal scroll, and frosted edges
 * that appear only while more content remains in that direction. Keyboard users
 * can focus the region and scroll it directly. */
export function ScrollFadeRegion({ label, className = "", maxHeight, scrollAxis = "y", children }: {
  label: string;
  className?: string;
  maxHeight?: number;
  scrollAxis?: "y" | "both";
  children: React.ReactNode;
}) {
  const { ref, edges } = useScrollEdges<HTMLDivElement>("y");
  return (
    <div className={`scroll-fade-shell${edgeClasses(edges, "fade-start", "fade-end")}${className ? ` ${className}` : ""}`}>
      <div
        ref={ref}
        className={`scroll-fade-region${scrollAxis === "both" ? " scroll-both" : ""}`}
        role="region"
        aria-label={label}
        tabIndex={0}
        style={maxHeight ? { maxHeight } : undefined}
      >
        {children}
      </div>
      <span className="scroll-fade-strip top" aria-hidden="true" />
      <span className="scroll-fade-strip bottom" aria-hidden="true" />
    </div>
  );
}
