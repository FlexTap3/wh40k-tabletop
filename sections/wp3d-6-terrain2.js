/* ==== WP3D-6: mission-true terrain pack ==== Overrides the generic terrain builders with
 * GW-tournament-style scenery matching the official layouts: ruins = low rubble footprints
 * + broken floor slabs (the obscuring AREA, not a monolith); walls = tall broken ruin
 * facades w/ windows + jagged tops (the vertical scenery); richer woods/crates/craters.
 * Registered via register() — called by the wh40k-3d.js orchestrator at init. */
import { registerTerrainBuilder } from './wp3d-1-geometry.js';

export function register() {
  /* stub — WP3D-A fills this file; falsy/no registration falls back to built-ins */
}
