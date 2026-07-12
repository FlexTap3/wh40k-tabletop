/* ==== WP3D-10: motion & feel pack ==== TTS-style piece animation (remote moves lift-arc-
 * drop), drag lift, hover outline, camera focus, 3D tape ruler, physical dice tied to the
 * app's real rolls (bridge.onDice). */

/* createMotion(deps) -> { tick(dtMs, state), dispose() }
 * deps = { THREE, scene, rig, sceneSync, bridge, canvas, renderer }
 * tick() runs every frame AFTER sceneSync.tick and BEFORE render — it may overwrite pool
 * instance transforms for animating tokens (sceneSync rewrites all transforms each dirty
 * tick, so animations must re-assert their offsets every frame while active). */
export function createMotion(deps) {
  /* stub — WP3D-E fills this file */
  return { tick(dtMs, state) {}, dispose() {} };
}
