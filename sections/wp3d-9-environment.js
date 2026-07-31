/* ==== WP3D-9: environment pack ==== The TTS room: wooden table under the mat, backdrop,
 * tiered lighting (desktop = real shadows, phone = cheap), lit material upgrade via
 * setPoolMaterialFactory/setMeshDecorator. Owner feedback this pack fixes: "the overall
 * immersion isn't there — draw heavily from Tabletop Simulator." Goal = a physical table
 * in a room under warm directional light, minis casting real shadows. */
import { setPoolMaterialFactory, setMeshDecorator } from './wp3d-1-geometry.js';

/* ---------------------------------------------------------------------------------------
 * Tunables (inches unless noted). Kept as named constants so the visual-iteration passes
 * (see tools/shots/wp3d-env-preview.js) can be re-tuned without hunting through the file.
 * ------------------------------------------------------------------------------------- */
const TABLE_MARGIN = 4;      // apron overhang beyond the board on all sides
const TABLE_DROP_H = 1.2;    // chunky table-edge thickness below the apron
const APRON_Y = -0.03;       // just under the board mat plane (y=0) — no z-fight at the seam
const MAT_TILE_IN = 6;       // wood-grain texture tile size, matches the board mat's 6in tiling

// Lighting — tuned so faction vertex colors read TRUE (shaded, not hue-shifted/blown out).
// See installLights() for the NdotL reasoning: a 40deg key means even the brightest
// directly-lit face only reaches ~sin(40)-cos(40) of full intensity, so these sums stay
// comfortably under a 1.0 combined exposure on the hottest faces.
/* Integrator retune (WP3D-5): the original 0.45/0.85 was calibrated against the old bright
   fallback board; combined with the v2 terrain pack's darker stone palette the whole table
   crushed to murk. Raised for a warm well-lit game-room read — verified by render vs the
   faction-color fidelity check (hue ratios stay ~true, values brighten). */
const HEMI_SKY = 0xcfe0f5, HEMI_GROUND = 0x6a5340, HEMI_INTENSITY = 0.95;
const KEY_COLOR = 0xfff0d8, KEY_INTENSITY = 1.25, KEY_ELEVATION_DEG = 48;
// Camera rig's default azimuth is PI/4 (see wp3d-2-renderer.js DEFAULT_AZIMUTH); offset the
// key light off that so it reads as a room lamp, not a headlamp glued to the viewer.
const KEY_AZIMUTH = Math.PI / 4 + 0.35;
const SHADOW_MAP_SIZE = 2048;

/* ---- procedural textures (browser-only; guarded by typeof document) ------------------- */

