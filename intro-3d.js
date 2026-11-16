// Site-wide 3D world (Three.js), one renderer, two scenes:
//  1. ROOM  — a hooded kid rolls up to a desk and starts typing; scrolling flies the camera around the desk,
//             over the shoulder and INTO the monitor.
//  2. SPACE — "inside the machine": a star tunnel, grid floor and wireframe shapes that stay alive behind the
//             portfolio and react to scroll speed and the pointer.
// Reduced motion / no WebGL → the intro section is removed (html.no-intro) and the portfolio shows directly.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const root = document.documentElement;
const canvas = document.getElementById('world');
const intro = document.getElementById('intro');
const flash = document.getElementById('flash');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SMALL = matchMedia('(max-width: 720px)').matches;
const DATA = await fetch(new URL('scene-data.json?v=3', import.meta.url)).then((r) => r.json());   // static text + light settings
const LT = DATA.lights;

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// Resolution budget: the room (avatar + bloom) renders at ≤1.5× pixel ratio, the always-on background at ≤1×.
const DPR_ROOM = Math.min(devicePixelRatio || 1, 1.5), DPR_SPACE = Math.min(devicePixelRatio || 1, 1);
renderer.setPixelRatio(DPR_ROOM);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LT.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;                                   // shadows re-rendered a few times a second, not every frame

// ───────────────────────── helpers ─────────────────────────
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function glowTex(color) {
  return canvasTex(128, 128, (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, color); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0, ...o });
function put(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r1, r2, h, s = 24) => new THREE.CylinderGeometry(r1, r2, h, s);
const sph = (r, a = 28, b = 20) => new THREE.SphereGeometry(r, a, b);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 8, 18);
function glow(parent, color, sx, sy, x, y, z, opacity = 0.5) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  s.scale.set(sx, sy, 1); s.position.set(x, y, z); parent.add(s); return s;
}

// ═════════════════════════ ROOM ═════════════════════════
const ROOM_BG = 0x05070e;
const room = new THREE.Scene();
room.background = new THREE.Color(ROOM_BG);
room.fog = new THREE.FogExp2(ROOM_BG, 0.045);
const roomCam = new THREE.PerspectiveCamera(40, 1, 0.02, 60);

// lights
room.add(new THREE.HemisphereLight(0xb9ccff, 0x0a0d18, 0.7));
const key = new THREE.SpotLight(0xe3ebff, LT.key, 14, 0.66, 0.85, 2);
key.position.set(2.0, 3.8, 2.6); key.target.position.set(0, 0.8, 0.25);
key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
room.add(key, key.target);
const monitorLight = new THREE.PointLight(0x7fa8ff, LT.monitor, 5, 2); monitorLight.position.set(0, 1.2, 0.2); room.add(monitorLight);
const wallWash = new THREE.PointLight(0x2a5bff, LT.wallWash, 7, 2); wallWash.position.set(0, 1.3, -2.5); room.add(wallWash);
const lampLight = new THREE.SpotLight(0xdfe8ff, 3.2, 3, 0.75, 0.7, 2);
lampLight.position.set(0.74, 1.3, -0.05); lampLight.target.position.set(0.3, 0.78, 0.25); room.add(lampLight, lampLight.target);
const neonLight = new THREE.PointLight(0x3d7bff, LT.neon, 4, 2); neonLight.position.set(-1.5, 2.1, -2.8); room.add(neonLight);
// warm fill on the kid's face and chest so the character reads clearly from every camera angle
const faceFill = new THREE.SpotLight(0xffd9b8, LT.faceFill, 6, 0.6, 1, 2);
faceFill.position.set(-1.1, 2.1, -1.2); faceFill.target.position.set(0, 1.25, 0.6); room.add(faceFill, faceFill.target);
// hair/shoulder light from behind: separates him from the dark room on every camera angle
const hairLight = new THREE.SpotLight(0xcfdcff, LT.hairLight, 6, 0.42, 0.9, 2);
hairLight.position.set(0.9, 2.7, 2.0); hairLight.target.position.set(0, 1.2, 0.6); room.add(hairLight, hairLight.target);
const envTex = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;      // soft studio reflections for skin, eyes and fabric
const rim = new THREE.DirectionalLight(0x6f8fff, 0.7); rim.position.set(-3, 2.5, 3); room.add(rim);

