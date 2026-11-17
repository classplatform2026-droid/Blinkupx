export const SWIPE_GESTURE_SLOP_PX = 10;
export const SWIPE_TRIGGER_THRESHOLD_PX = 48;
export const SWIPE_MAX_VISUAL_PX = 68;

export type GestureLock = 'none' | 'horizontal' | 'vertical';

export function computeDampedSwipeOffset(dx: number): number {
  if (!Number.isFinite(dx) || dx === 0) return 0;
  const sign = dx < 0 ? -1 : 1;
  const abs = Math.abs(dx);
  const damped =
    abs <= SWIPE_TRIGGER_THRESHOLD_PX
      ? abs
      : SWIPE_TRIGGER_THRESHOLD_PX + (abs - SWIPE_TRIGGER_THRESHOLD_PX) * 0.35;
  return Math.min(SWIPE_MAX_VISUAL_PX, damped) * sign;
}

export function detectSwipeLockDirection(dx: number, dy: number): GestureLock {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (absX < SWIPE_GESTURE_SLOP_PX && absY < SWIPE_GESTURE_SLOP_PX) {
    return 'none';
  }

  // Prioritize vertical scrolling whenever vertical travel is comparable or greater
  if (absY >= absX * 0.85) {
    return 'vertical';
  }

  if (absX > SWIPE_GESTURE_SLOP_PX && absX > absY * 1.25) {
    return 'horizontal';
  }

  return 'none';
}

export function shouldTriggerSwipeReply(
  offsetPx: number,
  isCancelled: boolean
): boolean {
  return !isCancelled && Math.abs(offsetPx) >= SWIPE_TRIGGER_THRESHOLD_PX;
}

export function isInteractiveMediaTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') {
    return false;
  }
  return Boolean(
    (target as Element).closest(
      'audio, video, input, textarea, select, [data-no-swipe="true"]'
    )
  );
}