// Wood-grain apron texture: warm plank base + seam lines + deterministic grain streaks.
// Fallback (no DOM, e.g. plain-node tests): flat brown MeshLambertMaterial, no texture.
function buildWoodTexture(THREE) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const SIZE = 256;
    const c = document.createElement('canvas');
    if (!c.getContext) return null;
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#6b4226';
    g.fillRect(0, 0, SIZE, SIZE);
    // plank seams
    g.strokeStyle = 'rgba(20,10,4,0.35)';
    g.lineWidth = 2;
    for (let x = 0; x < SIZE; x += 48) {
      g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, SIZE); g.stroke();
    }
    // deterministic grain streaks (LCG, no Math.random — reproducible across runs)
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 160; i++) {
      const y0 = rnd() * SIZE;
      const light = rnd() > 0.5;
      g.strokeStyle = light
        ? `rgba(255,214,168,${0.03 + rnd() * 0.05})`
        : `rgba(28,14,5,${0.04 + rnd() * 0.07})`;
      g.lineWidth = 1 + rnd() * 1.4;
      g.beginPath();
      let y = y0;
      g.moveTo(0, y);
      for (let x = 8; x <= SIZE; x += 12) {
        y += (rnd() - 0.5) * 5;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    if (THREE.RepeatWrapping) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // Canvas pixels are display-referred sRGB; without this the renderer's linear working
    // space + outputColorSpace=SRGBColorSpace round trip double-encodes them, washing the
    // wood out toward a pale over-bright tan instead of a grounded warm brown.
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch (e) { return null; }
}

// Dark warm room backdrop: a tall vertical gradient assigned to scene.background. A plain
// (non-cube/non-equirect) Texture background renders as a fixed full-viewport gradient —
// exactly the "big soft room behind the table" look, cheaper than a sphere/box mesh.
// Fallback (no DOM): flat dark warm Color.
function buildRoomBackground(THREE) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  try {
    const W = 4, H = 256;
    const c = document.createElement('canvas');
    if (!c.getContext) return null;
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (!g || !g.createLinearGradient) return null;
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#05060a');    // dark ceiling
    grad.addColorStop(0.5, '#141014');  // warm-neutral mid room
    grad.addColorStop(1, '#241a12');    // warm glow near table height
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const tex = new THREE.CanvasTexture(c);
    // Same sRGB note as buildWoodTexture — without this the "dark warm room" gradient
    // double-encodes into a much lighter, desaturated (almost pink) wash.
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch (e) { return null; }
}

/* ---- table geometry --------------------------------------------------------------------
 * World coords match buildBoard's convention: board spans x∈[0,w], z∈[0,h]. The apron
 * extends TABLE_MARGIN beyond that on every side; the edge/drop is a shallow box hung just
 * under the apron so only its vertical sides read (the top is hidden under the apron plane
 * — a 1mm y offset avoids z-fighting without a visible seam). */
function buildTableTop(THREE, board) {
  const w = board.w, h = board.h;
  const totalW = w + TABLE_MARGIN * 2, totalH = h + TABLE_MARGIN * 2;
  const geo = new THREE.PlaneGeometry(totalW, totalH);
  geo.rotateX(-Math.PI / 2);
  geo.translate(w / 2, 0, h / 2);
  const tex = buildWoodTexture(THREE);
  let material;
  if (tex) {
    tex.repeat.set(Math.max(1, totalW / MAT_TILE_IN), Math.max(1, totalH / MAT_TILE_IN));
    material = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
  } else {
    material = new THREE.MeshLambertMaterial({ color: 0x6b4226, side: THREE.DoubleSide });
  }
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = APRON_Y;
  mesh.userData.isTableApron = true;
  return mesh;
}

function buildTableEdge(THREE, board) {
  const w = board.w, h = board.h;
  const totalW = w + TABLE_MARGIN * 2, totalH = h + TABLE_MARGIN * 2;
  const geo = new THREE.BoxGeometry(totalW, TABLE_DROP_H, totalH);
  const material = new THREE.MeshLambertMaterial({ color: 0x3f2416 });
  const mesh = new THREE.Mesh(geo, material);
  // top of the box sits ~1mm under the apron plane (hidden), bottom hangs TABLE_DROP_H below.
  mesh.position.set(w / 2, APRON_Y - 0.001 - TABLE_DROP_H / 2, h / 2);
  mesh.userData.isTableEdge = true;
  return mesh;
}

/* ---- lighting --------------------------------------------------------------------------
 * HemisphereLight = gentle cool-sky/warm-ground fill (never fully flattens shadows).
 * DirectionalLight = the warm "room lamp" key, from a believable ~40deg elevation. Shadow
 * camera is an orthographic box sized to the board's half-diagonal + a margin so it always
 * covers the board regardless of aspect ratio, without wasting shadow-map texels on the
 * whole room. */
function installLights(THREE, scene, board, tier) {
  const w = board.w, h = board.h;
  const diag = Math.hypot(w, h) || 1;
  const center = new THREE.Vector3(w / 2, 0, h / 2);

  const hemi = new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_INTENSITY);
  hemi.position.set(center.x, 20, center.z);

  const key = new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY);
  const elevRad = KEY_ELEVATION_DEG * Math.PI / 180;
  const dist = diag * 1.4 + 10;
  key.position.set(
    center.x + Math.sin(KEY_AZIMUTH) * Math.cos(elevRad) * dist,
    Math.sin(elevRad) * dist,
    center.z + Math.cos(KEY_AZIMUTH) * Math.cos(elevRad) * dist
  );
  key.target.position.copy(center);

  if (tier && tier.shadows) {
    key.castShadow = true;
    // tier.shadowMapSize (iPad tier: 1024) overrides the desktop default map size.
    const mapSize = (tier && tier.shadowMapSize) || SHADOW_MAP_SIZE;
    key.shadow.mapSize.set(mapSize, mapSize);
    const pad = diag / 2 + TABLE_MARGIN + 2; // board half-diagonal + table + a little terrain headroom
    const cam = key.shadow.camera;
    cam.left = -pad; cam.right = pad; cam.top = pad; cam.bottom = -pad;
    cam.near = 1;
    cam.far = dist * 2 + pad;
    cam.updateProjectionMatrix();
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.02;
  } else {
    key.castShadow = false;
  }

  scene.add(hemi);
  scene.add(key.target);
  scene.add(key);
  return { hemi, key };
}