// floor, rug, wall
const floor = put(room, new THREE.PlaneGeometry(30, 30), M(0x080b14, { roughness: 0.6, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
const rug = put(room, cyl(1.75, 1.75, 0.02, 64), M(0x0f1630, { roughness: 1 }), 0, 0.01, 0.55); rug.castShadow = false;
put(room, cyl(1.45, 1.45, 0.022, 64), M(0x14204a, { roughness: 1 }), 0, 0.011, 0.55).castShadow = false;
const wall = put(room, new THREE.PlaneGeometry(40, 14), M(0x0a0e1a, { roughness: 0.95 }), 0, 7, -3.32); wall.castShadow = false;

// desk
const wood = M(0x8d6a4b, { roughness: 0.65 }), metal = M(0x1a1d27, { roughness: 0.45, metalness: 0.6 });
put(room, box(1.95, 0.05, 0.9), wood, 0, 0.755, 0);
for (const [x, z] of [[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]]) put(room, box(0.05, 0.73, 0.05), metal, x, 0.365, z);
put(room, box(1.8, 0.02, 0.02), new THREE.MeshBasicMaterial({ color: 0x2f6bff }), 0, 0.72, -0.44);

// monitor
const SCREEN_W = 1.0, SCREEN_H = 0.58, SCREEN_Y = 1.16, SCREEN_Z = -0.248;
put(room, box(1.06, 0.64, 0.04), M(0x0b0d13, { roughness: 0.85, metalness: 0.1 }), 0, SCREEN_Y, -0.27);
put(room, box(0.08, 0.3, 0.04), metal, 0, 0.9, -0.31);
put(room, cyl(0.16, 0.18, 0.02, 32), metal, 0, 0.79, -0.3);
glow(room, 'rgba(120,170,255,0.9)', 2.4, 1.6, 0, SCREEN_Y, -0.6, 0.1);
put(room, box(0.3, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: 0x2f6bff }), 0, SCREEN_Y, -0.292);   // light bar on the back of the monitor

// screen: a live code editor drawn on a canvas
const SW = 1280, SH = 742, SCR = 0.75;                          // drawn in 1280×742 units, uploaded at 75% (960×557)
const scr = document.createElement('canvas'); scr.width = Math.round(SW * SCR); scr.height = Math.round(SH * SCR);
const sg = scr.getContext('2d'); sg.scale(SCR, SCR);
const screenTex = new THREE.CanvasTexture(scr); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
screen.position.set(0, SCREEN_Y, SCREEN_Z); room.add(screen);

const COL = { kw: '#3d7bff', ty: '#a9c4ff', st: '#7fb2ff', fn: '#8fa6d6', nu: '#c7d6ff', '': '#e6ebf5' };
const LINES = DATA.editor.lines;
const TOTAL = LINES.reduce((n, l) => n + 1 + l.reduce((k, s) => k + s[0].length, 0), 0);
const FONT = '600 28px "JetBrains Mono", ui-monospace, Menlo, monospace';
function drawScreen(chars, caretOn) {
  const g = sg;
  const bg = g.createLinearGradient(0, 0, 0, SH); bg.addColorStop(0, '#0d1326'); bg.addColorStop(1, '#090d1a');
  g.fillStyle = bg; g.fillRect(0, 0, SW, SH);
  g.fillStyle = '#131a30'; g.fillRect(0, 0, SW, 58);                       // title bar
  [['#ff5f57', 34], ['#febc2e', 68], ['#28c840', 102]].forEach(([c, x]) => { g.fillStyle = c; g.beginPath(); g.arc(x, 29, 10, 0, 7); g.fill(); });
  g.font = '500 22px "JetBrains Mono", ui-monospace, Menlo, monospace'; g.textBaseline = 'middle';
  g.fillStyle = '#7d8bab'; g.fillText(DATA.editor.file, 150, 30);
  g.fillStyle = '#3d7bff'; g.fillRect(140, 55, 210, 3);
  g.font = FONT;
  let left = Math.floor(chars), cx = 0, cy = 0;
  const x0 = 96, y0 = 104, lh = 46;
  for (let i = 0; i < LINES.length; i++) {
    const y = y0 + i * lh;
    g.fillStyle = '#2f3a55'; g.textAlign = 'right'; g.fillText(String(i + 1), 62, y); g.textAlign = 'left';
    let x = x0;
    if (left <= 0 && i > 0) continue;
    for (const [txt, c] of LINES[i]) {
      if (left <= 0) break;
      const part = txt.slice(0, left); left -= part.length;
      g.fillStyle = COL[c]; g.fillText(part, x, y); x += g.measureText(part).width;
    }
    cx = x; cy = y;
    if (left > 0) left -= 1; else break;                                    // newline
  }
  const done = chars >= TOTAL;
  if (caretOn && !done) { g.fillStyle = '#3d7bff'; g.fillRect(cx + 2, cy - 17, 14, 34); }
  g.fillStyle = '#0f1630'; g.fillRect(0, SH - 46, SW, 46);                  // status bar
  g.font = '500 20px "JetBrains Mono", ui-monospace, Menlo, monospace';
  g.fillStyle = '#6c7a99'; g.fillText('main   Swift 6   UTF-8', 28, SH - 22);
  if (done) {
    g.fillStyle = '#34c759'; g.textAlign = 'right'; g.fillText('✓ Build Succeeded — launching portfolio…', SW - 28, SH - 22); g.textAlign = 'left';
  } else if (chars > 0) {
    g.fillStyle = '#c7d6ff'; g.textAlign = 'right'; g.fillText('● typing…', SW - 28, SH - 22); g.textAlign = 'left';
  }
  screenTex.needsUpdate = true;
}
drawScreen(0, true);

// keyboard, mouse
const kbTex = canvasTex(256, 84, (g, w, h) => {
  g.fillStyle = '#10131c'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) {
    g.fillStyle = `hsl(${214 + ((r + c) % 3) * 4} 85% ${48 + ((r * 7 + c * 3) % 3) * 6}%)`;
    g.fillRect(8 + c * 17.3, 8 + r * 18, 13, 13);
  }
});
put(room, box(0.48, 0.022, 0.16), M(0x10131c, { roughness: 0.5 }), 0, 0.791, 0.25);
const keys = put(room, new THREE.PlaneGeometry(0.46, 0.145), new THREE.MeshBasicMaterial({ map: kbTex, toneMapped: false }), 0, 0.8035, 0.25);
keys.rotation.x = -Math.PI / 2; keys.castShadow = false;
put(room, sph(0.035, 16, 12), M(0x1a1d27, { roughness: 0.35 }), 0.37, 0.795, 0.26).scale.set(0.8, 0.55, 1.25);

// mug + steam
const mug = new THREE.Group(); mug.position.set(-0.52, 0.78, 0.18); room.add(mug);
put(mug, cyl(0.045, 0.04, 0.09), M(0xf2f0ea, { roughness: 0.35 }), 0, 0.045, 0);
put(mug, cyl(0.038, 0.038, 0.005), M(0x3a2212), 0, 0.088, 0);
put(mug, new THREE.TorusGeometry(0.028, 0.008, 8, 16), M(0xf2f0ea, { roughness: 0.35 }), -0.05, 0.045, 0);
const steam = [0, 1, 2, 3].map((i) => { const s = glow(mug, 'rgba(255,255,255,0.8)', 0.08, 0.08, 0, 0.1, 0, 0); s.userData.o = i / 4; return s; });

// lamp
const lamp = new THREE.Group(); lamp.position.set(0.82, 0.78, -0.22); room.add(lamp);
put(lamp, cyl(0.07, 0.08, 0.02), metal, 0, 0.01, 0);
const arm1 = put(lamp, cyl(0.009, 0.009, 0.42, 8), metal, -0.03, 0.22, 0.02); arm1.rotation.z = 0.15;
const arm2 = put(lamp, cyl(0.009, 0.009, 0.26, 8), metal, -0.12, 0.47, 0.08); arm2.rotation.z = 0.95; arm2.rotation.y = -0.5;
const shade = put(lamp, new THREE.ConeGeometry(0.085, 0.12, 24, 1, true), M(0xff7a45, { roughness: 0.4, side: THREE.DoubleSide }), -0.22, 0.5, 0.14);
shade.visible = false;
const bar = put(lamp, box(0.34, 0.014, 0.03), new THREE.MeshBasicMaterial({ color: LT.lampBar }), -0.24, 0.5, 0.12); bar.rotation.y = -0.5; bar.castShadow = false;   // slim LED bar lamp
glow(lamp, 'rgba(200,220,255,0.9)', 0.4, 0.16, -0.24, 0.49, 0.12, 0.07);

// plant
const plant = new THREE.Group(); plant.position.set(-0.8, 0.78, -0.22); plant.visible = false; room.add(plant);
put(plant, cyl(0.075, 0.055, 0.12), M(0xe9e4da, { roughness: 0.6 }), 0, 0.06, 0);
const leafMat = M(0x2fa36b, { roughness: 0.7, flatShading: true });
const leaves = [];
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2, tilt = 0.35 + (i % 3) * 0.22;
  const leaf = put(plant, new THREE.IcosahedronGeometry(0.06, 0), leafMat, Math.sin(a) * 0.07 * (1 + tilt), 0.2 + (i % 3) * 0.07, Math.cos(a) * 0.07 * (1 + tilt));
  leaf.scale.set(0.7, 1.5, 0.35); leaf.rotation.set(Math.cos(a) * tilt, a, -Math.sin(a) * tilt); leaves.push(leaf);
}

