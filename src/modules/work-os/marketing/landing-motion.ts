import { gsap } from "gsap";

/** One owned GSAP context; no global selectors, scroll hijacking or hidden CSS. */
export function startLandingMotion(root: HTMLElement): () => void {
  let observer: IntersectionObserver | undefined;
  const context = gsap.context(() => {
    if (root.dataset.motionEntered !== "true") {
      gsap.timeline({
        defaults: { ease: "power3.out" },
        onComplete: () => { root.dataset.motionEntered = "true"; },
      })
        .from("[data-hero-intro]", { y: 10, opacity: 0, duration: .55 }, 0)
        .from("[data-hero-line]", { yPercent: 105, stagger: .10, duration: .85 }, .04)
        .from("[data-hero-details]", { y: 14, opacity: 0, duration: .7 }, .18)
        .from("[data-hero-stage]", { y: 24, opacity: 0, duration: .85, clearProps: "transform,opacity" }, .15)
        .from("[data-product-window]", { x: 18, y: 12, rotation: 5, duration: 1 }, .20)
        .from("[data-stage-companion]", { y: 20, opacity: 0, duration: .8 }, .32)
        .from("[data-stage-speech]", { y: 8, opacity: 0, duration: .6 }, .50);
    }
    // Start only upon intersection: unseen or JS-failed content is never hidden.
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        observer?.unobserve(node);
        if (node.dataset.revealed === "true") continue;
        node.dataset.revealed = "true";
        context.add(() => {
          gsap.from(node, { y: 22, opacity: .35, duration: .8, ease: "power3.out", clearProps: "transform,opacity" });
        });
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: .05 });
    root.querySelectorAll<HTMLElement>("[data-motion-reveal]").forEach((node) => observer?.observe(node));
  }, root);
  return () => {
    observer?.disconnect();
    context.revert();
    root.dataset.motionEntered = "true";
  };
}

export function animateCapture(image: HTMLImageElement): () => void {
  const tween = gsap.fromTo(image, { opacity: .5, y: 5 }, { opacity: 1, y: 0, duration: .42, ease: "power3.out", clearProps: "transform,opacity" });
  return () => { tween.revert(); };
}
