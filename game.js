/*
 * Estilhaço — roguelike de sobrevivência em 3D.
 * Jogo original: ataque automático, hordas, níveis com escolha de melhorias,
 * mapas procedurais com verticalidade, chefes, baús, altares e progressão permanente.
 * Depende apenas de three.js r128 (global THREE).
 */
(function () {
  'use strict';

  const T = window.THREE;
  const app = document.getElementById('app');
  if (!app) return;
  if (!T) {
    app.innerHTML = '<p class="fatal">Não foi possível carregar o motor 3D (three.js). Verifique a conexão e recarregue a página.</p>';
    return;
  }

  // =====================================================================
  // Utilidades
  // =====================================================================
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const $ = (id) => document.getElementById(id);
  const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pct = (v) => Math.round(v * 100) + '%';
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function angLerp(a, b, t) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeNoise(rng) {
    const S = 64, g = new Float32Array(S * S);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    const at = (x, y) => g[((y & (S - 1)) * S) + (x & (S - 1))];
    const sm = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      return lerp(lerp(at(xi, yi), at(xi + 1, yi), xf), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), xf), yf);
    };
  }
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const IS_TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // =====================================================================
  // Salvamento (só neste navegador)
  // =====================================================================
  const SAVE_KEY = 'estilhaco.save.v1';
  function defaultSave() {
    return {
      shards: 0, unlocked: ['brasa'], selected: 'brasa', forge: {}, quests: {},
      stats: { kills: 0, runs: 0, bosses: 0, best: 0, bestFloor: 1 },
      settings: { sens: 1, vol: 0.6, music: true },
    };
  }
  let SAVE = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw), d = defaultSave();
      SAVE = Object.assign(d, s);
      SAVE.stats = Object.assign(defaultSave().stats, s.stats || {});
      SAVE.settings = Object.assign(defaultSave().settings, s.settings || {});
      SAVE.forge = s.forge || {}; SAVE.quests = s.quests || {};
      if (!Array.isArray(SAVE.unlocked) || !SAVE.unlocked.length) SAVE.unlocked = ['brasa'];
    }
  } catch (e) { /* armazenamento indisponível: segue com progresso só nesta sessão */ }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* ignora */ } }

  // =====================================================================
  // Dados do jogo
  // =====================================================================
  const CHARACTERS = [
    { id: 'brasa', name: 'Brasa', color: 0xff7a3d, cost: 0, weapon: 'orbital', desc: 'Espírito de fogo. +15% de dano.', mods: { dmg: 0.15 } },
    { id: 'zefiro', name: 'Zéfiro', color: 0x7fe3ff, cost: 120, weapon: 'bumerangue', desc: 'Corre com o vento. +15% de velocidade e um pulo extra.', mods: { speed: 0.15, jumps: 1 } },
    { id: 'tita', name: 'Tita', color: 0xd3a66b, cost: 220, weapon: 'aura', desc: 'Rocha viva. +50 de vida máxima e +2 de armadura.', mods: { hp: 50, armor: 2 } },
    { id: 'volta', name: 'Volta', color: 0xffe45c, cost: 340, weapon: 'arco', desc: 'Carga elétrica. +15% de cadência.', mods: { haste: 0.15 } },
    { id: 'lume', name: 'Lume', color: 0xc99bff, cost: 480, weapon: 'meteoro', desc: 'Guarda das estrelas. +30% de ímã e +15% de XP.', mods: { magnet: 0.3, xpGain: 0.15 } },
    { id: 'agulha', name: 'Agulha', color: 0x7dffae, cost: 650, weapon: 'dardo', desc: 'Atiradora precisa. +12% de chance de crítico.', mods: { crit: 0.12 } },
    { id: 'marreta', name: 'Marreta', color: 0xff5f8f, cost: 800, weapon: 'impacto', desc: 'Cai com tudo. Pulos 15% mais altos e +1 de armadura.', mods: { jumpMult: 0.15, armor: 1 } },
  ];

  const WEAPONS = {
    orbital: { name: 'Lâminas Orbitais', icon: '◎', desc: 'Lâminas giram ao seu redor e cortam quem encostar.', up: ['2 lâminas giratórias', '+1 lâmina', '+30% de dano', '+1 lâmina e giro mais rápido', '+40% de dano e de raio'] },
    dardo: { name: 'Dardo Arcano', icon: '➶', desc: 'Dardos teleguiados no inimigo mais próximo. Paredes bloqueiam.', up: ['1 dardo teleguiado', '+1 dardo', 'Atravessa +1 inimigo', '+35% de dano', '+1 dardo e recarga 20% menor'] },
    arco: { name: 'Arco Voltaico', icon: 'ϟ', desc: 'Um raio salta de inimigo em inimigo.', up: ['Raio com 3 saltos', '+2 saltos', '+30% de dano', 'Recarga 25% menor', '+3 saltos e +30% de dano'] },
    aura: { name: 'Aura de Espinhos', icon: '✺', desc: 'Fere e atrasa todos ao seu redor.', up: ['Aura de dano contínuo', '+20% de raio', '+40% de dano', '+20% de raio e atraso maior', '+60% de dano'] },
    meteoro: { name: 'Chuva de Meteoros', icon: '☄', desc: 'Meteoros caem sobre os inimigos e explodem.', up: ['1 meteoro', '+1 meteoro', '+30% de raio da explosão', '+40% de dano', '+2 meteoros'] },
    bumerangue: { name: 'Bumerangue', icon: '↺', desc: 'Vai e volta atravessando tudo pelo caminho.', up: ['1 bumerangue', '+30% de dano', '+1 bumerangue', 'Alcance e velocidade maiores', '+1 bumerangue e +40% de dano'] },
    impacto: { name: 'Pisão Sísmico', icon: '⤓', desc: 'Ao aterrissar, solta uma onda de choque. Quedas maiores causam mais dano.', up: ['Onda ao aterrissar', '+30% de raio', '+40% de dano', 'Também dispara sozinho a cada 4s', '+50% de dano e de raio'] },
  };

  const RARITY = [
    { name: 'Comum', mult: 1, color: '#c3cad6' },
    { name: 'Rara', mult: 1.5, color: '#55b6ff' },
    { name: 'Épica', mult: 2.2, color: '#c77dff' },
    { name: 'Lendária', mult: 3.2, color: '#ffb547' },
  ];

  const RUNES = [
    { id: 'forca', name: 'Runa da Força', icon: '⚔', base: 0.10, fmt: (v) => `+${pct(v)} de dano`, apply: (s, v) => { s.dmg += v; } },
    { id: 'pressa', name: 'Runa da Pressa', icon: '⏱', base: 0.08, fmt: (v) => `+${pct(v)} de cadência`, apply: (s, v) => { s.haste += v; } },
    { id: 'alcance', name: 'Runa do Alcance', icon: '◌', base: 0.10, fmt: (v) => `+${pct(v)} de área`, apply: (s, v) => { s.area += v; } },
    { id: 'vento', name: 'Runa do Vento', icon: '»', base: 0.06, fmt: (v) => `+${pct(v)} de velocidade`, apply: (s, v) => { s.speed += v; } },
    { id: 'vida', name: 'Runa da Vida', icon: '♥', base: 20, round: true, fmt: (v) => `+${v} de vida máxima`, apply: (s, v, p) => { s.maxHp += v; p.hp += v; } },
    { id: 'seiva', name: 'Runa da Seiva', icon: '✚', base: 0.5, fmt: (v) => `+${v.toFixed(1).replace('.', ',')} de vida por segundo`, apply: (s, v) => { s.regen += v; } },
    { id: 'ima', name: 'Runa do Ímã', icon: '∪', base: 0.25, fmt: (v) => `+${pct(v)} de raio de coleta`, apply: (s, v) => { s.magnet *= 1 + v; } },
    { id: 'sorte', name: 'Runa da Sorte', icon: '☘', base: 8, round: true, fmt: (v) => `+${v} de sorte (raridades melhores)`, apply: (s, v) => { s.luck += v; } },
    { id: 'precisa', name: 'Runa Precisa', icon: '✦', base: 0.05, fmt: (v) => `+${pct(v)} de chance de crítico`, apply: (s, v) => { s.crit += v; } },
    { id: 'saber', name: 'Runa do Saber', icon: '✎', base: 0.10, fmt: (v) => `+${pct(v)} de XP`, apply: (s, v) => { s.xpGain += v; } },
    { id: 'pedra', name: 'Runa da Pedra', icon: '⬢', base: 1, round: true, fmt: (v) => `+${v} de armadura`, apply: (s, v) => { s.armor += v; } },
    { id: 'eco', name: 'Runa do Eco', icon: '⁂', base: 1, fixed: true, max: 3, fmt: () => '+1 projétil em todas as armas', apply: (s) => { s.proj += 1; } },
    { id: 'asa', name: 'Runa da Asa', icon: '⇈', base: 1, fixed: true, max: 2, fmt: () => '+1 pulo no ar', apply: (s) => { s.jumps += 1; } },
  ];

  const RELICS = [
    { id: 'coracao', name: 'Coração de Brasa', icon: '♥', r: 0, desc: '+40 de vida máxima e cura total.', apply: (p) => { p.stats.maxHp += 40; p.hp = p.stats.maxHp; } },
    { id: 'mola', name: 'Botas de Mola', icon: '⇧', r: 1, desc: 'Pulos 35% mais altos.', apply: (p) => { p.stats.jumpMult += 0.35; } },
    { id: 'espelho', name: 'Espelho Rachado', icon: '◇', r: 1, desc: '12% de chance de esquivar de um golpe.' },
    { id: 'presa', name: 'Presa Sedenta', icon: '⚕', r: 1, desc: 'Cada abate cura 0,4 de vida.' },
    { id: 'casco', name: 'Casco de Espinhos', icon: '✳', r: 0, desc: 'Quem te encosta leva o dobro do dano que causou.' },
    { id: 'lupa', name: 'Lupa do Joalheiro', icon: '⌕', r: 1, desc: '+60% de dano crítico e +5% de chance.', apply: (p) => { p.stats.critMult += 0.6; p.stats.crit += 0.05; } },
    { id: 'bussola', name: 'Bússola Dourada', icon: '✧', r: 0, desc: '+40% de moedas e baús 15% mais baratos.', apply: (p) => { p.stats.goldGain += 0.4; } },
    { id: 'ampulheta', name: 'Ampulheta Lenta', icon: '⧗', r: 1, desc: 'Inimigos se movem 12% mais devagar.' },
    { id: 'pena', name: 'Pena de Grifo', icon: '➹', r: 1, desc: 'Segure o pulo no ar para planar.' },
    { id: 'trovao', name: 'Pedra-Trovão', icon: 'ϟ', r: 2, desc: 'A cada 5s, um raio atinge o inimigo mais forte por perto.' },
    { id: 'gota', name: 'Gota Gélida', icon: '❄', r: 1, desc: 'Acertos têm 8% de chance de congelar o alvo.' },
    { id: 'polvora', name: 'Barril de Pólvora', icon: '✹', r: 2, desc: 'Inimigos têm 15% de chance de explodir ao morrer.' },
    { id: 'trevo', name: 'Trevo de Quatro Folhas', icon: '☘', r: 0, desc: '+25 de sorte.', apply: (p) => { p.stats.luck += 25; } },
    { id: 'bolha', name: 'Escudo de Bolha', icon: '◯', r: 1, desc: 'Bloqueia um golpe a cada 10s.' },
    { id: 'mochila', name: 'Mochila Funda', icon: '▣', r: 2, desc: '+1 opção sempre que subir de nível.' },
    { id: 'ancora', name: 'Golpe do Alto', icon: '▼', r: 1, desc: '+35% de dano em inimigos abaixo de você.' },
    { id: 'glutao', name: 'Coroa do Glutão', icon: '♛', r: 1, desc: '+30% de XP, mas −15% de vida máxima.', apply: (p) => { p.stats.xpGain += 0.3; p.stats.maxHp = Math.round(p.stats.maxHp * 0.85); p.hp = Math.min(p.hp, p.stats.maxHp); } },
    { id: 'caveira', name: 'Caveira Faminta', icon: '☠', r: 2, desc: '+1% de dano a cada 25 abates nesta partida (até +60%).' },
    { id: 'tenis', name: 'Tênis Alado', icon: '»', r: 0, desc: '+15% de velocidade e o deslize recarrega 40% mais rápido.', apply: (p) => { p.stats.speed += 0.15; p.stats.slideCd *= 0.6; } },
    { id: 'ferradura', name: 'Ímã de Ferradura', icon: '∩', r: 1, desc: 'A cada 40s, puxa todos os cristais de XP do mapa.' },
  ];
  const RELIC_BY_ID = Object.fromEntries(RELICS.map((r) => [r.id, r]));

  const FORGE = [
    { id: 'vigor', name: 'Vigor', desc: '+10 de vida máxima por nível', max: 5, cost: (l) => 30 + l * 30, apply: (s, l) => { s.maxHp += 10 * l; } },
    { id: 'furia', name: 'Fúria', desc: '+5% de dano por nível', max: 5, cost: (l) => 40 + l * 40, apply: (s, l) => { s.dmg += 0.05 * l; } },
    { id: 'agil', name: 'Agilidade', desc: '+3% de velocidade por nível', max: 5, cost: (l) => 30 + l * 30, apply: (s, l) => { s.speed += 0.03 * l; } },
    { id: 'atracao', name: 'Atração', desc: '+10% de raio de coleta por nível', max: 5, cost: (l) => 25 + l * 25, apply: (s, l) => { s.magnet *= 1 + 0.1 * l; } },
    { id: 'sabedoria', name: 'Sabedoria', desc: '+5% de XP por nível', max: 5, cost: (l) => 40 + l * 35, apply: (s, l) => { s.xpGain += 0.05 * l; } },
    { id: 'ganancia', name: 'Ganância', desc: '+10% de moedas por nível', max: 5, cost: (l) => 25 + l * 25, apply: (s, l) => { s.goldGain += 0.1 * l; } },
    { id: 'sorte', name: 'Fortuna', desc: '+4 de sorte por nível', max: 5, cost: (l) => 35 + l * 35, apply: (s, l) => { s.luck += 4 * l; } },
    { id: 'sorteio', name: 'Novo Sorteio', desc: '+1 sorteio de melhorias por partida', max: 3, cost: (l) => 80 + l * 80, apply: () => {} },
  ];

  const QUESTS = [
    { id: 'k100', name: 'Primeira limpeza', desc: 'Derrote 100 inimigos (no total).', reward: 20, check: (r, s) => s.kills + r.kills >= 100 },
    { id: 'k1000', name: 'Maré de lodo', desc: 'Derrote 1.000 inimigos (no total).', reward: 60, check: (r, s) => s.kills + r.kills >= 1000 },
    { id: 'k5000', name: 'Exterminador', desc: 'Derrote 5.000 inimigos (no total).', reward: 150, check: (r, s) => s.kills + r.kills >= 5000 },
    { id: 't2', name: 'Pé firme', desc: 'Sobreviva 2 minutos em uma partida.', reward: 20, check: (r) => r.time >= 120 },
    { id: 't5', name: 'Resistente', desc: 'Sobreviva 5 minutos em uma partida.', reward: 50, check: (r) => r.time >= 300 },
    { id: 't10', name: 'Inabalável', desc: 'Sobreviva 10 minutos em uma partida.', reward: 120, check: (r) => r.time >= 600 },
    { id: 'lv10', name: 'Aprendiz', desc: 'Chegue ao nível 10.', reward: 25, check: (r) => r.level >= 10 },
    { id: 'lv20', name: 'Veterano', desc: 'Chegue ao nível 20.', reward: 60, check: (r) => r.level >= 20 },
    { id: 'lv30', name: 'Lenda das ilhas', desc: 'Chegue ao nível 30.', reward: 120, check: (r) => r.level >= 30 },
    { id: 'boss1', name: 'Quebra-coroas', desc: 'Derrote um Colosso.', reward: 60, check: (r) => r.bossKills >= 1 },
    { id: 'boss5', name: 'Caçador de colossos', desc: 'Derrote 5 Colossos (no total).', reward: 150, check: (r, s) => s.bosses + r.bossKills >= 5 },
    { id: 'floor3', name: 'Mergulho', desc: 'Chegue ao Andar 3.', reward: 100, check: (r) => r.floor >= 3 },
    { id: 'chest3', name: 'Curioso', desc: 'Abra 3 baús em uma partida.', reward: 25, check: (r) => r.chests >= 3 },
    { id: 'chest8', name: 'Saqueador', desc: 'Abra 8 baús em uma partida.', reward: 80, check: (r) => r.chests >= 8 },
    { id: 'elite', name: 'Ouro no lodo', desc: 'Derrote um inimigo de elite.', reward: 30, check: (r) => r.elites >= 1 },
    { id: 'altar3', name: 'Devoto', desc: 'Use 3 altares em uma partida.', reward: 40, check: (r) => r.altars >= 3 },
    { id: 'max', name: 'Obra-prima', desc: 'Leve uma arma ao nível máximo.', reward: 50, check: (r) => r.maxed },
    { id: 'alto', name: 'Alpinista', desc: 'Fique de pé a 6 metros de altura.', reward: 30, check: (r) => r.maxHeight >= 6 },
    { id: 'stomp', name: 'Terremoto', desc: 'Derrote 50 inimigos com o Pisão Sísmico em uma partida.', reward: 40, check: (r) => r.stompKills >= 50 },
    { id: 'four', name: 'Arsenal', desc: 'Tenha 4 armas ao mesmo tempo.', reward: 30, check: (r) => r.weapons >= 4 },
    { id: 'legend', name: 'Toque dourado', desc: 'Escolha uma melhoria Lendária.', reward: 40, check: (r) => r.legend },
  ];

  const BIOMES = [
    { name: 'Bosque Suspenso', top: 0x2a1f5e, bottom: 0xffa27f, fog: 0xd99086, low: 0x67b25b, mid: 0x86c46a, high: 0xa6957a, rock: 0x6f6680, leaf: 0x2f8f5b, trunk: 0x6b4a32, crystal: 0xb78cff, sun: 0xffd9b0, hemi: 0xbfd4ff, ground: 0x5a4a3a },
    { name: 'Dunas de Cobre', top: 0x3b1f45, bottom: 0xffb766, fog: 0xe4a46e, low: 0xe5b872, mid: 0xd79d5c, high: 0xbb774c, rock: 0x8a5a48, leaf: 0x5f9a4a, trunk: 0x7a5a3a, crystal: 0xff8a5c, sun: 0xffe0a8, hemi: 0xffe2c0, ground: 0x7a4a2a },
    { name: 'Geleira Partida', top: 0x0d2442, bottom: 0xa3dcea, fog: 0x9ec6d8, low: 0xe2f0f6, mid: 0xbad9e8, high: 0x90b4ca, rock: 0x5d7488, leaf: 0x2f6b6a, trunk: 0x4a3a30, crystal: 0x7fe3ff, sun: 0xe8f6ff, hemi: 0xd8f0ff, ground: 0x4a5a6a },
    { name: 'Abismo Violeta', top: 0x07040f, bottom: 0x6c2c7c, fog: 0x3d1f4e, low: 0x4f3d72, mid: 0x62498c, high: 0x7d5da6, rock: 0x30254a, leaf: 0xb04fa0, trunk: 0x2a1a33, crystal: 0xff5ea8, sun: 0xffb0e0, hemi: 0xb090ff, ground: 0x201030 },
  ];

  const ETYPES = {
    gosma: { name: 'Gosma', hp: 12, speed: 3.2, dmg: 6, r: 0.6, h: 0.9, xp: 1, color: 0x7ad35d },
    corredor: { name: 'Diabrete', hp: 9, speed: 5.6, dmg: 5, r: 0.42, h: 1.0, xp: 1, color: 0xff5d4a },
    morcego: { name: 'Morcego', hp: 10, speed: 4.6, dmg: 5, r: 0.45, h: 0.5, xp: 1, color: 0x6d4fb0, fly: true },
    atirador: { name: 'Olho', hp: 22, speed: 2.7, dmg: 6, r: 0.55, h: 1.5, xp: 2, color: 0xf2eaff, ranged: true },
    bruto: { name: 'Bruto', hp: 75, speed: 2.5, dmg: 16, r: 1.0, h: 2.4, xp: 4, color: 0x8b5aa3, kbRes: 0.25 },
  };

  // =====================================================================
  // Interface (DOM)
  // =====================================================================
  app.innerHTML = `
  <canvas id="gl" aria-label="Mundo do jogo"></canvas>
  <canvas id="fx" aria-hidden="true"></canvas>
  <div id="hurt" class="hurt" aria-hidden="true"></div>
  <div id="hud" class="hud" hidden>
    <div class="hud-tl">
      <div class="vitals">
        <div class="lvl" title="Nível"><small>NV</small><span id="hLvl">1</span></div>
        <div class="bars">
          <div class="bar hp"><i id="hHp"></i><b id="hHpT">100 / 100</b></div>
          <div class="bar xp"><i id="hXp"></i></div>
        </div>
      </div>
      <div id="hWeapons" class="slots"></div>
      <div id="hRelics" class="relics"></div>
    </div>
    <div class="hud-tc">
      <div class="clock" id="hTime">0:00</div>
      <div class="floor" id="hFloor">Andar 1</div>
      <div id="boss" class="bossbar" hidden><span id="bossName">Colosso de Lodo</span><div class="bar"><i id="bossHp"></i></div></div>
    </div>
    <div class="hud-tr">
      <canvas id="mini" width="150" height="150" aria-label="Mapa"></canvas>
      <div class="tally">
        <span title="Abates">✕ <b id="hKills">0</b></span>
        <span class="coin" title="Moedas">● <b id="hCoins">0</b></span>
        <span class="shard" title="Estilhaços nesta partida">✦ <b id="hShards">0</b></span>
      </div>
    </div>
    <button id="pauseBtn" class="pause-btn" aria-label="Pausar">❚❚</button>
    <div id="prompt" class="prompt" hidden></div>
    <div id="toasts" class="toasts" aria-live="polite"></div>
    <div id="touch" class="touch" hidden>
      <div id="stickZone" class="stick-zone"><div id="stick" class="stick"><i id="knob"></i></div></div>
      <div id="lookZone" class="look-zone"></div>
      <div class="tbtns">
        <button id="tAct" class="tbtn act" hidden>Abrir</button>
        <button id="tSlide" class="tbtn">Deslizar</button>
        <button id="tJump" class="tbtn big">Pular</button>
      </div>
    </div>
  </div>

  <section id="sMenu" class="screen menu" hidden>
    <div class="menu-col">
      <p class="kicker">Roguelike de sobrevivência em 3D</p>
      <h1 class="logo"><span>Estilhaço</span></h1>
      <p class="lede">As ilhas do céu racharam e o lodo sobe pelas frestas. Corra, salte entre as pedras e deixe suas armas trabalharem sozinhas. Cada nível traz uma escolha nova.</p>
      <nav class="menu-nav">
        <button class="btn primary" data-go="sChars">Jogar</button>
        <button class="btn" data-go="sForge">Forja</button>
        <button class="btn" data-go="sQuests">Desafios <span class="pill" id="mQuestCount"></span></button>
        <button class="btn" data-go="sHow">Como jogar</button>
      </nav>
      <dl class="wallet">
        <div><dt>Estilhaços</dt><dd class="shard">✦ <span class="js-shards">0</span></dd></div>
        <div><dt>Recorde</dt><dd id="mBest">0:00</dd></div>
        <div><dt>Partidas</dt><dd id="mRuns">0</dd></div>
      </dl>
    </div>
  </section>

  <section id="sChars" class="screen panel-screen" hidden>
    <header class="scr-head"><button class="back" data-go="sMenu">← Voltar</button><h2>Escolha quem desce</h2><p class="wallet-inline shard">✦ <span class="js-shards">0</span></p></header>
    <div id="charList" class="char-grid"></div>
    <div class="scr-foot"><button id="startBtn" class="btn primary wide">Começar partida</button><p id="charMsg" class="msg" role="status"></p></div>
  </section>

  <section id="sForge" class="screen panel-screen" hidden>
    <header class="scr-head"><button class="back" data-go="sMenu">← Voltar</button><h2>Forja</h2><p class="wallet-inline shard">✦ <span class="js-shards">0</span></p></header>
    <p class="note">Melhorias permanentes, pagas com estilhaços. Valem para todas as partidas.</p>
    <div id="forgeList" class="forge-list"></div>
    <p id="forgeMsg" class="msg" role="status"></p>
  </section>

  <section id="sQuests" class="screen panel-screen" hidden>
    <header class="scr-head"><button class="back" data-go="sMenu">← Voltar</button><h2>Desafios</h2><p class="wallet-inline shard">✦ <span class="js-shards">0</span></p></header>
    <p class="note">Concluir um desafio rende estilhaços na hora. Eles são verificados durante a partida.</p>
    <div id="questList" class="quest-list"></div>
  </section>

  <section id="sHow" class="screen panel-screen" hidden>
    <header class="scr-head"><button class="back" data-go="sMenu">← Voltar</button><h2>Como jogar</h2></header>
    <div class="how">
      <div class="how-block">
        <h3>Teclado e mouse</h3>
        <dl class="keys">
          <div><dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Andar</dd></div>
          <div><dt><kbd>Espaço</kbd></dt><dd>Pular (segure com a Pena de Grifo para planar)</dd></div>
          <div><dt><kbd>Shift</kbd> ou <kbd>Ctrl</kbd></dt><dd>Deslizar (rápido; pule durante o deslize para ganhar impulso)</dd></div>
          <div><dt>Mouse</dt><dd>Girar a câmera (clique na tela para travar o cursor; arrastar também funciona)</dd></div>
          <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Girar a câmera pelo teclado</dd></div>
          <div><dt>Roda do mouse</dt><dd>Aproximar ou afastar</dd></div>
          <div><dt><kbd>E</kbd></dt><dd>Abrir baú</dd></div>
          <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Escolher melhoria · <kbd>R</kbd> sorteia de novo</dd></div>
          <div><dt><kbd>Esc</kbd> ou <kbd>P</kbd></dt><dd>Pausar</dd></div>
        </dl>
      </div>
      <div class="how-block">
        <h3>Toque</h3>
        <p>Polegar esquerdo move. Arraste no lado direito para girar a câmera. Botões para pular, deslizar e abrir baús.</p>
        <h3>A partida</h3>
        <ul>
          <li>Suas armas atacam sozinhas. Você só se move.</li>
          <li>Cristais de XP sobem seu nível. A cada nível, escolha 1 entre 3 melhorias.</li>
          <li>Baús custam moedas e dão relíquias únicas. Os dourados, deixados por elites, são de graça.</li>
          <li>Fique parado num altar até ele encher para ganhar uma runa rara ou melhor.</li>
          <li>Aos 4:00 desperta o Colosso. Pule as ondas de choque. Ao vencê-lo, um portal leva ao próximo andar.</li>
          <li>Os baús mais altos ficam no topo das torres de pedra. Suba pulando de coluna em coluna.</li>
        </ul>
      </div>
    </div>
  </section>

  <div id="modal" class="modal" hidden>
    <div class="modal-card" role="dialog" aria-labelledby="mTitle">
      <p class="eyebrow" id="mEyebrow">Nível 2</p>
      <h2 id="mTitle">Escolha uma melhoria</h2>
      <div id="mChoices" class="choices"></div>
      <div class="modal-actions">
        <button id="mReroll" class="btn small">Sortear de novo</button>
        <button id="mSkip" class="btn small ghost">Pular</button>
      </div>
    </div>
  </div>

  <section id="sPause" class="screen center-screen" hidden>
    <div class="card">
      <h2>Pausado</h2>
      <div class="settings">
        <label for="setSens">Sensibilidade da câmera <output id="setSensV"></output></label>
        <input id="setSens" type="range" min="0.3" max="2.5" step="0.1">
        <label for="setVol">Volume <output id="setVolV"></output></label>
        <input id="setVol" type="range" min="0" max="1" step="0.05">
        <label class="check" for="setMusic"><input id="setMusic" type="checkbox"> Música</label>
      </div>
      <div id="pauseBuild" class="pause-build"></div>
      <div class="stack">
        <button id="resumeBtn" class="btn primary">Continuar</button>
        <button id="quitBtn" class="btn ghost">Desistir da partida</button>
      </div>
    </div>
  </section>

  <section id="sOver" class="screen center-screen" hidden>
    <div class="card over">
      <p class="eyebrow" id="oEyebrow">Fim da partida</p>
      <h2 id="oTitle">Você caiu</h2>
      <dl id="oStats" class="stats"></dl>
      <div class="earn"><span>Estilhaços ganhos</span><b class="shard" id="oShards">✦ 0</b></div>
      <ul id="oQuests" class="done-quests"></ul>
      <div class="stack row">
        <button id="againBtn" class="btn primary">Jogar de novo</button>
        <button id="menuBtn" class="btn">Menu</button>
      </div>
    </div>
  </section>`;

  // =====================================================================
  // Renderizador e cena
  // =====================================================================
  const canvas = $('gl');
  const renderer = new T.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.25 : 1.5));
  renderer.shadowMap.enabled = !IS_TOUCH;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(62, 1, 0.1, 400);
  const fx = $('fx'), fxc = fx.getContext('2d');
  let VW = 1, VH = 1, DPR = 1;
  function resize() {
    VW = window.innerWidth; VH = window.innerHeight; DPR = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setSize(VW, VH, false);
    camera.aspect = VW / VH; camera.updateProjectionMatrix();
    fx.width = Math.round(VW * DPR); fx.height = Math.round(VH * DPR);
  }
  window.addEventListener('resize', resize);
  resize();

  const hemi = new T.HemisphereLight(0xffffff, 0x444444, 0.75);
  scene.add(hemi);
  const sun = new T.DirectionalLight(0xffffff, 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  // Céu em degradê
  const skyGeo = new T.SphereGeometry(300, 24, 16);
  skyGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new T.Mesh(skyGeo, new T.MeshBasicMaterial({ vertexColors: true, side: T.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  function paintSky(top, bottom) {
    const a = new T.Color(top), b = new T.Color(bottom), c = new T.Color();
    const p = skyGeo.attributes.position, col = skyGeo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const t = clamp((p.getY(i) / 300 + 0.1) / 0.9, 0, 1);
      c.copy(b).lerp(a, Math.pow(t, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }
  scene.fog = new T.Fog(0xffffff, 45, 150);

  // =====================================================================
  // Construção de geometria (low-poly com cores por vértice)
  // =====================================================================
  const _e = new T.Euler(), _q = new T.Quaternion(), _c = new T.Color(), _v = new T.Vector3();
  const dummy = new T.Object3D();
  function M(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e);
    return new T.Matrix4().compose(new T.Vector3(x, y, z), _q.clone(), new T.Vector3(sx, sy, sz));
  }
  function shade(hex, f) { return new T.Color(hex).multiplyScalar(f).getHex(); }
  function mergeParts(parts) {
    const pos = [], nor = [], col = [], c = new T.Color();
    for (const [g0, hex, m] of parts) {
      let g = g0.index ? g0.toNonIndexed() : g0.clone();
      g.computeVertexNormals();
      if (m) g.applyMatrix4(m);
      const p = g.attributes.position.array, n = g.attributes.normal.array;
      c.setHex(hex);
      for (let i = 0; i < p.length; i++) { pos.push(p[i]); nor.push(n[i]); }
      for (let i = 0; i < p.length / 3; i++) col.push(c.r, c.g, c.b);
      g.dispose(); g0.dispose();
    }
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  function instanced(geo, mat, count, shadow) {
    const m = new T.InstancedMesh(geo, mat, count);
    m.frustumCulled = false;
    _c.setRGB(1, 1, 1);
    for (let i = 0; i < count; i++) m.setColorAt(i, _c);
    m.count = 0;
    if (shadow && renderer.shadowMap.enabled) { m.castShadow = true; }
    scene.add(m);
    return m;
  }

  const MAT = {
    lam: new T.MeshLambertMaterial({ vertexColors: true }),
    basic: new T.MeshBasicMaterial({ color: 0xffffff }),
  };

  // Geometria dos inimigos
  const S = (r, w = 8, h = 6) => new T.SphereGeometry(r, w, h);
  const EGEO = {
    gosma: () => mergeParts([
      [new T.IcosahedronGeometry(0.62, 1), 0x7ad35d, M(0, 0.42, 0, 1, 0.72, 1)],
      [S(0.13), 0xffffff, M(-0.2, 0.56, 0.44)], [S(0.13), 0xffffff, M(0.2, 0.56, 0.44)],
      [S(0.07, 6, 5), 0x1b1030, M(-0.2, 0.56, 0.55)], [S(0.07, 6, 5), 0x1b1030, M(0.2, 0.56, 0.55)],
    ]),
    corredor: () => mergeParts([
      [new T.ConeGeometry(0.38, 0.95, 7), 0xff5d4a, M(0, 0.55, 0)],
      [new T.ConeGeometry(0.08, 0.34, 5), 0xfff0d0, M(-0.16, 1.02, 0, 1, 1, 1, 0, 0, 0.35)],
      [new T.ConeGeometry(0.08, 0.34, 5), 0xfff0d0, M(0.16, 1.02, 0, 1, 1, 1, 0, 0, -0.35)],
      [S(0.08, 6, 5), 0xffe14a, M(-0.11, 0.62, 0.27)], [S(0.08, 6, 5), 0xffe14a, M(0.11, 0.62, 0.27)],
      [S(0.13, 6, 5), 0x9e2b2b, M(-0.18, 0.1, 0)], [S(0.13, 6, 5), 0x9e2b2b, M(0.18, 0.1, 0)],
    ]),
    morcego: () => mergeParts([
      [new T.IcosahedronGeometry(0.34, 0), 0x6d4fb0, M(0, 0, 0)],
      [new T.BoxGeometry(0.75, 0.05, 0.38), 0x3e2b70, M(-0.5, 0.05, 0, 1, 1, 1, 0, 0, 0.3)],
      [new T.BoxGeometry(0.75, 0.05, 0.38), 0x3e2b70, M(0.5, 0.05, 0, 1, 1, 1, 0, 0, -0.3)],
      [S(0.07, 6, 5), 0xff4a6a, M(-0.12, 0.08, 0.28)], [S(0.07, 6, 5), 0xff4a6a, M(0.12, 0.08, 0.28)],
      [new T.ConeGeometry(0.07, 0.2, 4), 0x3e2b70, M(-0.15, 0.34, 0)], [new T.ConeGeometry(0.07, 0.2, 4), 0x3e2b70, M(0.15, 0.34, 0)],
    ]),
    atirador: () => mergeParts([
      [new T.ConeGeometry(0.3, 0.6, 6), 0x5a3d8a, M(0, 0.3, 0)],
      [S(0.5, 12, 9), 0xf2eaff, M(0, 1.05, 0)],
      [S(0.24, 10, 8), 0xff3d83, M(0, 1.05, 0.34, 1, 1, 0.5)],
      [S(0.11, 8, 6), 0x150a22, M(0, 1.05, 0.46, 1, 1, 0.5)],
    ]),
    bruto: () => mergeParts([
      [new T.BoxGeometry(1.4, 1.25, 1.0), 0x8b5aa3, M(0, 1.0, 0)],
      [new T.BoxGeometry(0.85, 0.62, 0.72), 0xa16fbb, M(0, 1.9, 0.12)],
      [new T.BoxGeometry(0.42, 1.1, 0.42), 0x734689, M(-0.95, 0.85, 0.05)],
      [new T.BoxGeometry(0.42, 1.1, 0.42), 0x734689, M(0.95, 0.85, 0.05)],
      [new T.BoxGeometry(0.45, 0.5, 0.5), 0x5c3870, M(-0.38, 0.22, 0)],
      [new T.BoxGeometry(0.45, 0.5, 0.5), 0x5c3870, M(0.38, 0.22, 0)],
      [new T.ConeGeometry(0.1, 0.4, 5), 0xfff2d6, M(-0.32, 2.35, 0.12)],
      [new T.ConeGeometry(0.1, 0.4, 5), 0xfff2d6, M(0.32, 2.35, 0.12)],
      [new T.BoxGeometry(0.14, 0.1, 0.05), 0xffe14a, M(-0.18, 1.95, 0.49)],
      [new T.BoxGeometry(0.14, 0.1, 0.05), 0xffe14a, M(0.18, 1.95, 0.49)],
    ]),
  };
  function bossGeo() {
    const parts = [
      [new T.IcosahedronGeometry(1.0, 1), 0x3fae8f, M(0, 1.2, 0, 2.4, 1.6, 2.4)],
      [S(0.4, 10, 8), 0xffffff, M(-0.75, 1.95, 1.9)], [S(0.4, 10, 8), 0xffffff, M(0.75, 1.95, 1.9)],
      [S(0.2, 8, 6), 0x150a22, M(-0.75, 1.95, 2.25)], [S(0.2, 8, 6), 0x150a22, M(0.75, 1.95, 2.25)],
      [new T.BoxGeometry(1.3, 0.16, 0.2), 0x1d3a33, M(0, 1.25, 2.25)],
      [new T.CylinderGeometry(1.05, 1.2, 0.4, 10), 0xffc845, M(0, 2.75, 0)],
    ];
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; parts.push([new T.ConeGeometry(0.22, 0.8, 5), 0xffc845, M(Math.cos(a) * 0.95, 3.25, Math.sin(a) * 0.95)]); }
    return mergeParts(parts);
  }
  function playerGeo(hex) {
    const col = new T.Color(hex);
    const belly = col.clone().lerp(new T.Color(0xffffff), 0.5).getHex();
    const dark = col.clone().multiplyScalar(0.55).getHex();
    return mergeParts([
      [new T.IcosahedronGeometry(0.5, 1), hex, M(0, 0.64, 0, 1, 1.12, 1)],
      [new T.IcosahedronGeometry(0.3, 1), belly, M(0, 0.52, 0.27, 1, 1.1, 0.6)],
      [S(0.11), 0xffffff, M(-0.17, 0.84, 0.4)], [S(0.11), 0xffffff, M(0.17, 0.84, 0.4)],
      [S(0.06, 6, 5), 0x1a1026, M(-0.17, 0.84, 0.5)], [S(0.06, 6, 5), 0x1a1026, M(0.17, 0.84, 0.5)],
      [S(0.15, 6, 5), dark, M(-0.22, 0.1, 0.05, 1, 0.6, 1.3)], [S(0.15, 6, 5), dark, M(0.22, 0.1, 0.05, 1, 0.6, 1.3)],
    ]);
  }
  function treeGeo(b) {
    return mergeParts([
      [new T.CylinderGeometry(0.16, 0.22, 1.0, 6), b.trunk, M(0, 0.5, 0)],
      [new T.ConeGeometry(0.95, 1.5, 7), b.leaf, M(0, 1.55, 0)],
      [new T.ConeGeometry(0.7, 1.2, 7), shade(b.leaf, 1.18), M(0, 2.35, 0)],
    ]);
  }
  function crystalGeo(b) {
    return mergeParts([
      [new T.OctahedronGeometry(0.3, 0), b.crystal, M(0, 0.55, 0, 0.8, 2.2, 0.8)],
      [new T.OctahedronGeometry(0.22, 0), shade(b.crystal, 1.2), M(0.28, 0.35, 0.1, 0.8, 1.6, 0.8, 0, 0, -0.4)],
      [new T.OctahedronGeometry(0.18, 0), shade(b.crystal, 0.8), M(-0.22, 0.3, -0.12, 0.8, 1.4, 0.8, 0.3, 0, 0.5)],
    ]);
  }

  // =====================================================================
  // Mundo: grade de colunas com alturas
  // =====================================================================
  const N = 48, C = 2, HALF = N * C / 2;
  const H = new Float32Array(N * N);
  const EDGE = new Uint8Array(N * N);
  const TREE = new Uint8Array(N * N);
  const RES = new Uint8Array(N * N);
  let BIOME = BIOMES[0];
  const world = { chests: [], altars: [], portal: null };

  function cellIdx(x, z) {
    const i = Math.floor((x + HALF) / C), j = Math.floor((z + HALF) / C);
    if (i < 0 || j < 0 || i >= N || j >= N) return -1;
    return j * N + i;
  }
  function hAt(x, z) { const k = cellIdx(x, z); return k < 0 ? 60 : H[k]; }
  const cx = (k) => (k % N) * C - HALF + C / 2;
  const cz = (k) => Math.floor(k / N) * C - HALF + C / 2;
  function groundUnder(x, z, r) {
    let g = hAt(x, z); const d = r * 0.7;
    let h = hAt(x + d, z + d); if (h > g) g = h;
    h = hAt(x - d, z + d); if (h > g) g = h;
    h = hAt(x + d, z - d); if (h > g) g = h;
    h = hAt(x - d, z - d); if (h > g) g = h;
    return g;
  }

  const boxGeo = (() => {
    const g = new T.BoxGeometry(1, 1, 1).toNonIndexed();
    g.translate(0, 0.5, 0);
    const n = g.attributes.normal, col = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) {
      const ny = n.getY(i);
      if (ny > 0.5) { col[i * 3] = 1; col[i * 3 + 1] = 1; col[i * 3 + 2] = 1; }
      else { col[i * 3] = 0.66; col[i * 3 + 1] = 0.56; col[i * 3 + 2] = 0.5; }
    }
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    return g;
  })();
  const terrain = instanced(boxGeo, MAT.lam, N * N, true);
  terrain.receiveShadow = renderer.shadowMap.enabled;
  terrain.count = N * N;

  const trees = instanced(treeGeo(BIOMES[0]), MAT.lam, 260, true);
  const crystalMat = new T.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
  const crystals = instanced(crystalGeo(BIOMES[0]), crystalMat, 160, false);
  const farIslands = new T.Group(); scene.add(farIslands);

  function generateWorld(seed) {
    const rng = mulberry32(seed), noise = makeNoise(rng);
    const ox = rng() * 100, oz = rng() * 100;
    RES.fill(0); TREE.fill(0);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, e = Math.min(i, j, N - 1 - i, N - 1 - j);
      EDGE[k] = e;
      const n = noise(ox + i * 0.085, oz + j * 0.085) * 0.7 + noise(ox * 2 + i * 0.21, oz * 2 + j * 0.21) * 0.3;
      let h = Math.max(0, (n - 0.4) * 7);
      h = Math.round(h * 2) / 2;
      const dc = Math.hypot(i - N / 2 + 0.5, j - N / 2 + 0.5);
      if (dc < 5) { h = 0; RES[k] = 1; } else if (dc < 7) h = Math.min(h, 0.5);
      if (e === 0) h = 12 + rng() * 6; else if (e === 1) h = Math.max(h, 7.5 + rng() * 4);
      H[k] = h;
    }
    const tops = [];
    // Mesas com escadas
    const nMesa = 5 + Math.floor(rng() * 3);
    for (let m = 0; m < nMesa; m++) {
      const w = 3 + Math.floor(rng() * 4), d = 3 + Math.floor(rng() * 4);
      let i0 = 0, j0 = 0, tries = 0;
      do { i0 = 3 + Math.floor(rng() * (N - 6 - w)); j0 = 3 + Math.floor(rng() * (N - 6 - d)); tries++; }
      while (tries < 30 && Math.hypot(i0 + w / 2 - N / 2, j0 + d / 2 - N / 2) < 10);
      let base = 0;
      for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) base = Math.max(base, H[j * N + i]);
      const top = Math.floor(base) + 2 + Math.floor(rng() * 3);
      for (let j = j0; j < j0 + d; j++) for (let i = i0; i < i0 + w; i++) { H[j * N + i] = top; RES[j * N + i] = 1; }
      const side = Math.floor(rng() * 4);
      for (let s = 1; s <= 12; s++) {
        const hh = top - 0.5 * s;
        for (let wv = 0; wv < 2; wv++) {
          let ci, cj;
          if (side === 0) { ci = i0 + Math.floor(w / 2) - 1 + wv; cj = j0 - s; }
          else if (side === 1) { ci = i0 + Math.floor(w / 2) - 1 + wv; cj = j0 + d - 1 + s; }
          else if (side === 2) { ci = i0 - s; cj = j0 + Math.floor(d / 2) - 1 + wv; }
          else { ci = i0 + w - 1 + s; cj = j0 + Math.floor(d / 2) - 1 + wv; }
          if (ci < 2 || cj < 2 || ci > N - 3 || cj > N - 3) continue;
          const kk = cj * N + ci;
          if (H[kk] < hh) H[kk] = hh;
          RES[kk] = 1;
        }
      }
      tops.push({ k: (j0 + Math.floor(d / 2)) * N + i0 + Math.floor(w / 2), kind: 'mesa' });
    }
    // Colunas soltas
    const nPil = 10 + Math.floor(rng() * 6);
    for (let p = 0; p < nPil; p++) {
      const i = 3 + Math.floor(rng() * (N - 7)), j = 3 + Math.floor(rng() * (N - 7));
      if (Math.hypot(i - N / 2, j - N / 2) < 7) continue;
      const big = rng() < 0.35;
      const hh = H[j * N + i] + 2.5 + Math.floor(rng() * 4) + (rng() < 0.5 ? 0.5 : 0);
      for (let dj = 0; dj < (big ? 2 : 1); dj++) for (let di = 0; di < (big ? 2 : 1); di++) { const kk = (j + dj) * N + i + di; H[kk] = Math.max(H[kk], hh); RES[kk] = 1; }
    }
    // Torres de saltos: colunas crescentes até uma plataforma com baú
    for (let t = 0; t < 2; t++) {
      let i = 5 + Math.floor(rng() * (N - 14)), j = 5 + Math.floor(rng() * (N - 14));
      if (Math.hypot(i - N / 2, j - N / 2) < 8) { i = (i + 14) % (N - 10) + 5; }
      const di = rng() < 0.5 ? 1 : -1, dj = rng() < 0.5 ? 1 : -1;
      let base = H[j * N + i];
      for (let s = 1; s <= 4; s++) {
        const ii = clamp(i + di * s * 2, 3, N - 4), jj = clamp(j + dj * (s % 2), 3, N - 4), kk = jj * N + ii;
        H[kk] = Math.max(H[kk], base + 1.5 * s); RES[kk] = 1;
        if (s === 4) {
          for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const k2 = clamp(jj + b, 3, N - 4) * N + clamp(ii + a * di, 3, N - 4); H[k2] = H[kk]; RES[k2] = 1; }
          tops.push({ k: kk, kind: 'torre' });
        }
      }
    }
    // Árvores e cristais
    let nt = 0, nc = 0;
    for (let k = 0; k < N * N; k++) {
      if (EDGE[k] < 3 || RES[k]) continue;
      if (H[k] < 2.5 && rng() < 0.065 && nt < 240) { TREE[k] = 1; nt++; }
    }
    return { tops, rng };
  }

  function terrainColor(k, b, r) {
    const h = H[k];
    let base = h >= 5.5 ? b.rock : h >= 2.5 ? b.high : h >= 1 ? b.mid : b.low;
    if (EDGE[k] <= 1) base = b.rock;
    _c.setHex(base).multiplyScalar(0.92 + r * 0.14);
    const i = k % N, j = (k / N) | 0;
    if ((i + j) & 1) _c.multiplyScalar(0.96);
    return _c;
  }

  function buildWorldMeshes(rng) {
    const b = BIOME;
    for (let k = 0; k < N * N; k++) {
      dummy.position.set(cx(k), -4, cz(k)); dummy.rotation.set(0, 0, 0);
      dummy.scale.set(C, H[k] + 4, C); dummy.updateMatrix();
      terrain.setMatrixAt(k, dummy.matrix);
      terrain.setColorAt(k, terrainColor(k, b, rng()));
    }
    terrain.instanceMatrix.needsUpdate = true; terrain.instanceColor.needsUpdate = true;

    trees.geometry.dispose(); trees.geometry = treeGeo(b);
    let n = 0;
    for (let k = 0; k < N * N; k++) {
      if (!TREE[k]) continue;
      const s = 0.85 + rng() * 0.5;
      dummy.position.set(cx(k), H[k], cz(k)); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      trees.setMatrixAt(n++, dummy.matrix);
    }
    trees.count = n; trees.instanceMatrix.needsUpdate = true;

    crystals.geometry.dispose(); crystals.geometry = crystalGeo(b);
    crystalMat.emissive.setHex(b.crystal).multiplyScalar(0.35);
    n = 0;
    for (let k = 0; k < N * N && n < 160; k++) {
      if (EDGE[k] < 2 || TREE[k] || H[k] < 2.5 || rng() > 0.12) continue;
      const s = 0.7 + rng() * 0.7;
      dummy.position.set(cx(k) + rand(-0.6, 0.6), H[k], cz(k) + rand(-0.6, 0.6)); dummy.rotation.set(0, rng() * 6.28, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      crystals.setMatrixAt(n++, dummy.matrix);
    }
    crystals.count = n; crystals.instanceMatrix.needsUpdate = true;

    // Ilhas distantes, para dar a sensação de céu aberto
    while (farIslands.children.length) { const c = farIslands.children.pop(); c.geometry.dispose(); }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2 + rng() * 0.3, d = 95 + rng() * 60, s = 4 + rng() * 9;
      const g = mergeParts([
        [new T.ConeGeometry(1, 2.2, 7), b.rock, M(0, -1.1, 0, 1, 1, 1, Math.PI, 0, 0)],
        [new T.CylinderGeometry(1.05, 1, 0.35, 7), b.low, M(0, 0.17, 0)],
        [new T.ConeGeometry(0.35, 0.9, 6), b.leaf, M(0.3, 0.8, 0.2)],
      ]);
      const m = new T.Mesh(g, MAT.lam);
      m.position.set(Math.cos(a) * d, -10 + rng() * 34, Math.sin(a) * d); m.scale.set(s, s, s); m.rotation.y = rng() * 6;
      farIslands.add(m);
    }

    paintSky(b.top, b.bottom);
    scene.fog.color.setHex(b.fog);
    hemi.color.setHex(b.hemi); hemi.groundColor.setHex(b.ground);
    sun.color.setHex(b.sun);
    renderer.setClearColor(b.fog);
  }

  // =====================================================================
  // Objetos interativos: baús, altares, portal
  // =====================================================================
  const propGroup = new T.Group(); scene.add(propGroup);
  const GEO = {
    chestBase: mergeParts([
      [new T.BoxGeometry(1.1, 0.6, 0.75), 0x8a5a2b, M(0, 0.3, 0)],
      [new T.BoxGeometry(0.12, 0.62, 0.79), 0xffc845, M(-0.36, 0.3, 0)],
      [new T.BoxGeometry(0.12, 0.62, 0.79), 0xffc845, M(0.36, 0.3, 0)],
      [new T.BoxGeometry(0.2, 0.24, 0.06), 0xffe08a, M(0, 0.5, 0.39)],
    ]),
    chestLid: mergeParts([
      [new T.BoxGeometry(1.16, 0.3, 0.8), 0x6e451f, M(0, 0.15, 0.4)],
      [new T.BoxGeometry(0.12, 0.32, 0.84), 0xffc845, M(-0.36, 0.15, 0.4)],
      [new T.BoxGeometry(0.12, 0.32, 0.84), 0xffc845, M(0.36, 0.15, 0.4)],
    ]),
    altar: mergeParts([
      [new T.CylinderGeometry(0.75, 0.9, 0.5, 7), 0x8c8aa0, M(0, 0.25, 0)],
      [new T.CylinderGeometry(0.45, 0.6, 0.7, 7), 0xa8a6bc, M(0, 0.85, 0)],
      [new T.CylinderGeometry(0.7, 0.5, 0.18, 7), 0x8c8aa0, M(0, 1.28, 0)],
    ]),
    rune: new T.OctahedronGeometry(0.35, 0),
    beam: new T.CylinderGeometry(0.3, 0.3, 16, 8, 1, true),
    disc: new T.CircleGeometry(1, 40),
    ring: (() => { const g = new T.RingGeometry(0.86, 1, 48); g.rotateX(-Math.PI / 2); return g; })(),
    portal: new T.TorusGeometry(1.7, 0.2, 8, 36),
    blade: new T.OctahedronGeometry(0.5, 0),
    dart: new T.OctahedronGeometry(0.5, 0),
    sphere: new T.SphereGeometry(0.5, 10, 8),
    box: new T.BoxGeometry(1, 1, 1),
    boomer: mergeParts([
      [new T.BoxGeometry(0.75, 0.08, 0.2), 0xfff1c8, M(0.28, 0, 0.2, 1, 1, 1, 0, 0.7, 0)],
      [new T.BoxGeometry(0.75, 0.08, 0.2), 0xfff1c8, M(-0.28, 0, 0.2, 1, 1, 1, 0, -0.7, 0)],
    ]),
  };
  GEO.disc.rotateX(-Math.PI / 2);
  const chestGoldMat = new T.MeshLambertMaterial({ vertexColors: true, color: 0xfff0a0, emissive: 0x6a4a00 });
  const beamMat = (hex, op) => new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false });

  function clearProps() {
    while (propGroup.children.length) propGroup.remove(propGroup.children[0]);
    world.chests.length = 0; world.altars.length = 0; world.portal = null;
  }
  function spawnChest(x, z, gold) {
    const y = groundUnder(x, z, 0.5);
    const g = new T.Group();
    const base = new T.Mesh(GEO.chestBase, gold ? chestGoldMat : MAT.lam);
    const lid = new T.Mesh(GEO.chestLid, gold ? chestGoldMat : MAT.lam);
    lid.position.set(0, 0.6, -0.4);
    const beam = new T.Mesh(GEO.beam, beamMat(gold ? 0xffd04a : 0xffb547, gold ? 0.3 : 0.18));
    beam.position.y = 8;
    base.castShadow = lid.castShadow = renderer.shadowMap.enabled;
    g.add(base, lid, beam);
    g.position.set(x, y, z); g.rotation.y = Math.random() * 6.28;
    propGroup.add(g);
    const ch = { x, y, z, g, lid, beam, gold, opened: false, open: 0 };
    world.chests.push(ch);
    return ch;
  }
  function spawnAltar(x, z) {
    const y = groundUnder(x, z, 0.5);
    const g = new T.Group();
    const base = new T.Mesh(GEO.altar, MAT.lam); base.castShadow = renderer.shadowMap.enabled;
    const rune = new T.Mesh(GEO.rune, new T.MeshBasicMaterial({ color: 0x7fe3ff }));
    rune.position.y = 1.9;
    const ring = new T.Mesh(GEO.ring, beamMat(0x7fe3ff, 0.6)); ring.scale.setScalar(2.4); ring.position.y = 0.05;
    const fill = new T.Mesh(GEO.disc, beamMat(0x7fe3ff, 0.22)); fill.position.y = 0.04; fill.scale.setScalar(0.001);
    const beam = new T.Mesh(GEO.beam, beamMat(0x7fe3ff, 0.14)); beam.position.y = 8;
    g.add(base, rune, ring, fill, beam);
    g.position.set(x, y, z);
    propGroup.add(g);
    world.altars.push({ x, y, z, g, rune, ring, fill, beam, charge: 0, used: false });
  }
  function spawnPortal(x, z) {
    const y = groundUnder(x, z, 1);
    const g = new T.Group();
    const ring = new T.Mesh(GEO.portal, new T.MeshBasicMaterial({ color: 0xc99bff }));
    ring.position.y = 2;
    const inner = new T.Mesh(new T.CircleGeometry(1.55, 32), beamMat(0x8a5cff, 0.55));
    inner.position.y = 2;
    const beam = new T.Mesh(GEO.beam, beamMat(0xc99bff, 0.25)); beam.position.y = 8;
    g.add(ring, inner, beam); g.position.set(x, y, z);
    propGroup.add(g);
    world.portal = { x, y, z, g, ring, inner };
  }

  // =====================================================================
  // Jogador
  // =====================================================================
  let P = null, run = null;
  const playerGroup = new T.Group(); scene.add(playerGroup);
  const playerBody = new T.Mesh(new T.BufferGeometry(), MAT.lam);
  playerBody.castShadow = renderer.shadowMap.enabled;
  const flameMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const playerFlame = new T.Mesh(new T.ConeGeometry(0.2, 0.6, 6), flameMat);
  playerFlame.position.set(0, 1.4, -0.05);
  const bubbleMesh = new T.Mesh(new T.SphereGeometry(0.95, 16, 12), new T.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, depthWrite: false }));
  bubbleMesh.position.y = 0.7;
  playerGroup.add(playerBody, playerFlame, bubbleMesh);
  playerGroup.visible = false;

  const GRAV = 26, JUMP_V = 10.2, STEP = 0.55, PR = 0.42, BASE_SPEED = 7.2;
  const BOSS_TIME = 240, MAX_ENEMIES = 290, MAX_WEAPONS = 4;
  const xpNeed = (l) => Math.floor(5 + (l - 1) * 4.2 + Math.pow(l - 1, 1.65));

  function newPlayer(ch) {
    const s = { maxHp: 120, regen: 0.2, armor: 0, speed: 1, dmg: 1, haste: 1, area: 1, proj: 0, crit: 0.05, critMult: 2, magnet: 3.2, xpGain: 1, luck: 0, jumps: 0, jumpMult: 1, goldGain: 1, slideCd: 0.9 };
    const m = ch.mods;
    if (m.dmg) s.dmg += m.dmg; if (m.speed) s.speed += m.speed; if (m.jumps) s.jumps += m.jumps;
    if (m.hp) s.maxHp += m.hp; if (m.armor) s.armor += m.armor; if (m.haste) s.haste += m.haste;
    if (m.magnet) s.magnet *= 1 + m.magnet; if (m.xpGain) s.xpGain += m.xpGain; if (m.crit) s.crit += m.crit;
    if (m.jumpMult) s.jumpMult += m.jumpMult;
    for (const f of FORGE) { const l = SAVE.forge[f.id] || 0; if (l) f.apply(s, l); }
    return {
      ch, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, jumpsUsed: 0, coyote: 0, slideT: 0, slideCdT: 0,
      airTime: 0, peakY: 0, facing: 0, hp: s.maxHp, iframes: 0, level: 1, xp: 0, xpNext: xpNeed(1), coins: 0,
      weapons: [], relics: {}, relicList: [], runes: {}, stats: s, bubbleT: 10, thunderT: 5, magnetT: 40, ySmooth: 0, stompCd: 0,
    };
  }

  // =====================================================================
  // Entidades e efeitos
  // =====================================================================
  const enemies = [];
  const EMESH = {};
  const enemyMat = new T.MeshLambertMaterial({ vertexColors: true });
  for (const k in ETYPES) EMESH[k] = instanced(EGEO[k](), enemyMat, 420, true);
  const bossMesh = new T.Mesh(bossGeo(), enemyMat);
  bossMesh.castShadow = renderer.shadowMap.enabled; bossMesh.visible = false; scene.add(bossMesh);

  const HHEAD = new Int32Array(N * N), HNEXT = new Int32Array(4096);
  function buildHash() {
    HHEAD.fill(-1);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]; if (!e.alive) continue;
      const ii = clamp(Math.floor((e.x + HALF) / C), 0, N - 1), jj = clamp(Math.floor((e.z + HALF) / C), 0, N - 1);
      const k = jj * N + ii;
      HNEXT[i] = HHEAD[k]; HHEAD[k] = i;
    }
  }
  function forNear(x, z, r, cb) {
    const m = r + 2.6;
    const i0 = clamp(Math.floor((x - m + HALF) / C), 0, N - 1), i1 = clamp(Math.floor((x + m + HALF) / C), 0, N - 1);
    const j0 = clamp(Math.floor((z - m + HALF) / C), 0, N - 1), j1 = clamp(Math.floor((z + m + HALF) / C), 0, N - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let idx = HHEAD[j * N + i];
      while (idx !== -1) {
        const e = enemies[idx];
        if (e && e.alive) { const dx = e.x - x, dz = e.z - z, rr = r + e.r; if (dx * dx + dz * dz <= rr * rr) cb(e); }
        idx = HNEXT[idx];
      }
    }
  }
  function nearestN(x, y, z, n, maxR) {
    const out = [], ds = [], m2 = maxR * maxR;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dy = (e.y + e.h * 0.5) - y, dz = e.z - z, d = dx * dx + dy * dy * 0.5 + dz * dz;
      if (d > m2) continue;
      if (out.length < n) { out.push(e); ds.push(d); }
      else { let wi = 0; for (let i = 1; i < n; i++) if (ds[i] > ds[wi]) wi = i; if (d < ds[wi]) { out[wi] = e; ds[wi] = d; } }
    }
    return out;
  }
  function hitReady(e, key, cd) {
    const last = e.hit[key];
    if (last !== undefined && run.time - last < cd) return false;
    e.hit[key] = run.time; return true;
  }

  // Projéteis e efeitos com pools simples
  function Pool(make) { this.free = []; this.make = make; }
  Pool.prototype.get = function () { const m = this.free.pop() || this.make(); m.visible = true; if (!m.parent) scene.add(m); return m; };
  Pool.prototype.put = function (m) { m.visible = false; this.free.push(m); };
  const ringPool = new Pool(() => new T.Mesh(GEO.ring, beamMat(0xffffff, 1)));
  const segPool = new Pool(() => new T.Mesh(GEO.box, beamMat(0xfff38a, 1)));
  const dartPool = new Pool(() => new T.Mesh(GEO.dart, new T.MeshBasicMaterial({ color: 0xbfefff })));
  const boomPool = new Pool(() => { const m = new T.Mesh(GEO.boomer, MAT.lam); m.castShadow = renderer.shadowMap.enabled; return m; });
  const meteorPool = new Pool(() => new T.Mesh(GEO.sphere, new T.MeshBasicMaterial({ color: 0xff8a3d })));
  const bulletPool = new Pool(() => new T.Mesh(GEO.sphere, new T.MeshBasicMaterial({ color: 0xff4f9a })));
  const darts = [], boomers = [], meteors = [], bullets = [], waves = [], effects = [], nums = [];
  let pendingBooms = [];

  function ringFx(x, y, z, r0, r1, dur, hex, op) {
    const m = ringPool.get();
    m.material.color.setHex(hex); m.material.opacity = op === undefined ? 0.85 : op;
    m.position.set(x, y + 0.08, z); m.scale.setScalar(Math.max(0.01, r0));
    effects.push({ m, t: 0, dur, r0, r1, op: m.material.opacity, pool: ringPool });
  }
  function segFx(ax, ay, az, bx, by, bz, hex, w, dur) {
    const m = segPool.get();
    m.material.color.setHex(hex); m.material.opacity = 1;
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.lookAt(bx, by, bz); m.scale.set(w, w, len);
    effects.push({ m, t: 0, dur, op: 1, pool: segPool, seg: true });
  }
  function bolt(ax, ay, az, bx, by, bz, hex) {
    let px = ax, py = ay, pz = az;
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const t = i / n, j = i === n ? 0 : 0.5;
      const qx = lerp(ax, bx, t) + rand(-j, j), qy = lerp(ay, by, t) + rand(-j, j), qz = lerp(az, bz, t) + rand(-j, j);
      segFx(px, py, pz, qx, qy, qz, hex, 0.12, 0.16);
      px = qx; py = qy; pz = qz;
    }
  }

  // Partículas instanciadas
  const PMAX = 700;
  const pmesh = instanced(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xffffff }), PMAX, false);
  const PA = { x: new Float32Array(PMAX), y: new Float32Array(PMAX), z: new Float32Array(PMAX), vx: new Float32Array(PMAX), vy: new Float32Array(PMAX), vz: new Float32Array(PMAX), life: new Float32Array(PMAX), max: new Float32Array(PMAX), size: new Float32Array(PMAX), g: new Float32Array(PMAX), col: new Float32Array(PMAX * 3) };
  let pCount = 0;
  function burst(x, y, z, hex, n, spd, life, size, grav) {
    _c.setHex(hex);
    spd = spd || 5; life = life || 0.5; size = size || 0.18; grav = grav === undefined ? 14 : grav;
    for (let i = 0; i < n; i++) {
      const k = pCount < PMAX ? pCount++ : Math.floor(Math.random() * PMAX);
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, s = Math.sqrt(1 - u * u), sp = spd * rand(0.4, 1);
      PA.x[k] = x; PA.y[k] = y; PA.z[k] = z;
      PA.vx[k] = Math.cos(a) * s * sp; PA.vy[k] = Math.abs(u) * sp + spd * 0.4; PA.vz[k] = Math.sin(a) * s * sp;
      PA.life[k] = PA.max[k] = life * rand(0.6, 1.2); PA.size[k] = size * rand(0.6, 1.3); PA.g[k] = grav;
      PA.col[k * 3] = _c.r; PA.col[k * 3 + 1] = _c.g; PA.col[k * 3 + 2] = _c.b;
    }
  }
  function copyP(d, s) {
    PA.x[d] = PA.x[s]; PA.y[d] = PA.y[s]; PA.z[d] = PA.z[s]; PA.vx[d] = PA.vx[s]; PA.vy[d] = PA.vy[s]; PA.vz[d] = PA.vz[s];
    PA.life[d] = PA.life[s]; PA.max[d] = PA.max[s]; PA.size[d] = PA.size[s]; PA.g[d] = PA.g[s];
    PA.col[d * 3] = PA.col[s * 3]; PA.col[d * 3 + 1] = PA.col[s * 3 + 1]; PA.col[d * 3 + 2] = PA.col[s * 3 + 2];
  }
  function updateParticles(dt) {
    let i = 0;
    while (i < pCount) {
      PA.life[i] -= dt;
      if (PA.life[i] <= 0) { pCount--; if (i !== pCount) copyP(i, pCount); continue; }
      PA.vy[i] -= PA.g[i] * dt;
      PA.x[i] += PA.vx[i] * dt; PA.y[i] += PA.vy[i] * dt; PA.z[i] += PA.vz[i] * dt;
      const g = hAt(PA.x[i], PA.z[i]);
      if (PA.y[i] < g) { PA.y[i] = g; PA.vy[i] *= -0.3; PA.vx[i] *= 0.6; PA.vz[i] *= 0.6; }
      i++;
    }
    for (let k = 0; k < pCount; k++) {
      const s = PA.size[k] * (PA.life[k] / PA.max[k]);
      dummy.position.set(PA.x[k], PA.y[k], PA.z[k]); dummy.rotation.set(PA.life[k] * 7, PA.life[k] * 5, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
      pmesh.setMatrixAt(k, dummy.matrix);
      _c.setRGB(PA.col[k * 3], PA.col[k * 3 + 1], PA.col[k * 3 + 2]); pmesh.setColorAt(k, _c);
    }
    pmesh.count = pCount; pmesh.instanceMatrix.needsUpdate = true; if (pmesh.instanceColor) pmesh.instanceColor.needsUpdate = true;
  }

  // Coletáveis: 0 XP, 1 moeda, 2 coração, 3 ímã, 4 estilhaço
  const pickups = [];
  const PK_XP = instanced(new T.OctahedronGeometry(0.22, 0), new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }), 700, false);
  const PK_COIN = instanced(new T.CylinderGeometry(0.22, 0.22, 0.07, 10), new T.MeshLambertMaterial({ color: 0xffd04a, emissive: 0x5a3a00 }), 300, false);
  const PK_MISC = instanced(new T.IcosahedronGeometry(0.3, 0), new T.MeshLambertMaterial({ color: 0xffffff, emissive: 0x333333 }), 60, false);
  const XP_COL = [0x5ee0a0, 0x4fb3ff, 0xc77dff, 0xffb547];
  const MISC_COL = { 2: 0xff4f6e, 3: 0x7fe3ff, 4: 0xc09bff };
  function drop(kind, x, y, z, v) {
    if (kind === 0 && pickups.length > 650) {
      const t = pickups.find((p) => p.k === 0 && !p.attract);
      if (t) { t.v += v; return; }
    }
    pickups.push({ k: kind, x: x + rand(-0.3, 0.3), y: y + 0.4, z: z + rand(-0.3, 0.3), vy: rand(3, 6), v, attract: false, sp: 0, t: Math.random() * 6 });
  }

  // =====================================================================
  // Entrada (teclado, mouse, toque)
  // =====================================================================
  const keys = {};
  let jumpPressed = false, slidePressed = false, actPressed = false, jumpHeld = false;
  let camYaw = 0.7, camPitch = 0.42, camDist = 9.5, shake = 0;
  const joy = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  let lookTouch = null, dragging = false, lastMX = 0, lastMY = 0;

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT')) return;
    initAudio();
    const c = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) e.preventDefault();
    if (!keys[c]) {
      if (c === 'Space') { jumpPressed = true; }
      if (c === 'ShiftLeft' || c === 'ShiftRight' || c === 'ControlLeft' || c === 'ControlRight' || c === 'KeyC') slidePressed = true;
      if (c === 'KeyE' || c === 'KeyF') actPressed = true;
      if ((c === 'Escape' || c === 'KeyP')) { if (state === 'play') pauseGame(); else if (state === 'pause' && c === 'KeyP') resumeGame(); }
      if (state === 'levelup' || state === 'chest' || state === 'altar') {
        const n = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[c];
        if (n !== undefined) chooseOption(n);
        if (c === 'KeyR') reroll();
      }
    }
    keys[c] = true;
    if (c === 'Space') jumpHeld = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Space') jumpHeld = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; jumpHeld = false; if (state === 'play') pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pauseGame(); });

  function lockPointer() {
    if (IS_TOUCH || document.pointerLockElement === canvas) return;
    try { const r = canvas.requestPointerLock && canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* cursor livre: arrastar continua funcionando */ }
  }
  let expectUnlock = false;
  function releasePointer() { try { if (document.pointerLockElement) { expectUnlock = true; document.exitPointerLock(); } } catch (e) { /* ignora */ } }
  let hadLock = false;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && expectUnlock) { expectUnlock = false; hadLock = false; return; }
    if (!locked && hadLock && state === 'play') pauseGame();
    hadLock = locked;
  });
  canvas.addEventListener('mousedown', (e) => {
    initAudio();
    if (state !== 'play') return;
    dragging = true; lastMX = e.clientX; lastMY = e.clientY;
    lockPointer();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (state !== 'play' && state !== 'menu') return;
    const sens = SAVE.settings.sens;
    if (document.pointerLockElement === canvas) {
      camYaw -= e.movementX * 0.0026 * sens; camPitch = clamp(camPitch + e.movementY * 0.002 * sens, -0.15, 1.25);
    } else if (dragging) {
      camYaw -= (e.clientX - lastMX) * 0.005 * sens; camPitch = clamp(camPitch + (e.clientY - lastMY) * 0.004 * sens, -0.15, 1.25);
      lastMX = e.clientX; lastMY = e.clientY;
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { if (state === 'play') { camDist = clamp(camDist + Math.sign(e.deltaY) * 0.8, 5, 15); e.preventDefault(); } }, { passive: false });

  // Toque
  const stickZone = $('stickZone'), stick = $('stick'), knob = $('knob'), lookZone = $('lookZone');
  stickZone.addEventListener('touchstart', (e) => {
    initAudio();
    const t = e.changedTouches[0]; joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY;
    stick.style.left = t.clientX + 'px'; stick.style.top = t.clientY + 'px'; stick.classList.add('on');
    e.preventDefault();
  }, { passive: false });
  stickZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (t.identifier === joy.id) {
      let dx = t.clientX - joy.ox, dy = t.clientY - joy.oy; const d = Math.hypot(dx, dy), m = 55;
      if (d > m) { dx = dx / d * m; dy = dy / d * m; }
      joy.x = dx / m; joy.y = dy / m; knob.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    e.preventDefault();
  }, { passive: false });
  const endStick = (e) => { for (const t of e.changedTouches) if (t.identifier === joy.id) { joy.id = null; joy.x = joy.y = 0; knob.style.transform = ''; stick.classList.remove('on'); } };
  stickZone.addEventListener('touchend', endStick); stickZone.addEventListener('touchcancel', endStick);
  lookZone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookTouch = { id: t.identifier, x: t.clientX, y: t.clientY }; e.preventDefault(); }, { passive: false });
  lookZone.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) if (lookTouch && t.identifier === lookTouch.id) {
      const s = SAVE.settings.sens;
      camYaw -= (t.clientX - lookTouch.x) * 0.007 * s; camPitch = clamp(camPitch + (t.clientY - lookTouch.y) * 0.005 * s, -0.15, 1.25);
      lookTouch.x = t.clientX; lookTouch.y = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });
  lookZone.addEventListener('touchend', () => { lookTouch = null; });
  const holdBtn = (id, down, up) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { initAudio(); down(); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { if (up) up(); e.preventDefault(); }, { passive: false });
    el.addEventListener('mousedown', () => { down(); }); el.addEventListener('mouseup', () => { if (up) up(); });
  };
  holdBtn('tJump', () => { jumpPressed = true; jumpHeld = true; }, () => { jumpHeld = false; });
  holdBtn('tSlide', () => { slidePressed = true; });
  holdBtn('tAct', () => { actPressed = true; });

  // =====================================================================
  // Áudio sintetizado (sem arquivos)
  // =====================================================================
  let AC = null, master = null, musicGain = null, noiseBuf = null;
  function initAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)();
      master = AC.createGain(); master.gain.value = SAVE.settings.vol; master.connect(AC.destination);
      musicGain = AC.createGain(); musicGain.gain.value = SAVE.settings.music ? 0.55 : 0; musicGain.connect(master);
      noiseBuf = AC.createBuffer(1, Math.floor(AC.sampleRate * 0.6), AC.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { AC = null; }
  }
  function tone(f, dur, type, vol, slideTo, at, dest) {
    if (!AC) return;
    const t = at || AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, at, dest) {
    if (!AC) return;
    const t = at || AC.currentTime;
    const s = AC.createBufferSource(); s.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq || 1500, t); f.frequency.exponentialRampToValueAtTime(90, t + dur);
    const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || master); s.start(t); s.stop(t + dur + 0.05);
  }
  const sfxT = {}; let xpPitch = 0;
  const GAP = { hit: 0.05, kill: 0.04, xp: 0.03, coin: 0.05, dart: 0.07, zap: 0.08, throw: 0.08, boom: 0.06, aura: 0.3 };
  function sfx(n) {
    if (!AC) return;
    const now = AC.currentTime;
    if (sfxT[n] && now - sfxT[n] < (GAP[n] || 0.02)) return;
    sfxT[n] = now;
    switch (n) {
      case 'hit': tone(240, 0.05, 'square', 0.03, 140); break;
      case 'kill': tone(520, 0.08, 'triangle', 0.05, 180); break;
      case 'xp': xpPitch = Math.min(xpPitch + 1, 14); tone(700 + xpPitch * 40, 0.06, 'sine', 0.05); break;
      case 'coin': tone(1250, 0.05, 'square', 0.03); tone(1660, 0.07, 'square', 0.03, 0, now + 0.05); break;
      case 'heal': tone(520, 0.12, 'sine', 0.08, 900); break;
      case 'level': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.09, 0, now + i * 0.07)); break;
      case 'hurt': tone(220, 0.22, 'sawtooth', 0.11, 70); noise(0.12, 0.08, 900); break;
      case 'jump': tone(320, 0.09, 'square', 0.04, 560); break;
      case 'slide': noise(0.22, 0.09, 2600); break;
      case 'zap': tone(1400, 0.1, 'sawtooth', 0.035, 300); break;
      case 'dart': tone(900, 0.06, 'triangle', 0.035, 1500); break;
      case 'throw': tone(480, 0.1, 'triangle', 0.04, 320); break;
      case 'boom': noise(0.4, 0.2, 1100); tone(110, 0.3, 'sine', 0.15, 40); break;
      case 'stomp': noise(0.3, 0.16, 700); tone(130, 0.3, 'sine', 0.18, 45); break;
      case 'chest': [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, 0, now + i * 0.06)); break;
      case 'altar': tone(660, 0.5, 'sine', 0.08, 1320); break;
      case 'boss': tone(55, 1.4, 'sawtooth', 0.14, 40); noise(1, 0.1, 400); break;
      case 'portal': tone(200, 1, 'sine', 0.12, 1200); break;
      case 'ui': tone(660, 0.05, 'sine', 0.05); break;
      case 'deny': tone(180, 0.15, 'square', 0.05, 120); break;
      case 'dodge': tone(1200, 0.08, 'sine', 0.05, 1800); break;
    }
  }
  // Música: um laço curto em lá menor, gerado ao vivo
  let musicTimer = null, musicStep = 0, musicNext = 0;
  const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function musicTick() {
    if (!AC || !musicGain || AC.state !== 'running') return;
    const spb = 60 / 112 / 4;
    if (musicNext < AC.currentTime) musicNext = AC.currentTime + 0.05;
    while (musicNext < AC.currentTime + 0.3) {
      const bar = Math.floor(musicStep / 16) % 4, st = musicStep % 16, ch = PROG[bar];
      if (st % 4 === 0) tone(mtof(ch[0] - 24), spb * 3.6, 'triangle', 0.2, 0, musicNext, musicGain);
      if (st % 2 === 0) { const arp = [0, 1, 2, 1, 0, 2, 1, 2][(st / 2) % 8]; tone(mtof(ch[arp] + (st >= 8 ? 12 : 0)), spb * 1.5, 'square', 0.028, 0, musicNext, musicGain); }
      if (st % 4 === 2) noise(0.05, 0.035, 7000, musicNext, musicGain);
      musicStep++; musicNext += spb;
    }
  }
  function setMusic(on) {
    if (on && !musicTimer) musicTimer = setInterval(musicTick, 90);
    if (!on && musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  // =====================================================================
  // Fluxo de caminhos dos inimigos (BFS a partir do jogador)
  // =====================================================================
  const FD = new Int16Array(N * N), FNEXT = new Int32Array(N * N), Q = new Int32Array(N * N);
  let flowCell = -1, flowT = 0;
  const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function computeFlow() {
    FD.fill(-1);
    const start = cellIdx(P.x, P.z); flowCell = start;
    if (start < 0) return;
    let qh = 0, qt = 0; Q[qt++] = start; FD[start] = 0;
    while (qh < qt) {
      const c = Q[qh++], ci = c % N, cj = (c / N) | 0;
      for (const d of D4) {
        const ni = ci + d[0], nj = cj + d[1];
        if (ni < 1 || nj < 1 || ni >= N - 1 || nj >= N - 1) continue;
        const n = nj * N + ni;
        if (FD[n] >= 0 || H[c] - H[n] > 1.05) continue;
        FD[n] = FD[c] + 1; Q[qt++] = n;
      }
    }
    for (let c = 0; c < N * N; c++) {
      FNEXT[c] = -1;
      if (FD[c] <= 0) continue;
      const ci = c % N, cj = (c / N) | 0;
      let best = -1, bd = FD[c];
      for (const d of D8) {
        const ni = ci + d[0], nj = cj + d[1];
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const n = nj * N + ni;
        if (FD[n] < 0 || H[n] - H[c] > 1.05) continue;
        if (d[0] && d[1]) {
          const a = cj * N + ni, b = nj * N + ci;
          if (FD[a] < 0 || FD[b] < 0 || H[a] - H[c] > 1.05 || H[b] - H[c] > 1.05) continue;
        }
        const score = FD[n] - (d[0] && d[1] ? 0.5 : 0);
        if (score < bd) { bd = score; best = n; }
      }
      FNEXT[c] = best;
    }
  }

  // =====================================================================
  // Física de movimento compartilhada
  // =====================================================================
  const SAMP = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [0.7, -0.7], [-0.7, 0.7], [-0.7, -0.7]];
  function blocked(x, z, y, r) {
    for (const s of SAMP) if (hAt(x + s[0] * r, z + s[1] * r) > y + STEP) return true;
    return false;
  }
  function treePush(ent, r) {
    const k = cellIdx(ent.x, ent.z); if (k < 0) return;
    const ci = k % N, cj = (k / N) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const n = nj * N + ni; if (!TREE[n] || ent.y > H[n] + 2.6) continue;
      const dx = ent.x - cx(n), dz = ent.z - cz(n), d = Math.hypot(dx, dz), rr = r + 0.4;
      if (d < rr && d > 0.001) { const nx = cx(n) + dx / d * rr, nz = cz(n) + dz / d * rr; if (!blocked(nx, nz, ent.y, r)) { ent.x = nx; ent.z = nz; } }
    }
  }

  // =====================================================================
  // Dano e mortes
  // =====================================================================
  function caveiraBonus() { return P.relics.caveira ? Math.min(0.6, Math.floor(run.kills / 25) * 0.01) : 0; }
  function dealDamage(e, base, src, kbx, kbz) {
    if (!e.alive) return 0;
    let d = base * (P.stats.dmg + caveiraBonus());
    if (P.relics.ancora && P.y > e.y + 1) d *= 1.35;
    const crit = Math.random() < P.stats.crit;
    if (crit) d *= P.stats.critMult;
    e.hp -= d; e.flash = 0.09;
    if (!e.boss && kbx !== undefined) { e.kx += kbx * e.kbRes; e.kz += kbz * e.kbRes; }
    if (P.relics.gota && !e.boss && Math.random() < 0.08) e.freeze = 1.6;
    addNumAt(e, d, crit);
    sfx('hit');
    if (e.hp <= 0) killEnemy(e, src);
    return d;
  }
  function killEnemy(e, src) {
    e.alive = false;
    run.kills++;
    if (src === 'impacto') run.stompKills++;
    burst(e.x, e.y + e.h * 0.5, e.z, e.color, e.elite ? 22 : 7, 6, 0.55, e.elite ? 0.3 : 0.2);
    sfx('kill');
    if (P.relics.presa) P.hp = Math.min(P.stats.maxHp, P.hp + 0.4);
    if (P.relics.polvora && Math.random() < 0.15) pendingBooms.push([e.x, e.y, e.z]);
    if (e.boss) { onBossDead(e); return; }
    drop(0, e.x, e.y, e.z, e.xp);
    const coinChance = e.elite ? 1 : 0.3;
    if (Math.random() < coinChance) { const n = e.elite ? 8 : 1; for (let i = 0; i < n; i++) drop(1, e.x, e.y, e.z, 1); }
    if (e.elite) { run.elites++; drop(4, e.x, e.y, e.z, 2); spawnChest(e.x, e.z, true); toast('Baú dourado deixado pela elite!'); }
    if (Math.random() < 0.007) drop(2, e.x, e.y, e.z, 1);
    if (Math.random() < 0.0025) drop(3, e.x, e.y, e.z, 1);
    if (Math.random() < 0.01) drop(4, e.x, e.y, e.z, 1);
  }
  function damagePlayer(amount, src) {
    if (P.iframes > 0 || state !== 'play') return;
    if (P.relics.espelho && Math.random() < 0.12) { P.iframes = 0.35; addText(P.x, P.y + 2, 'Esquiva!', '#9fe8ff'); sfx('dodge'); return; }
    if (P.relics.bolha && P.bubbleT >= 10) { P.bubbleT = 0; P.iframes = 0.6; burst(P.x, P.y + 0.8, P.z, 0x9fe8ff, 14, 5, 0.4); sfx('dodge'); return; }
    const d = Math.max(1, amount - P.stats.armor);
    P.hp -= d; P.iframes = 0.7;
    if (!REDUCED) shake = Math.min(0.6, shake + 0.25);
    hurtFlash = 1;
    sfx('hurt');
    if (P.relics.casco && src && src.alive) dealDamage(src, amount * 2 / Math.max(0.5, P.stats.dmg), 'casco');
    if (P.hp <= 0) { P.hp = 0; gameOver(); }
  }

  // Números de dano (desenhados no canvas 2D)
  function pushNum(x, y, z, text, color, big) {
    if (nums.length > 70) nums.shift();
    nums.push({ x, y, z, text, color, big, t: 0 });
  }
  function addText(x, y, text, color) { pushNum(x, y, P ? P.z : 0, text, color, true); }

  // =====================================================================
  // Inimigos
  // =====================================================================
  function tEff() { return run.stageTime + (run.floor - 1) * 100; }
  function spawnEnemy(type, opt) {
    opt = opt || {};
    if (enemies.length >= MAX_ENEMIES && !opt.force) return null;
    const t = ETYPES[type];
    let x = 0, z = 0;
    if (opt.x !== undefined) { x = opt.x; z = opt.z; }
    else {
      let ok = false;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2, d = rand(18, 30);
        x = P.x + Math.cos(a) * d; z = P.z + Math.sin(a) * d;
        const k = cellIdx(x, z);
        if (k < 0 || EDGE[k] < 2) continue;
        if (!t.fly && H[k] > P.y + 4.5) continue;
        ok = true; break;
      }
      if (!ok) return null;
    }
    const te = tEff();
    const hpM = (1 + te / 85) * Math.pow(1.45, run.floor - 1);
    const dmM = (1 + te / 220) * Math.pow(1.2, run.floor - 1);
    const el = !!opt.elite, s = el ? 1.65 : 1;
    const e = {
      type, x, y: groundUnder(x, z, 0.3) + (t.fly ? 2 : 0.02), z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0,
      hp: t.hp * hpM * (el ? 10 : 1), r: t.r * s, h: t.h * s, s, speed: t.speed * (el ? 0.9 : 1), dmg: t.dmg * dmM * (el ? 1.5 : 1),
      xp: t.xp * (el ? 15 : 1) * (1 + (run.floor - 1) * 0.5), elite: el, grounded: false, freeze: 0, flash: 0, slowT: 0, slowF: 0,
      shootCd: rand(1.2, 2.6), hit: {}, alive: true, phase: Math.random() * 6.28, fly: !!t.fly, ranged: !!t.ranged,
      kbRes: t.kbRes || 1, color: t.color, boss: false, yaw: 0, far: 0,
    };
    e.maxHp = e.hp;
    if (el) e.kbRes *= 0.3;
    enemies.push(e);
    return e;
  }
  function moveEnt(e, dx, dz, r) {
    let moved = true;
    if (dx) { const nx = e.x + dx; if (!blocked(nx, e.z, e.y, r)) e.x = nx; else { moved = false; e.bx = true; } }
    if (dz) { const nz = e.z + dz; if (!blocked(e.x, nz, e.y, r)) e.z = nz; else { moved = false; e.bx = true; } }
    return moved;
  }
  function updateEnemies(dt) {
    const slowAll = P.relics.ampulheta ? 0.88 : 1;
    const speedUp = 1 + Math.min(0.35, tEff() / 600);
    for (const e of enemies) {
      if (!e.alive) continue;
      if (e.flash > 0) e.flash -= dt;
      if (e.boss) { updateBoss(e, dt); continue; }
      const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz) || 0.001;
      // Inimigos que ficaram muito para trás reaparecem por perto
      if (dist > 44) { e.far += dt; if (e.far > 2) { const a = Math.random() * 6.28; const nx = P.x + Math.cos(a) * 24, nz = P.z + Math.sin(a) * 24; const k = cellIdx(nx, nz); if (k >= 0 && EDGE[k] >= 2) { e.x = nx; e.z = nz; e.y = groundUnder(nx, nz, 0.3) + (e.fly ? 2 : 0); e.far = 0; } } }
      if (e.freeze > 0) { e.freeze -= dt; continue; }
      if (e.slowT > 0) e.slowT -= dt;
      let spd = e.speed * slowAll * speedUp * (e.slowT > 0 ? 1 - e.slowF : 1);
      let tx = P.x, tz = P.z;
      if (e.fly) {
        const ty = Math.max(groundUnder(e.x, e.z, 0.3) + 1.2, P.y + 1.1);
        e.y = lerp(e.y, ty, Math.min(1, dt * 2.2));
      } else if (dist > 2.5) {
        const c = cellIdx(e.x, e.z);
        if (c >= 0 && FD[c] > 0 && FNEXT[c] >= 0) { tx = cx(FNEXT[c]); tz = cz(FNEXT[c]); }
      }
      let mx = tx - e.x, mz = tz - e.z; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
      if (e.ranged) {
        if (dist < 7) { mx = -dx / dist; mz = -dz / dist; spd *= 0.8; }
        else if (dist < 12) { mx = -dz / dist * 0.6; mz = dx / dist * 0.6; }
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 18) {
          e.shootCd = rand(2.2, 3.2);
          const sy = e.y + e.h * 0.7, ty = P.y + 0.7, l = Math.hypot(dx, ty - sy, dz) || 1, v = 9;
          const m = bulletPool.get(); m.scale.setScalar(0.38);
          bullets.push({ m, x: e.x, y: sy, z: e.z, vx: dx / l * v, vy: (ty - sy) / l * v, vz: dz / l * v, life: 4, dmg: e.dmg * 1.4 });
        }
      }
      e.vx = lerp(e.vx, mx * spd, Math.min(1, dt * 6));
      e.vz = lerp(e.vz, mz * spd, Math.min(1, dt * 6));
      e.kx *= Math.max(0, 1 - dt * 7); e.kz *= Math.max(0, 1 - dt * 7);
      const fx = (e.vx + e.kx) * dt, fz = (e.vz + e.kz) * dt;
      if (e.fly) { e.x += fx; e.z += fz; }
      else {
        e.bx = false;
        moveEnt(e, fx, fz, e.r * 0.6);
        if (e.bx && e.grounded) {
          const ah = hAt(e.x + mx * (e.r + 0.4), e.z + mz * (e.r + 0.4));
          if (ah - e.y <= 1.15) { e.vy = 8.2; e.grounded = false; }
        }
        e.vy -= GRAV * dt; e.y += e.vy * dt;
        const g = groundUnder(e.x, e.z, e.r * 0.5);
        if (e.y <= g) { e.y = g; e.vy = 0; e.grounded = true; } else if (e.grounded && e.y - g <= STEP + 0.05 && e.vy <= 0) { e.y = g; } else e.grounded = false;
        treePush(e, e.r * 0.6);
      }
      e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
      // Dano por contato
      const dy = (P.y + 0.6) - (e.y + e.h * 0.5);
      if (Math.abs(dy) < e.h * 0.5 + 0.6) { const rr = e.r + PR; if (dx * dx + dz * dz < rr * rr) damagePlayer(e.dmg, e); }
    }
  }
  function separate() {
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i]; if (!a.alive || a.boss) continue;
      const ci = clamp(Math.floor((a.x + HALF) / C), 0, N - 1), cj = clamp(Math.floor((a.z + HALF) / C), 0, N - 1);
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        let idx = HHEAD[nj * N + ni];
        while (idx !== -1 && n < 10) {
          if (idx !== i) {
            const b = enemies[idx];
            if (b.alive && !b.boss && b.fly === a.fly && Math.abs(a.y - b.y) < 1.5) {
              const dx = a.x - b.x, dz = a.z - b.z, rr = (a.r + b.r) * 0.9, d2 = dx * dx + dz * dz;
              if (d2 < rr * rr && d2 > 1e-6) {
                const d = Math.sqrt(d2), push = (rr - d) * 0.5;
                if (a.fly) { a.x += dx / d * push; a.z += dz / d * push; } else moveEnt(a, dx / d * push, dz / d * push, a.r * 0.6);
                n++;
              }
            }
          }
          idx = HNEXT[idx];
        }
      }
    }
  }
  function renderEnemies() {
    const cnt = {};
    for (const k in EMESH) cnt[k] = 0;
    const t = run ? run.time : 0;
    for (const e of enemies) {
      if (!e.alive || e.boss) continue;
      const m = EMESH[e.type], i = cnt[e.type]++;
      if (i >= 420) continue;
      let sx = e.s, sy = e.s, sz = e.s, oy = 0;
      if (e.fly) { sx *= 1 + Math.sin(t * 22 + e.phase) * 0.25; oy = Math.sin(t * 6 + e.phase) * 0.15; }
      else if (e.freeze <= 0) { const q = 1 + Math.sin(t * 10 + e.phase) * 0.07; sy *= q; sx /= Math.sqrt(q); sz /= Math.sqrt(q); }
      dummy.position.set(e.x, e.y + oy, e.z); dummy.rotation.set(0, e.yaw, 0); dummy.scale.set(sx, sy, sz); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (e.flash > 0) _c.setRGB(3, 3, 3); else if (e.freeze > 0) _c.setRGB(0.6, 1.1, 1.9); else if (e.elite) _c.setRGB(1.6, 1.25, 0.45); else _c.setRGB(1, 1, 1);
      m.setColorAt(i, _c);
    }
    for (const k in EMESH) { const m = EMESH[k]; m.count = Math.min(420, cnt[k]); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  // Chefe: o Colosso de Lodo
  let bossRef = null;
  function spawnBoss() {
    run.bossSpawned = true;
    let x = 0, z = 0;
    for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28; x = P.x + Math.cos(a) * 18; z = P.z + Math.sin(a) * 18; const k = cellIdx(x, z); if (k >= 0 && EDGE[k] >= 3) break; }
    const e = spawnEnemy('gosma', { x, z, force: true });
    const hpM = (1 + tEff() / 70) * Math.pow(1.45, run.floor - 1);
    Object.assign(e, { boss: true, hp: 750 * hpM, r: 2.3, h: 3.6, s: 1, dmg: 26 * Math.pow(1.2, run.floor - 1), speed: 2.8, xp: 0, color: 0x3fae8f, state: 'walk', timer: 4, summonT: 8, kbRes: 0 });
    e.maxHp = e.hp; e.y = groundUnder(x, z, 1.5);
    bossRef = e;
    bossMesh.visible = true;
    $('boss').hidden = false; $('bossName').textContent = run.floor > 1 ? `Colosso de Lodo · Andar ${run.floor}` : 'Colosso de Lodo';
    toast('O Colosso de Lodo despertou! Pule as ondas de choque.', 'warn');
    sfx('boss');
    if (!REDUCED) shake = 0.6;
  }
  function updateBoss(e, dt) {
    const dx = P.x - e.x, dz = P.z - e.z, dist = Math.hypot(dx, dz) || 0.001;
    e.timer -= dt; e.summonT -= dt;
    let sq = 1;
    if (e.state === 'walk') {
      const sp = e.speed * (P.relics.ampulheta ? 0.88 : 1) * (e.slowT > 0 ? 0.85 : 1);
      if (e.slowT > 0) e.slowT -= dt;
      e.x += dx / dist * sp * dt; e.z += dz / dist * sp * dt;
      e.x = clamp(e.x, -HALF + 6, HALF - 6); e.z = clamp(e.z, -HALF + 6, HALF - 6);
      const g = groundUnder(e.x, e.z, 1.6);
      if (g > e.y) e.y = lerp(e.y, g, Math.min(1, dt * 6)); else { e.vy -= GRAV * dt; e.y += e.vy * dt; if (e.y <= g) { e.y = g; e.vy = 0; } }
      sq = 1 + Math.sin(run.time * 6) * 0.05;
      if (e.timer <= 0 && dist < 28) { e.state = 'crouch'; e.st = 0.75; }
    } else if (e.state === 'crouch') {
      e.st -= dt; sq = 0.75;
      if (e.st <= 0) {
        const TT = 1.05, tx = P.x, tz = P.z, gy = groundUnder(tx, tz, 1.6);
        e.vx = (tx - e.x) / TT; e.vz = (tz - e.z) / TT; e.vy = (gy - e.y) / TT + 0.5 * GRAV * TT;
        e.state = 'air'; ringFx(tx, gy, tz, 3.2, 3.2, TT, 0xff4f6e, 0.5);
      }
    } else if (e.state === 'air') {
      sq = 1.15;
      e.x += e.vx * dt; e.z += e.vz * dt; e.vy -= GRAV * dt; e.y += e.vy * dt;
      const g = groundUnder(e.x, e.z, 1.6);
      if (e.vy < 0 && e.y <= g) {
        e.y = g; e.state = 'walk'; e.timer = rand(4.5, 6.5); e.vy = 0;
        const m = ringPool.get(); m.material.color.setHex(0xff6a3d); m.material.opacity = 0.9; m.position.set(e.x, e.y + 0.15, e.z);
        waves.push({ x: e.x, y: e.y, z: e.z, r: 1, max: 15, spd: 13, hit: false, m });
        burst(e.x, e.y + 0.3, e.z, 0x9b8a6a, 30, 9, 0.7, 0.35);
        sfx('stomp'); if (!REDUCED) shake = Math.min(0.8, shake + 0.5);
        if (Math.hypot(P.x - e.x, P.z - e.z) < e.r + 1 && Math.abs(P.y - e.y) < 2) damagePlayer(e.dmg * 1.4, e);
      }
    }
    if (e.summonT <= 0) {
      e.summonT = 9;
      for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28; const s = spawnEnemy('gosma', { x: e.x + Math.cos(a) * 3.5, z: e.z + Math.sin(a) * 3.5, force: true }); if (s) s.y = groundUnder(s.x, s.z, 0.3); }
    }
    e.yaw = angLerp(e.yaw, Math.atan2(dx, dz), Math.min(1, dt * 3));
    if (e.state !== 'air') { const dy = (P.y + 0.6) - (e.y + e.h * 0.5); if (Math.abs(dy) < e.h * 0.5 + 0.6 && dist < e.r + PR) damagePlayer(e.dmg, e); }
    bossMesh.position.set(e.x, e.y, e.z); bossMesh.rotation.y = e.yaw;
    bossMesh.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
  }
  function onBossDead(e) {
    run.bossKills++;
    bossMesh.visible = false; bossRef = null; $('boss').hidden = true;
    burst(e.x, e.y + 2, e.z, 0x3fae8f, 60, 12, 1, 0.45);
    burst(e.x, e.y + 2, e.z, 0xffc845, 30, 10, 1, 0.3);
    for (let i = 0; i < 12; i++) drop(0, e.x + rand(-2, 2), e.y + 1, e.z + rand(-2, 2), 8 * run.floor);
    for (let i = 0; i < 20; i++) drop(1, e.x + rand(-2, 2), e.y + 1, e.z + rand(-2, 2), 1);
    drop(4, e.x, e.y + 1, e.z, 10);
    spawnChest(e.x + 2, e.z, true);
    let px = e.x - 3, pz = e.z;
    if (EDGE[cellIdx(px, pz)] < 3) { px = 0; pz = 0; }
    spawnPortal(px, pz);
    toast('Colosso derrotado! Entre no portal para descer ao próximo andar.', 'good');
    sfx('portal'); if (!REDUCED) shake = 0.8;
  }

  // =====================================================================
  // Armas
  // =====================================================================
  const lv = (w, arr) => arr[w.level - 1];
  function makeWeapon(id) { return { id, level: 1, t: 0.4, angle: 0, meshes: [] }; }
  function disposeWeapon(w) { for (const m of w.meshes) scene.remove(m); if (w.mesh) scene.remove(w.mesh); if (w.ring) scene.remove(w.ring); }
  const bladeMat = new T.MeshBasicMaterial({ color: 0xffffff });
  const auraMat = beamMat(0xff9b3d, 0.18), auraRingMat = beamMat(0xffd27a, 0.6);
  const WFN = {
    orbital(w, dt) {
      const cnt = lv(w, [3, 4, 4, 5, 5]) + P.stats.proj, R = 2.5 * (w.level >= 5 ? 1.35 : 1) * P.stats.area;
      const spin = (w.level >= 4 ? 3.8 : 2.8) * Math.sqrt(P.stats.haste), dmg = 15 * (w.level >= 3 ? 1.3 : 1) * (w.level >= 5 ? 1.4 : 1);
      w.angle += spin * dt;
      while (w.meshes.length < cnt) { const m = new T.Mesh(GEO.blade, bladeMat); m.scale.set(0.9, 0.16, 0.42); scene.add(m); w.meshes.push(m); }
      for (let k = 0; k < w.meshes.length; k++) {
        const m = w.meshes[k];
        if (k >= cnt) { m.visible = false; continue; }
        m.visible = true;
        const a = w.angle + k * Math.PI * 2 / cnt, bx = P.x + Math.cos(a) * R, bz = P.z + Math.sin(a) * R, by = P.y + 0.75;
        m.position.set(bx, by, bz); m.rotation.set(0, -a, 0);
        forNear(bx, bz, 0.6, (e) => {
          if (Math.abs((e.y + e.h * 0.5) - by) > e.h * 0.5 + 0.7) return;
          if (hitReady(e, 'orb', 0.3)) dealDamage(e, dmg, 'orbital', Math.cos(a) * 4, Math.sin(a) * 4);
        });
      }
    },
    dardo(w, dt) {
      w.t -= dt; if (w.t > 0) return;
      const cnt = lv(w, [1, 2, 2, 2, 3]) + P.stats.proj;
      const targets = nearestN(P.x, P.y + 0.8, P.z, cnt, 22);
      if (!targets.length) { w.t = 0.15; return; }
      w.t = 1.05 * (w.level >= 5 ? 0.8 : 1) / P.stats.haste;
      for (let k = 0; k < cnt; k++) {
        const tg = targets[k % targets.length], m = dartPool.get();
        m.scale.set(0.22, 0.22, 0.75);
        const sx = P.x, sy = P.y + 1.0, sz = P.z;
        const dx = tg.x - sx + rand(-1, 1), dy = (tg.y + tg.h * 0.5) - sy, dz = tg.z - sz + rand(-1, 1), l = Math.hypot(dx, dy, dz) || 1;
        darts.push({ m, x: sx, y: sy, z: sz, vx: dx / l * 22, vy: dy / l * 22 + 2, vz: dz / l * 22, tg, life: 1.8, pierce: w.level >= 3 ? 1 : 0, dmg: 19 * (w.level >= 4 ? 1.35 : 1), hit: new Set() });
      }
      sfx('dart');
    },
    arco(w, dt) {
      w.t -= dt; if (w.t > 0) return;
      const jumps = lv(w, [3, 5, 5, 5, 8]) + P.stats.proj * 2, dmg = 21 * (w.level >= 3 ? 1.3 : 1) * (w.level >= 5 ? 1.3 : 1), range = 7.5 * P.stats.area;
      const first = nearestN(P.x, P.y + 0.8, P.z, 1, 12)[0];
      if (!first) { w.t = 0.2; return; }
      w.t = 1.75 * (w.level >= 4 ? 0.75 : 1) / P.stats.haste;
      let px = P.x, py = P.y + 1.1, pz = P.z, cur = first;
      const hit = new Set();
      for (let j = 0; j < jumps && cur; j++) {
        hit.add(cur);
        const cy = cur.y + cur.h * 0.6;
        bolt(px, py, pz, cur.x, cy, cur.z, 0xfff38a);
        dealDamage(cur, dmg, 'arco');
        px = cur.x; py = cy; pz = cur.z;
        let best = null, bd = range * range;
        forNear(px, pz, range, (e) => { if (hit.has(e)) return; const d = (e.x - px) ** 2 + (e.z - pz) ** 2; if (d < bd) { bd = d; best = e; } });
        cur = best;
      }
      sfx('zap');
    },
    aura(w, dt) {
      const R = 2.7 * lv(w, [1, 1.2, 1.2, 1.44, 1.44]) * P.stats.area, dmg = 7 * (w.level >= 3 ? 1.4 : 1) * (w.level >= 5 ? 1.6 : 1), slow = w.level >= 4 ? 0.45 : 0.28;
      if (!w.mesh) { w.mesh = new T.Mesh(GEO.disc, auraMat); w.ring = new T.Mesh(GEO.ring, auraRingMat); scene.add(w.mesh, w.ring); }
      const gy = groundUnder(P.x, P.z, 0.3);
      w.mesh.position.set(P.x, gy + 0.06, P.z); w.mesh.scale.setScalar(R);
      w.ring.position.set(P.x, gy + 0.07, P.z); w.ring.scale.setScalar(R);
      auraMat.opacity = 0.14 + Math.sin(run.time * 4) * 0.04;
      w.t -= dt; if (w.t > 0) return;
      w.t = 0.42 / P.stats.haste;
      forNear(P.x, P.z, R, (e) => { if (Math.abs(e.y - P.y) > 2.2) return; e.slowT = 0.6; e.slowF = slow; dealDamage(e, dmg, 'aura'); });
    },
    meteoro(w, dt) {
      w.t -= dt; if (w.t > 0) return;
      const cnt = lv(w, [1, 2, 2, 2, 4]) + P.stats.proj, R = 2.5 * (w.level >= 3 ? 1.3 : 1) * P.stats.area, dmg = 48 * (w.level >= 4 ? 1.4 : 1);
      const cand = enemies.filter((e) => e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 17);
      if (!cand.length) { w.t = 0.3; return; }
      w.t = 2.7 / P.stats.haste;
      for (let k = 0; k < cnt; k++) {
        const e = pick(cand), tx = e.x + rand(-0.8, 0.8), tz = e.z + rand(-0.8, 0.8), ty = groundUnder(tx, tz, 0.3);
        const m = meteorPool.get(); m.scale.setScalar(0.9);
        ringFx(tx, ty, tz, R, R, 0.7 + k * 0.15, 0xff6a3d, 0.45);
        meteors.push({ m, tx, ty, tz, t: -k * 0.15, dur: 0.7, R, dmg });
      }
    },
    bumerangue(w, dt) {
      w.t -= dt; if (w.t > 0) return;
      const cnt = lv(w, [1, 1, 2, 2, 3]) + P.stats.proj, dmg = 15 * (w.level >= 2 ? 1.3 : 1) * (w.level >= 5 ? 1.4 : 1);
      const range = (w.level >= 4 ? 13 : 9.5) * Math.sqrt(P.stats.area), spd = w.level >= 4 ? 21 : 17;
      const tg = nearestN(P.x, P.y, P.z, 1, 22)[0];
      const ang = tg ? Math.atan2(tg.x - P.x, tg.z - P.z) : P.facing;
      w.t = 1.55 / P.stats.haste;
      for (let k = 0; k < cnt; k++) {
        const a = ang + (k - (cnt - 1) / 2) * 0.45, m = boomPool.get();
        boomers.push({ m, x: P.x, y: P.y + 1, z: P.z, dx: Math.sin(a), dz: Math.cos(a), dist: 0, range, spd, dmg, back: false, key: 'bm' + Math.random() });
      }
      sfx('throw');
    },
    impacto(w, dt) {
      if (w.level >= 4) { w.t -= dt; if (w.t <= 0 && P.grounded) { w.t = 4 / P.stats.haste; stomp(w, 0.5); } }
    },
  };
  function stomp(w, fall) {
    const f = Math.min(fall, 7);
    const R = 3.3 * lv(w, [1, 1.3, 1.3, 1.3, 1.95]) * P.stats.area * (1 + f * 0.08);
    const dmg = 26 * (w.level >= 3 ? 1.4 : 1) * (w.level >= 5 ? 1.5 : 1) * (1 + f * 0.3);
    ringFx(P.x, P.y, P.z, 0.5, R, 0.35, 0xffd27a, 0.9);
    burst(P.x, P.y + 0.2, P.z, 0xb59a7a, 14, 7, 0.5, 0.25);
    sfx('stomp'); if (!REDUCED) shake = Math.min(0.5, shake + 0.15 + f * 0.04);
    forNear(P.x, P.z, R, (e) => {
      if (Math.abs(e.y - P.y) > 1.8) return;
      const dx = e.x - P.x, dz = e.z - P.z, d = Math.hypot(dx, dz) || 1;
      dealDamage(e, dmg, 'impacto', dx / d * 10, dz / d * 10);
      if (!e.fly && !e.boss && e.alive) { e.vy = 5; e.grounded = false; }
    });
  }
  function onLand(fall, air) {
    if (fall > 1.2) burst(P.x, P.y + 0.1, P.z, 0xd8c8a8, 6, 3, 0.35, 0.18);
    const w = P.weapons.find((x) => x.id === 'impacto');
    if (w && air > 0.28 && P.stompCd <= 0) { P.stompCd = 0.3; stomp(w, fall); }
  }

  function updateProjectiles(dt) {
    for (let i = darts.length - 1; i >= 0; i--) {
      const d = darts[i];
      if (d.tg && d.tg.alive) {
        const dx = d.tg.x - d.x, dy = (d.tg.y + d.tg.h * 0.5) - d.y, dz = d.tg.z - d.z, l = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, dt * 7);
        d.vx = lerp(d.vx, dx / l * 22, k); d.vy = lerp(d.vy, dy / l * 22, k); d.vz = lerp(d.vz, dz / l * 22, k);
      }
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.life -= dt;
      let dead = d.life <= 0;
      if (!dead && d.y < hAt(d.x, d.z)) { dead = true; burst(d.x, d.y, d.z, 0xbfefff, 4, 3, 0.25, 0.12); }
      if (!dead) forNear(d.x, d.z, 0.35, (e) => {
        if (dead || d.hit.has(e) || Math.abs(e.y + e.h * 0.5 - d.y) > e.h * 0.5 + 0.4) return;
        d.hit.add(e); dealDamage(e, d.dmg, 'dardo', d.vx * 0.12, d.vz * 0.12);
        if (d.pierce-- <= 0) dead = true;
      });
      if (dead) { dartPool.put(d.m); darts.splice(i, 1); continue; }
      d.m.position.set(d.x, d.y, d.z); d.m.lookAt(d.x + d.vx, d.y + d.vy, d.z + d.vz);
    }
    for (let i = boomers.length - 1; i >= 0; i--) {
      const b = boomers[i];
      if (!b.back) { b.x += b.dx * b.spd * dt; b.z += b.dz * b.spd * dt; b.dist += b.spd * dt; if (b.dist >= b.range) b.back = true; }
      else {
        const dx = P.x - b.x, dz = P.z - b.z, l = Math.hypot(dx, dz) || 1;
        b.x += dx / l * b.spd * 1.15 * dt; b.z += dz / l * b.spd * 1.15 * dt;
        if (l < 0.9) { boomPool.put(b.m); boomers.splice(i, 1); continue; }
      }
      b.y = lerp(b.y, P.y + 1, Math.min(1, dt * 4));
      forNear(b.x, b.z, 0.75, (e) => { if (Math.abs(e.y + e.h * 0.5 - b.y) > e.h * 0.5 + 0.8) return; if (hitReady(e, b.key, 0.3)) dealDamage(e, b.dmg, 'bumerangue', b.dx * 3, b.dz * 3); });
      b.m.position.set(b.x, b.y, b.z); b.m.rotation.y += dt * 18;
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.t += dt;
      if (m.t < 0) { m.m.visible = false; continue; }
      m.m.visible = true;
      const k = Math.min(1, m.t / m.dur);
      m.m.position.set(m.tx + (1 - k) * 5, m.ty + (1 - k) * 16, m.tz - (1 - k) * 3);
      if (Math.random() < 0.6) burst(m.m.position.x, m.m.position.y, m.m.position.z, 0xffb547, 1, 1, 0.3, 0.25, 0);
      if (k >= 1) {
        meteorPool.put(m.m); meteors.splice(i, 1);
        ringFx(m.tx, m.ty, m.tz, 0.5, m.R, 0.3, 0xffb547, 0.9);
        burst(m.tx, m.ty + 0.3, m.tz, 0xff8a3d, 16, 8, 0.5, 0.3);
        sfx('boom'); if (!REDUCED) shake = Math.min(0.5, shake + 0.08);
        forNear(m.tx, m.tz, m.R, (e) => { if (Math.abs(e.y - m.ty) > m.R + 1) return; const dx = e.x - m.tx, dz = e.z - m.tz, d = Math.hypot(dx, dz) || 1; dealDamage(e, m.dmg, 'meteoro', dx / d * 6, dz / d * 6); });
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
      let dead = b.life <= 0 || b.y < hAt(b.x, b.z);
      if (!dead) {
        const dx = P.x - b.x, dy = P.y + 0.7 - b.y, dz = P.z - b.z;
        if (dx * dx + dy * dy + dz * dz < 0.55) { damagePlayer(b.dmg, null); dead = true; }
      }
      if (dead) { bulletPool.put(b.m); bullets.splice(i, 1); continue; }
      b.m.position.set(b.x, b.y, b.z);
    }
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.r += w.spd * dt;
      w.m.scale.setScalar(w.r); w.m.material.opacity = 0.9 * (1 - w.r / w.max);
      const d = Math.hypot(P.x - w.x, P.z - w.z);
      if (!w.hit && Math.abs(d - w.r) < 0.9 && P.y - w.y < 0.6 && P.y >= w.y - 1.5) { w.hit = true; damagePlayer(bossRef ? bossRef.dmg * 0.8 : 20, null); }
      if (w.r >= w.max) { ringPool.put(w.m); waves.splice(i, 1); }
    }
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      f.t += dt;
      const k = f.t / f.dur;
      if (k >= 1) { f.pool.put(f.m); effects.splice(i, 1); continue; }
      if (!f.seg) f.m.scale.setScalar(Math.max(0.01, lerp(f.r0, f.r1, 1 - Math.pow(1 - k, 2))));
      f.m.material.opacity = f.op * (1 - k);
    }
    if (pendingBooms.length) {
      const list = pendingBooms; pendingBooms = [];
      for (const [x, y, z] of list) {
        ringFx(x, y, z, 0.4, 2.8, 0.3, 0xff8a3d, 0.9); burst(x, y + 0.4, z, 0xff8a3d, 10, 7, 0.4, 0.25); sfx('boom');
        forNear(x, z, 2.8, (e) => { if (Math.abs(e.y - y) < 2.5) dealDamage(e, 30, 'polvora'); });
      }
    }
  }

  // =====================================================================
  // Coletáveis
  // =====================================================================
  function updatePickups(dt) {
    const mag = P.stats.magnet;
    let nx = 0, nc = 0, nm = 0;
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      const dx = P.x - p.x, dy = (P.y + 0.7) - p.y, dz = P.z - p.z, d = Math.hypot(dx, dy, dz);
      if (!p.attract && d < mag) p.attract = true;
      if (p.attract) {
        p.sp = Math.min(28, p.sp + dt * 40);
        const s = Math.min(d, p.sp * dt) / (d || 1);
        p.x += dx * s; p.y += dy * s; p.z += dz * s;
        if (d < 0.7) { collect(p); pickups.splice(i, 1); continue; }
      } else {
        p.vy -= GRAV * 0.7 * dt; p.y += p.vy * dt;
        const g = hAt(p.x, p.z) + 0.35;
        if (p.y < g) { p.y = g; p.vy = 0; }
      }
      const bob = p.attract ? 0 : Math.sin(p.t * 3) * 0.1;
      if (p.k === 0) {
        if (nx >= 700) continue;
        dummy.position.set(p.x, p.y + bob, p.z); dummy.rotation.set(0, p.t * 2, 0);
        const tier = p.v >= 25 ? 3 : p.v >= 8 ? 2 : p.v >= 3 ? 1 : 0, s = 1 + tier * 0.3;
        dummy.scale.set(s, s * 1.3, s); dummy.updateMatrix();
        PK_XP.setMatrixAt(nx, dummy.matrix); _c.setHex(XP_COL[tier]); PK_XP.setColorAt(nx, _c); nx++;
      } else if (p.k === 1) {
        if (nc >= 300) continue;
        dummy.position.set(p.x, p.y + bob, p.z); dummy.rotation.set(Math.PI / 2, 0, p.t * 4); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        PK_COIN.setMatrixAt(nc++, dummy.matrix);
      } else {
        if (nm >= 60) continue;
        dummy.position.set(p.x, p.y + bob + 0.15, p.z); dummy.rotation.set(p.t, p.t * 2, 0); const s = p.k === 4 ? 0.8 : 1.1; dummy.scale.set(s, p.k === 4 ? s * 1.6 : s, s); dummy.updateMatrix();
        PK_MISC.setMatrixAt(nm, dummy.matrix); _c.setHex(MISC_COL[p.k]); PK_MISC.setColorAt(nm, _c); nm++;
      }
    }
    PK_XP.count = nx; PK_COIN.count = nc; PK_MISC.count = nm;
    for (const m of [PK_XP, PK_COIN, PK_MISC]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  function collect(p) {
    switch (p.k) {
      case 0: addXP(p.v); sfx('xp'); break;
      case 1: { const v = p.v * P.stats.goldGain; P.coins += Math.floor(v) + (Math.random() < v % 1 ? 1 : 0); sfx('coin'); break; }
      case 2: P.hp = Math.min(P.stats.maxHp, P.hp + 25); addText(P.x, P.y + 2, '+25', '#ff7f96'); sfx('heal'); break;
      case 3: for (const q of pickups) if (q.k === 0) q.attract = true; toast('Ímã! Todos os cristais vêm até você.'); sfx('heal'); break;
      case 4: run.shards += p.v; sfx('coin'); break;
    }
  }
  function addXP(v) {
    P.xp += v * P.stats.xpGain;
    while (P.xp >= P.xpNext) { P.xp -= P.xpNext; P.level++; P.xpNext = xpNeed(P.level); pendingLevels++; }
  }

  // =====================================================================
  // Melhorias, baús e altares
  // =====================================================================
  let pendingLevels = 0, modal = null;
  function rollRarity(min) {
    const L = P.stats.luck, r = Math.random() * 100;
    let v = r < 2 + L * 0.25 ? 3 : r < 9 + L * 0.6 ? 2 : r < 28 + L ? 1 : 0;
    return Math.max(v, min || 0);
  }
  function runeChoice(rune, minR) {
    const r = rune.fixed ? 1 : rollRarity(minR);
    let v = rune.base * RARITY[r].mult;
    if (rune.round) v = Math.max(1, Math.round(v));
    return { kind: 'rune', id: rune.id, rarity: r, value: v, icon: rune.icon, title: rune.name, tag: rune.fixed ? 'Especial' : RARITY[r].name, desc: rune.fmt(v), color: rune.fixed ? '#ff9b3d' : RARITY[r].color };
  }
  function buildChoices(n, mode) {
    const pool = [];
    if (mode !== 'altar') {
      for (const w of P.weapons) if (w.level < 5) pool.push({ w: 3, make: () => ({ kind: 'wup', id: w.id, icon: WEAPONS[w.id].icon, title: WEAPONS[w.id].name, tag: `Nível ${w.level + 1}`, desc: WEAPONS[w.id].up[w.level], color: '#ffd27a' }) });
      if (P.weapons.length < MAX_WEAPONS) for (const id in WEAPONS) if (!P.weapons.find((w) => w.id === id)) pool.push({ w: 1.6, make: () => ({ kind: 'wnew', id, icon: WEAPONS[id].icon, title: WEAPONS[id].name, tag: 'Nova arma', desc: WEAPONS[id].desc, color: '#58e1c1' }) });
    }
    for (const r of RUNES) if (!r.max || (P.runes[r.id] || 0) < r.max) pool.push({ w: r.fixed ? 0.6 : 2, make: () => runeChoice(r, mode === 'altar' ? 1 : 0) });
    const out = [];
    while (out.length < n && pool.length) {
      let tot = 0; for (const p of pool) tot += p.w;
      let x = Math.random() * tot, i = 0;
      for (; i < pool.length - 1; i++) { x -= pool[i].w; if (x <= 0) break; }
      out.push(pool[i].make()); pool.splice(i, 1);
    }
    return out;
  }
  function relicChoices() {
    const avail = shuffle(RELICS.filter((r) => !P.relics[r.id])).slice(0, 3);
    if (!avail.length) return [{ kind: 'gift', icon: '●', title: 'Saco de moedas', tag: 'Prêmio', desc: '+40 moedas e cura total', color: '#ffd04a' }];
    return avail.map((r) => ({ kind: 'relic', id: r.id, icon: r.icon, title: r.name, tag: ['Relíquia', 'Relíquia rara', 'Relíquia épica'][r.r], desc: r.desc, color: RARITY[r.r].color }));
  }
  function openModal(kind) {
    state = kind; releasePointer();
    const n = 3 + (P.relics.mochila && kind === 'levelup' ? 1 : 0);
    modal = { kind, choices: kind === 'chest' ? relicChoices() : buildChoices(n, kind === 'altar' ? 'altar' : '') };
    renderModal();
    $('modal').hidden = false;
    const first = $('mChoices').querySelector('button'); if (first && !IS_TOUCH) first.focus({ preventScroll: true });
  }
  function renderModal() {
    const k = modal.kind;
    $('mEyebrow').textContent = k === 'levelup' ? (pendingLevels > 1 ? `Nível ${P.level - pendingLevels + 1} · mais ${pendingLevels - 1} na fila` : `Nível ${P.level}`) : k === 'chest' ? 'Baú aberto' : 'Altar das Runas';
    $('mTitle').textContent = k === 'chest' ? 'Escolha uma relíquia' : k === 'altar' ? 'Escolha uma runa abençoada' : 'Escolha uma melhoria';
    $('mChoices').innerHTML = modal.choices.map((c, i) => `
      <button class="choice" data-i="${i}" style="--rc:${c.color}">
        <span class="key">${i + 1}</span><span class="ico" aria-hidden="true">${c.icon}</span>
        <span class="ctitle">${c.title}</span><span class="tag">${c.tag}</span><span class="cdesc">${c.desc}</span>
      </button>`).join('');
    const rr = $('mReroll');
    rr.hidden = k === 'chest';
    rr.textContent = `Sortear de novo (${run.rerolls})`; rr.disabled = run.rerolls <= 0;
    $('mSkip').textContent = k === 'levelup' ? 'Pular (+5 moedas)' : 'Deixar para lá';
  }
  $('mChoices').addEventListener('click', (e) => { const b = e.target.closest('.choice'); if (b) chooseOption(+b.dataset.i); });
  $('mReroll').addEventListener('click', reroll);
  $('mSkip').addEventListener('click', () => { if (!modal) return; if (modal.kind === 'levelup') { P.coins += 5; pendingLevels--; } afterChoice(); });
  function reroll() {
    if (!modal || modal.kind === 'chest' || run.rerolls <= 0) return;
    run.rerolls--; sfx('ui');
    modal.choices = buildChoices(modal.choices.length, modal.kind === 'altar' ? 'altar' : '');
    renderModal();
  }
  function chooseOption(i) {
    if (!modal || !modal.choices[i]) return;
    const c = modal.choices[i];
    sfx('ui');
    if (c.kind === 'wnew') { P.weapons.push(makeWeapon(c.id)); }
    else if (c.kind === 'wup') { const w = P.weapons.find((x) => x.id === c.id); w.level++; if (w.level >= 5) run.maxed = true; }
    else if (c.kind === 'rune') { const r = RUNES.find((x) => x.id === c.id); r.apply(P.stats, c.value, P); P.runes[c.id] = (P.runes[c.id] || 0) + 1; if (c.rarity === 3) run.legend = true; }
    else if (c.kind === 'relic') { const r = RELIC_BY_ID[c.id]; P.relics[c.id] = true; P.relicList.push(c.id); if (r.apply) r.apply(P); }
    else if (c.kind === 'gift') { P.coins += 40; P.hp = P.stats.maxHp; }
    if (modal.kind === 'levelup') pendingLevels--;
    afterChoice();
  }
  function afterChoice() {
    if (modal && modal.kind === 'levelup' && pendingLevels > 0) {
      modal.choices = buildChoices(3 + (P.relics.mochila ? 1 : 0), ''); renderModal(); return;
    }
    modal = null; $('modal').hidden = true; state = 'play';
    if (!IS_TOUCH) lockPointer();
  }

  function updateInteract(dt) {
    let near = null, nd = 99;
    for (const c of world.chests) {
      if (c.opened) { if (c.open < 1) { c.open = Math.min(1, c.open + dt * 3); c.lid.rotation.x = -c.open * 1.9; } continue; }
      c.beam.material.opacity = (c.gold ? 0.3 : 0.18) + Math.sin(run.time * 3) * 0.05;
      const d = Math.hypot(P.x - c.x, P.z - c.z);
      if (d < 2.4 && Math.abs(P.y - c.y) < 1.6 && d < nd) { near = c; nd = d; }
    }
    const pr = $('prompt'), act = $('tAct');
    if (near) {
      const cost = chestCost(near);
      const can = P.coins >= cost;
      const text = near.gold ? 'Abrir baú dourado (grátis)' : `Abrir baú · ${cost} moedas`;
      pr.innerHTML = `${IS_TOUCH ? '' : '<kbd>E</kbd> '}${text}${can ? '' : ' <span class="lack">— faltam ' + (cost - P.coins) + '</span>'}`;
      pr.hidden = false; act.hidden = false; act.textContent = near.gold ? 'Abrir' : `Abrir · ${cost}`;
      if (actPressed) {
        if (can) {
          P.coins -= cost; near.opened = true; near.beam.visible = false; run.chests++; if (!near.gold) run.chestsBought++;
          burst(near.x, near.y + 0.8, near.z, 0xffd04a, 20, 6, 0.6, 0.22); sfx('chest');
          openModal('chest');
        } else { sfx('deny'); toast(`Você precisa de ${cost} moedas. Tem ${P.coins}.`); }
      }
    } else { pr.hidden = true; act.hidden = true; }
    actPressed = false;

    for (const a of world.altars) {
      a.rune.rotation.y += dt * 1.5; a.rune.position.y = 1.9 + Math.sin(run.time * 2) * 0.12;
      if (a.used) continue;
      const d = Math.hypot(P.x - a.x, P.z - a.z);
      if (d < 2.4 && Math.abs(P.y - a.y) < 1.5) {
        a.charge = Math.min(1, a.charge + dt / 2.6);
        if (a.charge >= 1) {
          a.used = true; a.beam.visible = false; a.ring.material.opacity = 0.15; a.rune.material.color.setHex(0x55606a); a.fill.scale.setScalar(0.001);
          run.altars++; sfx('altar'); burst(a.x, a.y + 1.5, a.z, 0x7fe3ff, 24, 6, 0.7, 0.22);
          openModal('altar');
          return;
        }
      } else a.charge = Math.max(0, a.charge - dt / 4);
      a.fill.scale.setScalar(Math.max(0.001, a.charge * 2.4));
    }
    const po = world.portal;
    if (po) {
      po.ring.rotation.y += dt * 1.2; po.inner.rotation.y = po.ring.rotation.y; po.inner.material.opacity = 0.45 + Math.sin(run.time * 5) * 0.15;
      if (Math.hypot(P.x - po.x, P.z - po.z) < 1.8 && Math.abs(P.y - po.y) < 2.5) nextFloor();
    }
  }
  function chestCost(c) { return c.gold ? 0 : Math.round(10 * Math.pow(1.5, run.chestsBought) * (P.relics.bussola ? 0.85 : 1)); }

  // =====================================================================
  // Diretor: ondas, elites, chefes
  // =====================================================================
  let spawnAcc = 0;
  function chooseType(t) {
    const opts = [['gosma', 5]];
    if (t > 30) opts.push(['corredor', 4]);
    if (t > 65) opts.push(['morcego', 3]);
    if (t > 100) opts.push(['atirador', 1.8]);
    if (t > 140) opts.push(['bruto', 1.4]);
    let tot = 0; for (const o of opts) tot += o[1];
    let x = Math.random() * tot;
    for (const o of opts) { x -= o[1]; if (x <= 0) return o[0]; }
    return 'gosma';
  }
  function director(dt) {
    const t = tEff();
    const rate = Math.min(15, 0.7 + t * 0.036) * (bossRef ? 0.45 : 1);
    spawnAcc += rate * dt;
    while (spawnAcc >= 1) { spawnAcc -= 1; spawnEnemy(chooseType(t)); }
    if (run.stageTime >= run.nextElite) {
      run.nextElite += 55;
      if (spawnEnemy(chooseType(t), { elite: true, force: true })) toast('Uma elite dourada apareceu. Derrote-a para ganhar um baú grátis.', 'warn');
    }
    if (run.stageTime >= run.nextSwarm) {
      run.nextSwarm += 75;
      const type = run.stageTime > 120 ? 'morcego' : 'corredor';
      for (let i = 0; i < 22; i++) { const a = i / 22 * 6.28, x = P.x + Math.cos(a) * 17, z = P.z + Math.sin(a) * 17, k = cellIdx(x, z); if (k >= 0 && EDGE[k] >= 2) spawnEnemy(type, { x, z, force: true }); }
      toast('Enxame! Abra caminho.', 'warn');
    }
    if (!run.bossWarned && run.stageTime >= BOSS_TIME - 15) { run.bossWarned = true; toast('O chão treme. Algo grande desperta em 15 segundos.', 'warn'); }
    if (!run.bossSpawned && run.stageTime >= BOSS_TIME) spawnBoss();
  }

  // =====================================================================
  // Jogador: movimento, pulo, deslize
  // =====================================================================
  function updatePlayer(dt) {
    const s = P.stats;
    let ix = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + joy.x;
    let iz = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0) + joy.y;
    const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
    if (keys.ArrowLeft) camYaw += dt * 2.4 * SAVE.settings.sens;
    if (keys.ArrowRight) camYaw -= dt * 2.4 * SAVE.settings.sens;
    if (keys.ArrowUp) camPitch = clamp(camPitch - dt * 1.2, -0.15, 1.25);
    if (keys.ArrowDown) camPitch = clamp(camPitch + dt * 1.2, -0.15, 1.25);
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const wx = rx * ix - fx * iz, wz = rz * ix - fz * iz, wl = Math.hypot(wx, wz);
    const speed = BASE_SPEED * s.speed;

    P.slideCdT -= dt; P.iframes -= dt; P.stompCd -= dt;
    if (slidePressed && P.slideCdT <= 0 && (P.grounded || P.airTime < 0.15)) {
      P.slideT = 0.5; P.slideCdT = s.slideCd;
      const dx = wl > 0.1 ? wx / wl : Math.sin(P.facing), dz = wl > 0.1 ? wz / wl : Math.cos(P.facing);
      P.vx = dx * speed * 2.3; P.vz = dz * speed * 2.3;
      sfx('slide'); burst(P.x, P.y + 0.1, P.z, 0xd8c8a8, 6, 3, 0.3, 0.16);
    }
    slidePressed = false;
    if (P.slideT > 0) {
      P.slideT -= dt;
      const f = Math.max(0, 1 - dt * 1.6); P.vx *= f; P.vz *= f;
      if (wl > 0.1) { P.vx += wx * speed * dt * 2; P.vz += wz * speed * dt * 2; }
      if (P.grounded && Math.random() < 0.5) burst(P.x, P.y + 0.05, P.z, 0xd8c8a8, 1, 2, 0.25, 0.12);
    } else {
      const tx = wx * speed, tz = wz * speed, acc = (P.grounded ? 55 : 16) * dt;
      const dx = tx - P.vx, dz = tz - P.vz, dl = Math.hypot(dx, dz);
      if (dl <= acc) { P.vx = tx; P.vz = tz; } else { P.vx += dx / dl * acc; P.vz += dz / dl * acc; }
    }
    if (jumpPressed) {
      const jv = JUMP_V * Math.sqrt(s.jumpMult);
      if (P.grounded || P.coyote > 0) {
        P.vy = jv; P.grounded = false; P.coyote = 0; P.jumpsUsed = 0; P.peakY = P.y;
        if (P.slideT > 0) { P.vx *= 1.12; P.vz *= 1.12; P.slideT = 0; }
        sfx('jump');
      } else if (P.jumpsUsed < s.jumps) {
        P.jumpsUsed++; P.vy = jv * 0.95; sfx('jump');
        burst(P.x, P.y + 0.2, P.z, P.ch.color, 8, 4, 0.35, 0.16);
      }
    }
    jumpPressed = false;
    P.vy -= GRAV * dt;
    if (P.relics.pena && jumpHeld && P.vy < -2.2 && !P.grounded) P.vy = -2.2;

    const wasG = P.grounded;
    if (P.vx) { const nx = P.x + P.vx * dt; if (!blocked(nx, P.z, P.y, PR)) P.x = nx; else P.vx = 0; }
    if (P.vz) { const nz = P.z + P.vz * dt; if (!blocked(P.x, nz, P.y, PR)) P.z = nz; else P.vz = 0; }
    treePush(P, PR);
    P.y += P.vy * dt;
    const g = groundUnder(P.x, P.z, PR);
    if (P.y <= g) {
      if (!wasG) { onLand(P.peakY - g, P.airTime); }
      P.y = g; P.vy = 0; P.grounded = true; P.airTime = 0; P.jumpsUsed = 0;
    } else if (wasG && P.vy <= 0 && P.y - g <= STEP + 0.05) { P.y = g; P.vy = 0; P.grounded = true; }
    else {
      if (wasG) { P.coyote = 0.1; P.peakY = P.y; }
      P.grounded = false; P.airTime += dt; P.coyote -= dt; if (P.y > P.peakY) P.peakY = P.y;
    }
    if (P.grounded && P.y > run.maxHeight) run.maxHeight = P.y;
    const hs = Math.hypot(P.vx, P.vz);
    if (hs > 0.5) P.facing = angLerp(P.facing, Math.atan2(P.vx, P.vz), Math.min(1, dt * 12));

    // Regeneração e relíquias periódicas
    if (s.regen > 0) P.hp = Math.min(s.maxHp, P.hp + s.regen * dt);
    if (P.relics.bolha) P.bubbleT = Math.min(10, P.bubbleT + dt);
    if (P.relics.trovao) {
      P.thunderT -= dt;
      if (P.thunderT <= 0) {
        P.thunderT = 5;
        let best = null; for (const e of enemies) if (e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 16 && (!best || e.hp > best.hp)) best = e;
        if (best) { bolt(best.x + 1, best.y + 14, best.z, best.x, best.y + best.h * 0.5, best.z, 0xd2f4ff); dealDamage(best, 70 * (1 + run.floor * 0.3), 'trovao'); sfx('zap'); }
      }
    }
    if (P.relics.ferradura) { P.magnetT -= dt; if (P.magnetT <= 0) { P.magnetT = 40; for (const q of pickups) if (q.k === 0) q.attract = true; } }

    // Modelo
    playerGroup.position.set(P.x, P.y, P.z);
    playerGroup.rotation.y = P.facing;
    let sx = 1, sy = 1;
    if (P.slideT > 0) { sy = 0.6; sx = 1.2; }
    else if (!P.grounded) { sy = 1 + clamp(P.vy * 0.02, -0.15, 0.2); sx = 1 / Math.sqrt(sy); }
    else if (hs > 0.5) { sy = 1 + Math.sin(run.time * 16) * 0.06; sx = 1 / Math.sqrt(sy); }
    playerBody.scale.set(sx, sy, sx);
    playerFlame.position.y = 1.4 * sy;
    playerFlame.scale.set(1, 1 + Math.sin(run.time * 20) * 0.2, 1);
    playerGroup.visible = !(P.iframes > 0 && Math.floor(run.time * 20) % 2 === 0);
    bubbleMesh.visible = !!P.relics.bolha && P.bubbleT >= 10;
    P.ySmooth = lerp(P.ySmooth, P.y, 1 - Math.exp(-dt * 10));
  }

  // =====================================================================
  // Câmera
  // =====================================================================
  let menuAng = 0;
  function updateCamera(dt) {
    if (!P || state === 'menu' || state === 'boot') {
      menuAng += dt * 0.06;
      camera.position.set(Math.cos(menuAng) * 34, 22, Math.sin(menuAng) * 34);
      camera.lookAt(0, 2, 0);
      sky.position.copy(camera.position);
      sun.position.set(30, 50, 20); sun.target.position.set(0, 0, 0);
      return;
    }
    const tx = P.x, ty = P.ySmooth + 1.3, tz = P.z;
    const ox = Math.sin(camYaw) * Math.cos(camPitch), oy = Math.sin(camPitch), oz = Math.cos(camYaw) * Math.cos(camPitch);
    let d = camDist;
    for (let s = 0.6; s <= camDist; s += 0.35) {
      const px = tx + ox * s, py = ty + oy * s, pz = tz + oz * s;
      if (hAt(px, pz) > py - 0.35) { d = Math.max(2.4, s - 0.45); break; }
    }
    camera.position.set(tx + ox * d, ty + oy * d, tz + oz * d);
    if (shake > 0) { camera.position.x += rand(-1, 1) * shake * 0.4; camera.position.y += rand(-1, 1) * shake * 0.4; shake = Math.max(0, shake - dt * 2); }
    camera.lookAt(tx, ty + 0.3, tz);
    sky.position.copy(camera.position);
    sun.position.set(P.x + 30, P.y + 50, P.z + 20); sun.target.position.set(P.x, P.y, P.z);
  }

  // =====================================================================
  // HUD, minimapa, números, avisos
  // =====================================================================
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function setWidth(id, f) { const v = Math.round(clamp(f, 0, 1) * 1000) / 10 + '%'; if (hudCache[id] !== v) { hudCache[id] = v; $(id).style.width = v; } }
  function updateHUD() {
    setText('hLvl', String(P.level));
    setWidth('hHp', P.hp / P.stats.maxHp);
    setText('hHpT', `${Math.ceil(P.hp)} / ${Math.round(P.stats.maxHp)}`);
    setWidth('hXp', P.xp / P.xpNext);
    setText('hTime', fmtTime(run.stageTime));
    setText('hFloor', `Andar ${run.floor} · ${BIOME.name}`);
    setText('hKills', String(run.kills));
    setText('hCoins', String(P.coins));
    setText('hShards', String(run.shards));
    if (bossRef) setWidth('bossHp', bossRef.hp / bossRef.maxHp);
    const wkey = P.weapons.map((w) => w.id + w.level).join();
    if (hudCache.w !== wkey) {
      hudCache.w = wkey;
      let html = '';
      for (let i = 0; i < MAX_WEAPONS; i++) {
        const w = P.weapons[i];
        html += w ? `<div class="slot" title="${WEAPONS[w.id].name}"><span>${WEAPONS[w.id].icon}</span><i>${'●'.repeat(w.level)}${'○'.repeat(5 - w.level)}</i></div>` : '<div class="slot empty"></div>';
      }
      $('hWeapons').innerHTML = html;
    }
    const rkey = P.relicList.join();
    if (hudCache.r !== rkey) { hudCache.r = rkey; $('hRelics').innerHTML = P.relicList.map((id) => `<span title="${RELIC_BY_ID[id].name}: ${RELIC_BY_ID[id].desc}">${RELIC_BY_ID[id].icon}</span>`).join(''); }
  }

  const mini = $('mini'), mctx = mini.getContext('2d');
  let miniBase = null, miniT = 0;
  function buildMiniBase() {
    miniBase = document.createElement('canvas'); miniBase.width = N; miniBase.height = N;
    const c = miniBase.getContext('2d'), img = c.createImageData(N, N);
    for (let k = 0; k < N * N; k++) {
      const h = H[k], col = terrainColor(k, BIOME, 0.5);
      const f = EDGE[k] <= 1 ? 0.35 : 0.55 + Math.min(h, 8) * 0.07;
      img.data[k * 4] = col.r * 255 * f; img.data[k * 4 + 1] = col.g * 255 * f; img.data[k * 4 + 2] = col.b * 255 * f; img.data[k * 4 + 3] = 255;
      if (TREE[k]) { img.data[k * 4] *= 0.6; img.data[k * 4 + 1] *= 0.75; img.data[k * 4 + 2] *= 0.6; }
    }
    c.putImageData(img, 0, 0);
  }
  function drawMini() {
    const W = mini.width, s = W / (N * C);
    const X = (x) => (x + HALF) * s, Z = (z) => (z + HALF) * s;
    mctx.imageSmoothingEnabled = false;
    mctx.drawImage(miniBase, 0, 0, W, W);
    for (const c of world.chests) { mctx.fillStyle = c.opened ? 'rgba(80,70,60,.8)' : c.gold ? '#fff09a' : '#ffb547'; mctx.fillRect(X(c.x) - 3, Z(c.z) - 3, 6, 6); }
    for (const a of world.altars) { if (a.used) continue; mctx.fillStyle = '#7fe3ff'; mctx.beginPath(); mctx.arc(X(a.x), Z(a.z), 3.2, 0, 6.29); mctx.fill(); }
    for (const e of enemies) if (e.alive && e.elite) { mctx.fillStyle = '#ffd04a'; mctx.beginPath(); mctx.arc(X(e.x), Z(e.z), 2.5, 0, 6.29); mctx.fill(); }
    if (bossRef) { mctx.fillStyle = '#ff4f6e'; mctx.beginPath(); mctx.arc(X(bossRef.x), Z(bossRef.z), 5, 0, 6.29); mctx.fill(); }
    if (world.portal) { mctx.strokeStyle = '#c99bff'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(X(world.portal.x), Z(world.portal.z), 5, 0, 6.29); mctx.stroke(); }
    const px = X(P.x), pz = Z(P.z), a = -camYaw - Math.PI / 2;
    mctx.fillStyle = 'rgba(255,255,255,.18)'; mctx.beginPath(); mctx.moveTo(px, pz); mctx.arc(px, pz, 26, a - 0.6 + Math.PI, a + 0.6 + Math.PI); mctx.closePath(); mctx.fill();
    mctx.save(); mctx.translate(px, pz); mctx.rotate(-P.facing + Math.PI);
    mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(0, -5); mctx.lineTo(4, 4); mctx.lineTo(-4, 4); mctx.closePath(); mctx.fill();
    mctx.restore();
  }

  let hurtFlash = 0;
  const _p = new T.Vector3();
  function project(x, y, z) {
    _p.set(x, y, z).project(camera);
    if (_p.z > 1 || _p.z < -1) return null;
    return [(_p.x + 1) / 2 * VW, (1 - _p.y) / 2 * VH];
  }
  function drawFX(dt) {
    fxc.setTransform(DPR, 0, 0, DPR, 0, 0);
    fxc.clearRect(0, 0, VW, VH);
    if (!P || !run) return;
    fxc.textAlign = 'center'; fxc.lineJoin = 'round';
    // Barras de vida de elites
    for (const e of enemies) {
      if (!e.alive || !e.elite) continue;
      const p = project(e.x, e.y + e.h + 0.5, e.z); if (!p) continue;
      fxc.fillStyle = 'rgba(20,14,40,.75)'; fxc.fillRect(p[0] - 26, p[1], 52, 6);
      fxc.fillStyle = '#ffd04a'; fxc.fillRect(p[0] - 25, p[1] + 1, 50 * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
    // Preço dos baús próximos
    fxc.font = '700 13px "Barlow Semi Condensed", "Arial Narrow", sans-serif';
    for (const c of world.chests) {
      if (c.opened || Math.hypot(c.x - P.x, c.z - P.z) > 16) continue;
      const p = project(c.x, c.y + 1.5, c.z); if (!p) continue;
      const cost = chestCost(c), label = c.gold ? 'grátis' : '● ' + cost;
      fxc.lineWidth = 3; fxc.strokeStyle = 'rgba(20,14,40,.85)'; fxc.strokeText(label, p[0], p[1]);
      fxc.fillStyle = c.gold || P.coins >= cost ? '#ffd04a' : '#c9a4a4'; fxc.fillText(label, p[0], p[1]);
    }
    // Números de dano
    for (let i = nums.length - 1; i >= 0; i--) {
      const n = nums[i];
      n.t += dt;
      if (n.t > 0.8) { nums.splice(i, 1); continue; }
      const p = project(n.x, n.y + n.t * 1.4, n.z); if (!p) continue;
      const a = n.t < 0.6 ? 1 : 1 - (n.t - 0.6) / 0.2;
      fxc.globalAlpha = a;
      fxc.font = `700 ${n.big ? 21 : 15}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      fxc.lineWidth = 3.5; fxc.strokeStyle = 'rgba(20,10,30,.85)'; fxc.strokeText(n.text, p[0], p[1]);
      fxc.fillStyle = n.color; fxc.fillText(n.text, p[0], p[1]);
    }
    fxc.globalAlpha = 1;
    if (hurtFlash > 0) hurtFlash = Math.max(0, hurtFlash - dt * 3);
    const hv = Math.max(hurtFlash, P.hp / P.stats.maxHp < 0.3 ? 0.35 + Math.sin(run.time * 6) * 0.15 : 0);
    $('hurt').style.opacity = hv.toFixed(2);
  }
  // Número de dano: posição do inimigo
  function addNumAt(e, d, crit) {
    if (!crit && nums.length > 24) return;
    pushNum(e.x, e.y + e.h + 0.3, e.z, String(Math.round(d)), crit ? '#ffb547' : '#ffffff', crit);
  }

  function toast(msg, kind) {
    const box = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 3200);
  }

  // =====================================================================
  // Desafios
  // =====================================================================
  let questT = 0;
  function questSnapshot() { return { kills: run.kills, time: run.time, level: P.level, bossKills: run.bossKills, floor: run.floor, chests: run.chests, elites: run.elites, altars: run.altars, maxed: run.maxed, maxHeight: run.maxHeight, stompKills: run.stompKills, weapons: P.weapons.length, legend: run.legend }; }
  function checkQuests() {
    const snap = questSnapshot();
    for (const q of QUESTS) {
      if (SAVE.quests[q.id]) continue;
      if (q.check(snap, SAVE.stats)) {
        SAVE.quests[q.id] = true; SAVE.shards += q.reward; run.questShards += q.reward; run.questsDone.push(q);
        toast(`Desafio concluído: ${q.name} (+${q.reward} ✦)`, 'good');
        persist();
      }
    }
  }

  // =====================================================================
  // Ciclo da partida
  // =====================================================================
  let state = 'boot';
  function show(id) {
    for (const s of ['sMenu', 'sChars', 'sForge', 'sQuests', 'sHow', 'sPause', 'sOver']) $(s).hidden = s !== id;
    if (id === 'sMenu') renderMenu();
    if (id === 'sChars') renderChars();
    if (id === 'sForge') renderForge();
    if (id === 'sQuests') renderQuests();
  }
  app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) { initAudio(); sfx('ui'); show(b.dataset.go); }
  });

  function clearRunEntities() {
    for (const e of enemies) e.alive = false;
    enemies.length = 0;
    for (const d of darts) dartPool.put(d.m); darts.length = 0;
    for (const b of boomers) boomPool.put(b.m); boomers.length = 0;
    for (const m of meteors) meteorPool.put(m.m); meteors.length = 0;
    for (const b of bullets) bulletPool.put(b.m); bullets.length = 0;
    for (const w of waves) ringPool.put(w.m); waves.length = 0;
    for (const f of effects) f.pool.put(f.m); effects.length = 0;
    pickups.length = 0; nums.length = 0; pCount = 0; pendingBooms = [];
    bossRef = null; bossMesh.visible = false; $('boss').hidden = true;
  }
  function buildFloor(floor) {
    BIOME = BIOMES[(floor - 1) % BIOMES.length];
    const { tops, rng } = generateWorld(run.seed + floor * 7919);
    buildWorldMeshes(rng);
    clearProps();
    // Baús: nos topos das torres e mesas, e alguns no chão
    for (const t of tops) if (t.kind === 'torre' || rng() < 0.6) spawnChest(cx(t.k), cz(t.k), false);
    const ground = [];
    for (let k = 0; k < N * N; k++) if (EDGE[k] >= 4 && !RES[k] && !TREE[k] && H[k] <= 2) ground.push(k);
    shuffle(ground);
    let placed = 0;
    for (const k of ground) { if (placed >= 3) break; if (Math.hypot(cx(k), cz(k)) < 12) continue; spawnChest(cx(k), cz(k), false); placed++; }
    let alt = 0;
    for (const k of ground) {
      if (alt >= 3) break;
      if (Math.hypot(cx(k), cz(k)) < 14 || world.chests.some((c) => Math.hypot(c.x - cx(k), c.z - cz(k)) < 6) || world.altars.some((a) => Math.hypot(a.x - cx(k), a.z - cz(k)) < 14)) continue;
      spawnAltar(cx(k), cz(k)); alt++;
    }
    buildMiniBase();
  }
  function startRun() {
    initAudio();
    const ch = CHARACTERS.find((c) => c.id === SAVE.selected) || CHARACTERS[0];
    clearRunEntities();
    for (const w of (P ? P.weapons : [])) disposeWeapon(w);
    P = newPlayer(ch);
    run = {
      seed: (Math.random() * 1e9) | 0, time: 0, stageTime: 0, floor: 1, kills: 0, bossKills: 0, chests: 0, chestsBought: 0, altars: 0, elites: 0,
      maxHeight: 0, stompKills: 0, maxed: false, legend: false, shards: 0, questShards: 0, questsDone: [], nextElite: 55, nextSwarm: 100,
      bossSpawned: false, bossWarned: false, rerolls: 2 + (SAVE.forge.sorteio || 0),
    };
    P.weapons.push(makeWeapon(ch.weapon));
    playerBody.geometry.dispose(); playerBody.geometry = playerGeo(ch.color);
    flameMat.color.setHex(ch.color).lerp(new T.Color(0xffffff), 0.35);
    bladeMat.color.setHex(ch.color).lerp(new T.Color(0xffffff), 0.4);
    buildFloor(1);
    P.x = 0.5; P.z = 0.5; P.y = groundUnder(0, 0, PR); P.ySmooth = P.y;
    camYaw = 0.7; camPitch = 0.42;
    pendingLevels = 0; spawnAcc = 0; questT = 0;
    for (const k in hudCache) delete hudCache[k];
    computeFlow();
    playerGroup.visible = true;
    show(null);
    $('hud').hidden = false; $('touch').hidden = !IS_TOUCH; $('modal').hidden = true;
    state = 'play';
    setMusic(true);
    lockPointer();
    toast(`${ch.name} desceu ao ${BIOME.name}. Sobreviva!`);
  }
  // Andar seguinte: mantém armas, relíquias e nível
  function nextFloor() {
    let xp = 0;
    for (const p of pickups) if (p.k === 0) xp += p.v; else if (p.k === 1) P.coins += p.v;
    clearRunEntities();
    addXP(xp);
    run.floor++; run.stageTime = 0; run.nextElite = 55; run.nextSwarm = 100; run.bossSpawned = false; run.bossWarned = false; run.chestsBought = Math.max(0, run.chestsBought - 2);
    buildFloor(run.floor);
    P.x = 0.5; P.z = 0.5; P.y = groundUnder(0, 0, PR); P.vx = P.vy = P.vz = 0; P.ySmooth = P.y;
    P.hp = Math.min(P.stats.maxHp, P.hp + P.stats.maxHp * 0.3);
    computeFlow();
    sfx('portal');
    toast(`Andar ${run.floor}: ${BIOME.name}. Os inimigos ficaram mais fortes.`, 'warn');
  }
  function pauseGame() {
    if (state !== 'play') return;
    state = 'pause'; releasePointer();
    $('setSens').value = SAVE.settings.sens; $('setVol').value = SAVE.settings.vol; $('setMusic').checked = SAVE.settings.music;
    syncSettingLabels();
    $('pauseBuild').innerHTML = `<p class="pb-title">Sua build</p><div class="pb-list">${P.weapons.map((w) => `<span>${WEAPONS[w.id].icon} ${WEAPONS[w.id].name} <b>nv ${w.level}</b></span>`).join('')}${P.relicList.map((id) => `<span>${RELIC_BY_ID[id].icon} ${RELIC_BY_ID[id].name}</span>`).join('')}</div>`;
    show('sPause');
  }
  function resumeGame() {
    if (state !== 'pause') return;
    show(null); state = 'play'; lockPointer();
  }
  function syncSettingLabels() {
    $('setSensV').textContent = Number(SAVE.settings.sens).toFixed(1).replace('.', ',') + '×';
    $('setVolV').textContent = Math.round(SAVE.settings.vol * 100) + '%';
  }
  $('pauseBtn').addEventListener('click', () => pauseGame());
  $('resumeBtn').addEventListener('click', resumeGame);
  $('quitBtn').addEventListener('click', () => { if (state === 'pause') gameOver(true); });
  $('setSens').addEventListener('input', (e) => { SAVE.settings.sens = +e.target.value; syncSettingLabels(); persist(); });
  $('setVol').addEventListener('input', (e) => { SAVE.settings.vol = +e.target.value; if (master) master.gain.value = SAVE.settings.vol; syncSettingLabels(); persist(); });
  $('setMusic').addEventListener('change', (e) => { SAVE.settings.music = e.target.checked; if (musicGain) musicGain.gain.value = SAVE.settings.music ? 0.55 : 0; persist(); });

  function gameOver(quit) {
    state = 'over'; releasePointer(); setMusic(false);
    $('modal').hidden = true; modal = null;
    checkQuests();
    const base = Math.round(run.kills / 15 + run.time / 12 + (run.floor - 1) * 25 + run.bossKills * 40);
    const total = base + run.shards;
    SAVE.shards += total;
    SAVE.stats.kills += run.kills; SAVE.stats.runs++; SAVE.stats.bosses += run.bossKills;
    const record = run.time > SAVE.stats.best;
    if (record) SAVE.stats.best = run.time;
    SAVE.stats.bestFloor = Math.max(SAVE.stats.bestFloor, run.floor);
    persist();
    $('oEyebrow').textContent = record ? 'Novo recorde de tempo' : quit ? 'Partida encerrada' : 'Fim da partida';
    $('oTitle').textContent = quit ? 'Você voltou à superfície' : run.floor > 1 ? `Você caiu no Andar ${run.floor}` : 'Você caiu';
    const rows = [['Tempo total', fmtTime(run.time)], ['Andar', run.floor], ['Nível', P.level], ['Abates', run.kills], ['Colossos', run.bossKills], ['Baús', run.chests]];
    $('oStats').innerHTML = rows.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
    $('oShards').textContent = `✦ ${total + run.questShards}`;
    $('oQuests').innerHTML = run.questsDone.length ? run.questsDone.map((q) => `<li><span>${q.name}</span><b class="shard">+${q.reward} ✦</b></li>`).join('') : '';
    $('hud').hidden = true;
    show('sOver');
  }
  $('againBtn').addEventListener('click', () => { sfx('ui'); startRun(); });
  $('menuBtn').addEventListener('click', () => { sfx('ui'); toMenu(); });
  $('startBtn').addEventListener('click', () => { sfx('ui'); startRun(); });

  function toMenu() {
    state = 'menu'; setMusic(false);
    clearRunEntities();
    if (P) for (const w of P.weapons) disposeWeapon(w);
    P = null; run = null; playerGroup.visible = false;
    $('hud').hidden = true;
    renderEnemies();
    for (const m of [PK_XP, PK_COIN, PK_MISC, pmesh]) m.count = 0;
    run = { seed: 4242 };
    buildFloor(1);
    run = null;
    show('sMenu');
  }

  // Telas do menu
  function refreshShards() { for (const el of document.querySelectorAll('.js-shards')) el.textContent = SAVE.shards; }
  function renderMenu() {
    refreshShards();
    $('mBest').textContent = fmtTime(SAVE.stats.best);
    $('mRuns').textContent = SAVE.stats.runs;
    const done = QUESTS.filter((q) => SAVE.quests[q.id]).length;
    $('mQuestCount').textContent = `${done}/${QUESTS.length}`;
  }
  function renderChars() {
    refreshShards();
    $('charList').innerHTML = CHARACTERS.map((c) => {
      const un = SAVE.unlocked.includes(c.id), sel = SAVE.selected === c.id;
      return `<button class="char${sel ? ' sel' : ''}${un ? '' : ' locked'}" data-id="${c.id}" style="--c:${hexCss(c.color)}" aria-pressed="${sel}">
        <span class="avatar" aria-hidden="true"><i></i></span>
        <span class="cname">${c.name}</span>
        <span class="cdesc">${c.desc}</span>
        <span class="cweap">${WEAPONS[c.weapon].icon} ${WEAPONS[c.weapon].name}</span>
        ${un ? (sel ? '<span class="cstate">Selecionado</span>' : '<span class="cstate dim">Toque para escolher</span>') : `<span class="cstate cost">✦ ${c.cost} para liberar</span>`}
      </button>`;
    }).join('');
    $('charMsg').textContent = '';
  }
  $('charList').addEventListener('click', (e) => {
    const b = e.target.closest('.char'); if (!b) return;
    const c = CHARACTERS.find((x) => x.id === b.dataset.id);
    if (!SAVE.unlocked.includes(c.id)) {
      if (SAVE.shards >= c.cost) { SAVE.shards -= c.cost; SAVE.unlocked.push(c.id); SAVE.selected = c.id; persist(); sfx('chest'); renderChars(); $('charMsg').textContent = `${c.name} liberado.`; }
      else { sfx('deny'); $('charMsg').textContent = `Faltam ${c.cost - SAVE.shards} estilhaços para liberar ${c.name}.`; }
      return;
    }
    SAVE.selected = c.id; persist(); sfx('ui'); renderChars();
  });
  function renderForge() {
    refreshShards();
    $('forgeList').innerHTML = FORGE.map((f) => {
      const l = SAVE.forge[f.id] || 0, maxed = l >= f.max, cost = f.cost(l);
      return `<div class="forge-row">
        <div class="fr-text"><span class="fr-name">${f.name}</span><span class="fr-desc">${f.desc}</span></div>
        <span class="pips" aria-label="Nível ${l} de ${f.max}">${'<i class="on"></i>'.repeat(l)}${'<i></i>'.repeat(f.max - l)}</span>
        <button class="btn small" data-forge="${f.id}" ${maxed ? 'disabled' : ''}>${maxed ? 'Máximo' : '✦ ' + cost}</button>
      </div>`;
    }).join('');
    $('forgeMsg').textContent = '';
  }
  $('forgeList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-forge]'); if (!b) return;
    const f = FORGE.find((x) => x.id === b.dataset.forge), l = SAVE.forge[f.id] || 0;
    if (l >= f.max) return;
    const cost = f.cost(l);
    if (SAVE.shards < cost) { sfx('deny'); $('forgeMsg').textContent = `Faltam ${cost - SAVE.shards} estilhaços para ${f.name}.`; return; }
    SAVE.shards -= cost; SAVE.forge[f.id] = l + 1; persist(); sfx('chest'); renderForge();
    $('forgeMsg').textContent = `${f.name} subiu para o nível ${l + 1}.`;
  });
  function renderQuests() {
    refreshShards();
    $('questList').innerHTML = QUESTS.map((q) => {
      const d = !!SAVE.quests[q.id];
      return `<div class="quest${d ? ' done' : ''}"><span class="qmark" aria-hidden="true">${d ? '✓' : ''}</span><div class="qtext"><span class="qname">${q.name}</span><span class="qdesc">${q.desc}</span></div><span class="qrew shard">+${q.reward} ✦</span></div>`;
    }).join('');
  }

  // =====================================================================
  // Laço principal
  // =====================================================================
  function update(dt) {
    run.time += dt; run.stageTime += dt;
    updatePlayer(dt);
    if (state !== 'play') return;
    director(dt);
    flowT -= dt;
    if (flowT <= 0 || cellIdx(P.x, P.z) !== flowCell) { flowT = 0.35; computeFlow(); }
    updateEnemies(dt);
    if (state !== 'play') return;
    buildHash();
    separate();
    for (const w of P.weapons) WFN[w.id](w, dt);
    updateProjectiles(dt);
    if (state !== 'play') return;
    // compacta a lista de inimigos
    let j = 0;
    for (let i = 0; i < enemies.length; i++) if (enemies[i].alive) enemies[j++] = enemies[i];
    enemies.length = j;
    updatePickups(dt);
    updateInteract(dt);
    if (state !== 'play') return;
    if (pendingLevels > 0) { openModal('levelup'); sfx('level'); burst(P.x, P.y + 1, P.z, 0xffd27a, 24, 6, 0.7, 0.2); }
    questT -= dt;
    if (questT <= 0) { questT = 1; checkQuests(); }
    xpPitch = Math.max(0, xpPitch - dt * 6);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'play') update(dt);
    if (P && run && (state === 'play')) { updateParticles(dt); renderEnemies(); updateHUD(); miniT -= dt; if (miniT <= 0) { miniT = 0.1; drawMini(); } }
    updateCamera(dt);
    renderer.render(scene, camera);
    drawFX(state === 'play' ? dt : 0);
    requestAnimationFrame(frame);
  }

  // API mínima para testes automatizados
  window.__estilhaco = {
    get state() { return state; }, get P() { return P; }, get run() { return run; }, enemies,
    start: startRun, pause: pauseGame, resume: resumeGame, choose: chooseOption,
    skip(seconds) { if (run) { run.stageTime += seconds; run.time += seconds; } },
    give(id) { if (P && WEAPONS[id] && !P.weapons.find((w) => w.id === id)) P.weapons.push(makeWeapon(id)); },
    xp(v) { if (P) addXP(v); },
    // Simula a partida sem desenhar, escolhendo sempre a primeira opção dos menus
    sim(seconds, opts) {
      opts = opts || {};
      const step = 1 / 30;
      for (let t = 0; t < seconds && (state === 'play' || state === 'levelup' || state === 'chest' || state === 'altar'); t += step) {
        if (state !== 'play') { chooseOption(0); continue; }
        if (opts.god) { P.hp = P.stats.maxHp; }
        if (opts.wander) {
          let ax = 0, az = 0;
          for (const e of enemies) { if (!e.alive) continue; const dx = P.x - e.x, dz = P.z - e.z, d2 = dx * dx + dz * dz; if (d2 < 81) { ax += dx / (d2 + 0.5); az += dz / (d2 + 0.5); } }
          ax += -P.x * 0.004; az += -P.z * 0.004;
          if (Math.hypot(ax, az) < 0.01) { ax = Math.cos(run.time * 0.5); az = Math.sin(run.time * 0.5); }
          keys.KeyW = true; camYaw = Math.atan2(-ax, -az);
          if (Math.random() < 0.02) jumpPressed = true;
        }
        update(step);
        renderEnemies();
      }
      keys.KeyW = false;
      return { state, time: run && run.time, floor: run && run.floor, level: P && P.level, kills: run && run.kills, hp: P && Math.round(P.hp), enemies: enemies.length, boss: !!bossRef, portal: !!world.portal, chests: run && run.chests, weapons: P && P.weapons.map((w) => w.id + w.level).join(' ') };
    },
    get world() { return world; },
    openChestNear() { const c = world.chests.find((x) => !x.opened); if (c) { P.x = c.x + 1; P.z = c.z; P.y = c.y; P.coins += 999; actPressed = true; } },
  };

  // Início
  run = { seed: 4242 };
  buildFloor(1);
  run = null;
  state = 'menu';
  show('sMenu');
  requestAnimationFrame(frame);
})();
