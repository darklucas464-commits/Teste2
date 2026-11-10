/* Lixeiro Pixel 3D — jogo de lixeiro em pixel art 3D (Three.js) */
(() => {
'use strict';
const T = THREE;

// ------------------------------------------------------------------ utils
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);
const shade = (hex, f) => {
  const r = Math.min(255, ((hex >> 16) & 255) * f) | 0;
  const g = Math.min(255, ((hex >> 8) & 255) * f) | 0;
  const b = Math.min(255, (hex & 255) * f) | 0;
  return (r << 16) | (g << 8) | b;
};
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const units = ['K', 'M', 'B', 'T'];
  let u = -1;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
  return (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)) + units[u];
}

// ------------------------------------------------------------------ constantes
const TRUCK_SPEED = 3.5;
const SEG_LEN = 20;
const SEG_COUNT = 8;
const ROAD_HALF = 4;        // rua: x de -4 a 4
const WALK_OUT = 7.5;       // calçada: |x| de 4 a 7.5
const WALK_H = 0.15;
const ZONE_FRONT = -13;     // limite na frente do caminhão (z relativo)
const ZONE_BACK = 7.5;      // limite atrás do caminhão
const LOAD_CAP = 20;
const SAVE_KEY = 'lixeiro-pixel3d-v1';
const groundY = (x) => (Math.abs(x) > ROAD_HALF ? WALK_H : 0);

// ------------------------------------------------------------------ estado / save
const S = {
  money: 0, total: 0, deposits: 0, bought: 0, muted: false,
  lv: { speed: 0, carry: 0, range: 0, magnet: 0, value: 0, more: 0, rich: 0, helper: 0 },
};
let started = false, shopOpen = false;
let combo = 0, comboT = 0, load = 0, loadValue = 0, compactT = 0;

function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    if (!d) return;
    for (const k of ['money', 'total', 'deposits', 'bought']) if (typeof d[k] === 'number' && isFinite(d[k])) S[k] = d[k];
    S.muted = !!d.muted;
    if (d.lv) for (const k in S.lv) if (typeof d.lv[k] === 'number') S.lv[k] = Math.max(0, Math.floor(d.lv[k]));
  } catch (e) { /* sem save */ }
}
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage indisponível */ }
}
loadSave();

const stat = {
  speed: () => 6 + 0.7 * S.lv.speed,
  cap: () => 1 + S.lv.carry,
  range: () => 4.6 + 0.9 * S.lv.range,
  pickR: () => 1.25 + 0.32 * S.lv.magnet,
  mult: () => 1 + 0.25 * S.lv.value,
  gap: () => 4.2 / (1 + 0.22 * S.lv.more),
};

const UPGRADES = [
  { id: 'speed', name: 'Tênis de corrida', max: 10, base: 15, grow: 1.55, icon: 'shoe',
    desc: () => 'Corre mais rápido.' },
  { id: 'carry', name: 'Braços fortes', max: 8, base: 20, grow: 1.8, icon: 'bags',
    desc: () => 'Carrega ' + stat.cap() + ' lixo(s) de uma vez.' },
  { id: 'range', name: 'Arremesso forte', max: 10, base: 25, grow: 1.6, icon: 'target',
    desc: () => 'Joga o lixo de mais longe.' },
  { id: 'magnet', name: 'Luva magnética', max: 8, base: 30, grow: 1.65, icon: 'magnet',
    desc: () => 'Pega o lixo de mais longe.' },
  { id: 'value', name: 'Reciclagem', max: 25, base: 50, grow: 1.5, icon: 'coin',
    desc: () => 'Lixo vale x' + stat.mult().toFixed(2) + '.' },
  { id: 'more', name: 'Rota movimentada', max: 10, base: 75, grow: 1.7, icon: 'more',
    desc: () => 'Aparece mais lixo na rua.' },
  { id: 'rich', name: 'Bairro nobre', max: 10, base: 120, grow: 1.75, icon: 'gem',
    desc: () => 'Mais lixo raro e valioso.' },
  { id: 'helper', name: 'Ajudante', max: 4, base: 250, grow: 3.2, icon: 'gari',
    desc: () => 'Um colega que cata lixo sozinho.' },
];
const costOf = (u) => Math.round(u.base * Math.pow(u.grow, S.lv[u.id]));

// ------------------------------------------------------------------ áudio
let AC = null;
function audioInit() {
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; }
  }
  if (AC && AC.state === 'suspended') AC.resume();
}
function tone(freq, dur, type, vol, slide, delay) {
  if (S.muted || !AC) return;
  const t = AC.currentTime + (delay || 0);
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol || 0.06, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AC.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
let noiseBuf = null;
function noise(dur, vol, delay) {
  if (S.muted || !AC) return;
  if (!noiseBuf) {
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = AC.currentTime + (delay || 0);
  const src = AC.createBufferSource(), g = AC.createGain();
  src.buffer = noiseBuf;
  g.gain.setValueAtTime(vol || 0.05, t);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  src.connect(g); g.connect(AC.destination);
  src.start(t); src.stop(t + dur);
}
const sfx = {
  pickup: () => { tone(520, 0.06, 'square', 0.05); tone(780, 0.07, 'square', 0.05, 0, 0.05); },
  throw: () => tone(300, 0.12, 'triangle', 0.09, 260),
  coin: (c) => { const k = 1 + Math.min(c, 12) * 0.05; tone(988 * k, 0.07, 'square', 0.05); tone(1319 * k, 0.14, 'square', 0.05, 0, 0.07); },
  miss: () => tone(160, 0.2, 'sawtooth', 0.05, -80),
  buy: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.1, 'square', 0.05, 0, i * 0.07)),
  deny: () => tone(120, 0.15, 'square', 0.05),
  compact: () => { noise(0.45, 0.08); tone(90, 0.4, 'sawtooth', 0.07, -40); [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.12, 'square', 0.05, 0, 0.3 + i * 0.08)); },
};

// ------------------------------------------------------------------ renderer / cena
const canvas = $('game');
const renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.BasicShadowMap;
const scene = new T.Scene();
scene.background = new T.Color(0x7fd0f2);
scene.fog = new T.Fog(0x7fd0f2, 50, 105);
const camera = new T.PerspectiveCamera(50, 16 / 9, 0.5, 260);

const ambient = new T.AmbientLight(0xffffff, 1.7);
scene.add(ambient);
const sun = new T.DirectionalLight(0xffffff, 2.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -48; sun.shadow.camera.right = 48;
sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
let sunCenter = Infinity;
function placeSun(zc) {
  sunCenter = zc;
  sun.target.position.set(0, 0, zc);
  sun.position.set(20, 44, zc + 16);
  sun.target.updateMatrixWorld();
}

let camK = 1, camFollow = 0.25, camX = 0;
function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  const px = Math.max(2, Math.round(Math.min(w, h) / 240));   // tamanho do "pixel"
  renderer.setPixelRatio(1);
  renderer.setSize(Math.ceil(w / px), Math.ceil(h / px), false);
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 58 : 50;
  const hw = 17.7 * Math.tan((camera.fov / 2) * Math.PI / 180) * aspect;
  camK = clamp(9 / hw, 1, 1.6);
  camFollow = camK > 1.05 ? 0.6 : 0.25;
  camera.updateProjectionMatrix();
  scene.fog.near = 50 * camK; scene.fog.far = 105 * camK;
}
window.addEventListener('resize', layout);