// books + pc tower
[[0x1b2a55, 0.26, 0], [0x3d7bff, 0.23, 0.12], [0xe4e9f5, 0.2, -0.1]].forEach(([c, w, r], i) => {
  put(room, box(w, 0.035, 0.17), M(c, { roughness: 0.7 }), 0.58, 0.798 + i * 0.036, -0.2).rotation.y = r;
});
const tower = new THREE.Group(); tower.position.set(1.25, 0, -0.15); room.add(tower);
put(tower, box(0.24, 0.52, 0.5), M(0x0d1018, { roughness: 0.35, metalness: 0.5 }), 0, 0.26, 0);
const fans = [0.38, 0.16].map((y) => {
  const f = put(tower, new THREE.TorusGeometry(0.075, 0.012, 8, 28), new THREE.MeshBasicMaterial({ color: 0x2f6bff }), -0.122, y, 0.05);
  f.rotation.y = Math.PI / 2; f.castShadow = false; return f;
});
glow(tower, 'rgba(61,123,255,0.9)', 0.7, 0.9, -0.2, 0.27, 0.05, 0.05);

// wall: neon sign, posters, shelf
const neonTex = canvasTex(640, 256, (g, w, h) => {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 150px "JetBrains Mono", Menlo, monospace'; g.shadowColor = '#3d7bff'; g.shadowBlur = 30;
  g.fillStyle = '#e6eeff'; g.fillText('</>', w / 2, 100); g.fillText('</>', w / 2, 100);
  g.font = '500 40px "JetBrains Mono", Menlo, monospace'; g.shadowColor = '#3d7bff'; g.shadowBlur = 18;
  g.fillStyle = '#dfe8ff'; g.fillText('hello, world', w / 2, 212);
});
const neon = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.6), new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, opacity: 0.5 }));
neon.position.set(-1.55, 2.1, -3.3); neon.scale.setScalar(1.5); room.add(neon);
const poster = (x, y, w, h, a, b, label) => {
  put(room, box(w + 0.05, h + 0.05, 0.02), M(0x0a0c12), x, y, -3.31);
  const t = canvasTex(256, 340, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, a); grd.addColorStop(1, b); g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.arc(W * 0.68, H * 0.36, 70, 0, 7); g.fill();
    g.fillStyle = 'rgba(8,8,11,.3)'; g.beginPath(); g.arc(W * 0.36, H * 0.56, 96, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = '700 30px "JetBrains Mono", Menlo, monospace'; g.fillText(label, 22, H - 30);
  });
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: 0x8a8a8a }));
  p.position.set(x, y, -3.295); room.add(p);
};
poster(1.3, 2.2, 0.75, 1.0, '#0d1a3d', '#2f6bff', 'SwiftUI');
poster(2.3, 2.0, 0.63, 0.84, '#3d7bff', '#0b1430', 'SHIP IT');
put(room, box(0.9, 0.03, 0.2), wood, -1.55, 1.45, -3.2);
put(room, box(0.12, 0.2, 0.12), M(0x3d7bff), -1.85, 1.565, -3.2);
put(room, box(0.1, 0.26, 0.12), M(0xf2f0ea), -1.72, 1.595, -3.2);
put(room, sph(0.08), M(0x1b2a55, { roughness: 0.4 }), -1.4, 1.545, -3.2);
put(room, new THREE.IcosahedronGeometry(0.07, 0), M(0x6f8fff, { flatShading: true, roughness: 0.3 }), -1.2, 1.535, -3.2);

// dust
const dustN = 140, dustPos = new Float32Array(dustN * 3);
for (let i = 0; i < dustN; i++) { dustPos[i * 3] = (Math.random() - 0.5) * 6; dustPos[i * 3 + 1] = Math.random() * 3; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 5; }
const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dotTex = glowTex('rgba(255,255,255,1)');
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.035, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x9fc4ff }));
room.add(dust);

// floating code glyphs that rise out of the screen while typing
const glyphs = ['{ }', '</>', 'let', 'func', '0', '1', '( )', '=>', 'if', '[ ]'].map((s, i) => canvasTex(160, 96, (g, w, h) => {
  g.font = '700 54px "JetBrains Mono", Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const c = ['#a9c4ff', '#3d7bff', '#8fa6d6', '#c7d6ff', '#7fb2ff'][i % 5]; g.shadowColor = c; g.shadowBlur = 16; g.fillStyle = c; g.fillText(s, w / 2, h / 2);
}));
const floaters = Array.from({ length: SMALL ? 10 : 18 }, (_, i) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphs[i % glyphs.length], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.userData = { o: Math.random(), x: (Math.random() - 0.5) * 1.1, z: Math.random() * 0.9, sp: 0.1 + Math.random() * 0.1, sc: 0.1 + Math.random() * 0.1 };
  room.add(s); return s;
});