function installFog(THREE, scene, board) {
  const diag = Math.hypot(board.w, board.h) || 1;
  // Near sits well past the camera rig's max orbit radius (~2.2x diag, see wp3d-2-renderer.js
  // RADIUS_MIN/radiusMax) plus the board's own far corner, so fog never touches the board at
  // any zoom level — it only softens the room behind it.
  const near = diag * 3.5;
  const far = diag * 9;
  scene.fog = new THREE.Fog(0x141014, near, far);
}

/* ---- material/decorator install (the "everything gets lit" plumbing) -------------------
 * setPoolMaterialFactory swaps the unlit vertex-color Basic material every token pool uses
 * for a lit MeshLambertMaterial (same vertexColors:true contract). setMeshDecorator runs on
 * every board/terrain/token object the scene-sync creates; for board+terrain (built by
 * WP3D-1/packs as plain MeshBasicMaterial meshes) it converts them to MeshLambertMaterial
 * in place, preserving color/map/vertexColors — so ALL terrain packs get lit automatically,
 * not just this file's own table. Shadow flags per contract: tokens cast, terrain
 * cast+receive, board+table receive only. */
/* WP3D-v7c "painted mini" pass: desktop/iPad tiers (tier.shadows as the proxy) convert to
 * MeshStandardMaterial — PBR + the scene.environment IBL installed below reads as painted
 * plastic instead of matte clay. Phones keep the cheaper Lambert (no IBL is installed there
 * either). Roughness varies by role: minis are semi-gloss, terrain/board stay matte. */
const PBR_ROUGHNESS = { tokens: 0.5, terrain: 0.85, board: 0.95 };
const PBR_METALNESS = { tokens: 0.22, terrain: 0.08, board: 0.0 };
function makeDecorator(THREE, tier) {
  const pbr = !!(tier && tier.shadows) && THREE.MeshStandardMaterial != null;
  const litCache = { terrain: new WeakMap(), board: new WeakMap() }; // per-role: params differ
  function toLit(mat, role) {
    if (!mat || !mat.isMeshBasicMaterial) return mat; // already lit, or not ours to convert
    const cache = litCache[role];
    let lit = cache.get(mat);
    if (!lit) {
      const common = {
        color: mat.color ? mat.color.clone() : 0xffffff,
        vertexColors: !!mat.vertexColors,
        map: mat.map || null,
        side: mat.side,
        transparent: !!mat.transparent,
        opacity: mat.opacity != null ? mat.opacity : 1,
      };
      lit = pbr
        ? new THREE.MeshStandardMaterial(Object.assign(common, {
            roughness: PBR_ROUGHNESS[role] != null ? PBR_ROUGHNESS[role] : 0.85,
            metalness: PBR_METALNESS[role] != null ? PBR_METALNESS[role] : 0.05,
          }))
        : new THREE.MeshLambertMaterial(common);
      cache.set(mat, lit);
    }
    return lit;
  }
  function convertMesh(o, role) {
    if (!o || !o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => toLit(m, role)) : toLit(o.material, role);
  }
  return function decorate(obj, role) {
    const shadows = !!(tier && tier.shadows);
    if (role === 'tokens') {
      obj.castShadow = shadows; // InstancedMesh — receiveShadow left off (contract: cast only)
    } else if (role === 'terrain') {
      obj.traverse((o) => {
        convertMesh(o, 'terrain');
        if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; }
      });
    } else if (role === 'board') {
      convertMesh(obj, 'board');
      obj.receiveShadow = shadows;
    }
  };
}