// ------------------------------------------------------------------ voxel models
const vmat = new T.MeshLambertMaterial({ vertexColors: true });
const _c = new T.Color();
// parte: [x, yBase, z, largura, altura, profundidade, cor]
function buildGeo(parts) {
  const pos = new Float32Array(parts.length * 108);
  const nor = new Float32Array(parts.length * 108);
  const col = new Float32Array(parts.length * 108);
  let o = 0;
  for (const p of parts) {
    const g = new T.BoxGeometry(p[3], p[4], p[5]).toNonIndexed();
    g.translate(p[0], p[1] + p[4] / 2, p[2]);
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    _c.set(p[6]);
    for (let i = 0; i < 36; i++) { col[o + i * 3] = _c.r; col[o + i * 3 + 1] = _c.g; col[o + i * 3 + 2] = _c.b; }
    o += 108;
    g.dispose();
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
  geo.setAttribute('color', new T.BufferAttribute(col, 3));
  return geo;
}
function vmesh(partsOrGeo) {
  const geo = Array.isArray(partsOrGeo) ? buildGeo(partsOrGeo) : partsOrGeo;
  const m = new T.Mesh(geo, vmat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ texturas pixel art
function pixelTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new T.CanvasTexture(c);
  t.magFilter = T.NearestFilter;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.colorSpace = T.SRGBColorSpace;
  return t;
}
function speckle(g, w, h, colors, n) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(colors);
    g.fillRect((Math.random() * w) | 0, (Math.random() * h) | 0, 1, 1);
  }
}
const roadTex = pixelTex(64, 160, (g, w, h) => {
  g.fillStyle = '#4b4f5c'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, ['#454955', '#525665', '#3f434e', '#585c6b'], 1400);
  g.fillStyle = '#434753';
  for (let i = 0; i < 7; i++) g.fillRect((Math.random() * 54) | 0, (Math.random() * 150) | 0, 3 + ((Math.random() * 6) | 0), 2 + ((Math.random() * 5) | 0));
  g.fillStyle = '#d9d9cf'; g.fillRect(2, 0, 1, h); g.fillRect(61, 0, 1, h);
  g.fillStyle = '#f2c230';
  for (let y = 0; y < h; y += 32) g.fillRect(31, y + 8, 2, 16);
});
const walkTex = pixelTex(28, 160, (g, w, h) => {
  const tones = ['#c9c2b4', '#bfb8aa', '#d2ccbf', '#c4bdaf'];
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 7) {
    g.fillStyle = pick(tones); g.fillRect(x, y, 7, 8);
  }
  g.fillStyle = '#a39c8f';
  for (let y = 0; y < h; y += 8) g.fillRect(0, y, w, 1);
  for (let x = 0; x < w; x += 7) g.fillRect(x, 0, 1, h);
  speckle(g, w, h, ['#b3ac9e', '#d8d2c6'], 300);
});
const grassTex = pixelTex(32, 32, (g, w, h) => {
  g.fillStyle = '#5fae4b'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, ['#55a043', '#6dbb55', '#4f983f', '#79c45f'], 320);
  speckle(g, w, h, ['#fee761', '#ffffff', '#f77622'], 5);
});
grassTex.wrapS = grassTex.wrapT = T.RepeatWrapping;
grassTex.repeat.set(30 / 4, SEG_LEN / 4);

const roadGeo = new T.PlaneGeometry(ROAD_HALF * 2, SEG_LEN).rotateX(-Math.PI / 2);
const walkGeo = new T.BoxGeometry(WALK_OUT - ROAD_HALF, WALK_H, SEG_LEN);
const grassGeo = new T.PlaneGeometry(30, SEG_LEN).rotateX(-Math.PI / 2);
const roadMat = new T.MeshLambertMaterial({ map: roadTex });
const walkMat = new T.MeshLambertMaterial({ map: walkTex });
const grassMat = new T.MeshLambertMaterial({ map: grassTex });

// ------------------------------------------------------------------ cenário (casas, árvores...)
const WALLS = [0xf4e3c1, 0xf2b8a0, 0xa8d8e8, 0xf7d977, 0xc5e6a6, 0xe8e8e8, 0xf0a6c0, 0xd9c2f0, 0xffcf8f];
const ROOFS = [0xc8553d, 0xb04632, 0x8b5a3c, 0x5a6988, 0x9e4539];
const DOORS = [0x8b5a3c, 0x3a4466, 0x265c42, 0x9e2835];
const GLASS = 0x8fd3ff;
const LEAF = [0x3e8948, 0x4fa35a, 0x2f7a4a, 0x63c74d];