// ───────── the developer (origin: chair on the floor, facing −z toward the desk) ─────────
const kid = new THREE.Group(); room.add(kid);
const KID_REST = new THREE.Vector3(0, 0, 0.62), KID_START = new THREE.Vector3(3.6, 0, 2.1);
const clothTex = canvasTex(256, 256, (g, w, h) => {                                  // woven-fabric bump
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { const v = 108 + ((x + y) % 4 === 0 ? 34 : 0) + Math.random() * 30; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 2, 2); }
});
clothTex.wrapS = clothTex.wrapT = THREE.RepeatWrapping; clothTex.repeat.set(5, 5); clothTex.colorSpace = THREE.NoColorSpace;
const cloth = (color) => M(color, { roughness: 0.9, bumpMap: clothTex, bumpScale: 0.5 });
const hoodie = cloth(0xf06a2c), hoodieDark = cloth(0xc9501c);
const skin = M(0xd9966c, { roughness: 0.6 }), pants = M(0x1b2238, { roughness: 0.9 }), chairMat = M(0x141824, { roughness: 0.55 });
const hairMat = M(0x17110e, { roughness: 0.85 });

// chair
put(kid, box(0.48, 0.07, 0.46), chairMat, 0, 0.42, 0.02);
const back = put(kid, box(0.44, 0.52, 0.06), chairMat, 0, 0.76, 0.27); back.rotation.x = 0.1;
put(kid, box(0.36, 0.03, 0.065), new THREE.MeshBasicMaterial({ color: 0x2f6bff }), 0, 0.96, 0.29).rotation.x = 0.1;
put(kid, cyl(0.03, 0.03, 0.28, 12), metal, 0, 0.26, 0.02);
for (let i = 0; i < 5; i++) {
  const a = (i / 5) * Math.PI * 2;
  const spoke = put(kid, box(0.05, 0.03, 0.3), metal, Math.sin(a) * 0.15, 0.1, 0.02 + Math.cos(a) * 0.15); spoke.rotation.y = a;
  put(kid, sph(0.04, 12, 8), M(0x0b0d13), Math.sin(a) * 0.3, 0.04, 0.02 + Math.cos(a) * 0.3);
}

// body: isa's own scanned avatar (isa-avatar.glb, made with Avaturn), posed seated at the keyboard in code.
// Bones are aimed in world space (bone → child points along a target direction), so the rig's local axes don't matter.
const AV = { ready: false, b: {}, rest: new Map() };
const TUNE = Object.fromEntries(new URLSearchParams(location.search));               // ?tw=..&curl=.. while tuning the pose
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _e = new THREE.Euler();
function worldRotate(bone, q) {
  bone.getWorldQuaternion(_wq); _wq.premultiply(q); bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(_wq)); bone.updateWorldMatrix(false, true);
}
function aim(bone, child, x, y, z) {
  bone.updateWorldMatrix(true, true); bone.getWorldPosition(_a); child.getWorldPosition(_b); _b.sub(_a).normalize();
  worldRotate(bone, _q.setFromUnitVectors(_b, _d.set(x, y, z).normalize()));
}
function twist(bone, child, angle) { bone.getWorldPosition(_a); child.getWorldPosition(_b); _b.sub(_a).normalize(); worldRotate(bone, _q.setFromAxisAngle(_b, angle)); }
function turn(bone, x, y, z, angle) { bone.updateWorldMatrix(true, true); worldRotate(bone, _q.setFromAxisAngle(_d.set(x, y, z).normalize(), angle)); }

function poseSeated(model) {
  const B = AV.b;
  turn(B.Spine, 1, 0, 0, -0.07); turn(B.Neck, 1, 0, 0, -0.1); turn(B.Head, 1, 0, 0, -0.08);   // lean in, eyes on the screen
  for (const [P, sx] of [['Left', -1], ['Right', 1]]) {                                       // he faces −z; his left is −x
    aim(B[P + 'UpLeg'], B[P + 'Leg'], sx * 0.12, -0.08, -1);
    aim(B[P + 'Leg'], B[P + 'Foot'], 0, -1, 0.06);
    aim(B[P + 'Foot'], B[P + 'ToeBase'], sx * 0.1, -0.3, -1);
    aim(B[P + 'Arm'], B[P + 'ForeArm'], sx * 0.2, -1, -0.3);
    aim(B[P + 'ForeArm'], B[P + 'Hand'], -sx * 0.34, -0.1, -1);
    twist(B[P + 'ForeArm'], B[P + 'Hand'], sx * (+TUNE.tw || 0));
    aim(B[P + 'Hand'], B[P + 'HandMiddle1'], -sx * 0.12, -0.22, -1);
  }
  // sit on the chair: bring the hips to seat height, slightly back on the seat
  model.updateWorldMatrix(true, true); B.Hips.getWorldPosition(_a);
  model.position.x += kid.position.x - _a.x; model.position.y += 0.555 - _a.y; model.position.z += kid.position.z + 0.07 - _a.z;
  for (const n of Object.keys(B)) AV.rest.set(n, B[n].quaternion.clone());
}
new GLTFLoader().load(new URL('isa-avatar.glb?v=2', import.meta.url).href, (gltf) => {
  const model = gltf.scene; model.rotation.y = Math.PI; kid.add(model);
  model.traverse((o) => {
    if (o.isBone) AV.b[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      o.material.envMap = envTex; o.material.envMapIntensity = 0.5;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (o.material[k]) o.material[k].anisotropy = 8;
      if (o.material.transparent) { o.material.depthWrite = true; o.material.alphaTest = 0.35; o.castShadow = false; } }
  });
  kid.position.copy(KID_REST); kid.updateWorldMatrix(true, true);
  poseSeated(model); AV.ready = true;
}, undefined, (err) => console.warn('avatar failed to load:', err));
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
function animateAvatar(busy) {
  if (!AV.ready) return;
  const B = AV.b, R = AV.rest, set = (n, x, y, z) => { B[n].quaternion.copy(R.get(n)).multiply(_q.setFromEuler(_e.set(x, y, z))); };
  set('Head', Math.sin(time * 0.9) * 0.025, Math.sin(time * 0.6) * 0.07 + (busy ? Math.sin(time * 2.3) * 0.02 : 0), Math.sin(time * 1.1) * 0.02);
  set('Spine1', Math.sin(time * 1.7) * 0.012, 0, 0);
  ['Left', 'Right'].forEach((P, i) => {
    const k = busy ? 1 : 0.08;
    set(P + 'Hand', Math.sin(time * 13 + i * 2.1) * 0.05 * k, Math.sin(time * 5 + i * 3) * 0.06 * k, Math.sin(time * 9 + i) * 0.04 * k);
    set(P + 'ForeArm', Math.sin(time * 6 + i * 2.6) * 0.02 * k, 0, Math.sin(time * 4.3 + i) * 0.02 * k);
    FINGERS.forEach((f, j) => {
      const c = 0.22 + (busy ? Math.max(0, Math.sin(time * 19 + j * 1.9 + i * 2.6)) * 0.32 : 0);   // relaxed curl + key taps
      for (const seg of [1, 2]) set(P + 'Hand' + f + seg, c, 0, 0);
    });
  });
}

