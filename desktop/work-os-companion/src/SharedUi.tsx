import { Sparkles } from "lucide-react";

/** Shared page-level primitives used across the companion surfaces. */

export function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><p>{body}</p></div>; }
export function PageIntro({ eyebrow, title, body }: { eyebrow?: string; title: string; body: string }) { return <header className="page-intro">{eyebrow ? <span>{eyebrow}</span> : null}<h2>{title}</h2><p>{body}</p></header>; }
