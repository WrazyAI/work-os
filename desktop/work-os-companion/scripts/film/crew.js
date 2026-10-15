/*
 * The film crew.
 *
 * Injected into the companion before anything else runs, so every guide film is
 * shot against the real application rather than a mock of it.
 *
 * This file is deliberately a *renderer*, not an animator. An earlier version
 * ran its own request-animation-frame loops and let the browser drive CSS
 * transitions, and the guide films were captured by streaming whatever the
 * compositor happened to produce. That was fragile in a way that showed up in
 * the finished films: the capture protocol withholds frames when the page is
 * quiet, so a hold could collapse to nothing and a camera move could lose its
 * middle. It also made every take slightly different from the last.
 *
 * So now the director owns time. For any instant the shooter computes the exact
 * camera, the exact pointer position, and the exact state of the press ripple,
 * and calls `render` with them. The page holds no timers, no animation frames,
 * and no transitions, which makes a take reproducible, exactly paced, and free
 * of the delivery artefacts that a streamed capture cannot avoid.
 *
 * It owns three things and nothing else:
 *
 *   1. The pointer. A real operating-system cursor is composited outside the
 *      page and never lands in a capture, so the crew draws its own. It lives in
 *      screen space, which is the whole point: a real pointer does not grow when
 *      the camera pushes in, it stays glued to whatever it is resting on while
 *      the world moves underneath it.
 *   2. The camera. A transform on the application root, not a filter applied
 *      afterwards, so text is re-rasterised at every zoom level instead of being
 *      magnified into mush.
 *   3. Hygiene. Development chrome is not part of the product and is hidden, and
 *      the interface's own transitions are stilled so every rendered frame is a
 *      settled state rather than a photograph of something mid-flight.
 */
(() => {
  if (window.__film) return;

  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const CURSOR_ID = "__film-cursor";
  const RIPPLE_ID = "__film-ripple";
  const OWNED = `#${CURSOR_ID}, #${RIPPLE_ID}`;

  /** Native pointer outline. Drawn rather than imported so it needs no asset. */
  const CURSOR_SHAPE = "M5.2 2.1 L5.2 19.4 L9.6 15.3 L12.5 21.6 L15.8 20 L12.9 13.9 L18.6 13.4 Z";

  const RIPPLE_MS = 520;

  const style = document.createElement("style");
  style.textContent = `
    ${OWNED} { position: fixed; pointer-events: none; }
    #${CURSOR_ID} {
      left: 0; top: 0; width: 26px; height: 26px; margin: -2px 0 0 -2px;
      z-index: 2147483646;
      filter: drop-shadow(0 2px 5px rgba(15, 24, 14, .34));
      will-change: transform;
    }
    #${CURSOR_ID} svg { transition: transform 110ms ${EASE}; }
    #${CURSOR_ID}.is-pressed svg { transform: scale(.86); }
    #${RIPPLE_ID} {
      left: 0; top: 0; width: 46px; height: 46px; margin: -23px 0 0 -23px;
      z-index: 2147483645; border-radius: 999px;
      border: 2px solid rgba(168, 241, 91, .95);
      box-shadow: 0 0 0 3px rgba(20, 30, 18, .16), inset 0 0 12px rgba(168, 241, 91, .34);
      will-change: transform, opacity;
    }
    /* Development chrome is not the product. */
    .notice.debug, [data-film-hide] { display: none !important; }
    /*
     * Still the interface's own motion. Every frame the shooter renders is a
     * state, never a moment caught between two of them, which is what makes a
     * take reproducible and keeps app transitions from beating against the
     * film's own timing. The crew's own elements are exempt.
     */
    *:not(#${CURSOR_ID}):not(#${CURSOR_ID} *):not(#${RIPPLE_ID}) {
      transition: none !important;
      animation: none !important;
    }
  `;

  const cursor = document.createElement("div");
  cursor.id = CURSOR_ID;
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26">
    <path d="${CURSOR_SHAPE}" fill="#182018" stroke="#ffffff" stroke-width="1.35" stroke-linejoin="round"/>
  </svg>`;

  const ripple = document.createElement("div");
  ripple.id = RIPPLE_ID;
  ripple.setAttribute("aria-hidden", "true");

  const appRoot = () => document.getElementById("root");

  /** Where a page coordinate lands on screen. The scroll cancels out of it. */
  const camera = { scale: 1, band: 0, left: 0 };

  const applyCamera = () => {
    const root = appRoot();
    if (!root) return;
    const { scale, band, left } = camera;
    root.style.transformOrigin = "0 0";
    root.style.willChange = "transform";
    root.style.transform = `translate3d(${(window.scrollX || 0) - left * scale}px, ${(window.scrollY || 0) - band * scale}px, 0) scale(${scale})`;
  };

  const mount = () => {
    (document.head ?? document.documentElement)?.appendChild(style);
    document.body.appendChild(cursor);
    document.body.appendChild(ripple);
    applyCamera();
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  window.__film = {
    /**
     * Draw one frame. Everything is absolute state, so rendering the same frame
     * twice produces the same picture.
     *
     * `ripple` is the age of the press in milliseconds, or null when no press is
     * showing; the crew computes the ripple's geometry from that age rather than
     * letting a CSS animation run on its own clock.
     */
    render({ scale = camera.scale, band = camera.band, left = camera.left, cursor: point, pressed = false, ripple: rippleAge = null } = {}) {
      const moved = scale !== camera.scale || band !== camera.band || left !== camera.left;
      camera.scale = scale;
      camera.band = band;
      camera.left = left;
      if (moved) applyCamera();

      if (point) cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
      cursor.classList.toggle("is-pressed", pressed);

      if (rippleAge === null || rippleAge === undefined) {
        ripple.style.opacity = "0";
      } else {
        const t = Math.max(0, Math.min(1, rippleAge / RIPPLE_MS));
        // A decelerating ring that fades as it opens.
        const size = 0.34 + 0.44 * (1 - (1 - t) * (1 - t));
        ripple.style.opacity = String(0.95 * (1 - t));
        ripple.style.transform = `translate3d(${point?.x ?? 0}px, ${point?.y ?? 0}px, 0) scale(${size})`;
      }
      return true;
    },

    /** Screen rectangle of an element, for the director to aim the real mouse. */
    box(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
    },

    /**
     * Where an element sits in the page's own coordinates, with the camera
     * transform divided back out. This is what lets a shot be written as "frame
     * the focus card" rather than as a pixel offset that silently rots the next
     * time the layout moves.
     */
    pageBox(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const scale = camera.scale || 1;
      const left = box.left / scale + camera.left;
      const top = box.top / scale + camera.band;
      const width = box.width / scale;
      const height = box.height / scale;
      return { left, top, right: left + width, bottom: top + height, width, height, cx: left + width / 2, cy: top + height / 2 };
    },

    /** The document's own extent, so the camera can be kept inside it. */
    bounds() {
      return { height: document.body.scrollHeight, width: document.documentElement.clientWidth };
    },
  };
})();