// camera: one full circle around the developer, then over the shoulder and into the screen
const ORB_C = new THREE.Vector3(0, 1.05, 0.4), ORBIT_END = 0.66;
function orbitPoint(t, out) {
  const th = lerp(0.85, 0.32 + Math.PI * 2, t);                                       // 0 = directly behind (+z)
  const front = Math.pow(Math.max(0, -Math.cos(th)), 2);                              // 1 when the camera faces him
  const r = lerp(3.7, 2.2, t) - front * 0.75, h = lerp(1.0, 0.55, t) + front * 0.3;
  return out.set(ORB_C.x + Math.sin(th) * r, ORB_C.y + h, ORB_C.z + Math.cos(th) * r);
}
const divePath = new THREE.CatmullRomCurve3([
  orbitPoint(0.93, new THREE.Vector3()),
  orbitPoint(1, new THREE.Vector3()),
  new THREE.Vector3(0.0, 1.9, 0.74),
  new THREE.Vector3(0.0, 1.17, 0.1),
  new THREE.Vector3(0.0, SCREEN_Y, SCREEN_Z + 0.05),
], false, 'catmullrom', 0.5);
const lookA = new THREE.Vector3(0, 1.12, 0.42), lookB = new THREE.Vector3(0, SCREEN_Y, SCREEN_Z), look = new THREE.Vector3();

// ═════════════════════════ SPACE ═════════════════════════
const SPACE_BG = 0x05070d;
const space = new THREE.Scene();
space.background = new THREE.Color(SPACE_BG);
space.fog = new THREE.Fog(SPACE_BG, 12, 58);
const spaceCam = new THREE.PerspectiveCamera(60, 1, 0.1, 120); spaceCam.position.set(0, 0, 5);

// data stream: a tunnel of 0s and 1s instead of stars
const starN = SMALL ? 800 : 1700, Z_NEAR = 6, Z_SPAN = 66;
const bitTex = (ch) => canvasTex(64, 64, (g) => { g.font = '700 50px "JetBrains Mono", Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(ch, 32, 35); });
const palette = [new THREE.Color(0x9fc4ff), new THREE.Color(0xe9f0ff), new THREE.Color(0x3d7bff), new THREE.Color(0x3d7bff), new THREE.Color(0xc7d6ff)];
const streams = ['0', '1'].map((ch) => {
  const n = starN >> 1, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 15;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(a) * r * 0.7; pos[i * 3 + 2] = Z_NEAR - Math.random() * Z_SPAN;
    const k = Math.random(), c = palette[k < 0.07 ? 3 : k < 0.2 ? 4 : (Math.random() * 3) | 0].clone().multiplyScalar(0.45 + Math.random() * 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, size: 0.085, vertexColors: true, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending }));
  space.add(pts); return pts;
});

// circuit-board floor with signal pulses running along the traces
const grid = new THREE.GridHelper(160, 80, 0x2f6bff, 0x101d40);
grid.position.y = -5; grid.material.transparent = true; grid.material.opacity = 0.32; space.add(grid);
const pulseTex = glowTex('rgba(255,255,255,1)');
const pulses = Array.from({ length: SMALL ? 8 : 16 }, (_, i) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pulseTex, color: i % 3 ? 0x3d7bff : 0xdfe9ff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(0.5, 0.5, 1); s.userData = { alongZ: i % 2 === 0, line: (Math.floor(Math.random() * 24) - 12) * 2, t: Math.random(), sp: 0.05 + Math.random() * 0.08 };
  space.add(s); return s;
});