function tree(P, x, z, k) {
  if (Math.random() < 0.25) {            // coqueiro
    P.push([x, WALK_H, z, 0.35 * k, 4.6 * k, 0.35 * k, 0xb89a6a]);
    const y = WALK_H + 4.6 * k;
    P.push([x, y, z, 3.4 * k, 0.2, 0.7 * k, 0x3e8948], [x, y + 0.02, z, 0.7 * k, 0.2, 3.4 * k, 0x4fa35a]);
    P.push([x, y + 0.2, z, 0.9 * k, 0.3, 0.9 * k, 0x2f7a4a], [x + 0.25 * k, y - 0.3, z, 0.3, 0.3, 0.3, 0x8b5a3c]);
    return;
  }
  const a = pick(LEAF), b = pick(LEAF);
  P.push([x, WALK_H, z, 0.5 * k, 1.8 * k, 0.5 * k, 0x8b5a3c]);
  P.push([x, WALK_H + 1.6 * k, z, 2.4 * k, 1.2 * k, 2.4 * k, a]);
  P.push([x, WALK_H + 2.8 * k, z, 1.8 * k, 0.9 * k, 1.8 * k, b]);
  P.push([x, WALK_H + 3.7 * k, z, 1.0 * k, 0.6 * k, 1.0 * k, a]);
}
function windowX(P, fx, s, y, z, w, h) {   // janela numa parede virada para a rua
  P.push([fx, y, z, 0.1, h, w, 0xffffff], [fx - s * 0.03, y + 0.12, z, 0.1, h - 0.24, w - 0.24, GLASS]);
}
function windowZ(P, x, y, fz, w, h) {      // janela numa parede virada para a câmera
  P.push([x, y, fz, w, h, 0.1, 0xffffff], [x, y + 0.12, fz + 0.03, w - 0.24, h - 0.24, 0.1, GLASS]);
}
function muro(P, s, cz, gateZ, color) {
  const x = s * 7.95, z0 = cz - 4.8, z1 = cz + 4.8, g0 = gateZ - 0.8, g1 = gateZ + 0.8;
  if (g0 > z0) P.push([x, WALK_H, (z0 + g0) / 2, 0.3, 0.9, g0 - z0, color], [x, WALK_H + 0.9, (z0 + g0) / 2, 0.36, 0.1, g0 - z0, shade(color, 0.85)]);
  if (z1 > g1) P.push([x, WALK_H, (z1 + g1) / 2, 0.3, 0.9, z1 - g1, color], [x, WALK_H + 0.9, (z1 + g1) / 2, 0.36, 0.1, z1 - g1, shade(color, 0.85)]);
  P.push([x, WALK_H, gateZ, 0.1, 0.8, 1.6, 0x5a6988]);
}
function house(P, s, cz) {
  const wz = rand(6, 8), dx = rand(5, 6.5), floors = Math.random() < 0.3 ? 2 : 1;
  const h = floors * 2.6 + 0.5, front = 9.4, cx = s * (front + dx / 2);
  const wall = pick(WALLS), roof = pick(ROOFS);
  P.push([cx, WALK_H, cz, dx, h, wz, wall]);
  P.push([cx, WALK_H, cz, dx + 0.08, 0.4, wz + 0.08, shade(wall, 0.78)]);
  for (let i = 0; i < 4; i++) {
    P.push([cx, WALK_H + h + i * 0.35, cz, dx + 0.7, 0.35, (wz + 0.8) * (1 - i / 4.4), i % 2 ? shade(roof, 0.88) : roof]);
  }
  const fx = s * (front - 0.04), doorZ = cz - wz * 0.22, winZ = cz + wz * 0.2;
  P.push([fx, WALK_H, doorZ, 0.1, 1.8, 0.9, pick(DOORS)]);
  for (let f = 0; f < floors; f++) {
    const y = WALK_H + 0.9 + f * 2.6;
    windowX(P, fx, s, y, winZ, 1.4, 1.1);
    if (f > 0) windowX(P, fx, s, y, doorZ, 1.0, 1.1);
    windowZ(P, cx - dx * 0.2, y, cz + wz / 2 + 0.04, 1.2, 1.1);
    if (Math.random() < 0.6) windowZ(P, cx + dx * 0.22, y, cz + wz / 2 + 0.04, 1.0, 1.1);
  }
  muro(P, s, cz, doorZ, pick([0xe8e8e8, 0xd2ccbf, shade(wall, 0.92)]));
  if (Math.random() < 0.5) tree(P, s * rand(10.5, 13), cz + wz / 2 + rand(0.5, 1), 0.6);
}
function shop(P, s, cz) {
  const dx = 5.5, h = 3.2, front = 8.8, cx = s * (front + dx / 2), wz = 8.8;
  const wall = pick(WALLS), aw = pick([0xe43b44, 0x0099db, 0x3e8948, 0xf77622]);
  P.push([cx, WALK_H, cz, dx, h, wz, wall]);
  P.push([cx, WALK_H + h, cz, dx + 0.3, 0.3, wz + 0.3, shade(wall, 0.75)]);
  const fx = s * (front - 0.04);
  for (let i = 0; i < 8; i++) P.push([s * (front - 0.5), WALK_H + 2.35, cz - 3.85 + i * 1.1, 1.0, 0.16, 1.1, i % 2 ? 0xffffff : aw]);
  P.push([fx, WALK_H + h - 0.1, cz, 0.16, 0.9, 5.2, aw], [fx - s * 0.04, WALK_H + h + 0.1, cz, 0.16, 0.5, 4.4, 0xffffff]);
  P.push([fx, WALK_H, cz - 2.4, 0.1, 1.9, 1.1, pick(DOORS)]);
  windowX(P, fx, s, WALK_H + 0.7, cz + 1.2, 4.0, 1.5);
  windowZ(P, cx, WALK_H + 1.0, cz + wz / 2 + 0.04, 2.2, 1.2);
  // caixotes na frente
  P.push([s * 8.3, WALK_H, cz + 3.6, 0.6, 0.5, 0.6, 0xb98b55], [s * 8.3, WALK_H + 0.5, cz + 3.6, 0.5, 0.2, 0.5, pick([0xe43b44, 0xfeae34, 0x63c74d])]);
}
function building(P, s, cz) {
  const dx = 7, wz = 8.8, floors = 3 + ((Math.random() * 3) | 0), h = floors * 2.5 + 1, front = 9.2, cx = s * (front + dx / 2);
  const wall = pick([0xd9d2c5, 0xb8c4d6, 0xe6c9a8, 0xc9d9c0, 0xdcb8b0]);
  P.push([cx, WALK_H, cz, dx, h, wz, wall]);
  P.push([cx, WALK_H + h, cz, dx + 0.3, 0.35, wz + 0.3, shade(wall, 0.7)]);
  P.push([cx + s * 1.2, WALK_H + h + 0.35, cz - 1.5, 1.6, 1.3, 1.6, 0x4a90c2], [cx + s * 1.2, WALK_H + h + 1.65, cz - 1.5, 1.8, 0.15, 1.8, 0x3a6f99]);
  const fx = s * (front - 0.04);
  P.push([fx, WALK_H, cz, 0.1, 2.0, 1.6, 0x3a4466]);
  for (let f = 0; f < floors; f++) {
    const y = WALK_H + (f === 0 ? 1.2 : 0.9) + f * 2.5;
    for (const oz of [-2.9, 0, 2.9]) if (!(f === 0 && oz === 0)) windowX(P, fx, s, y, cz + oz, 1.3, 1.1);
    windowZ(P, cx - 1.6, y, cz + wz / 2 + 0.04, 1.3, 1.1);
    windowZ(P, cx + 1.6, y, cz + wz / 2 + 0.04, 1.3, 1.1);
  }
  muro(P, s, cz, cz, 0xd2ccbf);
}
function park(P, s, cz) {
  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) tree(P, s * rand(9.5, 14), cz + rand(-4, 4), rand(0.8, 1.15));
  const bx = s * 8.6;
  P.push([bx, WALK_H + 0.4, cz, 0.5, 0.1, 1.8, 0x8b5a3c], [bx + s * 0.25, WALK_H + 0.5, cz, 0.1, 0.5, 1.8, 0x8b5a3c]);
  P.push([bx, WALK_H, cz - 0.7, 0.4, 0.4, 0.12, 0x3a4466], [bx, WALK_H, cz + 0.7, 0.4, 0.4, 0.12, 0x3a4466]);
  for (let i = 0; i < 6; i++) P.push([s * rand(8.2, 13), WALK_H, cz + rand(-4.5, 4.5), 0.25, 0.25, 0.25, pick([0xe43b44, 0xfee761, 0xffffff, 0xf0a6c0])]);
}
function furniture(P, s, lampZ) {
  // poste de luz
  P.push([s * 7.25, WALK_H, lampZ, 0.18, 4.4, 0.18, 0x5a6988], [s * 6.75, WALK_H + 4.3, lampZ, 1.1, 0.14, 0.18, 0x5a6988]);
  P.push([s * 6.3, WALK_H + 4.1, lampZ, 0.5, 0.2, 0.32, 0xfff3b0]);
  if (Math.random() < 0.45) {           // lixeira laranja de rua
    const z = lampZ + rand(3, 6);
    P.push([s * 7.2, WALK_H, z, 0.12, 0.6, 0.12, 0x5a6988], [s * 7.2, WALK_H + 0.5, z, 0.5, 0.7, 0.4, 0xf77622], [s * 7.2, WALK_H + 1.2, z, 0.54, 0.08, 0.44, 0xb8491a]);
  }
  if (Math.random() < 0.25) {           // hidrante
    const z = lampZ - rand(3, 5);
    P.push([s * 7.15, WALK_H, z, 0.3, 0.6, 0.3, 0xe43b44], [s * 7.15, WALK_H + 0.6, z, 0.2, 0.15, 0.2, 0xb02a35], [s * 7.15, WALK_H + 0.3, z, 0.5, 0.14, 0.14, 0xb02a35]);
  }
  if (Math.random() < 0.25) tree(P, s * 7.15, lampZ + (lampZ > 0 ? -9 : 9) * rand(0.6, 1), 0.6);
  // árvores no fundo
  for (let i = 0; i < 2; i++) tree(P, s * rand(18, 27), rand(-9, 9), rand(0.9, 1.4));
}
function genDecor(seg) {
  if (seg.decor) { seg.g.remove(seg.decor); seg.decor.geometry.dispose(); }
  const P = [];
  for (const s of [-1, 1]) {
    for (const cz of [-5, 5]) {
      const r = Math.random();
      if (r < 0.52) house(P, s, cz);
      else if (r < 0.68) shop(P, s, cz);
      else if (r < 0.84) building(P, s, cz);
      else park(P, s, cz);
    }
    furniture(P, s, s > 0 ? -7 : 3);
  }
  seg.decor = vmesh(P);
  seg.g.add(seg.decor);
}
const segs = [];
function makeSegments() {
  for (let i = 0; i < SEG_COUNT; i++) {
    const g = new T.Group();
    const road = new T.Mesh(roadGeo, roadMat); road.receiveShadow = true; g.add(road);
    for (const s of [-1, 1]) {
      const wk = new T.Mesh(walkGeo, walkMat);
      wk.position.set(s * (ROAD_HALF + WALK_OUT) / 2, WALK_H / 2, 0); wk.receiveShadow = true; g.add(wk);
      const gr = new T.Mesh(grassGeo, grassMat);
      gr.position.set(s * (WALK_OUT + 15), WALK_H - 0.01, 0); gr.receiveShadow = true; g.add(gr);
    }
    const seg = { g, k: i - 2, decor: null };
    g.position.z = -seg.k * SEG_LEN;
    genDecor(seg);
    scene.add(g);
    segs.push(seg);
  }
}

