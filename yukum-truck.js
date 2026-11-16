// Yüküm — real-time 3D truck-loading scene (Three.js) behind the Yüküm project card.
// Model: "Truck" by ROY (Sketchfab), CC BY 4.0 — converted to yukum-truck.glb. The cargo box is turned into glass with
// aluminium edges and fills with cardboard boxes; blue rim light, reflective floor, light specks.
// Plays ONCE when visible, then renders the final frame and stops the loop (no idle GPU/battery use).
// Reduced motion → final frame. No WebGL / load error → the still image (yukum-truck.png) inside the container stays.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MODEL_URL = new URL('yukum-truck.glb', import.meta.url).href;

// deterministic randomness → the load looks the same every time
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const easeOutBack = (t) => { const c1 = 1.25, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// ---------- procedural textures ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function cardboard(r, variant) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = ['#c49a6c', '#b98c5d', '#caa275', '#b4875a'][variant % 4]; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {                                                 // fibre speckle
      g.fillStyle = `rgba(${r() > 0.5 ? '255,235,200' : '70,45,20'},${0.04 + r() * 0.06})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
    }
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.75);  // darker edges
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(60,35,10,0.28)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(214,190,150,0.55)'; g.fillRect(w * 0.44, 0, w * 0.12, h);       // packing tape
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(w * 0.45, 0, w * 0.02, h);
    if (variant % 3 === 0) {                                                            // shipping label
      g.fillStyle = '#f2efe8'; g.fillRect(w * 0.1, h * 0.62, w * 0.26, h * 0.2);
      g.fillStyle = '#2b2b2b'; for (let i = 0; i < 4; i++) g.fillRect(w * 0.13, h * (0.66 + i * 0.035), w * (0.12 + r() * 0.08), 2);
      g.fillStyle = '#F26B1D'; g.fillRect(w * 0.29, h * 0.65, w * 0.05, h * 0.05);
    }
  });
}
function radialAlpha(inner, outer) {
  return canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, w * inner, w / 2, h / 2, w * outer);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#000000'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
function glowTex(color) {
  return canvasTex(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}

// ---------- model ----------
async function loadTruck() {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  const model = gltf.scene;
  model.rotation.y = -Math.PI / 2;                       // model front is +z → face -x (cab on the left, load to the right)
  const truck = new THREE.Group(); truck.add(model);
  truck.updateMatrixWorld(true);

  const paint = new THREE.MeshPhysicalMaterial({ color: 0xf0a31c, metalness: 0.5, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3 });
  const tint = new THREE.MeshPhysicalMaterial({ color: 0x0c1522, metalness: 0.7, roughness: 0.04, clearcoat: 1, envMapIntensity: 2, transparent: true, opacity: 0.88 });
  const shellGlass = new THREE.MeshPhysicalMaterial({ color: 0xd6e6ff, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.8 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 0 });   // headlights: switched on while driving in
  let shell = null, floorTop = null, lampMesh = null;
  const wheels = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const name = o.material && o.material.name;
    if (o.name.includes('wheels')) wheels.push(o);
    if (name === 'head_paint') o.material = paint;
    else if (name === 'windglass') o.material = tint;
    else if (name === 'glass') { o.material = lamp; lampMesh = o; }
    else if (name === 'signal_light' || name === 'signal_light_001') { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xffa31a); o.material.emissiveIntensity = 1.6; }
    if (name === 'bodycolour') shell = o;
    if (name === 'diffuse_black') {
      const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
      if (Math.max(s.x, s.z) > 5) floorTop = o;          // long black chassis under the cargo box
    }
  });

  // ground the truck at y = 0, centre it on x
  const all = new THREE.Box3().setFromObject(truck);
  truck.position.y -= all.min.y; truck.position.x -= (all.min.x + all.max.x) / 2;
  truck.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(truck);

  // wheels: move each mesh's pivot to its own centre so it can spin about the axle (model x = truck width)
  for (const w of wheels) {
    w.geometry.computeBoundingBox();
    const c = w.geometry.boundingBox.getCenter(new THREE.Vector3());
    w.geometry.translate(-c.x, -c.y, -c.z); w.position.copy(c);
  }
  // headlight flares at the two ends of the lamp strip (truck-local)
  const flares = [];
  if (lampMesh) {
    const lb = new THREE.Box3().setFromObject(lampMesh), o = truck.position;
    for (const z of [lb.min.z + 0.25, lb.max.z - 0.25]) flares.push(new THREE.Vector3(lb.min.x - o.x - 0.05, (lb.min.y + lb.max.y) / 2 - o.y, z - o.z));
  }

  // cargo box → glass with aluminium edges; its inside is where the load goes
  let interior = null;
  if (shell) {
    const sb = new THREE.Box3().setFromObject(shell);
    const floorY = floorTop ? new THREE.Box3().setFromObject(floorTop).max.y : sb.min.y + (sb.max.y - sb.min.y) * 0.18;
    // boxes are children of `truck` → convert world bounds to truck-local (truck is only translated)
    const o = truck.position;
    interior = { x0: sb.min.x - o.x + 0.16, x1: sb.max.x - o.x - 0.16, y0: floorY - o.y + 0.04, y1: sb.max.y - o.y - 0.14,
                 z0: sb.min.z - o.z + 0.12, z1: sb.max.z - o.z - 0.12 };
    shell.material = shellGlass; shell.renderOrder = 10; shell.castShadow = false;
    shell.add(new THREE.LineSegments(new THREE.EdgesGeometry(shell.geometry, 28),
      new THREE.LineBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.55 })));
  }
  return { truck, bounds, interior, wheels, lamp, flares };
}

function fillCargo(group, box, r) {
  const mats = [0, 1, 2, 3, 4, 5].map((v) => new THREE.MeshStandardMaterial({ map: cardboard(r, v), roughness: 0.88 }));
  const boxes = [], gap = 0.03;
  const TW = box.z1 - box.z0;
  let x = box.x0;
  while (x < box.x1 - 0.35) {
    const len = Math.min(0.65 + r() * 0.75, box.x1 - x);
    const rows = r() > 0.45 ? 2 : 3, depth = TW / rows;
    for (let k = 0; k < rows; k++) {
      let y = box.y0;
      const z = box.z0 + depth * k + depth / 2;
      const cap = box.y1 - r() * 0.35;                                         // slightly uneven top line, like a real load
      while (y < cap - 0.28) {
        const h = Math.min(0.4 + r() * 0.5, cap - y);
        const m = new THREE.Mesh(new THREE.BoxGeometry(len - gap - r() * 0.07, h - gap, depth - gap - r() * 0.05), mats[Math.floor(r() * mats.length)]);
        m.castShadow = true; m.receiveShadow = true;
        const target = new THREE.Vector3(x + len / 2, y + h / 2, z);
        m.position.copy(target); m.rotation.y = (r() - 0.5) * 0.03; m.visible = false;
        group.add(m); boxes.push({ m, target });
        y += h;
      }
    }
    x += len;
  }
  // load from the cab end towards the rear doors, bottom to top
  boxes.sort((a, b) => (a.target.x - b.target.x) || (a.target.y - b.target.y) || (a.target.z - b.target.z));
  boxes.forEach((b, i) => { b.delay = 0.35 + i * (2.9 / boxes.length); });
  return boxes;
}

function stage(renderer, bounds) {
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const r = rng(77);
  const cx = (bounds.min.x + bounds.max.x) / 2, len = bounds.max.x - bounds.min.x, top = bounds.max.y;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(len * 2.8, len * 2.8),
    new THREE.MeshStandardMaterial({ color: 0x060a12, metalness: 0.25, roughness: 0.55, transparent: true, alphaMap: radialAlpha(0.02, 0.42) }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0, 0); floor.receiveShadow = true; scene.add(floor);
  const pts = [];
  for (let i = 0; i < 420; i++) { const a = r() * Math.PI * 2, d = 3 + r() * len; pts.push(cx + Math.cos(a) * d * 1.2, 0.01, Math.sin(a) * d * 0.7); }
  const specks = new THREE.BufferGeometry(); specks.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(specks, new THREE.PointsMaterial({ color: 0x4f8dff, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false })));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex('rgba(40,110,255,0.9)'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.material.opacity = 0.4; glow.scale.set(6, 3.6, 1); glow.position.set(bounds.max.x - 0.6, top * 0.62, -2.2); scene.add(glow);   // rim glow hugging the rear top corner
  const under = new THREE.Mesh(new THREE.PlaneGeometry(len * 1.1, 6), new THREE.MeshBasicMaterial({ map: glowTex('rgba(30,90,255,0.55)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  under.rotation.x = -Math.PI / 2; under.position.set(cx, 0.02, 0); scene.add(under);

  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x0a0c12, 0.6));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.6); key.position.set(cx - 12, 14, 12); key.target.position.set(cx, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -len, right: len, top: len * 0.6, bottom: -len * 0.6, near: 1, far: 60 }); key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const rim = new THREE.PointLight(0x2f6bff, 70, 30, 1.6); rim.name = 'rim'; rim.position.set(bounds.max.x + 1.5, top + 1.5, -3.5); scene.add(rim);
  const rim2 = new THREE.PointLight(0x3a7bff, 40, 22, 1.8); rim2.position.set(cx - 1, top + 1.8, -4); scene.add(rim2);
  const inside = new THREE.PointLight(0xffd6a0, 16, 12, 2); inside.position.set(cx + len * 0.15, top * 0.8, 0.5); scene.add(inside);
  return scene;
}

async function start(container) {
  const fallback = container.querySelector('.yk-fallback, svg');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { return; }                                                          // no WebGL → keep the still image
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  let model;
  try { model = await loadTruck(); } catch (e) { renderer.dispose(); return; }  // load error → keep the still image
  const { truck, bounds, interior, wheels, lamp, flares } = model;
  const scene = stage(renderer, bounds);
  scene.add(truck);
  const r = rng(2048);
  const boxes = interior ? fillCargo(truck, interior, r) : [];
  boxes.forEach((b) => { b.spin = new THREE.Euler((r() - 0.5) * 1.6, (r() - 0.5) * 2.2, (r() - 0.5) * 1.6); });

  // headlight flares (additive sprites) — fade in while the truck drives in
  const flareTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(200,225,255,0.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const flareSprites = flares.map((p) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    sp.scale.set(1.6, 1.6, 1); sp.position.copy(p); truck.add(sp); return sp; });
  const beam = new THREE.SpotLight(0xdfe9ff, 0, 18, 0.5, 0.6, 1.4);            // real light thrown on the floor ahead
  if (flares.length) { beam.position.copy(flares[0]).add(new THREE.Vector3(0, 0, (flares[1].z - flares[0].z) / 2)); beam.target.position.copy(beam.position).add(new THREE.Vector3(-6, -1.2, 0)); truck.add(beam, beam.target); }

  // light sweep across the glass cargo box (front → rear)
  let sweep = null;
  if (interior) {
    const tex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 128, 0); grd.addColorStop(0, 'rgba(120,180,255,0)'); grd.addColorStop(0.5, 'rgba(190,225,255,0.9)'); grd.addColorStop(1, 'rgba(120,180,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 128, 8); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const h = interior.y1 - interior.y0 + 0.4;
    sweep = new THREE.Mesh(new THREE.PlaneGeometry(1.1, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    sweep.position.set(interior.x0, (interior.y0 + interior.y1) / 2, interior.z1 + 0.16); sweep.renderOrder = 20; truck.add(sweep);
  }
  const rim = scene.getObjectByName('rim');

  renderer.domElement.className = 'yk-canvas';
  container.appendChild(renderer.domElement);

  // camera: spherical path around a look-at point — low tracking shot → rising swing into a 3/4 front "product shot"
  const len = bounds.max.x - bounds.min.x, cx = (bounds.min.x + bounds.max.x) / 2;
  const LOOK = new THREE.Vector3(cx - len * 0.09, bounds.max.y * 0.42, 0);
  const zoom = parseFloat(container.dataset.ykZoom || '1');
  const R0 = 17.4 * (len / 16.4) * zoom;
  const deg = Math.PI / 180;
  const K = [ // t, azimuth (from -x towards +z), elevation, radius factor
    [0.0, 74 * deg, 4 * deg, 1.12], [1.8, 66 * deg, 6 * deg, 1.06], [4.6, 52 * deg, 9 * deg, 1.03], [6.6, 38 * deg, 13 * deg, 1.0]];
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300);
  let fit = 1;
  function size() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fit = Math.max(1, Math.pow(2.1 / (w / h), 0.72));                          // narrow boxes: pull back so the whole truck fits
  }
  function camAt(t, look) {
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const [t0, a0, e0, r0] = K[i], [t1, a1, e1, r1] = K[i + 1];
    const u = easeInOut(clamp01((t - t0) / (t1 - t0)));
    const az = a0 + (a1 - a0) * u, el = e0 + (e1 - e0) * u, rad = R0 * fit * (r0 + (r1 - r0) * u);
    camera.position.set(look.x - Math.cos(az) * Math.cos(el) * rad, look.y + Math.sin(el) * rad, look.z + Math.sin(az) * Math.cos(el) * rad);
    camera.lookAt(look);
  }

  const DURATION = 7.0, DRIVE = 1.8;
  let elapsed = 0, last = 0, running = false, finished = false, raf = 0, fixedT = null;
  const baseX = truck.position.x, entry = len * 0.95;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const look = new THREE.Vector3();

  function pose(t) {
    // 1) drive in from the left, wheels spinning, light suspension bob, headlights on
    const d = easeOutCubic(clamp01(t / DRIVE));
    truck.position.x = baseX - (1 - d) * entry;
    const travelled = d * entry;
    for (const w of wheels) w.rotation.x = -travelled / 0.69;                   // tyre radius ≈ 0.69 m
    truck.position.y = Math.sin(t * 9) * 0.025 * (1 - clamp01((t - DRIVE) / 0.6));
    const lampOn = clamp01(t / 0.6);
    lamp.emissiveIntensity = 2.6 * lampOn;
    flareSprites.forEach((sp) => { sp.material.opacity = 0.9 * lampOn; });
    beam.intensity = 40 * lampOn;
    // 2) cargo flies in on an arc from above/behind, tumbling, then settles with a small squash
    for (const b of boxes) {
      const p = clamp01((t - (b.delay + 1.3)) / 0.75);
      b.m.visible = p > 0;
      if (p <= 0) continue;
      const e = easeOutBack(p), arc = 1 - e;
      b.m.position.set(b.target.x + arc * 2.6, b.target.y + arc * 4.2 + Math.sin(p * Math.PI) * 0.6, b.target.z + arc * 0.4);
      b.m.rotation.set(b.spin.x * arc, b.spin.y * arc, b.spin.z * arc);
      const sq = p > 0.85 ? 1 - Math.sin((p - 0.85) / 0.15 * Math.PI) * 0.06 : 1;
      b.m.scale.set(1, sq, 1);
    }
    // 3) light sweep over the glass box + rim light swell
    if (sweep && interior) {
      const q = clamp01((t - 4.7) / 1.4);
      sweep.position.x = interior.x0 + (interior.x1 - interior.x0) * easeInOut(q);
      sweep.material.opacity = Math.sin(q * Math.PI) * 0.85;
    }
    if (rim) rim.intensity = 70 + 70 * easeInOut(clamp01((t - 4.4) / 1.8));
    // camera follows the truck while it drives, then frames the final shot
    look.copy(LOOK); look.x += (truck.position.x - baseX) * 0.55;
    camAt(t, look);
  }
  function draw(t) { pose(t); renderer.render(scene, camera); }

  new ResizeObserver(() => { size(); if (!running) draw(fixedT ?? (finished ? 1e9 : elapsed)); }).observe(container);
  size();

  function loop(now) {
    if (!running) return;
    if (!last) last = now;
    elapsed += Math.min(0.05, (now - last) / 1000); last = now;
    draw(elapsed);
    if (elapsed >= DURATION) { running = false; finished = true; draw(1e9); return; }   // final frame, loop stops
    raf = requestAnimationFrame(loop);
  }
  function play() {
    if (finished || running) return;
    if (REDUCED) { finished = true; draw(1e9); return; }
    running = true; last = 0; raf = requestAnimationFrame(loop);
  }
  function pause() { running = false; cancelAnimationFrame(raf); }

  const reveal = () => { if (fallback) fallback.style.display = 'none'; container.classList.add('is-3d'); };
  // test hooks for previews: ?ykfinal (last frame) · ?ykt=1.5 (frame at t seconds)
  const tq = /[?&]ykt=([\d.]+)/.exec(location.search);
  if (/[?&]ykfinal\b/.test(location.search) || tq) { finished = true; fixedT = tq ? parseFloat(tq[1]) : 1e9; draw(fixedT); reveal(); return; }
  draw(0); reveal();                                                             // empty cargo box until it scrolls into view
  if (container.dataset.ykAutoplay !== undefined) { play(); return; }
  new IntersectionObserver((entries) => {
    for (const e of entries) { if (e.isIntersecting) play(); else if (running) pause(); }
  }, { threshold: 0.3 }).observe(container);
}

// Download the 1 MB model only when the card is within ~1.5 screens of the viewport (not on page load).
const near = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { near.unobserve(e.target); start(e.target); }
}, { rootMargin: '150% 0px' });
document.querySelectorAll('[data-yk-truck]').forEach((el) => near.observe(el));
