import { ACCENTS, accentChain, createShader, playSweep, type ShaderController } from "glimm";

/* The built-in "prism" palette is only cyan→indigo→magenta, so a sweep reads
 * as blue/purple. Build a true full-spectrum rainbow for the chat composer. */
export const CHAT_SWEEP_PALETTE = accentChain([
  ACCENTS.red,
  ACCENTS.orange,
  ACCENTS.yellow,
  ACCENTS.green,
  ACCENTS.cyan,
  ACCENTS.blue,
  ACCENTS.purple,
]);

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** One-shot rainbow sweep across the composer interior. Fired on send and
 *  when a streamed assistant reply settles — two real events, never ambient. */
export function createChatSweep(canvas: HTMLCanvasElement) {
  let shader: ShaderController | null = null;
  let sweeping = false;

  // createShader seeds its hue phase from Math.random(); pin it so the sweep
  // looks identical on every trigger.
  const build = (): ShaderController | null => {
    const random = Math.random;
    Math.random = () => 0;
    try {
      return createShader({
        canvas,
        palette: CHAT_SWEEP_PALETTE,
        direction: "ltr",
        bandTight: 10,
        swellAmount: 0.85,
      });
    } finally {
      Math.random = random;
    }
  };

  shader = build();

  return {
    play(): void {
      if (sweeping || prefersReducedMotion()) return;
      // Recreate per sweep so uTime restarts at 0 (identical hue phase).
      shader?.destroy();
      shader = build();
      if (!shader) return;
      sweeping = true;
      const handle = playSweep(shader, {
        palette: CHAT_SWEEP_PALETTE,
        direction: "ltr",
        sweepMs: 620,
        outroMs: 90,
        peakAlpha: 1.25,
        bandTight: 10,
        brightness: 1.35,
        swellAmount: 1,
        waveSpeed: 1.7,
      });
      void handle.done.finally(() => {
        sweeping = false;
      });
    },
    dispose(): void {
      shader?.destroy();
      shader = null;
    },
  };
}