// ------------------------------------------------------------------ caminhão
const truck = { x: 0, z: 0, squash: 0, g: new T.Group(), beacon: null };
(function buildTruck() {
  const P = [
    [0, 0.55, 0.1, 2.5, 0.35, 8.0, 0x2b2b3a],
    // cabine
    [0, 0.9, -3.0, 2.8, 2.3, 2.0, 0xf2f2f2],
    [0, 3.2, -3.0, 2.6, 0.15, 1.8, 0xd0d4e0],
    [0, 2.0, -4.02, 2.4, 0.9, 0.06, 0x6fc3df],
    [1.41, 2.0, -3.0, 0.06, 0.8, 1.3, 0x6fc3df], [-1.41, 2.0, -3.0, 0.06, 0.8, 1.3, 0x6fc3df],
    [0, 0.9, -4.05, 2.8, 0.5, 0.15, 0x3a4466],
    [0.9, 1.45, -4.03, 0.5, 0.3, 0.06, 0xfee761], [-0.9, 1.45, -4.03, 0.5, 0.3, 0.06, 0xfee761],
    [1.41, 1.2, -3.0, 0.06, 0.35, 2.0, 0xf77622], [-1.41, 1.2, -3.0, 0.06, 0.35, 2.0, 0xf77622],
    // caçamba compactadora
    [0, 0.9, 0.4, 3.0, 2.9, 4.6, 0x3e8948],
    [0, 3.8, 0.4, 2.6, 0.15, 4.2, 0x327345],
    [1.51, 1.9, 0.4, 0.06, 0.45, 4.6, 0xfee761], [-1.51, 1.9, 0.4, 0.06, 0.45, 4.6, 0xfee761],
    [1.51, 2.7, 0.4, 0.06, 0.2, 4.6, 0xffffff], [-1.51, 2.7, 0.4, 0.06, 0.2, 4.6, 0xffffff],
    [1.51, 1.2, 0.4, 0.06, 0.3, 4.6, 0x327345], [-1.51, 1.2, 0.4, 0.06, 0.3, 4.6, 0x327345],
    // boca traseira (onde entra o lixo)
    [1.35, 0.9, 3.3, 0.3, 2.5, 1.3, 0x327345], [-1.35, 0.9, 3.3, 0.3, 2.5, 1.3, 0x327345],
    [0, 0.75, 3.35, 3.0, 0.35, 1.4, 0x2b2b3a],
    [0, 3.3, 3.0, 3.0, 0.5, 0.7, 0x3e8948],
    [0, 1.1, 2.72, 2.4, 2.2, 0.06, 0x14141f],
    [0, 1.1, 3.95, 2.4, 0.4, 0.12, 0x8b9bb4],
    [0, 3.3, 3.36, 2.0, 0.3, 0.06, 0xfee761],
    // lanternas
    [1.35, 1.2, 3.97, 0.22, 0.3, 0.06, 0xe43b44], [-1.35, 1.2, 3.97, 0.22, 0.3, 0.06, 0xe43b44],
    [1.35, 2.9, 3.97, 0.22, 0.22, 0.06, 0xfeae34], [-1.35, 2.9, 3.97, 0.22, 0.22, 0.06, 0xfeae34],
    // estribo
    [0, 0.4, 4.2, 3.0, 0.15, 0.5, 0x8b9bb4],
    // escapamento
    [1.25, 3.2, -1.75, 0.22, 1.3, 0.22, 0x8b9bb4],
  ];
  for (const z of [-2.9, 1.3, 2.5]) for (const s of [-1, 1]) {
    P.push([s * 1.3, 0, z, 0.5, 1.0, 1.0, 0x181425], [s * 1.57, 0.3, z, 0.06, 0.4, 0.4, 0xc0cbdc]);
  }
  truck.g.add(vmesh(P));
  truck.beacon = new T.Mesh(new T.BoxGeometry(0.5, 0.3, 0.4), new T.MeshBasicMaterial({ color: 0xfeae34 }));
  truck.beacon.position.set(0, 3.5, -3.0);
  truck.g.add(truck.beacon);
  scene.add(truck.g);
})();
const HOP_Y = 1.7, HOP_Z = 3.4;   // posição da boca da caçamba (local)

// anel de alcance do arremesso
const ringTex = (() => {
  const t = pixelTex(128, 128, (g) => {
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    const n = 28;
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(64, 64, 61, (i / n) * Math.PI * 2, ((i + 0.55) / n) * Math.PI * 2);
      g.stroke();
    }
  });
  t.minFilter = T.NearestFilter; t.generateMipmaps = false;
  return t;
})();
const ringMat = new T.MeshBasicMaterial({ map: ringTex, transparent: true, alphaTest: 0.5, depthWrite: false, opacity: 0.9 });
const ring = new T.Mesh(new T.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), ringMat);
ring.position.y = WALK_H + 0.06;
ring.renderOrder = 2;
scene.add(ring);

// ------------------------------------------------------------------ gari (jogador e ajudantes)
const SKIN = [0xe8b796, 0xc68642, 0x8d5524, 0xf1c9a5];
function makeGari(shirt, pants, cap, skin) {
  const g = new T.Group();
  const body = vmesh([
    [0, 0.75, 0, 0.7, 0.75, 0.42, shirt],
    [0, 1.0, 0, 0.74, 0.12, 0.46, 0xe8ff5a],
    [0, 0.75, 0, 0.72, 0.1, 0.44, shade(shirt, 0.8)],
    [0, 1.5, 0, 0.5, 0.46, 0.5, skin],
    [0, 1.62, 0.23, 0.52, 0.34, 0.06, 0x3b2a20],
    [0, 1.92, 0, 0.56, 0.16, 0.56, cap],
    [0, 1.92, -0.38, 0.46, 0.07, 0.22, cap],
  ]);
  g.add(body);
  const legGeo = buildGeo([[0, -0.55, 0, 0.28, 0.55, 0.3, pants], [0, -0.75, -0.04, 0.3, 0.2, 0.4, 0x181425]]);
  const armGeo = buildGeo([[0, -0.5, 0, 0.24, 0.5, 0.26, shirt], [0, -0.68, 0, 0.26, 0.18, 0.28, 0xfee761]]);
  const mk = (geo, x, y) => { const m = vmesh(geo); m.position.set(x, y, 0); g.add(m); return m; };
  const m = {
    g, body,
    legL: mk(legGeo, -0.19, 0.75), legR: mk(legGeo, 0.19, 0.75),
    armL: mk(armGeo, -0.48, 1.45), armR: mk(armGeo, 0.48, 1.45),
    phase: Math.random() * 6, angle: 0, throwT: 0,
  };
  scene.add(g);
  return m;
}
function animGari(e, dt, dx, dz) {
  // (dx,dz) = velocidade real no mundo
  const m = e.m, sp = Math.hypot(dx, dz);
  if (sp > 0.3) {
    const want = Math.atan2(-dx, -dz);
    let d = want - m.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    m.angle += d * Math.min(1, dt * 12);
  }
  m.phase += dt * (5 + sp * 1.4);
  const sw = Math.sin(m.phase) * Math.min(1, 0.35 + sp * 0.12);
  m.legL.rotation.x = sw; m.legR.rotation.x = -sw;
  m.throwT = Math.max(0, m.throwT - dt);
  if (m.throwT > 0) {
    const a = Math.PI * 0.55 + (m.throwT / 0.2) * 1.2;
    m.armL.rotation.x = a; m.armR.rotation.x = a;
  } else if (e.held.length) {
    m.armL.rotation.x = Math.PI + Math.sin(m.phase * 2) * 0.05;
    m.armR.rotation.x = Math.PI - Math.sin(m.phase * 2) * 0.05;
  } else {
    m.armL.rotation.x = -sw * 0.9; m.armR.rotation.x = sw * 0.9;
  }
  const gy = groundY(e.x);
  e.gy = lerp(e.gy === undefined ? gy : e.gy, gy, Math.min(1, dt * 14));
  m.g.position.set(e.x, e.gy + Math.abs(Math.sin(m.phase)) * 0.09, e.z);
  m.g.rotation.y = m.angle;
}
function collideTruck(e) {
  const rx = e.x - truck.x, rz = e.z - truck.z;
  const hx = 1.95, z0 = -4.5, z1 = 4.75;
  if (Math.abs(rx) < hx && rz > z0 && rz < z1) {
    const px = hx - Math.abs(rx), pf = rz - z0, pb = z1 - rz;
    if (px <= pf && px <= pb) e.x = truck.x + (rx >= 0 ? hx : -hx);
    else if (pb < pf) e.z = truck.z + z1;
    else e.z = truck.z + z0;
  }
}
function clampZone(e) {
  e.x = clamp(e.x, -7.3, 7.3);
  e.z = clamp(e.z, truck.z + ZONE_FRONT, truck.z + ZONE_BACK);
}

