type SeekableMedia = Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'readyState' | 'preload' | 'load' | 'addEventListener'>;
const pending = new WeakMap<SeekableMedia, number>();

/** A chapter press requests a seek, never playback. Last press wins while the
 * preload=none player is obtaining metadata. */
export function seekTutorialChapter(video: SeekableMedia, start: number): boolean {
  if (!Number.isFinite(start) || start < 0) return false;
  const seek = (time: number) => {
    video.currentTime = Number.isFinite(video.duration)
      ? Math.min(time, Math.max(0, video.duration - 0.05))
      : time;
  };
  if (video.readyState >= 1) {
    pending.delete(video);
    seek(start);
    return true;
  }
  const alreadyLoading = pending.has(video);
  pending.set(video, start);
  if (!alreadyLoading) {
    video.addEventListener('loadedmetadata', () => {
      const requested = pending.get(video);
      pending.delete(video);
      if (requested !== undefined) seek(requested);
    }, { once: true });
    video.addEventListener('error', () => pending.delete(video), { once: true });
    video.preload = 'metadata';
    video.load();
  }
  return true;
}