/* Procedural "studio" IBL: a tiny room with a bright warm ceiling softbox + cool side
 * cards, PMREM-filtered into scene.environment so every MeshStandardMaterial picks up
 * believable reflections/ambient. Requires a REAL renderer (guarded — node tests pass a
 * stub or nothing). Cheap: built once, ~2ms, small filtered mip chain. */
function installIBL(THREE, scene, renderer) {
  if (!renderer || !THREE.PMREMGenerator || !THREE.Scene) return null;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new THREE.Scene();
    room.background = new THREE.Color(0x23262e);
    const card = (hex, intensity, w, h, x, y, z, rx, ry) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(intensity), side: THREE.DoubleSide })
      );
      m.position.set(x, y, z);
      if (rx) m.rotation.x = rx;
      if (ry) m.rotation.y = ry;
      room.add(m);
      return m;
    };
    card(0xfff1dc, 5.5, 6, 6, 0, 8, 0, Math.PI / 2, 0);      // warm ceiling softbox (key)
    card(0xbdd2ee, 1.6, 4, 6, -8, 3, 0, 0, Math.PI / 2);     // cool side fill L
    card(0x8f9aad, 0.9, 4, 6, 8, 3, 0, 0, -Math.PI / 2);     // dim side fill R
    card(0x4a4038, 1.0, 12, 12, 0, -4, 0, -Math.PI / 2, 0);  // warm dark floor bounce
    const rt = pmrem.fromScene(room, 0.05);
    room.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    pmrem.dispose();
    scene.environment = rt.texture;
    return rt;
  } catch (e) { return null; }
}

function disposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((m) => { if (m) { if (m.map && m.map.dispose) m.map.dispose(); m.dispose(); } });
}

/* createEnvironment(THREE, scene, board, tier, renderer) -> { dispose() }
 * Called by the orchestrator AFTER createSceneSync but BEFORE the first tick, so the
 * material factory/decorator are live before any pool or terrain object is created. */
export function createEnvironment(THREE, scene, board, tier, renderer) {
  const b = board || { w: 60, h: 44 };
  const t = tier || {};

  const apron = buildTableTop(THREE, b);
  const edge = buildTableEdge(THREE, b);
  apron.receiveShadow = !!t.shadows;
  edge.receiveShadow = !!t.shadows;
  scene.add(apron);
  scene.add(edge);

  const bgTex = buildRoomBackground(THREE);
  scene.background = bgTex || new THREE.Color(0x171310);

  installFog(THREE, scene, b);
  const { hemi, key } = installLights(THREE, scene, b, t);

  if (renderer) {
    try {
      renderer.shadowMap.enabled = !!t.shadows;
      // Respect the tier's filter choice: iPad tier picks hard PCF (softShadows:false);
      // everything else keeps PCFSoft. (v7b bug: this line used to force PCFSoft back on.)
      if (t.shadows) {
        renderer.shadowMap.type = (t.softShadows === false && THREE.PCFShadowMap != null)
          ? THREE.PCFShadowMap
          : (THREE.PCFSoftShadowMap != null ? THREE.PCFSoftShadowMap : renderer.shadowMap.type);
      }
    } catch (e) { /* renderer stub in tests may not have a real shadowMap object */ }
  }

  // IBL + PBR pools on desktop/iPad; phones keep Lambert + lights only.
  const pbr = !!t.shadows && THREE.MeshStandardMaterial != null;
  const envRT = pbr ? installIBL(THREE, scene, renderer && renderer.render ? renderer : null) : null;
  setPoolMaterialFactory((T) => pbr
    ? new T.MeshStandardMaterial({ vertexColors: true, roughness: PBR_ROUGHNESS.tokens, metalness: PBR_METALNESS.tokens })
    : new T.MeshLambertMaterial({ vertexColors: true }));
  setMeshDecorator(makeDecorator(THREE, t));

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      setPoolMaterialFactory(null);
      setMeshDecorator(null);
      if (envRT) { scene.environment = null; envRT.dispose(); }
      scene.remove(apron); disposeMesh(apron);
      scene.remove(edge); disposeMesh(edge);
      scene.remove(hemi);
      scene.remove(key.target);
      scene.remove(key);
      if (scene.background && scene.background.dispose) scene.background.dispose();
      scene.background = null;
      scene.fog = null;
    },
  };
}
