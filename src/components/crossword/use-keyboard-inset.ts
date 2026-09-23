"use client";

import { useEffect, useState } from "react";

/**
 * Height, in pixels, currently covered by the on-screen keyboard.
 *
 * A `position: fixed; bottom: 0` element is pinned to the *layout* viewport,
 * which the virtual keyboard does not shrink — so the clue bar would sit
 * underneath the keyboard, exactly where it is needed most. The visual viewport
 * does shrink, and the difference between the two is the overlap to offset.
 *
 * Returns 0 on desktop and on browsers without `visualViewport`.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // Below ~120px it is a browser chrome animation, not a keyboard.
      setInset(covered > 120 ? Math.round(covered) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