const player = { x: 2.6, z: 6, held: [], cool: 0, m: makeGari(0xf77622, 0x3a4466, 0xf77622, SKIN[0]) };
const helpers = [];
const HELPER_COLORS = [0x0099db, 0xb55088, 0x63c74d, 0xfee761];
function syncHelpers() {
  while (helpers.length < S.lv.helper) {
    const i = helpers.length;
    const side = i % 2 === 0 ? 1 : -1;
    const h = {
      x: side * 2.8, z: truck.z + 6.5, held: [], cool: 0, target: null, side, idx: i,
      m: makeGari(HELPER_COLORS[i % 4], 0x262b44, HELPER_COLORS[i % 4], SKIN[(i + 1) % 4]),
    };
    h.m.g.scale.setScalar(0.88);
    helpers.push(h);
  }
}

// ------------------------------------------------------------------ lixo
function bagParts(c) {
  return [
    [0, 0, 0, 0.72, 0.5, 0.72, c], [0, 0.5, 0, 0.5, 0.16, 0.5, shade(c, 1.25)],
    [0, 0.66, 0, 0.16, 0.14, 0.16, shade(c, 0.8)], [0.2, 0.3, 0.37, 0.14, 0.14, 0.02, shade(c, 1.9)],
    [-0.37, 0.28, -0.1, 0.02, 0.14, 0.14, shade(c, 1.9)],
  ];
}
const TYPES = [
  { id: 'preto', value: 1, w: 60, rich: 0, color: 0x3a3a50, parts: bagParts(0x33334a) },
  { id: 'azul', value: 2, w: 25, rich: 0.15, color: 0x0099db, parts: bagParts(0x1f7fc4) },
  { id: 'caixa', value: 3, w: 15, rich: 0.3, color: 0xb98b55, parts: [
    [0, 0, 0, 0.8, 0.6, 0.8, 0xb98b55], [0, 0.6, 0, 0.84, 0.06, 0.2, 0xe6cfa0], [0, 0.2, 0.41, 0.3, 0.2, 0.02, 0x8b6238]] },
  { id: 'garrafas', value: 6, w: 6, rich: 0.6, color: 0x63c74d, parts: [
    [0, 0, 0, 0.8, 0.4, 0.6, 0xe43b44], [-0.22, 0.4, 0, 0.18, 0.4, 0.18, 0x63c74d], [0, 0.4, 0, 0.18, 0.4, 0.18, 0x3e8948],
    [0.22, 0.4, 0, 0.18, 0.4, 0.18, 0x63c74d], [-0.22, 0.8, 0, 0.08, 0.14, 0.08, 0xc0cbdc], [0, 0.8, 0, 0.08, 0.14, 0.08, 0xc0cbdc], [0.22, 0.8, 0, 0.08, 0.14, 0.08, 0xc0cbdc]] },
  { id: 'tv', value: 15, w: 2.5, rich: 1.0, color: 0x8b9bb4, parts: [
    [0, 0, 0, 0.9, 0.75, 0.7, 0x8b6238], [0, 0.12, 0.36, 0.6, 0.5, 0.02, 0x9ad8e8], [0.36, 0.2, 0.36, 0.1, 0.1, 0.03, 0x181425],
    [-0.15, 0.75, 0, 0.05, 0.4, 0.05, 0xc0cbdc], [0.15, 0.75, 0, 0.05, 0.4, 0.05, 0xc0cbdc]] },
  { id: 'ouro', value: 60, w: 0.5, rich: 1.6, color: 0xfee761, parts: bagParts(0xf2b020) },
];
for (const t of TYPES) { t.geo = buildGeo(t.parts); t.free = []; }
function pickType() {
  let tot = 0;
  for (const t of TYPES) tot += t.w * (1 + S.lv.rich * t.rich);
  let r = Math.random() * tot;
  for (const t of TYPES) { r -= t.w * (1 + S.lv.rich * t.rich); if (r <= 0) return t; }
  return TYPES[0];
}
const trash = [];
function spawnTrash(z) {
  const type = pickType();
  const s = Math.random() < 0.5 ? -1 : 1;
  const x = s * (Math.random() < 0.14 ? rand(2.6, 3.7) : rand(4.7, 6.6));
  const mesh = type.free.pop() || vmesh(type.geo);
  const b = { type, mesh, state: 'ground', x, y: groundY(x), z, holder: null, reservedBy: null, t: 0, spark: 0 };
  mesh.position.set(x, b.y, z);
  mesh.rotation.set(0, rand(0, 6.28), 0);
  mesh.scale.setScalar(1);
  scene.add(mesh);
  trash.push(b);
}
function removeTrash(b) {
  scene.remove(b.mesh);
  b.type.free.push(b.mesh);
  b.state = 'gone';
  if (b.reservedBy) { b.reservedBy.target = null; b.reservedBy = null; }
}
function grab(e, b) {
  if (b.reservedBy && b.reservedBy !== e) b.reservedBy.target = null;
  b.reservedBy = null;
  b.state = 'held'; b.holder = e;
  e.held.push(b);
}
function throwBag(e, isPlayer) {
  const b = e.held.pop();
  if (!b) return;
  const range = isPlayer ? stat.range() : Math.max(4.6, stat.range() * 0.9);
  const dx = truck.x - e.x, dz = truck.z + HOP_Z - e.z, d = Math.hypot(dx, dz);
  b.state = 'fly'; b.holder = null; b.t = 0; b.byPlayer = isPlayer;
  b.sx = b.mesh.position.x; b.sy = b.mesh.position.y; b.sz = b.mesh.position.z;
  e.m.throwT = 0.2;
  if (d <= range) {
    b.toTruck = true; b.dur = 0.32 + d * 0.035; b.arc = 1.2 + d * 0.18;
    if (isPlayer) sfx.throw();
  } else {
    const k = (range * 0.8) / d;
    b.toTruck = false; b.dur = 0.5; b.arc = 1.6;
    b.tx = clamp(e.x + dx * k + rand(-0.4, 0.4), -7, 7); b.tz = e.z + dz * k;
    if (isPlayer) { sfx.miss(); popup('LONGE!', e.x, 2.6, e.z, 'bad'); }
  }
}
function deposit(b) {
  const comboMult = b.byPlayer ? 1 + Math.min(combo, 20) * 0.05 : 1;
  const v = Math.max(1, Math.round(b.type.value * stat.mult() * comboMult));
  S.money += v; S.total += v; S.deposits++;
  loadValue += v; load++;
  if (b.byPlayer) { combo++; comboT = 3; sfx.coin(combo); }
  popup('+$' + fmt(v), truck.x + rand(-0.6, 0.6), 4.3, truck.z + HOP_Z, b.byPlayer ? '' : 'helper');
  truck.squash = 1;
  for (let i = 0; i < 5; i++) {
    spawnP(truck.x + rand(-0.8, 0.8), 2.0, truck.z + HOP_Z + 0.3, rand(-2, 2), rand(2, 5), rand(0.5, 3) - TRUCK_SPEED, b.type.color, 0.5, 0.16, 12);
  }
  removeTrash(b);
  if (load >= LOAD_CAP) {
    const bonus = Math.max(1, Math.round(loadValue * 0.25));
    S.money += bonus; S.total += bonus;
    load = 0; loadValue = 0; compactT = 1.2;
    sfx.compact();
    popup('CARGA CHEIA! +$' + fmt(bonus), truck.x, 6, truck.z, 'big');
  }
  hudDirty = true;
}

