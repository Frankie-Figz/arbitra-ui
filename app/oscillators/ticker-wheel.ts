/** Small geometry helpers shared by the pointer control and its deterministic tests. */
export function wheelAngle(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }): number | null {
  const dx = x - bounds.left - bounds.width / 2, dy = y - bounds.top - bounds.height / 2;
  if (![dx, dy, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0
    || Math.hypot(dx, dy) < Math.min(bounds.width, bounds.height) * .18) return null;
  return Math.atan2(dy, dx);
}

/** Crossing the -180/+180 seam must move a few degrees, not jump a whole turn. */
export function wheelDelta(previous: number, next: number): number {
  return Number.isFinite(previous) && Number.isFinite(next) ? Math.atan2(Math.sin(next - previous), Math.cos(next - previous)) : 0;
}

export function wrapPosition(value: number, period: number): number {
  return Number.isFinite(value) && Number.isFinite(period) && period > 0 ? ((value % period) + period) % period : 0;
}

/** Advance the paused CSS timeline, retaining its exact position when motion resumes. */
export function steerTicker(track: HTMLElement | null, viewport: HTMLElement | null, radians: number): void {
  if (!track || !viewport || !Number.isFinite(radians)) return;
  const group = track.firstElementChild as HTMLElement | null;
  const width = group?.getBoundingClientRect().width ?? 0;
  if (!group || width <= 0 || !group.childElementCount) return;
  const pixels = radians / (2 * Math.PI) * 4 * width / group.childElementCount;
  const animation = track.getAnimations?.()[0];
  const duration = animation?.effect?.getComputedTiming().duration;
  if (animation && typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
    const time = typeof animation.currentTime === "number" ? animation.currentTime : 0;
    animation.currentTime = wrapPosition(time + (pixels + viewport.scrollLeft) / width * duration, duration);
    viewport.scrollLeft = 0;
  } else {
    // Reduced motion has no animation/duplicate group: retain ordinary bounded scrolling.
    viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + pixels));
  }
}
