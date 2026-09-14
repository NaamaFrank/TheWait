/**
 * Horizontal screen carousel.
 *
 * The six screens live side by side in one wide track that is slid with a
 * transform. A pointer gesture locks to an axis after a few pixels so a
 * vertical flick still scrolls the screen it started on, and the track resists
 * dragging past either end instead of stopping dead.
 *
 * Screens may expose `enter` and `leave` so nothing off-screen keeps polling.
 *
 * The desktop shell shows one screen at a time with no swiping, so sliding can
 * be turned off: the track stops transforming and CSS shows whichever screen
 * carries `is-current`. Everything else - lifecycle, `inert`, the hash - is the
 * same in both shells.
 */

/** Movement, in px, before a gesture commits to horizontal or vertical. */
const AXIS_LOCK = 6;

/** How far a drag must travel to count as a page turn. */
const TURN_THRESHOLD = 70;

/** Resistance applied when dragging past the first or last screen. */
const EDGE_DAMPING = 0.3;

const EASE = 'transform 420ms cubic-bezier(.22,.9,.2,1)';

export function createCarousel({ track, screens, initialIndex = 0, sliding = true, onChange }) {
  const last = screens.length - 1;
  let index = Math.max(0, Math.min(screens.length - 1, initialIndex));
  let drag = 0;
  let gesture = null;
  let slides = sliding;

  /*
   * Measured rather than assumed: the frame is 390px on a desktop mockup and
   * the full viewport width on a phone.
   */
  const step = () => track.getBoundingClientRect().width / screens.length;

  function apply() {
    if (!slides) {
      track.style.transition = 'none';
      track.style.transform = '';
      return;
    }

    track.style.transition = gesture?.locked === 'x' ? 'none' : EASE;
    track.style.transform = `translateX(${-index * step() + drag}px)`;
  }

  /** Marks the visible screen for CSS and keeps the rest out of the tab order. */
  function markVisible() {
    for (const [position, screen] of screens.entries()) {
      const active = position === index;
      screen.element.classList.toggle('is-current', active);
      screen.element.setAttribute('aria-hidden', active ? 'false' : 'true');
      screen.element.inert = !active;
    }
  }

  function activate(next) {
    const clamped = Math.max(0, Math.min(last, next));
    drag = 0;

    if (clamped !== index) {
      screens[index].leave?.();
      index = clamped;

      /*
       * Shown first, entered second - the order `start` already used. A screen
       * that is still `display: none` measures zero, so anything sizing itself
       * against its own box in `enter` got nothing and kept the size it had.
       * That is what made the globe appear small and then jump.
       */
      markVisible();
      screens[index].enter?.();
      onChange?.(index);
    }

    apply();
  }

  function onPointerDown(event) {
    if (!slides) return;
    // Controls and the globe canvas handle their own pointers.
    if (event.target.closest('button, select, input, canvas, a')) return;
    gesture = { x: event.clientX, y: event.clientY, locked: null };
  }

  function onPointerMove(event) {
    if (!gesture) return;

    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;

    if (!gesture.locked) {
      if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
      gesture.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }

    if (gesture.locked !== 'x') return;

    const atEdge = (index === 0 && dx > 0) || (index === last && dx < 0);
    drag = dx * (atEdge ? EDGE_DAMPING : 1);
    apply();
  }

  function onPointerUp() {
    if (!gesture) return;

    const travelled = drag;
    gesture = null;

    if (Math.abs(travelled) > TURN_THRESHOLD) activate(index + (travelled < 0 ? 1 : -1));
    else {
      drag = 0;
      apply();
    }
  }

  function onKeyDown(event) {
    if (event.target.closest('input, select, textarea')) return;
    if (event.key === 'ArrowRight') activate(index + 1);
    if (event.key === 'ArrowLeft') activate(index - 1);
  }

  return {
    start() {
      track.addEventListener('pointerdown', onPointerDown);
      addEventListener('pointermove', onPointerMove);
      addEventListener('pointerup', onPointerUp);
      addEventListener('pointercancel', onPointerUp);
      addEventListener('keydown', onKeyDown);
      addEventListener('resize', apply);

      markVisible();
      screens[index].enter?.();
      apply();
      onChange?.(index);
    },

    go: activate,

    /** Swapping shells: drop the transform, or put it back where it belongs. */
    setSliding(next) {
      if (next === slides) return;
      slides = next;
      drag = 0;
      gesture = null;
      apply();
    },

    get index() {
      return index;
    }
  };
}
