/* ==== WP3D-11: mode manager ==== 2D-first tri-state (off/pip/full). Owns PiP canvas-rect
 * sizing (the boardwrap ResizeObserver does NOT fire on the CSS inset change — this module
 * drives the resize path from the canvas rect on every mode change), tier pixel-ratio
 * recompute, PiP camera auto-frame with the shared user-input yield rule. */

/* createModes(deps) -> { setMode(m), getMode(), tick(dtMs, state), dispose() }
 * deps = { THREE, canvas, rendererCtl /* {renderer,setSize} *\/, rig, labels, interaction,
 *          sceneSync, motion, bridge, tier, sizeTo(w,h) /* orchestrator's resize path *\/ } */
export function createModes(deps) {
  /* stub — P2 fills this file */
  let mode = 'full';
  return {
    setMode(m) { mode = m; },
    getMode() { return mode; },
    tick(dtMs, state) {},
    dispose() {},
  };
}
