/**
 * VS MODE (design/vs-mode.md): the menus (match type, character select), the match lifecycle in the
 * Glatorian Arena — always and only there — the loop step for every VS state, the VS HUD, the results
 * and the rematch. main.js wires it in (screens, loop, input, back button) and hands it the shared
 * services; the rules live in vsRules.js, the combat glue in vsCombat.js, the CPUs in vsAI.js, the
 * intro in vsIntro.js, the cameras in vsCamera.js / cineCam.js.
 */
import * as THREE from 'three';
import { VS, VsFlow, MATCH_TYPES, slotCheck, pairingOk, defaultPicks, vsRoster, vsSpawns, slotLabel, cyclePick } from './vsRules.js';
import { makeVsWorld, vsFighterConfig, vsRulesFor, separate } from './vsCombat.js';
import { CombatAI, SuperTahuCounter, idleInput, rngFrom, COUNTER } from './vsAI.js';
import { VsIntro } from './vsIntro.js';
import { VersusCamera, SpectatorCamera } from './vsCamera.js';
import { CineCamera, orbitShot } from './cineCam.js';

/**
 * @param {object} d services from main.js: cfg, $, scene, camera, audio, fx, fire, maps, ROSTER,
 *   available(c), createFighter(id, cfg), portraits, setScreen(id|null), setMap(id), hideShowcases(),
 *   clearHorde(), toTitle(), configureHud(c), banner(text, kind), setMode(m), flash(kind)
 */