// ------------------------------------------------------------------ partículas
const parts = [];
const pGeo = new T.BoxGeometry(1, 1, 1);
function spawnP(x, y, z, vx, vy, vz, color, life, size, grav) {
  let p = null;
  for (const q of parts) if (q.life <= 0) { p = q; break; }
  if (!p) {
    if (parts.length >= 90) return;
    p = { mesh: new T.Mesh(pGeo, new T.MeshBasicMaterial()), life: 0 };
    scene.add(p.mesh); parts.push(p);
  }
  p.mesh.material.color.set(color);
  p.mesh.position.set(x, y, z);
  p.mesh.scale.setScalar(size);
  p.mesh.visible = true;
  p.vx = vx; p.vy = vy; p.vz = vz; p.life = life; p.max = life; p.size = size; p.grav = grav;
}
function updateParts(dt) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vy -= p.grav * dt;
    p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
    if (p.grav < 0) p.mesh.scale.setScalar(p.size * (1 + (1 - p.life / p.max) * 1.4));
  }
}

// ------------------------------------------------------------------ popups
const pops = $('pops');
const _v = new T.Vector3();
function popup(text, x, y, z, cls) {
  _v.set(x, y, z).project(camera);
  if (_v.z > 1) return;
  const el = document.createElement('div');
  el.className = 'pop outline ' + (cls || '');
  el.textContent = text;
  el.style.left = clamp((_v.x * 0.5 + 0.5) * window.innerWidth, 40, window.innerWidth - 40) + 'px';
  el.style.top = Math.max(60, (-_v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  pops.appendChild(el);
  setTimeout(() => el.remove(), cls === 'big' ? 1400 : 900);
}

// ------------------------------------------------------------------ input
const keys = {};
const input = { x: 0, z: 0 };
let throwHeld = false, throwQueued = false, isTouch = false;
let stickId = null, stickX = 0, stickY = 0;
const stick = $('stick'), knob = $('knob'), btnThrow = $('btnThrow');

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  audioInit();
  if (!started) { if (e.code === 'Space' || e.code === 'Enter') startGame(); return; }
  if (e.code === 'Space') { throwHeld = true; throwQueued = true; }
  if (e.code === 'KeyE' || e.code === 'Tab') toggleShop();
  if (e.code === 'Escape' && shopOpen) toggleShop(false);
  if (e.code === 'KeyM') toggleMute();
});
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Space') throwHeld = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; throwHeld = false; });

canvas.addEventListener('pointerdown', (e) => {
  audioInit();
  if (!started || shopOpen) return;
  if (e.pointerType === 'mouse') {
    if (e.button === 0) { throwHeld = true; throwQueued = true; }
    return;
  }
  setTouch();
  if (stickId === null) {
    stickId = e.pointerId; stickX = e.clientX; stickY = e.clientY;
    stick.style.left = stickX + 'px'; stick.style.top = stickY + 'px';
    knob.style.transform = '';
    stick.classList.remove('hidden');
    input.tx = 0; input.tz = 0;
  }
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stickId) return;
  let dx = e.clientX - stickX, dy = e.clientY - stickY;
  const d = Math.hypot(dx, dy), R = 44;
  if (d > R) { dx *= R / d; dy *= R / d; }
  knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  input.tx = dx / R; input.tz = dy / R;
});
function endPointer(e) {
  if (e.pointerType === 'mouse') { throwHeld = false; return; }
  if (e.pointerId === stickId) {
    stickId = null; input.tx = 0; input.tz = 0;
    stick.classList.add('hidden');
  }
}
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function setTouch() {
  if (isTouch) return;
  isTouch = true;
  if (started) btnThrow.classList.remove('hidden');
}
btnThrow.addEventListener('pointerdown', (e) => { e.preventDefault(); audioInit(); throwHeld = true; throwQueued = true; });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btnThrow.addEventListener(ev, () => { throwHeld = false; });

function readInput() {
  let x = 0, z = 0;
  if (keys.KeyA || keys.ArrowLeft) x -= 1;
  if (keys.KeyD || keys.ArrowRight) x += 1;
  if (keys.KeyW || keys.ArrowUp) z -= 1;
  if (keys.KeyS || keys.ArrowDown) z += 1;
  if (stickId !== null) { x += input.tx || 0; z += input.tz || 0; }
  const d = Math.hypot(x, z);
  if (d > 1) { x /= d; z /= d; }
  input.x = x; input.z = z;
}

