/* ==== WP3D-9: environment pack ==== The TTS room: wooden table under the mat, backdrop,
 * tiered lighting (desktop = real shadows, phone = cheap), lit material upgrade via
 * setPoolMaterialFactory/setMeshDecorator. */
import { setPoolMaterialFactory, setMeshDecorator } from './wp3d-1-geometry.js';

/* createEnvironment(THREE, scene, board, tier, renderer) -> { dispose() }
 * Called by the orchestrator AFTER createSceneSync but BEFORE the first tick, so the
 * material factory/decorator are live before any pool or terrain object is created. */
export function createEnvironment(THREE, scene, board, tier, renderer) {
  /* stub — WP3D-D fills this file */
  return { dispose() {} };
}