export function createVsMode(d) {
  const { cfg, $ } = d;
  const V = cfg.vs;
  const flow = new VsFlow();
  const rosterOf = (id) => d.ROSTER.find((c) => c.id === id);
  let picks = [null, null];
  let m = null;            // the match in progress
  let paused = false;
  let menuT = 0;
  let seed = null;         // test harness: a fixed seed makes the CPUs deterministic
  let lastError = '';
  const idle = idleInput();
  const look = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // ------------------------------------------------------------------ shared VS world services
  const fxState = { shake: 0, hitStop: 0, slow: 0 };
  const env = {
    cfg,
    get fx() { return d.fx; },
    get audio() { return d.audio; },
    get map() { return d.maps.glatorian; },
    shake: (a) => { fxState.shake = Math.min(1.2, Math.max(fxState.shake, a)); },
    hitStop: (t) => { fxState.hitStop = Math.max(fxState.hitStop, t); },
  };

  // ------------------------------------------------------------------ menus
  /** Open VS MODE from the main menu. Refuses (and says why) without the Glatorian Arena. */
  function open() {
    if (!d.maps.glatorian) { lastError = 'VS MODE needs the GLATORIAN ARENA, which failed to load.'; $('#vs-error').textContent = lastError; return false; }
    d.clearHorde();
    disposeMatch();
    flow.toType();
    d.setMode('vs');
    d.setMap('glatorian');
    d.hideShowcases();
    document.body.dataset.fighter = 'menu';
    document.body.classList.remove('vs-pvc', 'vs-cvc', 'vs-fight');
    d.setScreen('vs-type');
    menuT = 0;
    return true;
  }

  /** PLAYER VS CPU / CPU VS CPU picked: the character select. */
  function chooseType(type) {
    if (!flow.toSelect(type)) return false;
    picks = defaultPicks(d.ROSTER, type, d.available, picks);
    disposeMatch();
    d.setScreen('vs-select');
    renderSelect();
    return true;
  }

  /** Fill the select screen: both slots, their roster cards (refused ones dimmed with the reason). */
  function renderSelect() {
    const type = flow.type;
    $('#vs-sel-head').textContent = MATCH_TYPES[type].label;
    for (const slot of [0, 1]) {
      const el = $(`#vs-slot-${slot}`), id = picks[slot], c = rosterOf(id);
      el.dataset.fighter = id || 'menu';
      el.querySelector('.vs-role').textContent = slotLabel(type, slot);
      el.querySelector('.vs-pname').textContent = c ? c.name : '-';
      const img = el.querySelector('.vs-big img');
      img.src = (c && d.portraits[c.id]) || '';
      const tag = el.querySelector('.vs-cpu-tag');
      tag.textContent = c && c.vs && c.vs.counter ? 'CPU ONLY · NEVER STRIKES FIRST' : '';
      const row = el.querySelector('.vs-cards');
      row.innerHTML = '';
      for (const r of vsRoster(d.ROSTER, d.available)) {
        const chk = slotCheck(r, type, slot, picks[1 - slot], d.available);
        const b = document.createElement('button');
        b.className = 'card vs-card' + (r.id === id ? ' on' : '') + (chk.ok ? '' : ' locked refused');
        b.dataset.id = r.id;
        b.innerHTML = `<div class="pic" style="--c:${r.color}">${d.portraits[r.id] ? `<img alt="" src="${d.portraits[r.id]}">` : ''}</div><div class="cname${r.name.length > 10 ? ' long' : ''}">${r.name}</div>${chk.ok ? '' : `<em class="why">${chk.reason}</em>`}`;
        b.addEventListener('click', (e) => { e.preventDefault(); d.audio.unlock(); if (!pick(slot, r.id)) { b.classList.remove('nope'); void b.offsetWidth; b.classList.add('nope'); } });
        row.appendChild(b);
      }
    }
    $('#vs-go').disabled = !pairingOk(d.ROSTER, type, picks, d.available);
  }

  /** Put fighter `id` in `slot` if the rules allow it. */
  function pick(slot, id) {
    if (flow.state !== VS.SELECT) return false;
    const c = rosterOf(id);
    if (!slotCheck(c, flow.type, slot, picks[1 - slot], d.available).ok) return false;
    picks[slot] = id;
    renderSelect();
    return true;
  }

  /** FIGHT on the select screen. */
  function go() {
    if (flow.state !== VS.SELECT || !pairingOk(d.ROSTER, flow.type, picks, d.available)) return false;
    return startMatch(picks.slice());
  }

  // ------------------------------------------------------------------ the match
  /** ARENA_LOADING: both fighters in the Glatorian Arena, facing each other; then the intro. */
  function startMatch(ids) {
    if (!flow.load(ids)) return false;
    disposeMatch();
    $('#banner').className = ''; // nothing from the previous match carries over (a K.O.! still showing)
    const map = d.maps.glatorian;
    d.setMap('glatorian');
    d.hideShowcases();
    d.setMode('vs');
    const type = flow.type;
    const fighters = ids.map((id) => {
      const f = d.createFighter(id, vsFighterConfig(cfg, id));
      f.vs = vsRulesFor(cfg, id);
      return f;
    });
    const spawns = vsSpawns(V.gap, fighters[0].radius, fighters[1].radius, 0);
    fighters.forEach((f, i) => {
      const s = spawns[i];
      f.pos.set(s.x, map.groundHeight(s.x, s.z), s.z);
      f.groundY = f.pos.y;
      f.facing = s.facing;
      f.vel.set(0, 0, 0);
      f.sync();
      d.scene.add(f.root);
    });
    const rng = rngFrom(seed !== null ? seed + flow.matches : (Math.random() * 2 ** 31) | 0);
    const match = { get fighting() { return flow.fighting; }, ko: (f) => onKnockout(f) };
    const worlds = fighters.map((f, i) => makeVsWorld(env, f, fighters[1 - i], match, uiHooks));
    // controllers: the player's pad, an ordinary CPU, or Super Tahu's counter
    const ctrls = fighters.map((f, i) => {
      const role = MATCH_TYPES[type].roles[i], c = rosterOf(ids[i]), foe = fighters[1 - i];
      if (role === 'player') return { kind: 'player' };
      if (c.vs.counter) return { kind: 'counter', ai: new SuperTahuCounter(f, foe, V.superTahu, match, counterHooks(f)) };
      const prof = V.ai[ids[i]] || V.ai.default;
      return { kind: 'cpu', ai: new CombatAI(f, foe, prof, { common: V.ai, rng, map, buttons: c.buttons, foeButtons: rosterOf(ids[1 - i]).buttons }) };
    });
    m = {
      type, ids, fighters, worlds, ctrls, frame: 0, t: 0, koT: -1, resultsShown: false, intro: null, fightT: 0,
      versus: new VersusCamera(V.camera.versus, cfg.camera, map),
      spectator: new SpectatorCamera(V.camera, map),
      cine: null, rng,
      stats: { hits: [0, 0], damage: [0, 0] },
    };
    m.spectator.setMode(camModeOf());
    fxState.shake = 0; fxState.hitStop = 0; fxState.slow = 0;
    d.fx.clear(); d.fire.clear();
    setupHud();
    flow.intro();
    // both settle into their idle stances before the first frame: no bind pose on screen, and the
    // intro's shots frame the stance (a fighting stance carries the head lower and forward)
    for (let k = 0; k < Math.round(V.settle * 60); k++) fighters.forEach((f, i) => f.update(1 / 60, idle, 0, worlds[i]));
    startIntro();
    return true;
  }

  /** Where the gameplay camera will be when the fight starts (the intro flies into it). */
  function gameplayPose() {
    const [a, b] = m.fighters;
    if (m.type === 'pvc') { const t = m.versus.target(a, b); return t; }
    m.spectator.ready = false;
    return m.spectator.target(a, b, { pos: new THREE.Vector3(), look: new THREE.Vector3() });
  }

  /** CINEMATIC_INTRO: the face-off; nothing can hurt, no one is controlled. */
  function startIntro() {
    const [a, b] = m.fighters;
    for (const i of [0, 1]) {
      const c = rosterOf(m.ids[i]);
      const p = $(`.vsi-plate.p${i}`);
      p.dataset.fighter = c.id;
      p.querySelector('.vsi-role').textContent = slotLabel(m.type, i);
      p.querySelector('.vsi-name').textContent = c.name;
      p.querySelector('.vsi-title').textContent = c.vs.counter ? 'THE TOA OF FIRE · CPU ONLY' : (c.title || '');
      $(`.vsi-n${i}`).textContent = c.name;
    }
    document.body.classList.add('cine', 'vs-intro');
    d.setScreen('vs-intro');
    m.intro = new VsIntro(V.intro, a, b, {
      plate: (i, on) => $(`.vsi-plate.p${i}`).classList.toggle('show', on),
      vs: (on) => $('.vsi-vs').classList.toggle('show', on),
      fight: (on) => fightText(on),
      sfx: (k) => { if (k === 'cut') d.audio.whoosh(); else if (k === 'vs') d.audio.slam(); else if (k === 'fight') { d.audio.hit(true); env.shake(0.4); } },
    }, gameplayPose, m.rng);
  }

  function fightText(on) {
    const el = $('#vs-fight-txt');
    el.classList.remove('show');
    if (on) { void el.offsetWidth; el.classList.add('show'); }
  }

  /** SKIP: the intro ends at once and the fight starts (once). */
  function skip() {
    if (!m || flow.state !== VS.INTRO) return false;
    m.intro.skip();
    const cut = $('#cut');
    cut.classList.remove('go'); void cut.offsetWidth; cut.classList.add('go');
    fightText(true);
    beginFight();
    return true;
  }

  /** FIGHTING: controls and CPUs on, gameplay camera, HUD. Exactly once per match. */
  function beginFight() {
    if (!flow.fight()) return false;
    document.body.classList.remove('cine', 'vs-intro');
    document.body.classList.add('vs-fight');
    d.setScreen(null);
    const [a, b] = m.fighters;
    if (m.type === 'pvc') m.versus.reset(a, b); else m.spectator.reset(a, b);
    m.fightT = 0;
    for (const c of m.ctrls) if (c.ai && c.ai.reset) c.ai.reset();
    m.fightTxt = true; // FIGHT! stays up for the fight's first second (game time: a pause holds it)
    return true;
  }

  /** A fighter is knocked out: the first knockout decides the match. */
  function onKnockout(f) {
    if (!m) return;
    const i = m.fighters.indexOf(f);
    if (i < 0 || !flow.ko(i)) return;
    m.koT = 0;
    fxState.slow = V.koSlowMo;
    env.hitStop(0.12);
    env.shake(0.6);
    const w = m.fighters[1 - i];
    d.banner('K.O.!', 'bad');
    d.audio.slam();
    // the winner poses once the dust settles (Super Tahu finishes his slam and stays calm)
    setTimeout(() => {
      if (!m || m.fighters[1 - i] !== w || !w.alive) return;
      if (rosterOf(m.ids[1 - i]).vs.counter) return;
      if (w.vsVictory()) { if (w.kind === 'dreadnought') d.audio.roar(); else d.audio.special(); }
    }, 700);
  }

  /** MATCH_FINISHED: the results. */
  function showResults() {
    if (!m || m.resultsShown) return;
    m.resultsShown = true;
    const wi = flow.winner, c = rosterOf(m.ids[wi]);
    const title = m.type === 'pvc' ? (wi === 0 ? 'VICTORY' : 'DEFEAT') : `${slotLabel(m.type, wi)} WINS`;
    $('#vs-result').textContent = title;
    $('#vs-result').className = m.type === 'pvc' && wi !== 0 ? 'lose' : 'win';
    const box = $('#vs-winner');
    box.dataset.fighter = c.id;
    box.querySelector('img').src = d.portraits[c.id] || '';
    box.querySelector('span').textContent = `${c.name} WINS`;
    const loser = rosterOf(m.ids[1 - wi]);
    const how = c.vs.counter ? `${loser.name} attacked first. INFERNO SLAM: one blow.` : `${c.name} ${Math.round(m.fighters[wi].hp)} HP left · ${Math.round(m.t)} s`;
    $('#vs-detail').textContent = how;
    d.setScreen('vs-over');
  }

  /** REMATCH: same match type, same fighters, the same arena; everything reset. */
  function rematch() {
    if (!m || flow.state !== VS.DONE) return false;
    return startMatch(m.ids.slice());
  }
  /** CHARACTER SELECTION. */
  function reselect() {
    if (flow.state !== VS.DONE && flow.state !== VS.SELECT) return false;
    const type = m ? m.type : flow.type;
    disposeMatch();
    flow.state = VS.TYPE;
    return chooseType(type);
  }
  /** MAIN MENU. */
  function toMenu() {
    exit();
    d.toTitle();
  }
  /** Leave VS MODE (cleans everything up). */
  function exit() {
    disposeMatch();
    flow.exit();
    paused = false;
    document.body.classList.remove('vs-pvc', 'vs-cvc', 'vs-fight', 'vs-intro', 'cine', 'raging', 'overflowing');
  }

  /** Remove the match's fighters and effects (rematch, reselect, exit). */
  function disposeMatch() {
    if (!m) return;
    for (const f of m.fighters) { d.scene.remove(f.root); if (f.dispose) f.dispose(); }
    for (const c of m.ctrls) if (c.ai) c.ai.tahu = c.ai.foe = c.ai.self = null;
    m = null;
    d.fx.clear(); d.fire.clear();
    fightText(false);
    $('.vsi-vs').classList.remove('show');
    for (const p of document.querySelectorAll('.vsi-plate')) p.classList.remove('show');
    document.body.classList.remove('raging', 'overflowing', 'vs-fight', 'vs-intro', 'cine');
  }

  // ------------------------------------------------------------------ presentation hooks
  const uiHooks = {
    hit(attacker, target, info) {
      const fx = d.fx, at = info.at;
      fx.sparks(at, info.rapid ? 4 : info.heavy ? 22 : 12, info.rapid ? 0xc8ffd0 : 0xffd27a, info.heavy ? 12 : 8);
      if (info.dealt > 0) fx.damageNumber(tmp.set(at.x, at.y + 0.6, at.z), Math.round(info.dealt), info.heavy ? 'big' : info.rapid ? 'small' : '');
      if (!info.rapid) {
        d.audio.hit(info.heavy);
        env.hitStop(info.heavy ? cfg.feel.hitStopHeavy : cfg.feel.hitStop);
        env.shake(info.heavy ? cfg.feel.shakeHeavy * 0.6 : cfg.feel.shakeLight);
      }
      if (m) { const i = m.fighters.indexOf(attacker); if (i >= 0) { m.stats.hits[i]++; m.stats.damage[i] += info.dealt || 0; } }
    },
    combo(f, n) {
      if (!m || n < 2) return;
      const el = $('#combo'), i = m.fighters.indexOf(f);
      el.innerHTML = `<b>${n}</b><em>HITS</em>`;
      el.classList.toggle('vs-r', i === 1);
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      el.style.opacity = 1;
      clearTimeout(uiHooks.comboT);
      uiHooks.comboT = setTimeout(() => { el.style.opacity = 0; }, 1400);
    },
    special(f, name, kind) {
      d.banner(`${name}!!`, kind);
      if (kind === 'fire') d.audio.inferno(); else d.audio.special();
      env.hitStop(0.12);
      d.flash(kind === 'fire' ? 'fire' : '');
    },
    specialImpact(p) {
      // INFERNO SLAM (Super Tahu's ultimate counter): the slam, a crown of fire, then the column
      const o = p.pos, fire = d.fire, map = d.maps.glatorian;
      env.shake(1.0); env.hitStop(0.08);
      d.audio.slam();
      d.fx.shockwave(o, 9, 0xff8a2a);
      d.fx.crack(o, 3, p.facing);
      for (let k = 0; k < 5; k++) {
        const a = p.facing + (k - 2) * 0.62;
        const x = o.x + Math.sin(a) * 4.4, z = o.z + Math.cos(a) * 4.4;
        fire.erupt({ x, y: map.groundHeight(x, z), z, delay: 0.03 * Math.abs(k - 2), radius: 0.7, height: 7 });
      }
      if (p.vsCounter) p.vsCounter.impact();
    },
    rage(f, on) {
      const i = m ? m.fighters.indexOf(f) : -1;
      if (i >= 0) $(`#vs-side-${i}`).classList.toggle('raging', on);
      if (on) { d.banner(`${rosterOf(f.kind).special}!!`, 'rage'); env.hitStop(0.1); }
      if (m && m.type === 'pvc' && i === 0) document.body.classList.toggle('raging', on);
    },
    /** TOAKU's ENERGY OVERFLOW: the surge's banner; his side (and the player's screen edges) glow green. */
    overflow(f, phase) {
      const i = m ? m.fighters.indexOf(f) : -1;
      const on = phase === 'surge' || phase === 'on';
      if (phase === 'surge') { d.banner('ENERGY OVERFLOW!!', 'overflow'); d.flash(''); env.hitStop(0.08); }
      if (phase === 'charge') return;
      if (i >= 0) $(`#vs-side-${i}`).classList.toggle('overflowing', on);
      if (m && m.type === 'pvc' && i === 0) document.body.classList.toggle('overflowing', on);
    },
    heal(f, n) {
      const i = m ? m.fighters.indexOf(f) : -1;
      if (i < 0 || !(n > 0)) return;
      const pop = $(`#vs-side-${i} .vs-heal`);
      pop.textContent = `+${Math.round(n)}`;
      pop.classList.remove('go'); void pop.offsetWidth; pop.classList.add('go');
    },
    hurt(f) {
      const i = m ? m.fighters.indexOf(f) : -1;
      if (i < 0) return;
      const s = $(`#vs-side-${i}`);
      s.classList.remove('hit'); void s.offsetWidth; s.classList.add('hit');
      if (m.type === 'pvc' && i === 0) {
        $('#hurt').classList.remove('go'); void $('#hurt').offsetWidth; $('#hurt').classList.add('go');
        if (navigator.vibrate) navigator.vibrate(30);
      }
    },
  };

  /** Super Tahu's counter: what the player sees when he wakes up and when the column hits. */
  function counterHooks(tahu) {
    return {
      detected(attacker) {
        d.audio.charge();
        env.hitStop(0.22);
        d.fx.sparks(attacker.center(tmp), 30, 0xff8a2a, 10);
        d.flash('fire');
      },
      erupt(at, onHit, delay) {
        const map = d.maps.glatorian;
        d.fire.erupt({ x: at.x, y: map.groundHeight(at.x, at.z), z: at.z, delay, radius: 1.7, height: 15, onErupt: () => { onHit(); d.audio.fireColumn(); env.shake(0.9); } });
      },
      defeated() {},
      tahu,
    };
  }

  // ------------------------------------------------------------------ HUD
  const hudEls = [0, 1].map((i) => {
    const s = $(`#vs-side-${i}`);
    return { s, name: s.querySelector('.vs-name'), tag: s.querySelector('.vs-tag'), fill: s.querySelector('.vs-hp .fill'), lag: s.querySelector('.vs-hp .lag'), res: s.querySelector('.vs-res'), resFill: s.querySelector('.vs-res i'), resLabel: s.querySelector('.vs-res span'), emb: s.querySelector('.vs-emb'), img: s.querySelector('.vs-emb img'), use: s.querySelector('.vs-emb use') };
  });
  const shown = {};
  const put = (k, v, fn) => { if (shown[k] !== v) { shown[k] = v; fn(v); } };
  /** Names, emblems, themes and which bars each side shows. */
  function setupHud() {
    for (const k of Object.keys(shown)) delete shown[k];
    const type = m.type;
    document.body.classList.toggle('vs-pvc', type === 'pvc');
    document.body.classList.toggle('vs-cvc', type === 'cvc');
    if (type === 'pvc') d.configureHud(rosterOf(m.ids[0])); // the player's own buttons and colours
    else document.body.dataset.fighter = 'menu';
    m.lag = [1, 1];
    m.ids.forEach((id, i) => {
      const c = rosterOf(id), e = hudEls[i];
      e.s.dataset.fighter = id;
      e.s.classList.remove('raging', 'overflowing', 'hit');
      e.res.classList.remove('raging', 'overflowing', 'ready');
      e.name.textContent = c.name;
      e.tag.textContent = type === 'pvc' ? (i === 0 ? 'P1' : 'CPU') : 'CPU';
      e.emb.classList.toggle('portrait', !c.emblem);
      if (c.emblem) e.use.setAttribute('href', '#' + c.emblem); else e.img.src = d.portraits[id] || '';
      // a resource bar only for a fighter that has one in a duel (Super Tahu: none — his counter needs none)
      const hasRes = !c.vs.counter;
      e.res.style.display = hasRes ? '' : 'none';
      e.resLabel.textContent = c.meterLabel;
    });
    $('#vs-cam').textContent = `CAM: ${camModeOf().toUpperCase()}`;
  }
  function updateHud(dt) {
    m.fighters.forEach((f, i) => {
      const e = hudEls[i], hpf = Math.max(0, f.hp / f.maxHp);
      m.lag[i] = m.lag[i] > hpf ? Math.max(hpf, m.lag[i] - dt * 0.45) : hpf;
      put(`hp${i}`, Math.round(hpf * 400) / 400, (v) => { e.fill.style.transform = `scaleX(${v})`; e.s.classList.toggle('low', v < 0.3); });
      put(`lag${i}`, Math.round(m.lag[i] * 400) / 400, (v) => { e.lag.style.transform = `scaleX(${v})`; });
      if (rosterOf(m.ids[i]).vs.counter) return;
      const mf = f.hudMeter !== undefined ? f.hudMeter : Math.min(1, f.meter / f.cfg.special.meterMax);
      put(`res${i}`, Math.round(mf * 200) / 200, (v) => { e.resFill.style.transform = `scaleX(${v})`; });
      const ready = f.hudReady !== undefined ? f.hudReady : f.specialReady !== undefined ? f.specialReady : mf >= 1;
      put(`rdy${i}`, ready, (v) => e.res.classList.toggle('ready', v));
      if (f.overflowT !== undefined) {
        // TOAKU's ENERGY OVERFLOW: the bar burns green with the time left while it runs
        put(`of${i}`, f.overflowT > 0 || f.state === 'overflow', (v) => e.res.classList.toggle('overflowing', v));
        const secs = f.overflowT > 0 ? Math.ceil(f.overflowT) : 0;
        put(`ofs${i}`, secs, (v) => { e.resLabel.textContent = v ? `${rosterOf(m.ids[i]).meterLabel} · ${v}s` : rosterOf(m.ids[i]).meterLabel; });
      }
      if (f.rageT !== undefined) {
        const secs = f.rageT > 0 ? Math.ceil(f.rageT) : 0;
        put(`rage${i}`, secs, (v) => { e.res.classList.toggle('raging', v > 0); e.resLabel.textContent = v ? `${rosterOf(m.ids[i]).meterLabel} · ${v}s` : rosterOf(m.ids[i]).meterLabel; });
      }
    });
    if (m.type === 'pvc') {
      // the player's own buttons: special ready / the PUNCH charge ring (like the horde HUD)
      const p = m.fighters[0], sp = $('#btn-special'), punch = $('#btn-punch');
      const mf = p.hudMeter !== undefined ? p.hudMeter : Math.min(1, p.meter / p.cfg.special.meterMax);
      const sf = p.specialCharge !== undefined ? p.specialCharge : mf;
      put('spFill', Math.round(sf * 100) / 100, (v) => sp.style.setProperty('--fill', v * 360 + 'deg'));
      if (p.overflowT !== undefined) {
        const of = $('#btn-overflow');
        put('ofFill', Math.round(mf * 100) / 100, (v) => of.style.setProperty('--fill', v * 360 + 'deg'));
        put('ofReady', p.overflowReady, (v) => of.classList.toggle('ready', v));
        put('ofActive', p.overflowT > 0 || p.state === 'overflow', (v) => of.classList.toggle('active', v));
      }
      put('spReady', p.specialReady !== undefined ? p.specialReady : mf >= 1, (v) => sp.classList.toggle('ready', v));
      put('spRaging', !!(p.rageT > 0), (v) => sp.classList.toggle('raging', v));
      const ch = p.charge || 0;
      put('charge', Math.round(ch * 50) / 50, (v) => { punch.style.setProperty('--charge', v * 360 + 'deg'); punch.classList.toggle('charging', v > 0); });
      put('charged', ch >= 1, (v) => punch.classList.toggle('charged', v));
    }
  }

  // ------------------------------------------------------------------ the loop
  let camModeStore = 'dynamic';
  function camModeOf() { return camModeStore; }
  /** CPU VS CPU: switch the spectator camera (dynamic / wide). */
  function toggleCam() {
    camModeStore = camModeStore === 'wide' ? 'dynamic' : 'wide';
    if (m) m.spectator.setMode(camModeStore);
    $('#vs-cam').textContent = `CAM: ${camModeStore.toUpperCase()}`;
    return camModeStore;
  }

  /** One frame of whatever VS state is on. */
  function step(dt, inp) {
    const st = flow.state;
    if (st === VS.TYPE || st === VS.SELECT) return stepMenu(dt);
    if (!m) return;
    if (paused) return;
    if (st === VS.INTRO) return stepIntro(dt);
    if (st === VS.FIGHT || st === VS.DONE) return stepFight(dt, inp);
  }

  /** Menus: the empty arena turns slowly behind the panels. */
  function stepMenu(dt) {
    menuT += dt;
    const map = d.maps.glatorian, a = menuT * 0.08;
    d.camera.position.set(Math.sin(a) * 34, 15, Math.cos(a) * 34);
    d.camera.lookAt(0, 3, 0);
    map.update(dt, { x: 0, y: 0, z: 0 });
    d.fx.update(dt);
  }

  /** The intro: both fighters idle (no input, no damage); the cinematic camera; then the fight. */
  function stepIntro(dt) {
    for (let i = 0; i < 2; i++) m.fighters[i].update(dt, idle, 0, m.worlds[i]);
    const pose = m.intro.update(dt);
    applyPose(pose.pos, pose.look);
    d.maps.glatorian.update(dt, m.fighters[0].pos);
    d.fx.update(dt); d.fire.update(dt);
    if (m.intro.done) beginFight();
  }

  function stepFight(dt, inp) {
    let sdt = dt;
    if (fxState.hitStop > 0) { fxState.hitStop -= dt; sdt *= 0.05; }
    if (fxState.slow > 0) { fxState.slow -= dt; sdt *= 0.35; }
    m.t += flow.fighting ? sdt : 0;
    const fighting = flow.fighting;
    if (fighting) m.fightT += dt;
    if (m.fightTxt && m.fightT > 1) { m.fightTxt = false; fightText(false); }
    const [a, b] = m.fighters;
    // camera first: the player's stick is relative to it
    let pose, playerYaw = 0;
    if (m.type === 'pvc') { const v = m.versus.update(dt, a, b, fighting ? inp.camDX : 0); pose = v; playerYaw = v.yaw; } else pose = m.spectator.update(dt, a, b);
    // inputs: the pad for the player, the CPUs' controllers otherwise (nothing outside FIGHTING)
    const inputs = m.ctrls.map((c, i) => {
      if (c.kind === 'player') return fighting ? inp : idle;
      if (c.kind === 'counter') return c.ai.update(sdt);
      return c.ai.update(sdt, fighting);
    });
    // fairness: the two fighters take turns going first
    const order = (m.frame++ & 1) ? [1, 0] : [0, 1];
    for (const i of order) m.fighters[i].update(sdt, inputs[i], m.ctrls[i].kind === 'player' ? playerYaw : 0, m.worlds[i]);
    separate(a, b, d.maps.glatorian);
    // after the knockout: slow motion, the winner's pose, an orbit around him, then the results
    if (flow.state === VS.DONE) {
      m.koT += dt;
      if (m.koT > 0.9 && !m.cine) {
        const w = m.fighters[flow.winner], h = w.height;
        m.cine = new CineCamera(m.rng).play([orbitShot(V.resultDelay + 2, { x: w.pos.x, y: w.pos.y, z: w.pos.z }, { a0: w.facing - 0.5, a1: w.facing + 0.4, r0: h * 1.9, r1: h * 1.55, h0: h * 0.45, h1: h * 0.6, look0: h * 0.62 })]);
        m.cineW = 0;
      }
      if (m.cine) {
        const c = m.cine.update(dt);
        m.cineW = Math.min(1, m.cineW + dt / 0.8);
        tmp.copy(pose.pos).lerp(c.pos, m.cineW);
        look.copy(pose.look).lerp(c.look, m.cineW);
        pose = { pos: tmp, look };
      }
      if (m.koT >= V.resultDelay) showResults();
    }
    applyPose(pose.pos, pose.look);
    d.maps.glatorian.update(sdt, a.pos);
    d.fx.update(sdt);
    d.fire.update(sdt);
    updateHud(dt);
  }

  /** Camera pose + shake. */
  function applyPose(pos, lk) {
    const cam = d.camera;
    cam.position.copy(pos);
    cam.lookAt(lk);
    fxState.shake = Math.max(0, fxState.shake - 1 / 60 * 2.5);
    if (fxState.shake > 0) {
      const s = fxState.shake * fxState.shake * 0.6;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.05;
    }
  }

  // ------------------------------------------------------------------ input outside the fight
  /** Android back / Escape: one step back. */
  function back() {
    const st = flow.state;
    if (st === VS.TYPE) { toMenu(); return true; }
    if (st === VS.SELECT) { flow.toType(); d.setScreen('vs-type'); return true; }
    if (st === VS.INTRO) { skip(); return true; }
    if (st === VS.FIGHT) { pause(!paused); return true; }
    if (st === VS.DONE) { if (m && m.resultsShown) reselect(); return true; }
    return false;
  }
  /** Pause (FIGHTING only). */
  function pause(on) {
    if (flow.state !== VS.FIGHT && !(paused && !on)) return false;
    paused = on;
    d.setScreen(on ? 'pause' : null);
    return true;
  }
  /** Keyboard shortcuts on the VS screens. */
  function key(code) {
    const st = flow.state;
    if (code === 'Escape' || code === 'KeyP') return back();
    if (code === 'Enter' || code === 'Space') {
      if (st === VS.TYPE && code === 'Enter') return chooseType('pvc');
      if (st === VS.SELECT && code === 'Enter') return go();
      if (st === VS.INTRO) return skip();
      if (st === VS.DONE && m && m.resultsShown && code === 'Enter') return rematch();
    }
    if (st === VS.TYPE && (code === 'Digit1' || code === 'Numpad1')) return chooseType('pvc');
    if (st === VS.TYPE && (code === 'Digit2' || code === 'Numpad2')) return chooseType('cvc');
    if (st === VS.SELECT) {
      // left / right browse fighter 1's slot, up / down fighter 2's (refused fighters are skipped)
      const slot = code === 'ArrowLeft' || code === 'ArrowRight' ? 0 : code === 'ArrowUp' || code === 'ArrowDown' ? 1 : -1;
      if (slot >= 0) return pick(slot, cyclePick(d.ROSTER, flow.type, slot, picks, code === 'ArrowLeft' || code === 'ArrowUp' ? -1 : 1, d.available));
    }
    if (st === VS.DONE && m && m.resultsShown && code === 'KeyM') { toMenu(); return true; }
    if (code === 'KeyC' && st === VS.FIGHT && m && m.type === 'cvc') { toggleCam(); return true; }
    return false;
  }

  // ------------------------------------------------------------------ wiring
  const tap = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', (e) => { e.preventDefault(); d.audio.unlock(); fn(); }); };
  tap('#vs-type-back', toMenu);
  for (const el of document.querySelectorAll('.vs-type')) el.addEventListener('click', (e) => { e.preventDefault(); d.audio.unlock(); chooseType(el.dataset.type); });
  tap('#vs-sel-back', () => { flow.toType(); d.setScreen('vs-type'); });
  tap('#vs-go', go);
  tap('#vs-skip', skip);
  tap('#vs-rematch', rematch);
  tap('#vs-reselect', reselect);
  tap('#vs-menu', toMenu);
  tap('#vs-cam', toggleCam);

  return {
    open, chooseType, pick, go, skip, rematch, reselect, toMenu, exit, back, pause, key, step, toggleCam, startMatch,
    get state() { return flow.state; },
    get active() { return flow.state !== null; },
    get paused() { return paused; },
    get flow() { return flow; },
    get match() { return m; },
    get picks() { return picks.slice(); },
    get error() { return lastError; },
    /** Test harness: deterministic CPUs from this seed (null: random). */
    setSeed(s) { seed = s; },
    COUNTER,
  };
}