// floating engineering panels at the sides: real code, a terminal, architecture / schema / blueprint drawings
const PW = 800, PH = 560, MONO = '"JetBrains Mono", Menlo, monospace';
const KW = new Set(['actor', 'private', 'var', 'let', 'func', 'async', 'throws', 'try', 'await', 'if', 'return', 'defer', 'final', 'class', 'do', 'catch', 'struct', 'some', 'import', 'nil']);
function panel(title, draw) {
  return canvasTex(PW, PH, (g) => {
    g.fillStyle = 'rgba(6,10,22,0.8)'; g.beginPath(); g.roundRect(2, 2, PW - 4, PH - 4, 14); g.fill();
    g.strokeStyle = 'rgba(110,160,255,0.42)'; g.lineWidth = 2; g.stroke();
    g.fillStyle = 'rgba(61,123,255,0.08)'; g.beginPath(); g.roundRect(2, 2, PW - 4, 44, [14, 14, 0, 0]); g.fill();
    g.font = `500 19px ${MONO}`; g.textBaseline = 'middle'; g.fillStyle = '#b7c6e6'; g.fillText(title, 22, 25);
    g.fillStyle = '#3d7bff'; g.fillRect(PW - 40, 20, 18, 3); g.fillStyle = '#3a4766'; g.fillRect(PW - 70, 20, 18, 3);
    for (const [x, y] of [[10, 10], [PW - 10, 10], [10, PH - 10], [PW - 10, PH - 10]]) { g.fillStyle = '#3d7bff'; g.fillRect(x - 2, y - 2, 4, 4); }   // corner ticks
    draw(g);
  });
}
function code(title, src) {
  return panel(title, (g) => {
    g.font = `500 20px ${MONO}`;
    src.split('\n').forEach((ln, i) => {
      const y = 78 + i * 31; let x = 64;
      g.fillStyle = '#2f3a55'; g.textAlign = 'right'; g.fillText(String(i + 1), 46, y); g.textAlign = 'left';
      for (const tok of ln.split(/(\s+|[()\[\]{}.,:<>?=!&|-]+|"[^"]*")/)) {
        if (!tok) continue;
        g.fillStyle = tok[0] === '"' ? '#7fb2ff' : KW.has(tok) ? '#3d7bff' : /^[A-Z@]/.test(tok) ? '#a9c4ff' : /^\d/.test(tok) ? '#c7d6ff' : /^[a-z]\w*$/.test(tok) ? '#e6ebf5' : '#5f6f92';
        g.fillText(tok, x, y); x += g.measureText(tok).width;
      }
    });
  });
}
const label = (g, t, x, y, c = '#b7c6e6', f = 17) => { g.font = `500 ${f}px ${MONO}`; g.fillStyle = c; g.fillText(t, x, y); };
const boxed = (g, t, x, y, w, h, c = '#3d7bff') => { g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(x, y, w, h); g.fillStyle = 'rgba(61,123,255,0.06)'; g.fillRect(x, y, w, h); g.font = `600 18px ${MONO}`; g.textAlign = 'center'; g.fillStyle = '#e9eefa'; g.fillText(t, x + w / 2, y + h / 2); g.textAlign = 'left'; };
const arrow = (g, x1, y1, x2, y2, c = '#3d7bff') => { const a = Math.atan2(y2 - y1, x2 - x1); g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.moveTo(x2, y2); g.lineTo(x2 - 11 * Math.cos(a - 0.45), y2 - 11 * Math.sin(a - 0.45)); g.moveTo(x2, y2); g.lineTo(x2 - 11 * Math.cos(a + 0.45), y2 - 11 * Math.sin(a + 0.45)); g.stroke(); };
const panelTex = [
  ...DATA.panels.code.map((c) => code(c.title, c.src)),
  panel(DATA.panels.terminal.title, (g) => { DATA.panels.terminal.lines.forEach(([t, c], i) => label(g, t, 26, 82 + i * 34, c, 21)); }),
  panel('architecture — MVVM + Clean', (g) => {
    const row = [['View', 40], ['ViewModel', 220], ['Service', 430], ['APIClient', 620]];
    row.forEach(([t, x], i) => { boxed(g, t, x, 110, 140, 62); if (i) arrow(g, row[i - 1][1] + 140, 141, x - 4, 141); });
    boxed(g, '.NET 10 Web API', 250, 290, 300, 62, '#3d7bff'); boxed(g, 'SQL Server', 250, 430, 300, 62, '#8fa6d6');
    arrow(g, 690, 172, 552, 300); arrow(g, 400, 352, 400, 426, '#8fa6d6');
    label(g, 'SwiftUI', 40, 200); label(g, '@Observable', 220, 200); label(g, 'protocol', 430, 200); label(g, 'async/await · actor', 560, 200);
    label(g, 'JWT · refresh rotation', 570, 326, '#3d7bff'); label(g, 'EF Core · Repository', 570, 466, '#8fa6d6');
    g.setLineDash([6, 6]); g.strokeStyle = '#2f3a55'; g.strokeRect(24, 82, 752, 140); g.setLineDash([]); label(g, 'iOS app', 30, 240, '#5f6f92');
  }),
  panel('schema — yukum.db', (g) => {
    const T = [['Users', 40, 90, ['Id  PK', 'Email', 'Role', 'CreatedAt']], ['Loads', 300, 150, ['Id  PK', 'ShipperId  FK', 'Origin', 'Destination', 'Weight']], ['Bids', 560, 90, ['Id  PK', 'LoadId  FK', 'CarrierId  FK', 'Price']]];
    T.forEach(([n, x, y, f]) => {
      g.strokeStyle = '#3d7bff'; g.lineWidth = 2; g.strokeRect(x, y, 200, 44 + f.length * 30); g.fillStyle = 'rgba(61,123,255,0.12)'; g.fillRect(x, y, 200, 38);
      label(g, n, x + 12, y + 20, '#e9eefa', 19); f.forEach((t, i) => label(g, t, x + 12, y + 62 + i * 30, /FK/.test(t) ? '#3d7bff' : /PK/.test(t) ? '#c7d6ff' : '#b7c6e6'));
    });
    arrow(g, 300, 244, 242, 150); arrow(g, 560, 180, 502, 210); arrow(g, 560, 212, 240, 130, '#8fa6d6');
    label(g, '1 — N', 250, 220, '#5f6f92'); label(g, 'N — 1', 508, 176, '#5f6f92'); label(g, '20 tables · 65 endpoints', 40, 520, '#5f6f92');
  }),
  panel('blueprint — iPhone 393 × 852 pt', (g) => {
    g.strokeStyle = '#3d7bff'; g.lineWidth = 2; g.beginPath(); g.roundRect(300, 70, 210, 440, 30); g.stroke(); g.beginPath(); g.roundRect(370, 84, 70, 18, 9); g.stroke();
    g.lineWidth = 1.5; g.strokeRect(318, 124, 174, 40); g.strokeRect(318, 178, 174, 110); g.strokeRect(318, 302, 82, 70); g.strokeRect(410, 302, 82, 70); g.strokeRect(318, 386, 174, 34);
    g.beginPath(); g.moveTo(318, 178); g.lineTo(492, 288); g.moveTo(492, 178); g.lineTo(318, 288); g.stroke(); g.beginPath(); g.roundRect(340, 440, 130, 40, 20); g.stroke();
    g.strokeStyle = '#3d7bff'; g.beginPath(); g.moveTo(300, 532); g.lineTo(510, 532); g.moveTo(300, 524); g.lineTo(300, 540); g.moveTo(510, 524); g.lineTo(510, 540); g.moveTo(550, 70); g.lineTo(550, 510); g.moveTo(542, 70); g.lineTo(558, 70); g.moveTo(542, 510); g.lineTo(558, 510); g.stroke();
    label(g, '393', 388, 548, '#3d7bff'); label(g, '852', 566, 290, '#3d7bff');
    [['NavigationStack', 124], ['Hero image', 232], ['LazyVGrid', 336], ['TextField', 402], ['Button · primary', 460]].forEach(([t, y]) => { label(g, t, 60, y); g.strokeStyle = '#2f3a55'; g.beginPath(); g.moveTo(232, y); g.lineTo(314, y); g.stroke(); });
    label(g, 'safe area', 600, 110, '#5f6f92'); label(g, '@ViewBuilder', 600, 232, '#5f6f92'); label(g, 'MVVM', 600, 336, '#5f6f92');
  }),
  panel('cache — 4-way set associative', (g) => {
    label(g, '64-bit address', 40, 84, '#e9eefa', 19);
    [['TAG', 40, 400, '#3d7bff'], ['INDEX', 440, 180, '#3d7bff'], ['OFFSET', 620, 140, '#8fa6d6']].forEach(([t, x, w, c]) => { boxed(g, t, x, 104, w, 54, c); });
    label(g, '63', 40, 178, '#5f6f92'); label(g, '0', 748, 178, '#5f6f92');
    for (let r = 0; r < 5; r++) for (let w = 0; w < 4; w++) { const x = 150 + w * 150, y = 240 + r * 52; g.strokeStyle = '#3a4766'; g.lineWidth = 1.5; g.strokeRect(x, y, 138, 40); const hit = (r * 3 + w * 5) % 7 === 0; if (hit) { g.fillStyle = 'rgba(61,123,255,0.18)'; g.fillRect(x, y, 138, 40); } label(g, (hit ? 'V 1  ' : 'V 0  ') + (0x1a3f + r * 977 + w * 131).toString(16), x + 10, y + 21, hit ? '#8fa6d6' : '#5f6f92', 16); }
    for (let r = 0; r < 5; r++) label(g, 'set ' + r, 50, 261 + r * 52);
    arrow(g, 530, 160, 110, 236);
    for (let w = 0; w < 4; w++) label(g, 'way ' + w, 190 + w * 150, 222, '#5f6f92', 15);
  }),
];
const shapes = Array.from({ length: SMALL ? 6 : 12 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(PW / 200, PH / 200), new THREE.MeshBasicMaterial({ map: panelTex[i % panelTex.length], transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  m.scale.setScalar(0.85 + Math.random() * 0.45);
  m.userData = { side, edge: 0.7 + Math.random() * 0.28, y: -9 + (i / 12) * 18 + Math.random() * 1.2, z: -2.5 - Math.random() * 13, d: 0.5 + Math.random() * 0.7, ph: Math.random() * 6 };
  space.add(m); return m;
});

// ═════════════════════════ post-processing ═════════════════════════
// Soft bloom makes the screen, neon and LEDs glow. Skipped on small screens; falls back to a plain render on error.
let composer = null, scenePass = null;
if (!SMALL && !REDUCED) {
  try {
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2 });
    composer = new EffectComposer(renderer, rt);
    scenePass = new RenderPass(room, roomCam); composer.addPass(scenePass);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), LT.bloom.strength, LT.bloom.radius, LT.bloom.threshold));
    composer.addPass(new OutputPass());
  } catch (err) { console.warn('bloom disabled:', err); composer = null; }
}
function draw(scene, cam) {
  if (!composer) { renderer.render(scene, cam); return; }
  scenePass.scene = scene; scenePass.camera = cam; composer.render();
}

