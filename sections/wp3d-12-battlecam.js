/* ==== WP3D-12: battle-cam ==== Attack cinematic (bridge.onAttackStaged → frame attacker→
 * target), shared-dice consumer (bridge.onRemoteDice → opponent's rolls tumble on YOUR
 * table, visually tagged as theirs), yields to user camera input per the shared rule. */

/* createBattlecam(deps) -> { tick(dtMs, state), dispose() }
 * deps = { THREE, scene, rig, sceneSync, motion, bridge, yield: sharedYield } */
export function createBattlecam(deps) {
  /* stub — P3 fills this file */
  return { tick(dtMs, state) {}, dispose() {} };
}