// ------------------------------------------------------------------ HUD / loja
const elMoney = $('moneyVal'), elMoneyBox = $('money'), elCarry = $('carry'), elCombo = $('combo');
const elLoad = $('loadFill'), elHint = $('hint'), btnShop = $('btnShop'), btnMute = $('btnMute');
let hudDirty = true, lastMoney = -1;
const ICON_PAL = {
  k: '#181425', w: '#ffffff', r: '#e43b44', o: '#f77622', y: '#feae34', Y: '#fee761', g: '#63c74d',
  G: '#3e8948', b: '#0099db', d: '#3a4466', l: '#c0cbdc', n: '#b86f50', s: '#e8b796', c: '#8fd3ff',
};
const ICONS = {
  shoe: ['', '', '......rr', '.....rrrr', '....rrwrr', '...rrwrrr', 'rrrrrrrrrr', 'rrrrrrrrrrr', 'wwwwwwwwwww', 'kkkkkkkkkkk'],
  bags: ['', '.....kk', '....kkkk', '...kkdkkk', '...kkkkkk', '....kkkk', '.kk.....kk', 'kkkk...kkkk', 'kdkkk.kkdkk', 'kkkkk.kkkkk', '.kkk...kkk'],
  target: ['....rrrr', '..rrwwwwrr', '.rwwwwwwwwr', '.rwwrrrrwwr', 'rwwrrwwrrwwr', 'rwwrwrrwrwwr', 'rwwrwrrwrwwr', 'rwwrrwwrrwwr', '.rwwrrrrwwr', '.rwwwwwwwwr', '..rrwwwwrr', '....rrrr'],
  magnet: ['', '.www....www', '.www....www', '.rrr....rrr', '.rrr....rrr', '.rrr....rrr', '.rrr....rrr', '.rrrr..rrrr', '..rrrrrrrr', '...rrrrrr'],
  coin: ['....yyyy', '..yyYYYYyy', '.yYYYkkYYYy', '.yYYkkkkYYy', 'yYYkkYYYYYYy', 'yYYYkkkYYYYy', 'yYYYYYkkYYYy', 'yYYYYYYkkYYy', '.yYYkkkkYYy', '.yYYYkkYYYy', '..yyYYYYyy', '....yyyy'],
  more: ['.........g', '........ggg', '...kk....g', '..kkkk', '.kkkkkk', '.kkdkkkk', 'kkkkkkkk', 'kkkkkkkk', 'kkkkkkkk', '.kkkkkk'],
  gem: ['', '..cccccccc', '.cwwccccbbb', 'ccwcccccbbbb', 'cccccccbbbbb', '.cccccbbbbb', '..cccbbbbb', '...ccbbbb', '....cbbb', '.....bb'],
  gari: ['', '...oooooo', '..oooooooo', '..oooooooooo', '..ssssssss', '..sksssskss', '..ssssssss', '..sskkkkss', '...ssssss', '..oooooooo', '.ooYYYYYYoo', '.oooooooooo'],
};
function iconURL(name) {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const g = c.getContext('2d');
  ICONS[name].forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = ICON_PAL[row[x]];
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  });
  return c.toDataURL();
}
const shopRows = [];
function buildShop() {
  const list = $('shopList');
  for (const u of UPGRADES) {
    const row = document.createElement('div'); row.className = 'item';
    const img = document.createElement('img'); img.src = iconURL(u.icon); img.alt = '';
    const mid = document.createElement('div');
    const name = document.createElement('div'); name.className = 'name'; name.textContent = u.name;
    const desc = document.createElement('div'); desc.className = 'desc';
    const lvl = document.createElement('div'); lvl.className = 'lvl';
    mid.append(name, desc, lvl);
    const btn = document.createElement('button'); btn.className = 'btn';
    btn.addEventListener('click', () => buy(u));
    row.append(img, mid, btn);
    list.appendChild(row);
    shopRows.push({ u, desc, lvl, btn });
  }
}
function refreshShop() {
  $('shopMoney').textContent = '$' + fmt(S.money);
  for (const r of shopRows) {
    const lv = S.lv[r.u.id], maxed = lv >= r.u.max;
    r.desc.textContent = r.u.desc();
    r.lvl.textContent = 'Nível ' + lv + '/' + r.u.max;
    r.btn.textContent = maxed ? 'MAX' : '$' + fmt(costOf(r.u));
    r.btn.disabled = maxed || S.money < costOf(r.u);
    r.btn.classList.toggle('max', maxed);
  }
}
function buy(u) {
  audioInit();
  const c = costOf(u);
  if (S.lv[u.id] >= u.max || S.money < c) { sfx.deny(); return; }
  S.money -= c; S.lv[u.id]++; S.bought++;
  sfx.buy();
  syncHelpers();
  save(); refreshShop(); hudDirty = true;
}
function toggleShop(force) {
  if (!started) return;
  shopOpen = force === undefined ? !shopOpen : force;
  $('shop').classList.toggle('hidden', !shopOpen);
  resetArmed = false; $('btnReset').textContent = 'APAGAR SAVE';
  throwHeld = false; throwQueued = false;
  if (shopOpen) refreshShop(); else save();
}
function toggleMute() {
  S.muted = !S.muted;
  btnMute.textContent = S.muted ? 'MUDO' : 'SOM';
  save();
}
let resetArmed = false;
$('btnReset').addEventListener('click', () => {
  if (!resetArmed) { resetArmed = true; $('btnReset').textContent = 'TEM CERTEZA?'; return; }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ok */ }
  window.removeEventListener('pagehide', save);
  document.removeEventListener('visibilitychange', onHide);
  location.reload();
});
btnShop.addEventListener('click', () => { audioInit(); toggleShop(); });
$('btnCloseShop').addEventListener('click', () => toggleShop(false));
btnMute.addEventListener('click', () => { audioInit(); toggleMute(); });
$('btnStart').addEventListener('click', (e) => {
  audioInit();
  if (e.pointerType && e.pointerType !== 'mouse') setTouch();
  startGame();
});
$('btnStart').addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') isTouch = true; });
function onHide() { if (document.hidden) save(); }
document.addEventListener('visibilitychange', onHide);
window.addEventListener('pagehide', save);

function startGame() {
  if (started) return;
  started = true;
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  if (isTouch) btnThrow.classList.remove('hidden');
  hudDirty = true;
}

function updateHUD(inRange) {
  if (Math.floor(S.money) !== lastMoney) {
    if (lastMoney >= 0 && S.money > lastMoney) {
      elMoneyBox.classList.remove('bump'); void elMoneyBox.offsetWidth; elMoneyBox.classList.add('bump');
    }
    lastMoney = Math.floor(S.money);
    elMoney.textContent = '$' + fmt(S.money);
    let can = false;
    for (const u of UPGRADES) if (S.lv[u.id] < u.max && S.money >= costOf(u)) { can = true; break; }
    btnShop.classList.toggle('has-new', can);
    hudDirty = true;
  }
  btnThrow.classList.toggle('off', !(player.held.length && inRange));
  if (!hudDirty) return;
  hudDirty = false;
  elCarry.textContent = 'LIXO ' + player.held.length + '/' + stat.cap();
  elCombo.textContent = combo >= 2 ? 'COMBO x' + (1 + Math.min(combo, 20) * 0.05).toFixed(2) : '';
  elLoad.style.width = (load / LOAD_CAP * 100) + '%';
  let hint = '';
  if (S.deposits < 3) {
    if (!player.held.length) hint = 'Encoste no lixo da calçada para pegar!';
    else if (!inRange) hint = 'Chegue perto da traseira do caminhão (dentro do círculo)';
    else hint = isTouch ? 'Toque em JOGAR LIXO!' : 'Aperte ESPAÇO ou clique para jogar o lixo!';
  } else if (S.bought === 0 && btnShop.classList.contains('has-new')) {
    hint = isTouch ? 'Você tem dinheiro! Abra a LOJA' : 'Você tem dinheiro! Abra a LOJA (tecla E)';
  }
  elHint.textContent = hint;
}

// ------------------------------------------------------------------ dia / noite
const SKY = [
  { t: 0.00, sky: 0x7fd0f2, sun: 0xffffff, si: 2.0, amb: 0xffffff, ai: 1.7 },
  { t: 0.50, sky: 0x7fd0f2, sun: 0xffffff, si: 2.0, amb: 0xffffff, ai: 1.7 },
  { t: 0.60, sky: 0xf5a36b, sun: 0xffb070, si: 1.7, amb: 0xffd9c0, ai: 1.5 },
  { t: 0.68, sky: 0x2f3566, sun: 0x8aa0ff, si: 0.8, amb: 0x8f9bff, ai: 1.25 },
  { t: 0.90, sky: 0x2f3566, sun: 0x8aa0ff, si: 0.8, amb: 0x8f9bff, ai: 1.25 },
  { t: 0.96, sky: 0xf2c1a0, sun: 0xffd0a0, si: 1.6, amb: 0xffe6d6, ai: 1.5 },
  { t: 1.00, sky: 0x7fd0f2, sun: 0xffffff, si: 2.0, amb: 0xffffff, ai: 1.7 },
];
const DAY_LEN = 240;
const _ca = new T.Color(), _cb = new T.Color();
function updateSky(time) {
  const t = (time / DAY_LEN) % 1;
  let i = 0;
  while (i < SKY.length - 2 && t >= SKY[i + 1].t) i++;
  const a = SKY[i], b = SKY[i + 1], f = clamp((t - a.t) / (b.t - a.t), 0, 1);
  scene.background.copy(_ca.set(a.sky)).lerp(_cb.set(b.sky), f);
  scene.fog.color.copy(scene.background);
  sun.color.copy(_ca.set(a.sun)).lerp(_cb.set(b.sun), f);
  sun.intensity = lerp(a.si, b.si, f);
  ambient.color.copy(_ca.set(a.amb)).lerp(_cb.set(b.amb), f);
  ambient.intensity = lerp(a.ai, b.ai, f);
}

// ------------------------------------------------------------------ lógica
let time = 0, spawnAcc = 0, smokeT = 0, saveT = 0;