// ═════════════════════════ runtime ═════════════════════════
let W = 0, H = 0, introH = 1;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  if (composer) { composer.setPixelRatio(DPR_ROOM); composer.setSize(W, H); }
  const aspect = W / H;
  roomCam.aspect = spaceCam.aspect = aspect;
  roomCam.fov = aspect < 0.75 ? 66 : aspect < 1.2 ? 52 : 40;
  spaceCam.fov = aspect < 1 ? 75 : 60;
  roomCam.updateProjectionMatrix(); spaceCam.updateProjectionMatrix();
  introH = intro ? intro.offsetHeight : 0;
}

const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', (e) => { mouse.x = (e.clientX / W) * 2 - 1; mouse.y = (e.clientY / H) * 2 - 1; }, { passive: true });

const caps = intro ? [...intro.querySelectorAll('[data-from]')].map((el) => ({ el, a: +el.dataset.from, b: +el.dataset.to, on: null })) : [];
const hint = intro && intro.querySelector('.intro-hint');
const noIntro = () => REDUCED || root.classList.contains('no-intro') || !intro;
const DBG = new URLSearchParams(location.search).get('p');                          // ?p=0.5 pins the intro at a point (for tuning)
function target() { if (DBG !== null) return +DBG; return noIntro() ? 2 : clamp(scrollY / Math.max(1, introH - H), 0, 1.25); }

let screenAt = -1, frameN = 0, mode = '', idleFor = 0, skip = false;
let ps = 0, time = 0, last = 0, arriveT = 1 /* already seated: no roll-in, no spin, no raised arms */, chars = 0, shownChars = -1, shownCaret = null;
let lastScroll = scrollY, vel = 0, flow = 0, introOn = null, heroE = -1, started = false;

function setClass(on) { if (on !== introOn) { introOn = on; root.classList.toggle('intro-on', on); } }

function updateRoom(dt) {
  // arrival: the chair rolls in with a spin, then the kid drops the hands onto the keyboard
  if (ps > 0.12) arriveT = 1;
  arriveT = Math.min(1, arriveT + dt / 3.4);
  const e = easeOutCubic(clamp(arriveT / 0.8));
  kid.position.lerpVectors(KID_START, KID_REST, e);
  kid.position.x += Math.sin(e * Math.PI) * 0.25;
  kid.rotation.y = (1 - e) * Math.PI * 4.5;
  const settle = smooth(0.72, 1, arriveT);                    // 0 = riding pose, 1 = typing pose
  const typing = time > 0.9;                                  // a beat of stillness, then he starts typing

  if (typing) chars = Math.min(TOTAL + 1, chars + dt * (ps > 0.6 ? 260 : 24));
  const caret = (time * 2) % 1 < 0.55, ci = Math.floor(chars);
  if ((ci !== shownChars || caret !== shownCaret) && time - screenAt > 0.08) { screenAt = time; shownChars = ci; shownCaret = caret; drawScreen(chars, caret); }   // ≤12 texture uploads/s
  const busy = typing && chars < TOTAL;

  animateAvatar(busy);

  const flick = LT.monitor + (busy ? Math.sin(time * 31) * 0.18 + Math.sin(time * 13) * 0.12 : Math.sin(time * 2) * 0.05);
  monitorLight.intensity = flick;
  fans.forEach((f, i) => { f.rotation.x += dt * (4 + i); });
  steam.forEach((s) => { const k = (time * 0.35 + s.userData.o) % 1; s.position.set(Math.sin(k * 6 + s.userData.o * 9) * 0.02, 0.1 + k * 0.28, 0); s.scale.setScalar(0.06 + k * 0.12); s.material.opacity = Math.sin(k * Math.PI) * 0.16; });
  leaves.forEach((l, i) => { l.rotation.z += Math.sin(time * 1.3 + i) * 0.0008; });
  dust.rotation.y = time * 0.02; dust.position.y = Math.sin(time * 0.3) * 0.05;
  neon.material.opacity = 0.5 + Math.sin(time * 40) * 0.02 + (Math.sin(time * 1.7) > 0.97 ? -0.2 : 0);
  floaters.forEach((s) => {
    const u = s.userData, k = (time * u.sp + u.o) % 1;
    s.position.set(u.x * (0.7 + k), SCREEN_Y + 0.42 + k * 1.25, SCREEN_Z - 0.15 - u.z * k * 0.6);
    s.scale.set(u.sc * 1.66, u.sc, 1);
    s.visible = false;                                         // floating glyphs retired: they read as cartoonish next to the real avatar
  });

  // camera
  const u = clamp(ps / 0.84);
  let free = 1;
  if (u < ORBIT_END) orbitPoint(u / ORBIT_END, roomCam.position);
  else { const k = (u - ORBIT_END) / (1 - ORBIT_END); divePath.getPoint(0.25 + 0.75 * k, roomCam.position); free = 1 - smooth(0.1, 0.6, k); look.lerpVectors(lookA, lookB, smooth(0.05, 0.62, k)); }
  if (u < ORBIT_END) { look.copy(lookA); look.y += 0.14 * Math.pow(Math.max(0, -Math.cos(lerp(0.85, 0.32 + Math.PI * 2, u / ORBIT_END))), 2); }   // look at his face on the front pass
  roomCam.position.x += mouse.sx * 0.12 * free; roomCam.position.y += -mouse.sy * 0.06 * free + Math.sin(time * 0.5) * 0.012 * free;
  roomCam.lookAt(look);
}

function updateSpace(dt) {
  const warp = ps < 1.2 ? (1 - smooth(0.86, 1.15, ps)) * 46 : 0;
  flow += (1.4 + warp + vel - flow) * Math.min(1, dt * 4);
  const dz = flow * dt;
  streams.forEach((pts) => {
    const p = pts.geometry.attributes.position.array;
    for (let i = 2; i < p.length; i += 3) { p[i] += dz; if (p[i] > Z_NEAR) p[i] -= Z_SPAN; }
    pts.geometry.attributes.position.needsUpdate = true;
  });
  grid.position.z = (grid.position.z + dz * 0.5) % 2;
  pulses.forEach((s) => {
    const u = s.userData; u.t = (u.t + dt * u.sp * (1 + flow * 0.08)) % 1;
    if (u.alongZ) s.position.set(u.line, -4.95, -50 + u.t * 56); else s.position.set(-30 + u.t * 60, -4.95, u.line - 14 + grid.position.z);
    s.material.opacity = Math.sin(u.t * Math.PI) * 0.9;
  });
  const sy = scrollY * 0.004;
  shapes.forEach((m) => {
    const u = m.userData;
    const ex = (5 - u.z) * Math.tan(spaceCam.fov * Math.PI / 360) * spaceCam.aspect * u.edge * u.side;   // stay near the left/right edge at any depth
    m.position.set(ex + Math.sin(time * 0.3 + u.ph) * 0.3, ((u.y + sy * u.d + 9) % 18 + 18) % 18 - 9, u.z);
    m.rotation.set(Math.sin(time * 0.35 + u.ph) * 0.05, -u.side * (0.5 + Math.sin(time * 0.25 + u.ph) * 0.07), Math.sin(time * 0.3 + u.ph) * 0.02);   // angled toward the page, gently swaying
    m.material.opacity = 0.72 + Math.sin(time * 0.8 + u.ph) * 0.1;
  });
  spaceCam.position.x = mouse.sx * 0.5; spaceCam.position.y = -mouse.sy * 0.3;
  spaceCam.rotation.z = mouse.sx * -0.025 + Math.sin(time * 0.2) * 0.01;
}

function updateDom() {
  setClass(!noIntro() && ps < 0.93);
  if (flash) flash.style.opacity = noIntro() ? 0 : clamp(1 - Math.abs(ps - 0.86) / 0.085).toFixed(3);
  caps.forEach((c) => { const on = ps >= c.a && ps < c.b; if (on !== c.on) { c.on = on; c.el.classList.toggle('on', on); } });
  if (hint) hint.style.opacity = ps < 0.04 ? 1 : 0;
  const e = noIntro() ? 1 : clamp((H - (introH - scrollY)) / (H * 0.8));
  if (Math.abs(e - heroE) > 0.002) { heroE = e; root.style.setProperty('--e', e.toFixed(3)); }
}

function frame(now) {
  if (document.hidden) { started = false; return; }
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; time += dt;
  ps += (target() - ps) * Math.min(1, dt * 7);
  mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 3); mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 3);
  const v = Math.min(34, Math.abs(scrollY - lastScroll) / Math.max(dt, 0.001) * 0.012); lastScroll = scrollY;
  vel += (v - vel) * Math.min(1, dt * 5);
  updateDom();
  const inRoom = ps < 0.86;
  if ((inRoom ? 'room' : 'space') !== mode) {                             // switch resolution budget with the scene
    mode = inRoom ? 'room' : 'space';
    renderer.setPixelRatio(inRoom ? DPR_ROOM : DPR_SPACE); resize(); renderer.shadowMap.needsUpdate = true;
  }
  if (inRoom) {
    updateRoom(dt);
    if (++frameN % 10 === 0) renderer.shadowMap.needsUpdate = true;
    draw(room, roomCam);
  } else {
    // background behind the portfolio: full rate while scrolling or moving the mouse, half rate when idle
    idleFor = vel > 0.3 || Math.abs(mouse.x - mouse.sx) + Math.abs(mouse.y - mouse.sy) > 0.01 ? 0 : idleFor + dt;
    skip = idleFor > 1.2 ? !skip : false;
    if (skip) return;
    updateSpace(idleFor > 1.2 ? dt * 2 : dt);
    renderer.render(space, spaceCam);
  }
}
function start() { if (started) return; started = true; last = performance.now(); requestAnimationFrame(frame); }

resize();
addEventListener('resize', resize);
if (REDUCED) {
  root.classList.add('no-intro'); ps = 2; updateDom();
  renderer.setPixelRatio(DPR_SPACE);
  const still = () => { resize(); renderer.render(space, spaceCam); };
  still(); addEventListener('resize', still);
} else {
  ps = target() > 0.5 ? target() : 0;
  if (document.fonts && document.fonts.load) document.fonts.load(FONT).then(() => { shownChars = -1; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  start();
}
root.classList.add('world-ready');