function findTrash(h) {
  let best = null, bd = 1e9;
  const both = helpers.length < 2;
  for (const b of trash) {
    if (b.state !== 'ground' || b.reservedBy) continue;
    const rz = b.z - truck.z;
    if (rz < ZONE_FRONT + 0.5 || rz > 5.5) continue;
    if (!both && b.x * h.side < 0) continue;
    const d = Math.hypot(b.x - h.x, b.z - h.z) + (rz > 2 ? 0 : -rz * 0.2);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) best.reservedBy = h;
  return best;
}
function updateHelper(h, dt) {
  const range = Math.max(4.6, stat.range() * 0.9), spd = stat.speed() * 0.8, cap = 2;
  h.cool -= dt;
  if (h.target && (h.target.state !== 'ground' || h.target.z - truck.z > ZONE_BACK)) {
    if (h.target.reservedBy === h) h.target.reservedBy = null;
    h.target = null;
  }
  if (!h.target && h.held.length < cap) h.target = findTrash(h);
  const hx = truck.x, hz = truck.z + HOP_Z;
  let tx, tz;
  if (h.held.length >= cap || (h.held.length && !h.target)) {
    if (Math.hypot(hx - h.x, hz - h.z) <= range - 0.4) {
      if (h.cool <= 0) { throwBag(h, false); h.cool = 0.45; }
      tx = h.x; tz = h.z - TRUCK_SPEED * dt;
    } else { tx = hx + h.side * 1.2; tz = hz + 1.6; }
  } else if (h.target) {
    tx = h.target.x; tz = h.target.z;
    if (Math.hypot(tx - h.x, tz - h.z) < 0.95) { const b = h.target; h.target = null; grab(h, b); }
  } else {
    tx = h.side * (2.7 + (h.idx > 1 ? 1.4 : 0)); tz = truck.z + 6.3;
  }
  const ox = h.x, oz = h.z;
  h.z -= TRUCK_SPEED * dt;
  const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
  if (d > 0.05) { const st = Math.min(d, spd * dt); h.x += (dx / d) * st; h.z += (dz / d) * st; }
  collideTruck(h); clampZone(h);
  animGari(h, dt, (h.x - ox) / dt, (h.z - oz) / dt);
}

function update(dt) {
  time += dt;
  truck.z -= TRUCK_SPEED * dt;

  // segmentos de rua
  for (const seg of segs) {
    if (seg.g.position.z - truck.z > 50) {
      seg.k += SEG_COUNT;
      seg.g.position.z = -seg.k * SEG_LEN;
      genDecor(seg);
    }
  }
  const sc = Math.round((truck.z - 24) / 10) * 10;
  if (sc !== sunCenter) placeSun(sc);

  // spawn de lixo
  spawnAcc += TRUCK_SPEED * dt;
  const gap = stat.gap();
  while (spawnAcc >= gap) { spawnAcc -= gap; spawnTrash(truck.z - 46 - rand(0, 6)); }

  // jogador
  readInput();
  const ox = player.x, oz = player.z, spd = stat.speed();
  player.z -= TRUCK_SPEED * dt;
  if (started) { player.x += input.x * spd * dt; player.z += input.z * spd * dt; }
  collideTruck(player); clampZone(player);
  animGari(player, dt, (player.x - ox) / dt, (player.z - oz) / dt);

  const hx = truck.x, hz = truck.z + HOP_Z;
  const range = stat.range();
  const inRange = Math.hypot(hx - player.x, hz - player.z) <= range;
  player.cool -= dt;
  if (started && (throwQueued || throwHeld) && player.cool <= 0 && player.held.length) {
    throwBag(player, true);
    player.cool = 0.2;
    hudDirty = true;
  }
  throwQueued = false;

  // ajudantes
  for (const h of helpers) updateHelper(h, dt);

  // lixo
  const pr = stat.pickR(), cap = stat.cap();
  for (let i = trash.length - 1; i >= 0; i--) {
    const b = trash[i];
    if (b.state === 'ground') {
      if (b.z - truck.z > 16) { removeTrash(b); }
      else if (started && player.held.length < cap && Math.hypot(b.x - player.x, b.z - player.z) < pr) {
        grab(player, b); sfx.pickup(); hudDirty = true;
      } else if (b.type.id === 'ouro') {
        b.spark -= dt;
        if (b.spark <= 0) { b.spark = 0.25; spawnP(b.x + rand(-0.4, 0.4), b.y + rand(0.3, 0.9), b.z + rand(-0.4, 0.4), 0, 1.2, -TRUCK_SPEED * 0, 0xffffff, 0.4, 0.1, 0); }
      }
    } else if (b.state === 'held') {
      const e = b.holder, idx = e.held.indexOf(b);
      const sc2 = e === player ? 1 : 0.88;
      b.x = e.x; b.z = e.z;
      b.mesh.position.set(e.x, e.m.g.position.y + (2.12 + idx * 0.58) * sc2, e.z);
      b.mesh.rotation.y = e.m.angle;
    } else if (b.state === 'fly') {
      b.t += dt;
      const f = Math.min(1, b.t / b.dur);
      const ex = b.toTruck ? hx : b.tx, ez = b.toTruck ? hz : b.tz, ey = b.toTruck ? HOP_Y : groundY(b.tx);
      b.mesh.position.set(lerp(b.sx, ex, f), lerp(b.sy, ey, f) + Math.sin(f * Math.PI) * b.arc, lerp(b.sz, ez, f));
      b.mesh.rotation.x += dt * 9; b.mesh.rotation.z += dt * 6;
      if (f >= 1) {
        if (b.toTruck) deposit(b);
        else {
          b.state = 'ground'; b.x = ex; b.z = ez; b.y = ey;
          if (Math.abs(b.x - truck.x) < 1.8 && b.z - truck.z > -4.4 && b.z - truck.z < 4.6) b.x = truck.x + (b.x >= truck.x ? 2 : -2);
          b.mesh.rotation.set(0, rand(0, 6.28), 0);
          b.mesh.position.set(b.x, b.y, b.z);
        }
      }
    }
    if (b.state === 'gone') trash.splice(i, 1);
  }

  // combo
  if (combo > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; hudDirty = true; } }

  // caminhão
  truck.squash = Math.max(0, truck.squash - dt * 5);
  compactT = Math.max(0, compactT - dt);
  const shake = compactT > 0 ? Math.sin(time * 70) * 0.06 : 0;
  truck.g.position.set(truck.x + shake, Math.sin(time * 16) * 0.025, truck.z);
  truck.g.scale.set(1 + truck.squash * 0.04, 1 - truck.squash * 0.05, 1);
  truck.g.rotation.z = Math.sin(time * 1.3) * 0.006;
  truck.beacon.material.color.set(Math.floor(time * 3) % 2 ? 0xfeae34 : 0x8a5a14);
  smokeT -= dt;
  if (smokeT <= 0) {
    smokeT = compactT > 0 ? 0.05 : 0.22;
    spawnP(truck.x + 1.25, 4.6, truck.z - 1.75, rand(-0.2, 0.2), rand(0.8, 1.4), rand(0.5, 1.2) - TRUCK_SPEED * 0.4, compactT > 0 ? 0x5a6988 : 0xc0cbdc, 0.9, 0.2, -0.5);
  }

  // anel de alcance
  ring.position.x = hx; ring.position.z = hz;
  ring.scale.set(range * 1.04, 1, range * 1.04);
  ring.rotation.y = time * 0.25;
  ring.visible = started;
  ringMat.color.set(player.held.length ? (inRange ? 0x63c74d : 0xe43b44) : 0xffffff);
  ringMat.opacity = player.held.length ? 0.95 : 0.45;

  updateParts(dt);
  updateSky(time);

  // câmera
  camX = lerp(camX, player.x * camFollow, 1 - Math.exp(-4 * dt));
  camera.position.set(camX, 12.5 * camK, truck.z + 20 * camK);
  camera.lookAt(camX * 0.6, 1, truck.z - 2.5);

  updateHUD(inRange);

  saveT += dt;
  if (saveT > 5) { saveT = 0; if (started) save(); }
}

// ------------------------------------------------------------------ boot
layout();
makeSegments();
placeSun(-20);
syncHelpers();
buildShop();
btnMute.textContent = S.muted ? 'MUDO' : 'SOM';
if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
  isTouch = true;
  $('titleKeys').innerHTML = 'Arraste o dedo na tela = andar<br>Botão JOGAR LIXO = arremessar<br>LOJA = upgrades';
}
for (let z = -8; z > -50; z -= stat.gap()) spawnTrash(z - rand(0, 2));

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  if (!shopOpen) update(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ganchos para testes automatizados
window.__lixeiro = { S, player, truck, trash, helpers, stat, save, step: (dt) => update(dt), setTime: (t) => { time = t; } };
})();
