// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { createClouds, generateSoccerField, createGrassBladesOnField, createMoon, MOON_RADIUS, updateGrass, addSceneryProps, addFans, createMountainRing } from "./worldGeneration.js";
import { getTerrainHeight } from './water.js';
import { Multiplayer, subscribeOnlineCount } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { initLogin, getSession, clearSession, getUser, updateUserDisplayName, getUserUpgrades, purchaseUpgrade, unlockCharacterFree, updateUserCharacter, CHARACTERS, ADVENTURE_ORDER, changePin, deleteAccount } from './login.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { LevelLoader } from './levelLoader.js';
import { BreakManager } from './breakManager.js';
import { initSpeechCommands } from './speechCommands.js';
import { GOAL_COIN_REWARD, recordGoal, recordGameResult, getPlayerStats, getLeaderboard } from './leaderboard.js';
import {
  getUpcomingTournaments, ensureTournamentsExist, subscribeTournamentList, subscribeTournament,
  registerForTournament, unregisterFromTournament, tryStartTournament,
  confirmJoin, markReady, kickAndFillBots, reportMatchResult,
  findPlayerMatch, getRealPlayersForMatch, getMatchRoomId,
  startTournamentNotifications, JOIN_TIMEOUT_MS, READY_TIMEOUT_MS,
} from './tournament.js';
import { ref, get, onValue } from 'firebase/database';
import { db } from './firebase-init.js';
import { AudioManager } from './audioManager.js';
import { AIPlayer } from './aiPlayer.js';
import { SoccerBall } from './soccerBall.js';
import { SetPieceManager, buildSetPieceParams } from './setPiece.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyGlobalGravity } from "./gravity.js";
import { getSpawnPosition } from './spawnUtils.js';

const DEFAULT_CHARACTER_MODEL = "/models/old_man.fbx";
const ADVENTURE_PROGRESS_KEY = 'adventureProgressRound';
const ADVENTURE_IN_PROGRESS_KEY = 'adventureRoundInProgress';
const ADVENTURE_ROUND_CONFIGS = [
  { enemyBots: 1, playerTeamSize: 1 },
  { enemyBots: 2, playerTeamSize: 2 },
  { enemyBots: 2, playerTeamSize: 1 },
  { enemyBots: 3, playerTeamSize: 2 },
  { enemyBots: 4, playerTeamSize: 2 },
  { enemyBots: 3, playerTeamSize: 1 },
  { enemyBots: 4, playerTeamSize: 1 },
];

function clampAdventureRound(round) {
  const parsed = Number.parseInt(round, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), ADVENTURE_ROUND_CONFIGS.length - 1);
}

function getAdventureRoundConfig(roundIdx) {
  return ADVENTURE_ROUND_CONFIGS[clampAdventureRound(roundIdx)] || ADVENTURE_ROUND_CONFIGS[0];
}

function getSavedAdventureRound() {
  const savedRound = clampAdventureRound(localStorage.getItem(ADVENTURE_PROGRESS_KEY) || '0');
  if (localStorage.getItem(ADVENTURE_IN_PROGRESS_KEY) !== '1') return savedRound;
  const penaltyRound = clampAdventureRound(savedRound - 1);
  localStorage.setItem(ADVENTURE_PROGRESS_KEY, String(penaltyRound));
  localStorage.removeItem(ADVENTURE_IN_PROGRESS_KEY);
  return penaltyRound;
}

function saveAdventureRound(roundIdx) {
  localStorage.setItem(ADVENTURE_PROGRESS_KEY, String(clampAdventureRound(roundIdx)));
}


const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  const audioManager = new AudioManager();

  // ── Arcade login gate — resolves when player authenticates ──────────────────
  let { username: playerName, character: characterModel } = await new Promise(resolve => {
    initLogin(({ username, character }) => {
      setCookie('playerName', username);
      setCookie('characterModel', character || DEFAULT_CHARACTER_MODEL);
      resolve({ username, character: character || DEFAULT_CHARACTER_MODEL });
    });
  });

  // ── Tournament notifications (active throughout the session) ─────────────────
  ensureTournamentsExist().catch(() => {});
  let _activeTournamentNotifId = null;
  const _stopTournamentNotifs = startTournamentNotifications(playerName, (tid, label) => {
    showTournamentNotification(tid, label);
  });

  function showTournamentNotification(tid, label) {
    _activeTournamentNotifId = tid;
    const popup = document.getElementById('tournament-notification');
    const nameEl = document.getElementById('tournament-notif-name');
    if (popup && nameEl) {
      nameEl.textContent = label;
      popup.classList.remove('hidden');
    }
  }

  document.getElementById('tournament-notif-dismiss')?.addEventListener('click', () => {
    document.getElementById('tournament-notification').classList.add('hidden');
  });

  document.getElementById('tournament-notif-join')?.addEventListener('click', () => {
    document.getElementById('tournament-notification').classList.add('hidden');
    if (_activeTournamentNotifId) {
      openTournamentBracket(_activeTournamentNotifId, playerName, null);
    }
  });

  // ── Dashboard — choose Play Online vs Play Bots ─────────────────────────────
  const { botsOnly, botsPerTeam, ballSizeMultiplier, gravityMultiplier, adventureMode, adventureCharModel, adventureRoundConfig } = await new Promise(resolve => {
    // ── Check if returning from a tournament game ─────────────────────────────
    const returningTournamentId = sessionStorage.getItem('tournamentId');
    const returningMatchId = sessionStorage.getItem('tournamentMatchId');
    if (returningTournamentId && returningMatchId) {
      resolve({ botsOnly: false, botsPerTeam: 3, ballSizeMultiplier: 1.0, gravityMultiplier: 1.0 });
      return;
    }

    const overlay = document.getElementById('dashboard-overlay');
    const settingsOverlay = document.getElementById('bots-settings-overlay');
    const onlineNumEl = document.getElementById('dashboard-online-num');
    overlay.classList.remove('hidden');

    // Dashboard audio sliders
    const dashMusicSlider = document.getElementById('dash-music-volume');
    const dashSfxSlider = document.getElementById('dash-sfx-volume');
    if (dashMusicSlider) {
      dashMusicSlider.value = audioManager.musicVolume;
      dashMusicSlider.addEventListener('input', () => audioManager.setMusicVolume(parseFloat(dashMusicSlider.value)));
    }
    if (dashSfxSlider) {
      dashSfxSlider.value = audioManager.sfxVolume;
      dashSfxSlider.addEventListener('input', () => audioManager.setSfxVolume(parseFloat(dashSfxSlider.value)));
    }

    const unsubCount = subscribeOnlineCount(count => {
      if (onlineNumEl) onlineNumEl.textContent = count;
    });

    // Bot settings — load from cookies
    let selectedBotsPerTeam = parseInt(getCookie('botsPerTeam') || '3', 10);
    let selectedBallSize = parseFloat(getCookie('ballSizeMultiplier') || '1.0');
    let selectedGravity = parseFloat(getCookie('gravityMultiplier') || '1.0');

    const botsDisplay = document.getElementById('bots-size-display');
    const ballDisplay = document.getElementById('ball-size-display');
    const gravDisplay = document.getElementById('gravity-display');

    const refreshDisplays = () => {
      botsDisplay.textContent = selectedBotsPerTeam;
      ballDisplay.textContent = selectedBallSize.toFixed(1);
      gravDisplay.textContent = selectedGravity.toFixed(1);
    };
    refreshDisplays();

    document.getElementById('bots-size-dec').addEventListener('click', () => {
      if (selectedBotsPerTeam > 1) { selectedBotsPerTeam--; refreshDisplays(); }
    });
    document.getElementById('bots-size-inc').addEventListener('click', () => {
      if (selectedBotsPerTeam < 5) { selectedBotsPerTeam++; refreshDisplays(); }
    });
    document.getElementById('ball-size-dec').addEventListener('click', () => {
      if (selectedBallSize > 0.5) { selectedBallSize = Math.round((selectedBallSize - 0.1) * 10) / 10; refreshDisplays(); }
    });
    document.getElementById('ball-size-inc').addEventListener('click', () => {
      if (selectedBallSize < 3.0) { selectedBallSize = Math.round((selectedBallSize + 0.1) * 10) / 10; refreshDisplays(); }
    });
    document.getElementById('gravity-dec').addEventListener('click', () => {
      if (selectedGravity > 0.1) { selectedGravity = Math.round((selectedGravity - 0.1) * 10) / 10; refreshDisplays(); }
    });
    document.getElementById('gravity-inc').addEventListener('click', () => {
      if (selectedGravity < 2.0) { selectedGravity = Math.round((selectedGravity + 0.1) * 10) / 10; refreshDisplays(); }
    });

    document.getElementById('btn-play-online').addEventListener('click', () => {
      unsubCount();
      overlay.classList.add('hidden');
      resolve({ botsOnly: false, botsPerTeam: selectedBotsPerTeam, ballSizeMultiplier: 1.0, gravityMultiplier: 1.0 });
    });

    document.getElementById('btn-play-bots').addEventListener('click', () => {
      overlay.classList.add('hidden');
      settingsOverlay.classList.remove('hidden');
    });

    document.getElementById('bots-settings-back').addEventListener('click', () => {
      settingsOverlay.classList.add('hidden');
      overlay.classList.remove('hidden');
    });

    document.getElementById('bots-settings-start').addEventListener('click', () => {
      setCookie('botsPerTeam', String(selectedBotsPerTeam));
      setCookie('ballSizeMultiplier', selectedBallSize.toFixed(1));
      setCookie('gravityMultiplier', selectedGravity.toFixed(1));
      unsubCount();
      settingsOverlay.classList.add('hidden');
      resolve({ botsOnly: true, botsPerTeam: selectedBotsPerTeam, ballSizeMultiplier: selectedBallSize, gravityMultiplier: selectedGravity });
    });

    // Stats button
    document.getElementById('btn-stats').addEventListener('click', async () => {
      const statsOverlay = document.getElementById('stats-overlay');
      const statsContent = document.getElementById('stats-content');
      statsContent.innerHTML = '<em>Loading...</em>';
      statsOverlay.classList.remove('hidden');
      try {
        const stats = await getPlayerStats(playerName);
        statsContent.innerHTML = `
          <div class="stats-row"><span class="stats-label">COINS</span><span class="stats-value stats-coins">🪙 ${stats.coins || 0}</span></div>
          <div class="stats-row"><span class="stats-label">GOALS</span><span class="stats-value">${stats.goals || 0}</span></div>
          <div class="stats-row"><span class="stats-label">WINS</span><span class="stats-value stats-win">${stats.wins || 0}</span></div>
          <div class="stats-row"><span class="stats-label">DRAWS</span><span class="stats-value stats-draw">${stats.draws || 0}</span></div>
          <div class="stats-row"><span class="stats-label">LOSSES</span><span class="stats-value stats-loss">${stats.losses || 0}</span></div>
        `;
      } catch {
        statsContent.innerHTML = '<em>Failed to load stats.</em>';
      }
    });

    document.getElementById('stats-overlay-close').addEventListener('click', () => {
      document.getElementById('stats-overlay').classList.add('hidden');
    });

    // Leaderboard button
    document.getElementById('btn-leaderboard-dash').addEventListener('click', async () => {
      const lbOverlay = document.getElementById('leaderboard-dash-overlay');
      const lbContent = document.getElementById('leaderboard-dash-content');
      lbContent.innerHTML = '<em>Loading...</em>';
      lbOverlay.classList.remove('hidden');
      try {
        const rows = await getLeaderboard();
        if (rows.length === 0) {
          lbContent.innerHTML = '<em>No scores yet.</em>';
        } else {
          const table = document.createElement('table');
          table.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Goals</th><th>W</th><th>D</th><th>L</th></tr></thead>';
          const tbody = document.createElement('tbody');
          rows.forEach((row, i) => {
            const tr = document.createElement('tr');
            if (i === 0) tr.classList.add('lb-top');
            [i + 1, row.name, row.goals || 0, row.wins || 0, row.draws || 0, row.losses || 0].forEach(val => {
              const td = document.createElement('td');
              td.textContent = val;
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          lbContent.innerHTML = '';
          lbContent.appendChild(table);
        }
      } catch {
        lbContent.innerHTML = '<em>Failed to load leaderboard.</em>';
      }
    });

    document.getElementById('leaderboard-dash-overlay-close').addEventListener('click', () => {
      document.getElementById('leaderboard-dash-overlay').classList.add('hidden');
    });

    // ── Profile button ──────────────────────────────────────────────────────────
    let currentPlayerName = playerName;

    async function openProfileOverlay() {
      const profileOverlay = document.getElementById('profile-overlay');
      document.getElementById('profile-name-input').value = currentPlayerName;
      document.getElementById('profile-name-error').classList.add('hidden');
      document.getElementById('profile-name-ok').classList.add('hidden');
      profileCharIndex = Math.max(0, CHARACTERS.findIndex(c => c.model === characterModel));
      renderProfileCharacterPicker(false);
      profileOverlay.classList.remove('hidden');
      try {
        const [upgrades, stats] = await Promise.all([
          getUserUpgrades(getSession()),
          getPlayerStats(currentPlayerName),
        ]);
        profileUnlockedKeys = upgrades || {};
        profileCoins = stats?.coins || 0;
        renderProfileCharacterPicker(false);
      } catch { /* keep current unlock display */ }
    }

    document.getElementById('btn-profile').addEventListener('click', openProfileOverlay);

    document.getElementById('btn-profile-close').addEventListener('click', () => {
      document.getElementById('profile-overlay').classList.add('hidden');
    });

    document.getElementById('btn-profile-name-save').addEventListener('click', async () => {
      const input = document.getElementById('profile-name-input');
      const errEl = document.getElementById('profile-name-error');
      const okEl = document.getElementById('profile-name-ok');
      const newName = input.value.trim();
      errEl.classList.add('hidden');
      okEl.classList.add('hidden');

      if (!newName || newName.length < 2) {
        errEl.textContent = 'NAME TOO SHORT (MIN 2)';
        errEl.classList.remove('hidden');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(newName)) {
        errEl.textContent = 'LETTERS, NUMBERS & _ ONLY';
        errEl.classList.remove('hidden');
        return;
      }
      if (newName.toLowerCase() === currentPlayerName.toLowerCase()) {
        errEl.textContent = 'SAME AS CURRENT NAME';
        errEl.classList.remove('hidden');
        return;
      }

      const btn = document.getElementById('btn-profile-name-save');
      btn.textContent = 'SAVING...';
      btn.disabled = true;
      try {
        const existing = await getUser(newName);
        if (existing) {
          errEl.textContent = 'NAME TAKEN — TRY ANOTHER';
          errEl.classList.remove('hidden');
          return;
        }
        const sessionUser = getSession();
        await updateUserDisplayName(sessionUser, newName);
        currentPlayerName = newName;
        setCookie('playerName', newName);
        okEl.classList.remove('hidden');
      } catch {
        errEl.textContent = 'ERROR — CHECK CONNECTION';
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'SAVE';
        btn.disabled = false;
      }
    });

    let profileCharIndex = Math.max(0, CHARACTERS.findIndex(c => c.model === characterModel));
    let profileUnlockedKeys = {};
    let profileCoins = 0;

    function profileCharacterUnlocked(character) {
      return character.free || !!profileUnlockedKeys[`char_${character.key}`];
    }

    async function renderProfileCharacterPicker(saveChoice = false) {
      const chosen = CHARACTERS[profileCharIndex];
      const statusEl = document.getElementById('profile-char-save-status');
      const buyBtn = document.getElementById('profile-char-buy');
      document.getElementById('profile-char-emoji').textContent = chosen.emoji;
      const locked = !profileCharacterUnlocked(chosen);
      document.getElementById('profile-char-lock-info').classList.toggle('hidden', !locked);
      if (buyBtn) {
        buyBtn.classList.toggle('hidden', !locked);
        buyBtn.textContent = `🪙 ${chosen.cost || 0} — UNLOCK`;
        buyBtn.disabled = false;
      }
      if (statusEl) statusEl.textContent = locked ? 'LOCKED' : '';
      if (locked || !saveChoice) return;

      if (statusEl) statusEl.textContent = 'SAVING...';
      try {
        await updateUserCharacter(getSession(), chosen.model);
        setCookie('characterModel', chosen.model, 365);
        if (chosen.model !== characterModel) {
          characterModel = chosen.model;
          swapPlayerCharacter(characterModel);
        }
        if (statusEl) statusEl.textContent = 'SAVED!';
        setTimeout(() => {
          if (statusEl && CHARACTERS[profileCharIndex].model === chosen.model) statusEl.textContent = '';
        }, 1200);
      } catch {
        if (statusEl) statusEl.textContent = 'SAVE FAILED';
      }
    }

    document.getElementById('profile-char-left').addEventListener('click', () => {
      profileCharIndex = (profileCharIndex - 1 + CHARACTERS.length) % CHARACTERS.length;
      renderProfileCharacterPicker(true);
    });

    document.getElementById('profile-char-right').addEventListener('click', () => {
      profileCharIndex = (profileCharIndex + 1) % CHARACTERS.length;
      renderProfileCharacterPicker(true);
    });

    document.getElementById('profile-char-buy').addEventListener('click', async () => {
      const chosen = CHARACTERS[profileCharIndex];
      const btn = document.getElementById('profile-char-buy');
      const statusEl = document.getElementById('profile-char-save-status');
      const cost = chosen.cost || 0;
      if (!btn || profileCharacterUnlocked(chosen)) return;
      if (profileCoins < cost) {
        btn.textContent = 'NOT ENOUGH 🪙';
        btn.disabled = true;
        setTimeout(() => {
          btn.textContent = `🪙 ${cost} — UNLOCK`;
          btn.disabled = false;
        }, 2000);
        return;
      }
      btn.textContent = 'BUYING...';
      btn.disabled = true;
      try {
        await purchaseUpgrade(currentPlayerName, `char_${chosen.key}`, cost);
        profileUnlockedKeys[`char_${chosen.key}`] = true;
        profileCoins -= cost;
        if (statusEl) statusEl.textContent = 'UNLOCKED!';
        renderProfileCharacterPicker(true);
      } catch (err) {
        btn.textContent = err.message === 'NOT_ENOUGH_COINS' ? 'NOT ENOUGH 🪙' : 'ERROR!';
        setTimeout(() => {
          btn.textContent = `🪙 ${cost} — UNLOCK`;
          btn.disabled = false;
        }, 2000);
      }
    });

    // ── Shop ────────────────────────────────────────────────────────────────────
    const SHOP_UPGRADES = [
      {
        key: 'rainbowTrail',
        name: 'RAINBOW TRAIL',
        desc: 'LEAVES A RAINBOW STREAK\nBEHIND YOU AS YOU RUN!',
        emoji: '🌈',
        cost: 100,
      },
    ];

    let playerUpgrades = {};
    let shopCoins = 0;

    async function openShopOverlay() {
      const shopOverlay = document.getElementById('shop-overlay');
      shopOverlay.classList.remove('hidden');
      const coinsEl = document.getElementById('shop-coins-display');
      const listEl = document.getElementById('shop-items-list');
      coinsEl.textContent = '🪙 ...';
      listEl.innerHTML = '<em style="font-family:sans-serif;color:rgba(255,255,255,0.4);font-size:12px">Loading...</em>';

      try {
        const [stats, upgrades] = await Promise.all([
          getPlayerStats(currentPlayerName),
          getUserUpgrades(getSession()),
        ]);
        shopCoins = stats.coins || 0;
        playerUpgrades = upgrades || {};
        coinsEl.textContent = `🪙 ${shopCoins}`;
        renderShopItems(listEl);
      } catch {
        listEl.innerHTML = '<em style="font-family:sans-serif;color:#ff4444;font-size:12px">Failed to load.</em>';
      }
    }

    function renderShopItems(listEl) {
      listEl.innerHTML = '';
      SHOP_UPGRADES.forEach(upgrade => {
        const owned = !!playerUpgrades[upgrade.key];
        const item = document.createElement('div');
        item.className = `shop-item${owned ? ' owned-item' : ''} ${upgrade.key === 'rainbowTrail' ? 'rainbow-item' : ''}`;
        item.innerHTML = `
          <div class="shop-item-icon">${upgrade.emoji}</div>
          <div class="shop-item-info">
            <div class="shop-item-name">${upgrade.name}</div>
            <div class="shop-item-desc">${upgrade.desc.replace(/\n/g, '<br>')}</div>
          </div>
          <div class="shop-item-buy">
            <button class="arcade-btn btn-shop-buy${owned ? ' owned' : ''}" data-key="${upgrade.key}" ${owned ? 'disabled' : ''}>
              ${owned ? '✔ OWNED' : `🪙 ${upgrade.cost}`}
            </button>
          </div>
        `;
        if (!owned) {
          item.querySelector('.btn-shop-buy').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.textContent = 'BUYING...';
            btn.disabled = true;
            try {
              await purchaseUpgrade(currentPlayerName, upgrade.key, upgrade.cost);
              playerUpgrades[upgrade.key] = true;
              shopCoins -= upgrade.cost;
              document.getElementById('shop-coins-display').textContent = `🪙 ${shopCoins}`;
              // If rainbow trail was just purchased, activate it
              if (upgrade.key === 'rainbowTrail') {
                window.hasRainbowTrail = true;
              }
              renderShopItems(listEl);
            } catch (err) {
              if (err.message === 'NOT_ENOUGH_COINS') {
                btn.textContent = 'NOT ENOUGH 🪙';
                setTimeout(() => { btn.textContent = `🪙 ${upgrade.cost}`; btn.disabled = false; }, 2000);
              } else {
                btn.textContent = 'ERROR!';
                setTimeout(() => { btn.textContent = `🪙 ${upgrade.cost}`; btn.disabled = false; }, 2000);
              }
            }
          });
        }
        listEl.appendChild(item);
      });
    }

    document.getElementById('btn-open-shop').addEventListener('click', openShopOverlay);

    document.getElementById('btn-shop-close').addEventListener('click', () => {
      document.getElementById('shop-overlay').classList.add('hidden');
    });

    // ── Credits ──────────────────────────────────────────────────────────────────
    document.getElementById('btn-credits').addEventListener('click', async () => {
      const overlay = document.getElementById('credits-overlay');
      const textEl = document.getElementById('credits-text');
      overlay.classList.remove('hidden');
      try {
        const res = await fetch('/credits.txt');
        textEl.textContent = res.ok ? (await res.text()) || '(empty)' : 'Could not load credits.';
      } catch {
        textEl.textContent = 'Could not load credits.';
      }
    });
    document.getElementById('btn-credits-close').addEventListener('click', () => {
      document.getElementById('credits-overlay').classList.add('hidden');
    });

    // ── Advanced Settings ────────────────────────────────────────────────────────
    function bindAdvPinInput(inputId, displayId) {
      const input = document.getElementById(inputId);
      const display = document.getElementById(displayId);
      if (!input || !display) return;
      display.textContent = '○○○○○○';
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 6);
        const n = input.value.length;
        display.textContent = '●'.repeat(n) + '○'.repeat(6 - n);
      });
    }

    function openAdvancedSettings() {
      document.getElementById('profile-overlay').classList.add('hidden');
      ['adv-old-pin', 'adv-new-pin', 'adv-new-pin2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      ['adv-old-pin-display', 'adv-new-pin-display', 'adv-new-pin2-display'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '○○○○○○';
      });
      document.getElementById('adv-pin-error').classList.add('hidden');
      document.getElementById('adv-pin-ok').classList.add('hidden');
      document.getElementById('advanced-settings-overlay').classList.remove('hidden');
    }

    bindAdvPinInput('adv-old-pin', 'adv-old-pin-display');
    bindAdvPinInput('adv-new-pin', 'adv-new-pin-display');
    bindAdvPinInput('adv-new-pin2', 'adv-new-pin2-display');

    document.getElementById('btn-adv-settings-open').addEventListener('click', openAdvancedSettings);

    document.getElementById('btn-adv-settings-close').addEventListener('click', () => {
      document.getElementById('advanced-settings-overlay').classList.add('hidden');
      openProfileOverlay();
    });

    // ── Character Features ──────────────────────────────────────────────────────
    async function openCharacterFeatures() {
      document.getElementById('profile-overlay').classList.add('hidden');
      document.getElementById('character-features-overlay').classList.remove('hidden');

      let upgrades = {};
      try {
        upgrades = (await getUserUpgrades(getSession())) || {};
      } catch { /* keep defaults */ }

      const hasTrail = !!upgrades.rainbowTrail;
      const row = document.getElementById('feature-row-rainbowTrail');
      const btn = document.getElementById('btn-toggle-rainbowTrail');

      if (hasTrail) {
        row.classList.remove('locked');
        btn.disabled = false;
        const active = !!window.hasRainbowTrail;
        btn.textContent = active ? '✅ ON' : '❌ OFF';
        btn.className = `arcade-btn char-feature-toggle ${active ? 'on' : 'off'}`;
      } else {
        row.classList.add('locked');
        btn.disabled = true;
        btn.textContent = '🔒 LOCKED';
        btn.className = 'arcade-btn char-feature-toggle';
      }
    }

    document.getElementById('btn-char-features-open').addEventListener('click', openCharacterFeatures);

    document.getElementById('btn-char-features-close').addEventListener('click', () => {
      document.getElementById('character-features-overlay').classList.add('hidden');
      openProfileOverlay();
    });

    document.getElementById('btn-toggle-rainbowTrail').addEventListener('click', () => {
      window.hasRainbowTrail = !window.hasRainbowTrail;
      const btn = document.getElementById('btn-toggle-rainbowTrail');
      const active = window.hasRainbowTrail;
      btn.textContent = active ? '✅ ON' : '❌ OFF';
      btn.className = `arcade-btn char-feature-toggle ${active ? 'on' : 'off'}`;
    });

    document.getElementById('btn-adv-save-pin').addEventListener('click', async () => {
      const oldPin = document.getElementById('adv-old-pin').value.trim();
      const newPin = document.getElementById('adv-new-pin').value.trim();
      const newPin2 = document.getElementById('adv-new-pin2').value.trim();
      const errEl = document.getElementById('adv-pin-error');
      const okEl = document.getElementById('adv-pin-ok');
      errEl.classList.add('hidden');
      okEl.classList.add('hidden');

      if (!oldPin || oldPin.length < 4) { errEl.textContent = 'ENTER YOUR CURRENT PIN (4-6 DIGITS)'; errEl.classList.remove('hidden'); return; }
      if (!newPin || newPin.length < 4) { errEl.textContent = 'NEW PIN MUST BE 4-6 DIGITS'; errEl.classList.remove('hidden'); return; }
      if (newPin !== newPin2) { errEl.textContent = 'NEW PINS DO NOT MATCH'; errEl.classList.remove('hidden'); return; }
      if (newPin === oldPin) { errEl.textContent = 'NEW PIN SAME AS OLD PIN'; errEl.classList.remove('hidden'); return; }

      const btn = document.getElementById('btn-adv-save-pin');
      btn.textContent = 'SAVING...';
      btn.disabled = true;
      try {
        await changePin(getSession(), oldPin, newPin);
        okEl.classList.remove('hidden');
        ['adv-old-pin', 'adv-new-pin', 'adv-new-pin2'].forEach(id => { document.getElementById(id).value = ''; });
        ['adv-old-pin-display', 'adv-new-pin-display', 'adv-new-pin2-display'].forEach(id => { document.getElementById(id).textContent = '○○○○○○'; });
      } catch (err) {
        if (err.message === 'WRONG_PIN') errEl.textContent = 'CURRENT PIN IS INCORRECT';
        else errEl.textContent = 'ERROR — CHECK CONNECTION';
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'SAVE NEW PIN';
        btn.disabled = false;
      }
    });

    document.getElementById('btn-adv-delete-account').addEventListener('click', () => {
      document.getElementById('delete-error').classList.add('hidden');
      document.getElementById('delete-confirm-overlay').classList.remove('hidden');
    });

    document.getElementById('btn-delete-no').addEventListener('click', () => {
      document.getElementById('delete-confirm-overlay').classList.add('hidden');
    });

    document.getElementById('btn-delete-yes').addEventListener('click', async () => {
      const btn = document.getElementById('btn-delete-yes');
      const errEl = document.getElementById('delete-error');
      btn.textContent = 'DELETING...';
      btn.disabled = true;
      errEl.classList.add('hidden');
      try {
        await deleteAccount(getSession());
        clearSession();
        window.location.reload();
      } catch {
        errEl.textContent = 'ERROR — CHECK CONNECTION';
        errEl.classList.remove('hidden');
        btn.textContent = 'YES, DELETE';
        btn.disabled = false;
      }
    });

    // Preload upgrade state so the trail activates on game start if already owned
    (async () => {
      try {
        const upgrades = await getUserUpgrades(getSession());
        if (upgrades?.rainbowTrail) window.hasRainbowTrail = true;
      } catch { /* ignore */ }
    })();

    // ── Adventure Mode ──────────────────────────────────────────────────────────
    const adventureRoundOverlay = document.getElementById('adventure-round-overlay');
    const adventureWinOverlay = document.getElementById('adventure-win-overlay');
    const adventureLoseOverlay = document.getElementById('adventure-lose-overlay');

    function getAdventureState() {
      try { return JSON.parse(sessionStorage.getItem('adventureState') || 'null'); } catch { return null; }
    }
    function setAdventureState(state) {
      if (state) sessionStorage.setItem('adventureState', JSON.stringify(state));
      else sessionStorage.removeItem('adventureState');
    }

    function showAdventureRound(roundIdx) {
      const safeRoundIdx = clampAdventureRound(roundIdx);
      const char = ADVENTURE_ORDER[safeRoundIdx];
      if (!char) return;
      overlay.classList.add('hidden');
      document.getElementById('adv-round-label').textContent = `ROUND ${safeRoundIdx + 1} / ${ADVENTURE_ORDER.length}`;
      document.getElementById('adv-enemy-emoji').textContent = char.emoji;
      document.getElementById('adv-enemy-name').textContent = char.label;
      const config = getAdventureRoundConfig(safeRoundIdx);
      setAdventureState({ active: true, round: safeRoundIdx, charKey: char.key, charModel: char.model, charEmoji: char.emoji, charLabel: char.label, config });
      document.querySelector('#adventure-round-overlay .adventure-vs-desc').textContent = `BOTS (${config.enemyBots}) VS YOU (${config.playerTeamSize})`;
      adventureRoundOverlay.classList.remove('hidden');
    }

    function startAdventureRound(roundIdx) {
      const safeRoundIdx = clampAdventureRound(roundIdx);
      const char = ADVENTURE_ORDER[safeRoundIdx];
      const config = getAdventureRoundConfig(safeRoundIdx);
      saveAdventureRound(safeRoundIdx);
      localStorage.setItem(ADVENTURE_IN_PROGRESS_KEY, '1');
      setAdventureState({ active: true, round: safeRoundIdx, charKey: char.key, charModel: char.model, charEmoji: char.emoji, charLabel: char.label, config });
      sessionStorage.setItem('skipToGame', '1');
      unsubCount();
      adventureRoundOverlay.classList.add('hidden');
      resolve({ botsOnly: true, botsPerTeam: 3, ballSizeMultiplier: 1.0, gravityMultiplier: 1.0, adventureMode: true, adventureCharModel: char.model, adventureRoundConfig: config });
    }

    document.getElementById('btn-adventure-mode').addEventListener('click', () => {
      showAdventureRound(getSavedAdventureRound());
    });

    // ── Tournament Mode button ────────────────────────────────────────────────
    document.getElementById('btn-tournament-mode')?.addEventListener('click', () => {
      overlay.classList.add('hidden');
      openTournamentList(playerName, () => {
        overlay.classList.remove('hidden');
      }, (tid, matchId, isTeam1, roomId) => {
        // Start a tournament game
        sessionStorage.setItem('tournamentId', tid);
        sessionStorage.setItem('tournamentMatchId', matchId);
        sessionStorage.setItem('tournamentRoomId', roomId);
        sessionStorage.setItem('tournamentIsTeam1', isTeam1 ? '1' : '0');
        sessionStorage.setItem('skipToGame', '1');
        unsubCount();
        resolve({ botsOnly: false, botsPerTeam: 3, ballSizeMultiplier: 1.0, gravityMultiplier: 1.0 });
      });
    });

    document.getElementById('adv-start-round').addEventListener('click', () => {
      const state = getAdventureState();
      const roundIdx = state?.round ?? 0;
      startAdventureRound(roundIdx);
    });

    document.getElementById('adv-quit-pre').addEventListener('click', () => {
      setAdventureState(null);
      adventureRoundOverlay.classList.add('hidden');
      overlay.classList.remove('hidden');
    });

    // Adventure win overlay buttons
    document.getElementById('adv-next-round').addEventListener('click', () => {
      const state = getAdventureState();
      const nextRound = (state?.round ?? 0) + 1;
      if (nextRound >= ADVENTURE_ORDER.length) {
        // All rounds complete
        saveAdventureRound(ADVENTURE_ORDER.length - 1);
        localStorage.removeItem(ADVENTURE_IN_PROGRESS_KEY);
        setAdventureState(null);
        adventureWinOverlay.classList.add('hidden');
        overlay.classList.remove('hidden');
      } else {
        const nextChar = ADVENTURE_ORDER[nextRound];
        saveAdventureRound(nextRound);
        setAdventureState({ active: true, round: nextRound, charKey: nextChar.key, charModel: nextChar.model, charEmoji: nextChar.emoji, charLabel: nextChar.label, config: getAdventureRoundConfig(nextRound) });
        adventureWinOverlay.classList.add('hidden');
        showAdventureRound(nextRound);
      }
    });

    document.getElementById('adv-win-quit').addEventListener('click', () => {
      setAdventureState(null);
      adventureWinOverlay.classList.add('hidden');
      overlay.classList.remove('hidden');
    });

    // Adventure lose overlay buttons
    document.getElementById('adv-try-again').addEventListener('click', () => {
      const state = getAdventureState();
      const retryRound = clampAdventureRound(state?.round ?? getSavedAdventureRound());
      adventureLoseOverlay.classList.add('hidden');
      showAdventureRound(retryRound);
    });

    document.getElementById('adv-lose-quit').addEventListener('click', () => {
      setAdventureState(null);
      adventureLoseOverlay.classList.add('hidden');
      overlay.classList.remove('hidden');
    });

    // Check if returning from an adventure round game
    const returningAdventureState = getAdventureState();
    if (returningAdventureState?.active && sessionStorage.getItem('adventureResult')) {
      const result = sessionStorage.getItem('adventureResult');
      sessionStorage.removeItem('adventureResult');
      const roundIdx = clampAdventureRound(returningAdventureState.round);
      const char = ADVENTURE_ORDER[roundIdx];

      overlay.classList.add('hidden');

      localStorage.removeItem(ADVENTURE_IN_PROGRESS_KEY);
      if (result === 'win') {
        saveAdventureRound(Math.min(roundIdx + 1, ADVENTURE_ORDER.length - 1));
        document.getElementById('adv-win-text').textContent = `YOU DEFEATED THE ${char?.label || ''}!`;
        document.getElementById('adv-unlocked-emoji').textContent = char?.emoji || '';
        const isLastRound = roundIdx >= ADVENTURE_ORDER.length - 1;
        document.getElementById('adv-next-round').classList.toggle('hidden', isLastRound);
        if (isLastRound) {
          document.getElementById('adv-win-text').textContent = 'YOU BEAT ADVENTURE MODE!';
        }
        adventureWinOverlay.classList.remove('hidden');
      } else if (result === 'draw') {
        saveAdventureRound(roundIdx);
        showAdventureRound(roundIdx);
      } else {
        const previousRound = clampAdventureRound(roundIdx - 1);
        saveAdventureRound(previousRound);
        setAdventureState({ active: true, round: previousRound, config: getAdventureRoundConfig(previousRound) });
        document.querySelector('#adventure-lose-overlay .adventure-result-text').innerHTML = 'YOU LOST — TRY AGAIN FROM<br>THE PREVIOUS ROUND.';
        adventureLoseOverlay.classList.remove('hidden');
      }
    }
  });

  // ── Tournament UI functions ────────────────────────────────────────────────
  function fmtMs(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  }

  function renderBracket(bracket, myName, targetEl) {
    if (!bracket?.matches || !bracket?.teams) { targetEl.innerHTML = '<em>No bracket data</em>'; return; }

    const roundNums = [...new Set(Object.values(bracket.matches).map(m => m.round))].sort((a, b) => a - b);
    const roundNames = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
    targetEl.innerHTML = '';

    for (const r of roundNums) {
      const roundMatches = Object.entries(bracket.matches)
        .filter(([, m]) => m.round === r)
        .sort(([, a], [, b]) => a.matchIndex - b.matchIndex);

      const roundEl = document.createElement('div');
      roundEl.className = 'bracket-round';
      roundEl.innerHTML = `<div class="bracket-round-title">${roundNames[r] || `Round ${r + 1}`}</div>`;

      for (const [matchId, match] of roundMatches) {
        const t1 = bracket.teams[match.team1];
        const t2 = bracket.teams[match.team2];
        if (!t1 || !t2) continue;

        const myTeamId = findMyTeamInMatch(bracket, matchId, myName);
        const isMyMatch = !!myTeamId;
        const won1 = match.winner === 'team1';
        const won2 = match.winner === 'team2';

        const t1cls = `bracket-team${myTeamId === match.team1 ? ' my-team' : ''}${match.status === 'complete' ? (won1 ? ' winner' : ' loser') : ''}`;
        const t2cls = `bracket-team${myTeamId === match.team2 ? ' my-team' : ''}${match.status === 'complete' ? (won2 ? ' winner' : ' loser') : ''}`;

        let resultCls = 'result-waiting', resultTxt = 'UPCOMING';
        if (match.status === 'waiting_join') { resultCls = 'result-waiting'; resultTxt = 'JOINING...'; }
        if (match.status === 'playing')      { resultCls = 'result-playing'; resultTxt = 'LIVE'; }
        if (match.status === 'complete')     { resultCls = 'result-done';    resultTxt = 'DONE'; }

        const matchEl = document.createElement('div');
        matchEl.className = `bracket-match${isMyMatch ? ' my-match' : ''}`;
        matchEl.innerHTML = `
          <div class="bracket-match-teams">
            <span class="${t1cls}">${t1.name}</span>
            <span class="bracket-vs">vs</span>
            <span class="${t2cls}">${t2.name}</span>
          </div>
          <span class="bracket-match-result ${resultCls}">${resultTxt}</span>`;
        roundEl.appendChild(matchEl);
      }

      targetEl.appendChild(roundEl);
    }
  }

  function findMyTeamInMatch(bracket, matchId, myName) {
    const match = bracket?.matches?.[matchId];
    if (!match) return null;
    const t1 = bracket.teams?.[match.team1]?.players || [];
    const t2 = bracket.teams?.[match.team2]?.players || [];
    if (t1.some(p => !p.isBot && p.username === myName)) return match.team1;
    if (t2.some(p => !p.isBot && p.username === myName)) return match.team2;
    return null;
  }

  function openTournamentBracket(tid, myName, onStartGame) {
    const overlay = document.getElementById('tournament-bracket-overlay');
    const statusMsg = document.getElementById('bracket-status-msg');
    const countdownRow = document.getElementById('bracket-countdown-row');
    const countdownEl = document.getElementById('bracket-countdown');
    const countdownLabel = document.getElementById('bracket-countdown-label');
    const playersRow = document.getElementById('bracket-players-row');
    const playersLabel = document.getElementById('bracket-players-label');
    const bracketView = document.getElementById('tournament-bracket-view');
    const readyBtn = document.getElementById('bracket-ready-btn');
    const dashBtn = document.getElementById('bracket-dashboard-btn');
    const closeBtn = document.getElementById('bracket-close-btn');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    readyBtn.classList.add('hidden');
    dashBtn.classList.add('hidden');
    closeBtn.classList.add('hidden');
    countdownRow.classList.add('hidden');
    playersRow.classList.add('hidden');
    statusMsg.textContent = 'Loading bracket...';
    statusMsg.style.color = '#aaa';

    let joinCountdownTimer = null;
    let unsubBracket = null;
    let joinConfirmed = false;
    let gameStarted = false;

    function cleanup() {
      if (joinCountdownTimer) clearInterval(joinCountdownTimer);
      if (unsubBracket) unsubBracket();
    }

    unsubBracket = subscribeTournament(tid, async tData => {
      if (!tData?.bracket) {
        statusMsg.textContent = 'Tournament starting soon...';
        return;
      }

      renderBracket(tData.bracket, myName, bracketView);
      const myMatchInfo = findPlayerMatch(tData.bracket, myName);

      if (!myMatchInfo) {
        statusMsg.textContent = 'You are not in this tournament bracket.';
        statusMsg.style.color = '#aaa';
        closeBtn.classList.remove('hidden');
        return;
      }

      const { matchId, match, myTeamId, isTeam1 } = myMatchInfo;

      if (match.status === 'complete') {
        const playerWon = match.winnerId === myTeamId;
        if (playerWon) {
          statusMsg.textContent = '🏆 YOUR TEAM WON! Waiting for next round...';
          statusMsg.style.color = '#44ff88';
        } else {
          statusMsg.textContent = '💀 YOUR TEAM LOST. Better luck next time!';
          statusMsg.style.color = '#ff4444';
          closeBtn.classList.remove('hidden');
        }
        return;
      }

      if (match.status === 'playing' && !gameStarted) {
        gameStarted = true;
        const roomId = getMatchRoomId(tid, matchId);
        statusMsg.textContent = '▶ STARTING MATCH...';
        statusMsg.style.color = '#44ff88';
        cleanup();
        setTimeout(() => {
          if (onStartGame) {
            onStartGame(tid, matchId, isTeam1, roomId);
          } else {
            sessionStorage.setItem('tournamentId', tid);
            sessionStorage.setItem('tournamentMatchId', matchId);
            sessionStorage.setItem('tournamentRoomId', roomId);
            sessionStorage.setItem('tournamentIsTeam1', isTeam1 ? '1' : '0');
            sessionStorage.setItem('skipToGame', '1');
            location.reload();
          }
        }, 1000);
        return;
      }

      if (match.status === 'waiting_join') {
        const realPlayers = getRealPlayersForMatch(tData.bracket, matchId);
        const joined = match.joinedPlayers || {};
        const joinedCount = realPlayers.filter(p => joined[p]).length;

        statusMsg.textContent = `YOUR MATCH: ${myMatchInfo.myTeam.name} vs ${myMatchInfo.opponentTeam.name}`;
        statusMsg.style.color = '#ffcc44';

        playersRow.classList.remove('hidden');
        playersLabel.textContent = `${joinedCount}/${realPlayers.length} players joined`;

        if (!joinConfirmed) {
          joinConfirmed = true;
          await confirmJoin(tid, matchId, myName).catch(() => {});

          // Start countdown
          const deadline = Date.now() + JOIN_TIMEOUT_MS;
          countdownRow.classList.remove('hidden');
          countdownLabel.textContent = 'Match starts in:';

          if (joinCountdownTimer) clearInterval(joinCountdownTimer);
          joinCountdownTimer = setInterval(async () => {
            const left = deadline - Date.now();
            if (countdownEl) countdownEl.textContent = fmtMs(left);
            if (left <= 0) {
              clearInterval(joinCountdownTimer);
              // Kick non-joined players and start
              await kickAndFillBots(tid, matchId, tData.bracket).catch(() => {});
            }
          }, 500);
        }
      }
    });
  }

  function openTournamentList(myName, onBack, onStartGame) {
    const overlay = document.getElementById('tournament-overlay');
    const listEl = document.getElementById('tournament-list');
    const closeBtn = document.getElementById('tournament-close');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    listEl.innerHTML = '<em>Loading...</em>';

    let registeredTournaments = new Set();
    const unsub = subscribeTournamentList(tournaments => {
      listEl.innerHTML = '';
      if (!tournaments.length) { listEl.innerHTML = '<em>No upcoming tournaments</em>'; return; }

      for (const t of tournaments) {
        const isRegistered = !!t.registrations?.[myName];
        if (isRegistered) registeredTournaments.add(t.id);
        const regCount = t.registrationCount || 0;
        const now = Date.now();
        const minutesUntil = Math.floor((t.scheduledTime - now) / 60000);
        const timeStr = minutesUntil > 0
          ? `Starts in ${minutesUntil < 60 ? `${minutesUntil}m` : `${Math.floor(minutesUntil / 60)}h ${minutesUntil % 60}m`}`
          : (t.status === 'upcoming' ? 'Starting soon!' : '');

        const card = document.createElement('div');
        card.className = 'tournament-card';

        let statusCls = `status-${t.status}`;
        let statusLabel = t.status.toUpperCase();
        if (t.status === 'starting') statusLabel = 'STARTING!';
        if (t.status === 'complete' && t.champion) {
          const champTeam = t.bracket?.teams?.[t.champion];
          statusLabel = `WINNER: ${champTeam?.name || '?'}`;
        }

        card.innerHTML = `
          <div class="tournament-card-header">
            <span class="tournament-card-name">🏆 ${t.label}</span>
            <span class="tournament-card-status ${statusCls}">${statusLabel}</span>
          </div>
          <div class="tournament-card-info">${fmtTime(t.scheduledTime)}</div>
          <div class="tournament-card-info">${regCount} player${regCount !== 1 ? 's' : ''} registered</div>
          ${timeStr ? `<div class="tournament-card-info">${timeStr}</div>` : ''}`;

        const actionsEl = document.createElement('div');
        actionsEl.className = 'tournament-card-actions';

        if (t.status === 'upcoming' || t.status === 'starting') {
          if (isRegistered) {
            const badge = document.createElement('span');
            badge.className = 'tournament-registered-badge';
            badge.textContent = '✓ REGISTERED';
            actionsEl.appendChild(badge);

            const leaveBtn = document.createElement('button');
            leaveBtn.className = 'arcade-btn arcade-btn-red';
            leaveBtn.textContent = 'LEAVE';
            leaveBtn.addEventListener('click', async () => {
              leaveBtn.disabled = true;
              await unregisterFromTournament(t.id, myName).catch(() => {});
            });
            actionsEl.appendChild(leaveBtn);
          } else {
            const joinBtn = document.createElement('button');
            joinBtn.className = 'arcade-btn arcade-btn-green';
            joinBtn.textContent = 'JOIN';
            joinBtn.addEventListener('click', async () => {
              joinBtn.disabled = true;
              joinBtn.textContent = 'JOINING...';
              await ensureTournamentsExist().catch(() => {});
              await registerForTournament(t.id, myName).catch(() => {});
            });
            actionsEl.appendChild(joinBtn);
          }
        }

        if ((t.status === 'starting' || t.status === 'active') && isRegistered) {
          const viewBtn = document.createElement('button');
          viewBtn.className = 'arcade-btn arcade-btn-orange';
          viewBtn.textContent = 'VIEW BRACKET';
          viewBtn.addEventListener('click', () => {
            overlay.classList.add('hidden');
            openTournamentBracket(t.id, myName, onStartGame);
          });
          actionsEl.appendChild(viewBtn);
        }

        card.appendChild(actionsEl);
        listEl.appendChild(card);
      }
    });

    const handleClose = () => {
      unsub();
      overlay.classList.add('hidden');
      if (onBack) onBack();
    };

    closeBtn.replaceWith(closeBtn.cloneNode(true));
    document.getElementById('tournament-close').addEventListener('click', handleClose);
  }

  // ── Tournament game-over handler (called from showWinScreen) ─────────────────
  async function handleTournamentGameOver(winningTeam, localPlayerTeam) {
    const tid = sessionStorage.getItem('tournamentId');
    const matchId = sessionStorage.getItem('tournamentMatchId');
    const isTeam1 = sessionStorage.getItem('tournamentIsTeam1') === '1';
    if (!tid || !matchId) return;

    // Determine tournament winner
    let winnerTournamentTeam;
    if (winningTeam === null) {
      winnerTournamentTeam = 'team1'; // draw: team1 advances
    } else {
      const playerWon = winningTeam === localPlayerTeam;
      winnerTournamentTeam = (playerWon === isTeam1) ? 'team1' : 'team2';
    }

    await reportMatchResult(tid, matchId, winnerTournamentTeam).catch(() => {});

    const playerAdvanced = winnerTournamentTeam === (isTeam1 ? 'team1' : 'team2');

    const overlay = document.getElementById('tournament-bracket-overlay');
    const statusMsg = document.getElementById('bracket-status-msg');
    const countdownRow = document.getElementById('bracket-countdown-row');
    const countdownEl = document.getElementById('bracket-countdown');
    const countdownLabel = document.getElementById('bracket-countdown-label');
    const playersRow = document.getElementById('bracket-players-row');
    const readyBtn = document.getElementById('bracket-ready-btn');
    const dashBtn = document.getElementById('bracket-dashboard-btn');
    const closeBtn = document.getElementById('bracket-close-btn');
    const bracketView = document.getElementById('tournament-bracket-view');

    if (!overlay) return;
    overlay.classList.remove('hidden');
    readyBtn.classList.add('hidden');
    dashBtn.classList.add('hidden');
    closeBtn.classList.add('hidden');
    countdownRow.classList.add('hidden');
    playersRow.classList.add('hidden');

    // Load and render bracket
    const tSnap = await get(ref(db, `tournaments/${tid}`)).catch(() => null);
    const tData = tSnap?.val();
    if (tData?.bracket) renderBracket(tData.bracket, playerName, bracketView);

    if (playerAdvanced) {
      statusMsg.textContent = '🏆 YOU ADVANCED TO THE NEXT ROUND!';
      statusMsg.style.color = '#44ff88';
      readyBtn.classList.remove('hidden');
      countdownRow.classList.remove('hidden');
      countdownLabel.textContent = 'Auto-return in:';

      let secondsLeft = READY_TIMEOUT_MS / 1000;
      const countdownInterval = setInterval(() => {
        secondsLeft--;
        if (countdownEl) countdownEl.textContent = fmtMs(secondsLeft * 1000);
        if (secondsLeft <= 0) {
          clearInterval(countdownInterval);
          finishTournamentRound(tid);
        }
      }, 1000);

      const handleReady = () => {
        clearInterval(countdownInterval);
        readyBtn.disabled = true;
        readyBtn.textContent = '⏳ WAITING...';
        countdownRow.classList.add('hidden');
        finishTournamentRound(tid);
      };

      readyBtn.replaceWith(readyBtn.cloneNode(true));
      document.getElementById('bracket-ready-btn').addEventListener('click', handleReady);

    } else {
      statusMsg.textContent = '💀 YOU HAVE BEEN ELIMINATED!';
      statusMsg.style.color = '#ff4444';
      dashBtn.classList.remove('hidden');

      // Subscribe to watch the rest of the tournament
      const unsub = subscribeTournament(tid, tData2 => {
        if (tData2?.bracket) renderBracket(tData2.bracket, playerName, bracketView);
      });

      const handleDash = () => {
        unsub();
        sessionStorage.removeItem('tournamentId');
        sessionStorage.removeItem('tournamentMatchId');
        sessionStorage.removeItem('tournamentRoomId');
        sessionStorage.removeItem('tournamentIsTeam1');
        location.reload();
      };

      dashBtn.replaceWith(dashBtn.cloneNode(true));
      document.getElementById('bracket-dashboard-btn').addEventListener('click', handleDash);
    }
  }

  function finishTournamentRound(tid) {
    // Clear tournament session and return to dashboard to find next match
    sessionStorage.removeItem('tournamentId');
    sessionStorage.removeItem('tournamentMatchId');
    sessionStorage.removeItem('tournamentRoomId');
    sessionStorage.removeItem('tournamentIsTeam1');
    // Show notification-based flow: when next round is created, notification fires
    // For now, navigate back to dashboard and let the notification bring them back
    location.reload();
  }

  let multiplayer = null;
  let playerControls = null;
  const networkedEntities = new Map();
  const pendingEntityStates = new Map();
  const authoritativeEntityStates = new Map();
  let lastEntityBroadcast = 0;
  let lastControlSend = 0;
  const ENTITY_BROADCAST_INTERVAL = 120;
  const CONTROL_SEND_INTERVAL = 80;

  const otherPlayers = {};
  window.otherPlayers = otherPlayers;

  function cloneState(state) {
    return state ? JSON.parse(JSON.stringify(state)) : state;
  }

  function applyNetworkedState(id, state) {
    if (!state) return;
    const entry = networkedEntities.get(id);
    if (entry && typeof entry.applyState === 'function') {
      entry.applyState(state);
    } else {
      pendingEntityStates.set(id, cloneState(state));
    }
  }

  function registerNetworkedEntity(id, entry) {
    networkedEntities.set(id, entry);
    if (pendingEntityStates.has(id)) {
      const pending = pendingEntityStates.get(id);
      pendingEntityStates.delete(id);
      entry.applyState?.(pending);
    }
  }

  function updateAuthoritativeState(id, state, sourceId) {
    const copy = cloneState(state);
    authoritativeEntityStates.set(id, {
      state: copy,
      sourceId,
      timestamp: performance.now()
    });
    applyNetworkedState(id, copy);
  }

  function serializeAuthoritativeStates() {
    const payload = {};
    authoritativeEntityStates.forEach((entry, id) => {
      payload[id] = { ...cloneState(entry.state), sourceId: entry.sourceId };
    });
    return payload;
  }

  function collectLocalControlStates() {
    const result = new Map();
    const myId = multiplayer?.getId?.();
    if (!myId) return result;
    networkedEntities.forEach((entry, id) => {
      if (typeof entry.isLocallyControlled === 'function' && entry.isLocallyControlled()) {
        const state = entry.getState?.();
        if (state) {
          result.set(id, { state, sourceId: myId });
        }
      }
    });
    return result;
  }

  function handleIncomingData(peerId, data) {

    if (data.type === 'entityControl') {
      if (multiplayer?.isHost && data.id && data.state && data.sourceId) {
        updateAuthoritativeState(data.id, data.state, data.sourceId);
      }
      return;
    }

    if (data.type === 'entityStates' && data.states) {
      Object.entries(data.states).forEach(([id, entry]) => {
        if (!entry) return;
        const { sourceId, ...state } = entry;
        if (sourceId && sourceId === multiplayer?.getId?.()) {
          const localEntry = networkedEntities.get(id);
          if (localEntry?.isLocallyControlled?.()) {
            updateAuthoritativeState(id, state, sourceId);
            return;
          }
        }
        updateAuthoritativeState(id, state, sourceId ?? null);
      });
      return;
    }

    if (data.type === 'entitySnapshot' && data.states && multiplayer?.isHost) {
      authoritativeEntityStates.clear();
      Object.entries(data.states).forEach(([id, entry]) => {
        if (!entry) return;
        const { sourceId, ...state } = entry;
        updateAuthoritativeState(id, state, sourceId ?? null);
      });
      lastEntityBroadcast = 0;
      return;
    }

    if (data.type === 'entityStateRequest' && data.requesterId && data.previousHostId === multiplayer?.getId?.()) {
      const snapshot = serializeAuthoritativeStates();
      if (Object.keys(snapshot).length > 0) {
        multiplayer.sendTo(data.requesterId, { type: 'entitySnapshot', states: snapshot });
      }
      return;
    }

    if (data.type === 'presence') {
      const remoteId = data.id || peerId;
      const desiredModel = data.model || DEFAULT_CHARACTER_MODEL;

      // Determine this peer's team assignment
      const isNewPeer = !(remoteId in playerTeams);
      if (isNewPeer) {
        // Store their declared team (null if not yet assigned).
        // rebalanceTeams() will fill in nulls and broadcast final assignments.
        playerTeams[remoteId] = data.team || null;
        if (multiplayer?.isHost && !playerTeams[remoteId]) {
          setTimeout(rebalanceTeams, 100);
        }
      }

      const assignedTeam = playerTeams[remoteId] ?? null;
      const existing = otherPlayers[remoteId];
      const teamChanged = existing && existing.team !== assignedTeam;

      if (!existing || existing.modelPath !== desiredModel || teamChanged) {
        if (existing) {
          if (existing.model && existing.model.parent) {
            existing.model.parent.remove(existing.model);
          }
          if (existing.nameLabel && existing.nameLabel.parentNode) {
            existing.nameLabel.parentNode.removeChild(existing.nameLabel);
          }
        }

        const teamColor = assignedTeam === 'home' ? 0x3399ff : assignedTeam === 'away' ? 0xff3322 : null;
        const other = new PlayerCharacter(data.name, desiredModel, teamColor);
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[remoteId] = {
          model: other.model,
          nameLabel: other.nameLabel,
          name: data.name,
          health: existing?.health ?? 100,
          modelPath: desiredModel,
          team: assignedTeam
        };
      }

      const player = otherPlayers[remoteId];
      player.name = data.name;
      player.modelPath = desiredModel;
      player.team = assignedTeam;
      if (player.nameLabel) {
        player.nameLabel.innerText = data.name;
      }
      // Update remote player position and rotation
      player.model.position.x = data.x;
      player.model.position.z = data.z;

      // Adjust vertical placement against local terrain height
      const terrainY = (Number.isFinite(data.x) && Number.isFinite(data.z))
        ? getTerrainHeight(data.x, data.z)
        : 0;
      const hasAuthoritativeY = Number.isFinite(data.y);
      player.model.position.y = hasAuthoritativeY ? data.y : terrainY;

      player.model.rotation.y = data.rotation;
      const moon = window.moon;
      if (moon) {
        const moonPos = moon.position;
        const playerPos = player.model.position;
        const dist = playerPos.distanceTo(moonPos);
        if (dist < MOON_RADIUS * 2) {
          const up = new THREE.Vector3().subVectors(playerPos, moonPos).normalize();
          player.model.up.copy(up);
          const forward = new THREE.Vector3(Math.sin(data.rotation), 0, Math.cos(data.rotation))
            .projectOnPlane(up)
            .normalize();
          const target = playerPos.clone().add(forward);
          player.model.lookAt(target);
        } else {
          player.model.up.set(0, 1, 0);
          player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
        }
      } else {
        player.model.up.set(0, 1, 0);
        player.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
      }

      // Sync animation state if provided
      const actions = player.model.userData.actions;
      const current = player.model.userData.currentAction;
      if (actions && data.action && current !== data.action) {
        actions[current]?.fadeOut(0.2);
        actions[data.action]?.reset().fadeIn(0.2).play();
        player.model.userData.currentAction = data.action;
        if (['mutantPunch','hurricaneKick','mmaKick','slide'].includes(data.action)) {
          player.model.userData.attack = {
            name: data.action,
            start: Date.now(),
            hasHit: false
          };
        }
      }

      if (!multiplayer.connections[remoteId]) {
        multiplayer.connections[remoteId] = {};
      }
      const conn = multiplayer.connections[remoteId];
      if (!conn.listItem) {
        const list = document.getElementById('connected-players-list');
        const item = document.createElement('li');
        item.id = `peer-${remoteId}`;
        conn.listItem = item;
        list.appendChild(item);
      }
      conn.listItem.textContent = `Connected to ${data.name}`;
      return;
    }

    if (data.type === 'teamAssignments') {
      const myId = multiplayer?.getId?.();
      Object.entries(data.assignments || {}).forEach(([pid, team]) => {
        if (pid === myId) {
          if (team !== localPlayerTeam) {
            localPlayerTeam = team;
            window.localPlayerTeam = localPlayerTeam;
            localTeamConfirmed = true;
            const newColor = team === 'home' ? 0x3399ff : 0xff3322;
            swapPlayerCharacter(characterModel, newColor);
            // Only move to spawn if we haven't already been placed by joinResponse
            if (!receivedJoinResponse) {
              moveLocalPlayerToSpawn(team);
            }
          } else {
            localTeamConfirmed = true;
          }
        } else {
          const oldTeam = playerTeams[pid];
          playerTeams[pid] = team;
          // Force model rebuild on next presence if team changed
          if (otherPlayers[pid] && oldTeam !== team) {
            otherPlayers[pid].team = null;
          }
        }
      });

      if (data.aiCounts) {
        setAITeamCounts(data.aiCounts);
        // Apply AI positions immediately so they don't flash to default spawn positions
        if (data.aiStates) {
          Object.entries(data.aiStates).forEach(([id, state]) => {
            if (state) applyNetworkedState(id, state);
          });
        }
      } else if ('aiTeam' in data) {
        // Backward compatibility with older hosts that only supported one computer player.
        setAITeamCounts({ home: data.aiTeam === 'home' ? 1 : 0, away: data.aiTeam === 'away' ? 1 : 0 });
      }
      return;
    }

    if (data.type === 'joinRequest' && multiplayer?.isHost) {
      const requesterId = data.requesterId || peerId;

      // Assign team if not already done (may already be set if presence arrived first)
      if (!playerTeams[requesterId]) {
        // Honor preferred team for tournament games if the team has room
        if (data.preferredTeam && ['home', 'away'].includes(data.preferredTeam)) {
          playerTeams[requesterId] = data.preferredTeam;
        } else {
          playerTeams[requesterId] = assignTeamToNewPlayer();
        }
      }
      const assignedTeam = playerTeams[requesterId];

      // Capture the last AI on that team's position before removing it
      let spawnPosition = null;
      const teamAIs = aiPlayers[assignedTeam];
      if (teamAIs && teamAIs.length > 0) {
        const replacedAI = teamAIs[teamAIs.length - 1];
        if (replacedAI?.body) {
          const t = replacedAI.body.translation();
          spawnPosition = { x: t.x, y: t.y, z: t.z };
        }
      }

      // Update AI balance now that the new player's team is assigned
      updateAIForBalance();

      // Collect current AI states so the new player positions them correctly
      const aiStates = {};
      ['home', 'away'].forEach(team => {
        aiPlayers[team].forEach(ai => {
          if (ai.networkId) {
            aiStates[ai.networkId] = ai.getState?.() ?? null;
          }
        });
      });

      // Collect current ball state
      let ballState = null;
      if (soccerBall?.body) {
        const t = soccerBall.body.translation();
        const r = soccerBall.body.rotation();
        const v = soccerBall.body.linvel();
        ballState = { position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w], linvel: [v.x, v.y, v.z] };
      }

      // Include active set piece state so the joining client can sync up
      const activeSP = setPieceManager?.active ?? null;
      const setPieceState = activeSP ? {
        spType: activeSP.type,
        teamTaking: activeSP.teamTaking,
        ballFixedPos: activeSP.ballFixedPos,
        zone: activeSP.zone,
        exclusionZone: activeSP.exclusionZone,
        takerNetworkId: activeSP.takerNetworkId,
      } : null;

      multiplayer.sendTo(requesterId, {
        type: 'joinResponse',
        team: assignedTeam,
        spawnPosition,
        aiStates,
        ballState,
        gameTimeLeft,
        setPieceState,
        score: { home: score.home, away: score.away },
      });

      broadcastTeamAssignments();
      return;
    }

    if (data.type === 'joinResponse') {
      const { team, spawnPosition, aiStates, ballState, gameTimeLeft: hostTimeLeft } = data;

      // Sync the countdown to the host's current time so all players match
      if (typeof hostTimeLeft === 'number') {
        gameTimeLeft = hostTimeLeft;
        lastTimerTick = performance.now();
        updateTimerUI();
      }

      // Sync the score from the host so late joiners have the correct state
      if (data.score && typeof data.score.home === 'number') {
        score.home = data.score.home;
        score.away = data.score.away;
        updateScoreUI();
        scoreAuthoritative = true;
      }

      // Apply team assignment if not yet confirmed
      if (!localTeamConfirmed) {
        const changed = team !== localPlayerTeam;
        localPlayerTeam = team;
        window.localPlayerTeam = localPlayerTeam;
        localTeamConfirmed = true;
        receivedJoinResponse = true;
        if (changed) {
          const newColor = team === 'home' ? 0x3399ff : 0xff3322;
          swapPlayerCharacter(characterModel, newColor);
        }
      } else {
        receivedJoinResponse = true;
      }

      // Place player at the AI's position for a seamless handoff
      if (spawnPosition) {
        playerModel.position.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
        if (playerControls) {
          playerControls.playerX = spawnPosition.x;
          playerControls.playerY = spawnPosition.y;
          playerControls.playerZ = spawnPosition.z;
          playerControls.lastPosition.set(spawnPosition.x, spawnPosition.y, spawnPosition.z);
          playerControls.velocity?.set?.(0, 0, 0);
          if (playerControls.body) {
            playerControls.body.setTranslation(spawnPosition, true);
            playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
            playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      } else {
        moveLocalPlayerToSpawn(team);
      }

      // Apply ball and AI positions immediately
      if (ballState) applyNetworkedState('soccerball', ballState);
      if (aiStates) {
        Object.entries(aiStates).forEach(([id, state]) => {
          if (state) applyNetworkedState(id, state);
        });
      }
      // Restore active set piece if there is one
      if (data.setPieceState) {
        applySetPiece(data.setPieceState);
      }
      return;
    }

    if (data.type === 'setPiece') {
      // Only clients apply; host already applied it in triggerSetPiece
      if (!multiplayer.isHost) {
        applySetPiece({
          spType: data.spType,
          teamTaking: data.teamTaking,
          ballFixedPos: data.ballFixedPos,
          zone: data.zone,
          exclusionZone: data.exclusionZone ?? null,
          takerNetworkId: data.takerNetworkId ?? null,
        });
      }
      return;
    }

    if (data.type === 'setPieceClear') {
      if (!multiplayer.isHost) {
        setPieceManager?.clear();
        clearThrowIn();
      }
      return;
    }

    if (data.type === 'projectile') {
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(scene, projectiles, position, direction, data.id);

      const shooter = otherPlayers[data.id];
      if (shooter) {
        const actions = shooter.model.userData.actions;
        const current = shooter.model.userData.currentAction;
        const projAction = actions?.projectile;
        if (projAction) {
          actions[current]?.fadeOut(0.1);
          projAction.reset().fadeIn(0.1).play();
          shooter.model.userData.currentAction = 'projectile';
        }
      }
      return;
    }

    if (data.type === 'spaceship') {
      // Legacy messages handled by networked system; ignore to avoid conflicts.
      return;
    }

    if (data.type === 'grab') {
      if (data.target === multiplayer.getId()) {
        playerControls?.setGrabbed(data.active, data.from);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.grabbed = data.active;
        }
      }
      return;
    }

    if (data.type === 'grabMove') {
      const pos = new THREE.Vector3(...data.position);
      if (data.target === multiplayer.getId()) {
        playerControls?.updateGrabbedPosition(data.position);
      } else {
        const targetPlayer = otherPlayers[data.target];
        if (targetPlayer) {
          targetPlayer.model.position.copy(pos);
        }
      }
      return;
    }
  }

  const tournamentRoomId = sessionStorage.getItem('tournamentRoomId') || null;
  multiplayer = new Multiplayer(playerName, handleIncomingData, { botsOnly, forcedRoom: tournamentRoomId });
  multiplayer.onHostChange = ({ previousHostId, newHostId, isCurrentHost, roomPeerCount = 1 }) => {
    if (previousHostId && previousHostId === multiplayer.getId() && previousHostId !== newHostId) {
      const snapshot = serializeAuthoritativeStates();
      if (newHostId) {
        multiplayer.sendTo(newHostId, { type: 'entitySnapshot', states: snapshot });
      }
    }

    if (isCurrentHost) {
      scoreAuthoritative = true;
      lastEntityBroadcast = 0;
      if (previousHostId && previousHostId !== multiplayer.getId()) {
        multiplayer.sendTo(previousHostId, {
          type: 'entityStateRequest',
          requesterId: multiplayer.getId(),
          previousHostId
        });
      }
      // If there are other players in the room, I'm a new joiner — let rebalanceTeams
      // pick my team based on what's already occupied rather than defaulting to home.
      if (roomPeerCount > 1) {
        localTeamConfirmed = false;
      }
      // Rebalance teams after a short delay to allow presences from all peers to arrive
      setTimeout(rebalanceTeams, 600);
    }
  };

  multiplayer.onPeerDisconnect = (peerId) => {
    delete playerTeams[peerId];
    if (otherPlayers[peerId]) {
      if (otherPlayers[peerId].model?.parent)
        otherPlayers[peerId].model.parent.remove(otherPlayers[peerId].model);
      if (otherPlayers[peerId].nameLabel?.parentNode)
        otherPlayers[peerId].nameLabel.parentNode.removeChild(otherPlayers[peerId].nameLabel);
      delete otherPlayers[peerId];
    }
    const listItem = document.getElementById(`peer-${peerId}`);
    if (listItem) listItem.remove();
    if (multiplayer?.isHost) {
      updateAIForBalance();
      broadcastTeamAssignments();
    }
  };

  // When we connect to the host, send a join request so the host can relay
  // current game state (AI positions, ball, team assignment) back to us.
  multiplayer.onPeerConnected = (peerId) => {
    if (multiplayer.isHost) return;
    if (peerId === multiplayer.getHostId()) {
      const tournamentTeam = sessionStorage.getItem('tournamentIsTeam1') === '1' ? 'home' : (sessionStorage.getItem('tournamentIsTeam1') === '0' ? 'away' : null);
      multiplayer.sendTo(peerId, { type: 'joinRequest', requesterId: multiplayer.getId(), preferredTeam: tournamentTeam });
    }
  };

  const scene = new THREE.Scene();
  // Start with a plain light-blue sky so the game is immediately visible.
  // The full skybox cubemap is swapped in once it finishes loading in the background.
  scene.background = new THREE.Color(0x87ceeb);
  const cubeLoader = new THREE.CubeTextureLoader();
  cubeLoader.setPath('/assets/skybox/');
  cubeLoader.load(
    ['px.png', 'nx.png', 'py.png', 'ny.png', 'pz.png', 'nz.png'],
    (skyboxTexture) => { scene.background = skyboxTexture; }
  );

  // ── Rainbow trail system ───────────────────────────────────────────────────
  const TRAIL_COLORS = [0xff0000, 0xff7700, 0xffee00, 0x00ee00, 0x0088ff, 0x8800ff];
  const TRAIL_MAX = 24;
  const TRAIL_INTERVAL = 3; // frames between trail points
  let trailFrameCount = 0;
  let trailColorIndex = 0;
  const trailMeshes = [];

  function spawnTrailParticle(position) {
    const color = TRAIL_COLORS[trailColorIndex % TRAIL_COLORS.length];
    trailColorIndex++;
    const geo = new THREE.SphereGeometry(0.18, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y -= 0.1;
    mesh.userData.age = 0;
    scene.add(mesh);
    trailMeshes.push(mesh);
    if (trailMeshes.length > TRAIL_MAX) {
      const old = trailMeshes.shift();
      scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
    }
  }

  function updateRainbowTrail(playerModel, isMoving) {
    if (!window.hasRainbowTrail) {
      if (trailMeshes.length > 0) {
        trailMeshes.forEach(m => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
        trailMeshes.length = 0;
      }
      return;
    }
    trailFrameCount++;
    if (isMoving && trailFrameCount % TRAIL_INTERVAL === 0) {
      spawnTrailParticle(playerModel.position);
    }
    for (let i = trailMeshes.length - 1; i >= 0; i--) {
      const m = trailMeshes[i];
      m.userData.age += 1;
      const life = m.userData.age / TRAIL_MAX;
      m.material.opacity = Math.max(0, 0.9 - life * 0.9);
      m.scale.setScalar(Math.max(0.1, 1 - life * 0.7));
      if (m.material.opacity <= 0.01) {
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
        trailMeshes.splice(i, 1);
      }
    }
  }

  // ── Dust particle system ──────────────────────────────────────────────────────
  const dustParticles = [];
  const _dustGeo = new THREE.SphereGeometry(1, 5, 4);
  let _prevBallSpeed = 0;
  let _ballDustTimer = 0;
  let _playerDustTimer = 0;

  function spawnDustPuff(x, y, z, baseSize, count) {
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xc8a870,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(_dustGeo, mat);
      const s = baseSize * (0.7 + Math.random() * 0.6);
      mesh.scale.setScalar(s);
      mesh.position.set(
        x + (Math.random() - 0.5) * baseSize,
        y + Math.random() * 0.05,
        z + (Math.random() - 0.5) * baseSize
      );
      scene.add(mesh);
      const maxLife = 0.45 + Math.random() * 0.3;
      dustParticles.push({
        mesh, mat,
        life: maxLife,
        maxLife,
        vx: (Math.random() - 0.5) * 1.4,
        vy: 0.5 + Math.random() * 0.7,
        vz: (Math.random() - 0.5) * 1.4,
        baseScale: s,
      });
    }
  }

  function updateDustParticles(dt) {
    for (let i = dustParticles.length - 1; i >= 0; i--) {
      const p = dustParticles[i];
      p.life -= dt;
      const t = 1 - p.life / p.maxLife;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.vy = Math.max(0, p.vy - p.vy * 5 * dt);
      p.mesh.scale.setScalar(p.baseScale * (1 + t * 2.5));
      p.mat.opacity = Math.max(0, 0.55 * (1 - t));
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mat.dispose();
        dustParticles.splice(i, 1);
      }
    }

    if (soccerBall?.body) {
      const bv = soccerBall.body.linvel();
      const bSpeed = Math.sqrt(bv.x * bv.x + bv.y * bv.y + bv.z * bv.z);
      const bp = soccerBall.body.translation();
      const br = soccerBall.ballRadius ?? 0.28;
      const nearGround = bp.y < br + 0.55;

      // Kick: sudden speed spike → big puff burst
      if (bSpeed - _prevBallSpeed > 2.5 && nearGround) {
        spawnDustPuff(bp.x, bp.y - br * 0.6, bp.z, 0.22, 7);
      }
      _prevBallSpeed = bSpeed;

      // Rolling dust while ball moves near ground
      _ballDustTimer -= dt;
      if (_ballDustTimer <= 0 && bSpeed > 0.8 && nearGround) {
        _ballDustTimer = 0.06;
        spawnDustPuff(bp.x, bp.y - br * 0.9, bp.z, 0.08, 2);
      }
    }

    // Local player foot dust
    if (playerModel && playerControls?.isMoving && playerControls?.canJump) {
      _playerDustTimer -= dt;
      if (_playerDustTimer <= 0) {
        _playerDustTimer = 0.1;
        spawnDustPuff(
          playerModel.position.x,
          playerModel.position.y - 0.58,
          playerModel.position.z,
          0.05, 1
        );
      }
    }

    // AI player foot dust
    Object.values(aiPlayers).forEach(players => {
      players.forEach(ai => {
        if (!ai.body) return;
        const av = ai.body.linvel();
        const aSpeed = Math.sqrt(av.x * av.x + av.z * av.z);
        if (aSpeed < 0.5) return;
        const ap = ai.body.translation();
        if (ap.y > 1.8) return;
        if (!ai._dustTimer) ai._dustTimer = 0;
        ai._dustTimer -= dt;
        if (ai._dustTimer <= 0) {
          ai._dustTimer = 0.1;
          spawnDustPuff(ap.x, ap.y - 0.58, ap.z, 0.05, 1);
        }
      });
    });
  }

  createClouds(scene);

  let soccerBall;
  const MIN_PLAYERS_PER_TEAM = botsOnly ? botsPerTeam : 3;
  const aiPlayers = { home: [], away: [] };
  let setPieceManager;

  // Throw-in hand-holding state (local player is the taker)
  const throwInState = {
    holding: false,     // ball is held at player's hand
    handBone: null,     // THREE.Bone for right hand
    button: null,       // DOM button element
    thrown: false,      // animation triggered, waiting for release
  };

  // Bot throw-in state (an AI player is the taker)
  const botThrowInState = {
    active: false,      // bot throw-in sequence is running
    ai: null,           // the AIPlayer doing the throw-in
    handBone: null,     // THREE.Bone on the bot's model
    holding: false,     // ball is pinned to the bot's hand this frame
    thrown: false,      // throw has been executed
  };

  // Team management: tracks which team each peer is on ('home' | 'away')
  const playerTeams = {};
  let localPlayerTeam = 'home';
  window.localPlayerTeam = localPlayerTeam;
  let localTeamConfirmed = false;
  let receivedJoinResponse = false;

  const score = { home: 0, away: 0 };
  // True when score reflects authoritative state (host always true; clients set after joinResponse)
  let scoreAuthoritative = false;
  let goalCooldown = 0;
  let goalCelebrationActive = false;

  // ── Goal celebration ─────────────────────────────────────────────────────────
  let _confettiParticles = [];
  let _confettiEl = null;
  let _goalOverlayEl = null;

  function _ensureGoalOverlay() {
    if (_goalOverlayEl) return;
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
      'justify-content:center', 'pointer-events:none', 'z-index:500',
      'opacity:0', 'transition:opacity 0.3s',
    ].join(';');
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:18px;text-align:center;animation:goalPulse 0.5s ease-in-out infinite alternate;';
    const title = document.createElement('div');
    title.textContent = 'GOAL!';
    title.style.cssText = 'font-family:Impact,sans-serif;font-size:clamp(80px,18vw,200px);color:#ffe600;text-shadow:0 0 40px #ff8800,0 0 80px #ff4400,4px 4px 0 #000,-4px -4px 0 #000,4px -4px 0 #000,-4px 4px 0 #000;letter-spacing:10px;';
    const scorer = document.createElement('div');
    scorer.dataset.goalScorer = 'true';
    scorer.style.cssText = 'font-family:Impact,sans-serif;font-size:clamp(24px,5vw,56px);color:#fff;text-shadow:0 0 24px #000,3px 3px 0 #000,-3px -3px 0 #000;letter-spacing:2px;';
    content.append(title, scorer);
    el.appendChild(content);
    const style = document.createElement('style');
    style.textContent = `@keyframes goalPulse{from{transform:scale(1) rotate(-3deg)}to{transform:scale(1.08) rotate(3deg)}}`;
    document.head.appendChild(style);
    document.body.appendChild(el);
    _goalOverlayEl = el;
  }

  function _showGoalOverlay(scorerName = null, coinReward = GOAL_COIN_REWARD) {
    _ensureGoalOverlay();
    const scorerEl = _goalOverlayEl.querySelector('[data-goal-scorer]');
    if (scorerEl) {
      const name = scorerName || 'Someone';
      scorerEl.textContent = `${name} scored! +${coinReward} coins`;
    }
    _goalOverlayEl.style.opacity = '1';
  }

  function _hideGoalOverlay() {
    if (_goalOverlayEl) _goalOverlayEl.style.opacity = '0';
  }

  function _ensureConfettiCanvas() {
    if (_confettiEl) return;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:499;';
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    _confettiEl = canvas;
    window.addEventListener('resize', () => {
      if (_confettiEl) { _confettiEl.width = window.innerWidth; _confettiEl.height = window.innerHeight; }
    });
  }

  function _spawnConfetti(teamColor) {
    _ensureConfettiCanvas();
    _confettiEl.style.display = 'block';
    _confettiParticles = [];
    const colors = teamColor === 'home'
      ? ['#3399ff','#66bbff','#ffffff','#ffe600','#00ddff']
      : ['#ff3322','#ff8844','#ffffff','#ffe600','#ff66aa'];
    for (let i = 0; i < 220; i++) {
      _confettiParticles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight - window.innerHeight,
        vx: (Math.random() - 0.5) * 6,
        vy: Math.random() * 4 + 2,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.3,
        w: Math.random() * 10 + 5,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function _updateConfetti() {
    if (!_confettiEl || _confettiParticles.length === 0) return;
    const ctx = _confettiEl.getContext('2d');
    ctx.clearRect(0, 0, _confettiEl.width, _confettiEl.height);
    const alive = [];
    for (const p of _confettiParticles) {
      p.x += p.vx + Math.sin(p.phase) * 1.5;
      p.y += p.vy;
      p.rot += p.rotV;
      p.phase += 0.05;
      p.vy += 0.08; // gravity
      if (p.y < _confettiEl.height + 20) alive.push(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    _confettiParticles = alive;
  }

  function _clearConfetti() {
    if (_confettiEl) {
      const ctx = _confettiEl.getContext('2d');
      ctx.clearRect(0, 0, _confettiEl.width, _confettiEl.height);
      _confettiEl.style.display = 'none';
    }
    _confettiParticles = [];
  }

  // 3-D burst of coloured particles from the goal mouth
  function _spawnGoalExplosion(goalPos, teamColor) {
    const colors = teamColor === 'home'
      ? [0x3399ff, 0x66bbff, 0xffee00, 0xffffff]
      : [0xff3322, 0xff8844, 0xffee00, 0xffffff];
    const geo = new THREE.SphereGeometry(0.18, 6, 6);
    const particles = [];
    for (let i = 0; i < 80; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: colors[Math.floor(Math.random() * colors.length)] });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(goalPos.x + (Math.random() - 0.5) * 4, goalPos.y + Math.random() * 2, goalPos.z);
      scene.add(mesh);
      const speed = Math.random() * 18 + 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      particles.push({
        mesh,
        vx: Math.sin(phi) * Math.cos(theta) * speed,
        vy: Math.sin(phi) * Math.sin(theta) * speed + 5,
        vz: Math.cos(phi) * speed * 0.3,
        life: 1.0,
      });
    }

    let lastT = performance.now();
    function animateExplosion(now) {
      const dt = Math.min((now - lastT) / 1000, 0.05);
      lastT = now;
      let anyAlive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vy -= 20 * dt; // gravity
        p.life -= dt * 0.6;
        p.mesh.material.opacity = p.life;
        p.mesh.material.transparent = true;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          p.mesh.material.dispose();
        } else {
          anyAlive = true;
        }
      }
      if (anyAlive) requestAnimationFrame(animateExplosion);
    }
    requestAnimationFrame(animateExplosion);
  }

  function _resetPlayersToSides() {
    // Reset local player
    moveLocalPlayerToSpawn(localPlayerTeam);
    // Reset AI players to their spawn positions
    ['home', 'away'].forEach(team => {
      const spawnZ = team === 'home' ? -38 : 38;
      aiPlayers[team].forEach((ai, i) => {
        if (!ai.body) return;
        const spacing = 4;
        const spawnX = (i - (aiPlayers[team].length - 1) / 2) * spacing;
        ai.body.setTranslation({ x: spawnX, y: 1.5, z: spawnZ }, true);
        ai.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        ai.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      });
    });
  }

  function triggerGoalCelebration(scoringTeam, goalPos, scorerName = null, onComplete) {
    goalCelebrationActive = true;
    if (playerControls) playerControls.enabled = false;
    Object.values(aiPlayers).flat().forEach(ai => { ai.frozen = true; });

    // Freeze ball in place
    if (soccerBall?.body) {
      soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    _showGoalOverlay(scorerName);
    _spawnConfetti(scoringTeam);
    _spawnGoalExplosion(goalPos, scoringTeam);

    setTimeout(() => {
      _hideGoalOverlay();
      _clearConfetti();

      // Reset ball
      soccerBall.reset();

      // Reset players to their sides
      _resetPlayersToSides();

      // Spawn one defender from the team that conceded near center
      const defendingTeam = scoringTeam === 'home' ? 'away' : 'home';
      const defAI = aiPlayers[defendingTeam]?.[0];
      if (defAI?.body) {
        defAI.body.setTranslation({ x: (Math.random() - 0.5) * 6, y: 1.5, z: (defendingTeam === 'home' ? -3 : 3) }, true);
        defAI.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        defAI.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }

      // Unfreeze
      if (playerControls) playerControls.enabled = true;
      Object.values(aiPlayers).flat().forEach(ai => { ai.frozen = false; });
      goalCelebrationActive = false;

      if (onComplete) onComplete();
    }, 4000);
  }
  const SCORE_GOAL_WIDTH = 10;
  const SCORE_GOAL_HEIGHT = 3;
  const SCORE_FIELD_HALF = 50;
  const BALL_OUT_OF_BOUNDS_BUFFER = 1.0;

  const scoreEl = document.createElement('div');
  scoreEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.6);font-size:28px;font-weight:bold;padding:8px 28px;border-radius:10px;z-index:200;font-family:sans-serif;pointer-events:none;letter-spacing:4px;';
  scoreEl.innerHTML = '<span style="color:#3399ff">0</span> <span style="color:#fff">-</span> <span style="color:#ff3322">0</span>';
  document.body.appendChild(scoreEl);

  function updateScoreUI() {
    scoreEl.innerHTML = `<span style="color:#3399ff">${score.home}</span> <span style="color:#fff">-</span> <span style="color:#ff3322">${score.away}</span>`;
  }

  // ── 3-minute game timer ──────────────────────────────────────────────────────
  const GAME_DURATION_S = 3 * 60;
  let gameTimeLeft = GAME_DURATION_S;
  let gameTimerActive = true;
  let lastTimerTick = performance.now();
  // Host always has the authoritative score; clients get it synced via joinResponse
  if (multiplayer.isHost) scoreAuthoritative = true;

  const timerEl = document.createElement('div');
  timerEl.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.55);color:#fff;font-size:20px;font-weight:bold;padding:4px 18px;border-radius:8px;z-index:200;font-family:sans-serif;pointer-events:none;letter-spacing:2px;';
  timerEl.textContent = '3:00';
  document.body.appendChild(timerEl);

  function updateTimerUI() {
    const m = Math.floor(gameTimeLeft / 60);
    const s = gameTimeLeft % 60;
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (gameTimeLeft <= 30) timerEl.style.color = '#ff4444';
    else timerEl.style.color = '#fff';
  }

  const winOverlay = document.getElementById('win-overlay');
  const winMessage = document.getElementById('win-message');
  const playAgainBtn = document.getElementById('play-again-btn');

  playAgainBtn.addEventListener('click', () => {
    sessionStorage.setItem('skipToGame', '1');
    location.reload();
  });

  function showWinScreen() {
    const winningTeam = score.home > score.away ? 'home' : score.away > score.home ? 'away' : null;
    const teamLabel = winningTeam === 'home' ? 'Blue' : winningTeam === 'away' ? 'Red' : null;
    const color = winningTeam === 'home' ? '#3399ff' : winningTeam === 'away' ? '#ff3322' : '#ffffff';
    const text = teamLabel ? `${teamLabel} Team Wins!` : "It's a Tie!";
    winMessage.textContent = text;

    // Record game result only when we have the authoritative score (host always does;
    // clients get it synced via joinResponse — late joiners without a sync are skipped).
    if (scoreAuthoritative) {
      let result;
      if (winningTeam === null) result = 'draw';
      else if (winningTeam === localPlayerTeam) result = 'win';
      else result = 'loss';
      recordGameResult(playerName, result).catch(() => {});
    }
    winMessage.style.color = color;
    winOverlay.classList.remove('hidden');

    // Freeze all movement
    if (playerControls) playerControls.enabled = false;
    Object.values(aiPlayers).flat().forEach(ai => { ai.frozen = true; });

    // Position winning-team players at center field in a celebration row
    if (winningTeam) {
      const winners = [];
      if (localPlayerTeam === winningTeam && playerModel && playerControls) {
        winners.push({ model: playerModel, body: playerControls.body });
      }
      (aiPlayers[winningTeam] || []).forEach(ai => {
        if (ai.model && ai.body) winners.push({ model: ai.model, body: ai.body });
      });

      const spacing = 3;
      const startX = -((winners.length - 1) * spacing) / 2;
      winners.forEach(({ model, body }, i) => {
        const x = startX + i * spacing;
        model.position.set(x, 1.5, 0);
        model.rotation.set(0, 0, 0);
        if (body) {
          body.setTranslation({ x, y: 1.5, z: 0 }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
        // Play idle animation
        const actions = model.userData.actions;
        const current = model.userData.currentAction;
        if (actions?.idle) {
          actions[current]?.fadeOut(0.2);
          actions.idle.reset().fadeIn(0.2).play();
          model.userData.currentAction = 'idle';
        }
      });
    }

    // After 4 seconds reveal the Play Again button (or adventure/tournament result)
    setTimeout(async () => {
      if (sessionStorage.getItem('tournamentId') && sessionStorage.getItem('tournamentMatchId')) {
        // Tournament game over — show bracket and ready/eliminated screen
        await handleTournamentGameOver(winningTeam, localPlayerTeam);
      } else if (adventureMode) {
        const advState = (() => { try { return JSON.parse(sessionStorage.getItem('adventureState') || 'null'); } catch { return null; } })();
        const playerWon = winningTeam === localPlayerTeam;
        const result = winningTeam === null ? 'draw' : playerWon ? 'win' : 'loss';

        if (playerWon && advState?.charKey) {
          try { await unlockCharacterFree(`char_${advState.charKey}`); } catch { /* best-effort */ }
        }

        sessionStorage.setItem('adventureResult', result);
        sessionStorage.setItem('skipToGame', '1');
        location.reload();
      } else {
        playAgainBtn.classList.remove('hidden');
      }
    }, 4000);
  }

  function tickGameTimer(now) {
    if (!gameTimerActive) return;
    const elapsed = (now - lastTimerTick) / 1000;
    if (elapsed < 1) return;
    lastTimerTick += Math.floor(elapsed) * 1000;
    gameTimeLeft = Math.max(0, gameTimeLeft - Math.floor(elapsed));
    updateTimerUI();
    if (gameTimeLeft <= 0) {
      gameTimerActive = false;
      showWinScreen();
    }
  }

  const SCORE_FIELD_X_HALF = 30; // field is 60 wide

  function checkGoal() {
    if (!gameTimerActive && gameTimeLeft <= 0) return;
    if (!soccerBall?.body) return;
    if (goalCelebrationActive) return;
    // Don't interrupt an active set piece
    if (setPieceManager?.isActive()) return;
    const now = performance.now();
    if (now < goalCooldown) return;
    const pos = soccerBall.getPosition();
    if (!pos) return;

    const outZ = pos.z > SCORE_FIELD_HALF + BALL_OUT_OF_BOUNDS_BUFFER ||
                 pos.z < -SCORE_FIELD_HALF - BALL_OUT_OF_BOUNDS_BUFFER;
    const outX = Math.abs(pos.x) > SCORE_FIELD_X_HALF + BALL_OUT_OF_BOUNDS_BUFFER;
    if (!outX && !outZ) return;

    const inX = Math.abs(pos.x) <= SCORE_GOAL_WIDTH / 2;
    const inY = pos.y >= -0.3 && pos.y <= SCORE_GOAL_HEIGHT + 0.3;
    const vel = soccerBall.body.linvel();

    // Goal scored?
    if (inX && inY && pos.z > SCORE_FIELD_HALF && vel.z > 0) {
      // Red goal is on the +Z end, so scoring there awards the blue/home score.
      // Credit the last home (blue) player to touch the ball regardless of who shot it last.
      score.home++;
      updateScoreUI();
      goalCooldown = now + 7000;
      const goalPos = { x: 0, y: 1.5, z: SCORE_FIELD_HALF };
      const scorerName = soccerBall.lastTouchedByTeam.home || 'Blue team';
      triggerGoalCelebration('home', goalPos, scorerName, () => {
        if (localPlayerTeam === 'home' && scorerName === playerName) recordGoal(playerName).catch(() => {});
      });
      return;
    }
    if (inX && inY && pos.z < -SCORE_FIELD_HALF && vel.z < 0) {
      // Blue goal is on the -Z end, so scoring there awards the red/away score.
      // Credit the last away (red) player to touch the ball regardless of who shot it last.
      score.away++;
      updateScoreUI();
      goalCooldown = now + 7000;
      const goalPos = { x: 0, y: 1.5, z: -SCORE_FIELD_HALF };
      const scorerName = soccerBall.lastTouchedByTeam.away || 'Red team';
      triggerGoalCelebration('away', goalPos, scorerName, () => {
        if (localPlayerTeam === 'away' && scorerName === playerName) recordGoal(playerName).catch(() => {});
      });
      return;
    }

    // Not a goal — only the host triggers set pieces and broadcasts to clients
    if (multiplayer.isHost) triggerSetPiece(pos);
  }

  function triggerSetPiece(ballOutPos) {
    if (!setPieceManager) return;
    const lastTouched = soccerBall.lastTouchedTeam ?? 'away'; // default: give home team the benefit

    const params = buildSetPieceParams(ballOutPos, lastTouched);
    if (!params) {
      soccerBall.reset();
      return;
    }

    const { type, teamTaking, ballFixedPos, zone, exclusionZone } = params;

    // Determine the designated taker: prefer local player if on the taking team,
    // otherwise fall back to the first AI on that team.
    let takerNetworkId = null;
    if (localPlayerTeam === teamTaking) {
      takerNetworkId = multiplayer.getId();
    } else {
      takerNetworkId = aiPlayers[teamTaking]?.[0]?.networkId ?? null;
    }

    applySetPiece({ spType: type, teamTaking, ballFixedPos, zone, exclusionZone, takerNetworkId });

    // Broadcast the set piece to all connected clients
    multiplayer.send({ type: 'setPiece', spType: type, teamTaking, ballFixedPos, zone, exclusionZone, takerNetworkId });
  }

  // Apply a set piece locally (runs on host via triggerSetPiece and on clients via network message).
  function findRightHandBone(model) {
    let bone = null;
    model.traverse((obj) => {
      if (bone) return;
      const n = obj.name.toLowerCase();
      if (obj.isBone && (n.includes('righthand') || n.includes('right_hand') || n.includes('r_hand') || n.includes('handright'))) {
        bone = obj;
      }
    });
    // Fallback: any bone with "hand" and "r" or "right"
    if (!bone) {
      model.traverse((obj) => {
        if (bone) return;
        const n = obj.name.toLowerCase();
        if (obj.isBone && n.includes('hand') && (n.startsWith('r') || n.includes('_r'))) {
          bone = obj;
        }
      });
    }
    return bone;
  }

  function startThrowInHolding() {
    clearThrowIn();
    throwInState.holding = true;
    throwInState.thrown = false;

    // Find hand bone inside the player model
    if (playerModel) {
      throwInState.handBone = findRightHandBone(playerModel);
    }

    // Create the throw-in button
    const btn = document.createElement('button');
    btn.id = 'throw-in-btn';
    btn.textContent = 'THROW IN';
    btn.style.cssText = [
      'position:fixed',
      'top:50%',
      'left:50%',
      'transform:translate(-50%,-50%)',
      'z-index:500',
      'padding:16px 36px',
      'font-size:20px',
      'font-weight:bold',
      'background:rgba(255,220,0,0.92)',
      'color:#222',
      'border:3px solid #c8a000',
      'border-radius:12px',
      'cursor:pointer',
      'letter-spacing:2px',
      'pointer-events:auto',
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');

    btn.addEventListener('click', executeThrowIn);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); executeThrowIn(); }, { passive: false });

    document.body.appendChild(btn);
    throwInState.button = btn;
  }

  function executeThrowIn() {
    if (!throwInState.holding || throwInState.thrown) return;
    throwInState.thrown = true;

    // Play the throw-in animation
    if (playerControls) {
      playerControls.playAction('throwIn');
    }

    // After ~0.6s (mid-animation), launch the ball forward
    setTimeout(() => {
      throwInState.holding = false;

      if (soccerBall?.body && playerModel) {
        const rot = playerModel.rotation.y;
        const THROW_SPEED = 14;
        const THROW_UP = 5;
        soccerBall.body.setLinvel({
          x: Math.sin(rot) * THROW_SPEED,
          y: THROW_UP,
          z: Math.cos(rot) * THROW_SPEED,
        }, true);
        soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }

      // Remove button
      clearThrowInButton();
    }, 600);
  }

  function clearThrowInButton() {
    if (throwInState.button) {
      throwInState.button.removeEventListener('click', executeThrowIn);
      throwInState.button.remove();
      throwInState.button = null;
    }
  }

  function clearThrowIn() {
    throwInState.holding = false;
    throwInState.thrown = false;
    throwInState.handBone = null;
    clearThrowInButton();
  }

  function startBotThrowIn(ai) {
    if (!multiplayer.isHost) return;
    botThrowInState.active = true;
    botThrowInState.ai = ai;
    botThrowInState.holding = true;
    botThrowInState.thrown = false;
    botThrowInState.handBone = findRightHandBone(ai.model);

    // Freeze the bot so it doesn't kick the ball during the animation
    ai.kickAnimating = true;

    // Face toward the field (inward from sideline)
    const sp = setPieceManager?.active;
    if (sp && ai.model) {
      // Turn to face inward (away from the sideline)
      ai.model.rotation.y = Math.atan2(-Math.sign(sp.ballFixedPos.x), 0);
    }

    // Play throw-in animation
    const actions = ai.model?.userData?.actions;
    if (actions?.throwIn) {
      const current = ai.model.userData.currentAction;
      actions[current]?.fadeOut(0.15);
      actions.throwIn.reset().fadeIn(0.15).play();
      ai.model.userData.currentAction = 'throwIn';
    }

    setTimeout(() => {
      executeBotThrowIn(ai);
    }, 600);
  }

  function executeBotThrowIn(ai) {
    if (!botThrowInState.holding) return;
    botThrowInState.holding = false;
    botThrowInState.thrown = true;

    const sp = setPieceManager?.active;
    if (!sp || !soccerBall?.body || !ai.body) {
      ai.kickAnimating = false;
      return;
    }

    const aiPos = ai.body.translation();
    const takingTeam = sp.teamTaking;

    // Find closest teammate to throw to
    let closestTeammate = null;
    let closestDist = Infinity;

    for (const tm of (aiPlayers[takingTeam] ?? [])) {
      if (tm === ai || !tm.body) continue;
      const tmT = tm.body.translation();
      const d = Math.hypot(tmT.x - aiPos.x, tmT.z - aiPos.z);
      if (d < closestDist) { closestDist = d; closestTeammate = tmT; }
    }
    if (localPlayerTeam === takingTeam && playerControls?.body) {
      const lt = playerControls.body.translation();
      const d = Math.hypot(lt.x - aiPos.x, lt.z - aiPos.z);
      if (d < closestDist) { closestDist = d; closestTeammate = lt; }
    }
    for (const [, p] of Object.entries(otherPlayers)) {
      if (p.team !== takingTeam || !p.model) continue;
      const d = Math.hypot(p.model.position.x - aiPos.x, p.model.position.z - aiPos.z);
      if (d < closestDist) { closestDist = d; closestTeammate = p.model.position; }
    }

    const THROW_SPEED = 14;
    const THROW_UP = 5;
    let dirX, dirZ;
    if (closestTeammate) {
      const raw = new THREE.Vector3(closestTeammate.x - aiPos.x, 0, closestTeammate.z - aiPos.z);
      if (raw.length() > 0.01) raw.normalize();
      dirX = raw.x;
      dirZ = raw.z;
      if (ai.model) ai.model.rotation.y = Math.atan2(raw.x, raw.z);
    } else {
      const rot = ai.model?.rotation.y ?? 0;
      dirX = Math.sin(rot);
      dirZ = Math.cos(rot);
    }

    soccerBall.body.setLinvel({ x: dirX * THROW_SPEED, y: THROW_UP, z: dirZ * THROW_SPEED }, true);
    soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Unfreeze the bot after the throw
    setTimeout(() => { ai.kickAnimating = false; }, 300);
  }

  function clearBotThrowIn() {
    if (botThrowInState.ai) botThrowInState.ai.kickAnimating = false;
    botThrowInState.active = false;
    botThrowInState.ai = null;
    botThrowInState.handBone = null;
    botThrowInState.holding = false;
    botThrowInState.thrown = false;
  }

  function applySetPiece({ spType, teamTaking, ballFixedPos, zone, exclusionZone, takerNetworkId }) {
    if (!setPieceManager) return;

    // Place ball at set piece spot
    if (soccerBall?.body) {
      soccerBall.body.setTranslation(ballFixedPos, true);
      soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    const myId = multiplayer.getId();
    const iAmTaker = takerNetworkId !== null && takerNetworkId === myId;

    if (iAmTaker && playerControls?.body) {
      // Teleport the local player (the designated taker) into the zone
      const sy = 1.5;
      let spawnX = ballFixedPos.x;
      let spawnZ = ballFixedPos.z;
      const OFFSET = 3.0;
      if (spType === 'throwIn') {
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
      } else if (spType === 'cornerKick') {
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
      } else if (spType === 'goalKick') {
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * 3;
      }
      playerControls.body.setTranslation({ x: spawnX, y: sy, z: spawnZ }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (playerModel) {
        playerModel.position.set(spawnX, sy, spawnZ);
        playerControls.playerX = spawnX;
        playerControls.playerY = sy;
        playerControls.playerZ = spawnZ;
        playerControls.lastPosition.set(spawnX, sy, spawnZ);
      }

      // For throw-ins: attach ball to player's hand and show the throw button
      if (spType === 'throwIn') {
        startThrowInHolding();
      }
    } else if (multiplayer.isHost) {
      // Host is not the taker — teleport the AI taker body
      let takerAIBody = null;
      outer: for (const team of ['home', 'away']) {
        for (const ai of (aiPlayers[team] ?? [])) {
          if (ai.networkId === takerNetworkId) {
            takerAIBody = ai.body ?? null;
            break outer;
          }
        }
      }
      if (takerAIBody) {
        const sy = 1.5;
        let spawnX = ballFixedPos.x;
        let spawnZ = ballFixedPos.z;
        const OFFSET = 3.0;
        if (spType === 'throwIn') {
          spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
        } else if (spType === 'cornerKick') {
          spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
          spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
        } else if (spType === 'goalKick') {
          spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * 3;
        }
        takerAIBody.setTranslation({ x: spawnX, y: sy, z: spawnZ }, true);
        takerAIBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        takerAIBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    setPieceManager.trigger(spType, teamTaking, ballFixedPos, zone, takerNetworkId, exclusionZone);

    // Immediately eject any player already inside the zones at set piece creation.
    if (multiplayer.isHost) {
      const takerTeam = teamTaking;
      const ejOtherBodies = [];
      const ejOpposingBodies = [];
      if (playerControls?.body) {
        ejOtherBodies.push(playerControls.body);
        if (localPlayerTeam !== takerTeam) ejOpposingBodies.push(playerControls.body);
      }
      for (const team of ['home', 'away']) {
        for (const ai of (aiPlayers[team] ?? [])) {
          if (ai.body && ai.networkId !== takerNetworkId) {
            ejOtherBodies.push(ai.body);
            ejOpposingBodies.push(ai.body);
          }
        }
      }
      setPieceManager.ejectBodiesNow(ejOtherBodies, ejOpposingBodies);
    }
  }

  // Load additional level data (destructible props, etc.)
  const breakManager = new BreakManager(scene);
  const levelLoader = new LevelLoader(scene, { breakManager });
  // await levelLoader.loadManifest('/areas/demo/demo_area.json');
  // Expose to window for debugging
  window.breakManager = breakManager;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  scene.fog = new THREE.Fog(0x87cfff, 80, 220);

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;

  const hemiLight = new THREE.HemisphereLight(0xbde8ff, 0x405020, 1.2);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.mapSize.set(4096, 4096);

  dirLight.shadow.camera.left = -80;
  dirLight.shadow.camera.right = 80;
  dirLight.shadow.camera.top = 80;
  dirLight.shadow.camera.bottom = -80;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 200;

  dirLight.target.position.set(0, 0, 0);
  scene.add(dirLight);



  // --- RAPIER INIT ---
  await RAPIER.init();
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81 * gravityMultiplier, z: 0 });
  window.rapierWorld = rapierWorld;
  window.rbToMesh = rbToMesh;
  breakManager.setWorld(rapierWorld);

  // Ground collider
  {
    const groundRb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0)
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(200, 1, 200),
      groundRb
    );
  }

  // Load the essential field geometry (pitch stripes, goals, lines) synchronously
  // so players can start immediately. Heavy background assets are deferred below.
  generateSoccerField(scene, rapierWorld);

  let fanMixers = [];

  setPieceManager = new SetPieceManager(scene);

  soccerBall = new SoccerBall(scene, rapierWorld, rbToMesh);
  soccerBall.create(0, 1, 0, ballSizeMultiplier);
  registerNetworkedEntity('soccerball', {
    getState: () => {
      if (!soccerBall?.body) return null;
      const t = soccerBall.body.translation();
      const r = soccerBall.body.rotation();
      const v = soccerBall.body.linvel();
      if (!t || !r) return null;
      return {
        position: [t.x, t.y, t.z],
        rotation: [r.x, r.y, r.z, r.w],
        linvel: [v.x, v.y, v.z]
      };
    },
    applyState: state => {
      if (!state || !soccerBall?.body) return;
      const [px, py, pz] = state.position || [];
      const [rx, ry, rz, rw] = state.rotation || [];
      const [vx, vy, vz] = state.linvel || [];
      if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
        soccerBall.body.setTranslation({ x: px, y: py, z: pz }, true);
        soccerBall.mesh?.position.set(px, py, pz);
      }
      if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)) {
        soccerBall.body.setRotation({ x: rx, y: ry, z: rz, w: rw }, true);
        soccerBall.mesh?.quaternion.set(rx, ry, rz, rw);
      }
      if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
        soccerBall.body.setLinvel({ x: vx, y: vy, z: vz }, true);
      }
    },
    isLocallyControlled: () => multiplayer?.isHost !== false
  });




  let player = new PlayerCharacter(playerName, characterModel, 0x3399ff);
  let playerModel = player.model;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;
  window.audioManager = audioManager;
  // Music starts on first user interaction so the browser allows it
  const _startMusic = () => { audioManager.startMusic(); };
  document.addEventListener('keydown', _startMusic, { once: true });
  document.addEventListener('mousedown', _startMusic, { once: true });
  document.addEventListener('touchstart', _startMusic, { once: true });

  const sprintFill = document.getElementById('sprint-fill');
  function updateSprintUI() {
    if (sprintFill) {
      const sprintPercent = playerControls?.getSprintPercent?.() ?? 0;
      sprintFill.style.width = `${sprintPercent}%`;
      // Color: cyan at full, orange at mid, red when critically low
      if (sprintPercent > 50) {
        sprintFill.style.background = '#27d9ff';
      } else if (sprintPercent > 20) {
        sprintFill.style.background = '#ffaa00';
      } else {
        sprintFill.style.background = '#ff3333';
      }
    }
  }
  updateSprintUI();

  const projectiles = [];

  // Blue/home spawns near the blue (-Z) goal; red/away spawns near the red (+Z) goal.
  const TEAM_SPAWN_Z = { home: -38, away: 38 };

  function getTeamSpawnPosition(team = localPlayerTeam) {
    const spawnZ = TEAM_SPAWN_Z[team] ?? TEAM_SPAWN_Z.home;
    return { x: 0, y: getTerrainHeight(0, spawnZ) + 1.5, z: spawnZ };
  }

  const initialSpawn = getTeamSpawnPosition('home');

  playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile,
    projectiles,
    audioManager,
    spawnPosition: initialSpawn,
    playerName
  });
  window.playerControls = playerControls;

  // --- TEAM MANAGEMENT ---
  function removeAI(player) {
    if (!player) return;
    if (player.networkId) {
      networkedEntities.delete(player.networkId);
      pendingEntityStates.delete(player.networkId);
      authoritativeEntityStates.delete(player.networkId);
    }
    if (player.model?.parent) player.model.parent.remove(player.model);
    if (player.character?.nameLabel?.parentNode) {
      player.character.nameLabel.parentNode.removeChild(player.character.nameLabel);
    }
    if (player.body) rapierWorld.removeRigidBody(player.body);
  }


  function spawnAI(team, index) {
    const spawnZ = team === 'home' ? -38 : 38;
    const targetGoalZ = team === 'home' ? 50 : -50;
    const color = team === 'home' ? 0x3399ff : 0xff3322;
    const spacing = 4;
    const spawnX = (index - (MIN_PLAYERS_PER_TEAM - 1) / 2) * spacing;
    const botModel = (adventureMode && adventureCharModel && team === 'away') ? adventureCharModel : '/models/old_man.fbx';
    const ai = new AIPlayer(scene, rapierWorld, {
      spawnX,
      spawnZ,
      targetGoalZ,
      color,
      name: `Computer ${team === 'home' ? 'Home' : 'Away'} ${index + 1}`,
      model: botModel,
    });
    ai.team = team;
    ai.networkId = `ai-${team}-${index}`;
    aiPlayers[team].push(ai);
    registerNetworkedEntity(ai.networkId, {
      getState: () => ai.getState?.(),
      applyState: state => ai.applyState?.(state),
      isLocallyControlled: () => multiplayer?.isHost === true
    });
  }

  function setAITeamCounts(counts) {
    ['home', 'away'].forEach((team) => {
      const targetCount = Math.max(0, counts?.[team] || 0);
      while (aiPlayers[team].length > targetCount) {
        removeAI(aiPlayers[team].pop());
      }
      while (aiPlayers[team].length < targetCount) {
        spawnAI(team, aiPlayers[team].length);
      }
    });
  }

  function countRealPlayersByTeam() {
    const counts = { home: 0, away: 0 };
    // Only count local player's team if it's been confirmed (not just the initial default)
    if (localTeamConfirmed && localPlayerTeam) counts[localPlayerTeam]++;
    Object.values(playerTeams).forEach(t => { if (t) counts[t]++; });
    return counts;
  }

  function countNeededAIByTeam() {
    const realCounts = countRealPlayersByTeam();
    if (adventureMode) {
      const config = adventureRoundConfig || getAdventureRoundConfig(0);
      return {
        home: Math.max(0, config.playerTeamSize - realCounts.home),
        away: Math.max(0, config.enemyBots - realCounts.away)
      };
    }
    return {
      home: Math.max(0, MIN_PLAYERS_PER_TEAM - realCounts.home),
      away: Math.max(0, MIN_PLAYERS_PER_TEAM - realCounts.away)
    };
  }

  function assignTeamToNewPlayer() {
    const counts = countRealPlayersByTeam();
    return counts.away < counts.home ? 'away' : 'home';
  }

  function updateAIForBalance() {
    setAITeamCounts(countNeededAIByTeam());
  }

  function broadcastTeamAssignments() {
    const myId = multiplayer?.getId?.();
    const assignments = { ...playerTeams };
    if (myId) assignments[myId] = localPlayerTeam;

    // Include current AI positions so clients can apply them right after setAITeamCounts
    const aiStates = {};
    ['home', 'away'].forEach(team => {
      aiPlayers[team].forEach(ai => {
        if (ai.networkId) aiStates[ai.networkId] = ai.getState?.() ?? null;
      });
    });

    multiplayer.send({ type: 'teamAssignments', assignments, aiCounts: countNeededAIByTeam(), aiStates });
  }

  function getBodyForTeam(team) {
    if (localPlayerTeam === team) return playerControls?.body;
    return aiPlayers[team]?.[0]?.body ?? null;
  }

  function moveLocalPlayerToSpawn(team = localPlayerTeam) {
    const spawn = getTeamSpawnPosition(team);
    playerModel.position.set(spawn.x, spawn.y, spawn.z);
    if (playerControls) {
      playerControls.playerX = spawn.x;
      playerControls.playerY = spawn.y;
      playerControls.playerZ = spawn.z;
      playerControls.lastPosition.set(spawn.x, spawn.y, spawn.z);
      playerControls.velocity?.set?.(0, 0, 0);
      if (playerControls.body) {
        playerControls.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
        playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  function rebalanceTeams() {
    if (!multiplayer?.isHost) return;

    // Assign our own team if not yet confirmed
    if (!localTeamConfirmed) {
      const myTeam = assignTeamToNewPlayer();
      const changed = myTeam !== localPlayerTeam;
      localPlayerTeam = myTeam;
      localTeamConfirmed = true;
      if (changed) {
        const newColor = myTeam === 'home' ? 0x3399ff : 0xff3322;
        swapPlayerCharacter(characterModel, newColor);
        moveLocalPlayerToSpawn(myTeam);
      }
    }

    // Assign any remote players without a confirmed team
    for (const pid of Object.keys(playerTeams)) {
      if (!playerTeams[pid]) {
        playerTeams[pid] = assignTeamToNewPlayer();
      }
    }

    updateAIForBalance();
    broadcastTeamAssignments();
  }

  // Start in solo mode: local player is home with enough computers to make
  // three players on each team.
  localPlayerTeam = 'home';
  localTeamConfirmed = true;
  updateAIForBalance();

  // --- RAPIER HELPERS ---
  function spawnBlock({
    pos = new THREE.Vector3(0, 5, 0),
    half = new THREE.Vector3(0.25, 0.25, 0.25),
    linvel = new THREE.Vector3(),
    angvel = new THREE.Vector3(Math.random(), Math.random(), Math.random()),
    color = 0x66ccff,
  } = {}) {
    // Three mesh
    const geom = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.0 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(pos);
    scene.add(mesh);

    // Rapier body + collider
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0.02)
      .setAngularDamping(0.02);
    const rb = rapierWorld.createRigidBody(rbDesc);

    // Give it a fun impulse/velocity
    rb.setLinvel({ x: linvel.x, y: linvel.y, z: linvel.z }, true);
    rb.setAngvel({ x: angvel.x, y: angvel.y, z: angvel.z }, true);

    const colDesc = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setRestitution(0.2)
      .setFriction(0.6);
    rapierWorld.createCollider(colDesc, rb);

    rbToMesh.set(rb, mesh);
    return rb;
  }

  function shootBlockFromPlayer(speed = 18) {
    const origin = playerModel.position.clone().add(new THREE.Vector3(0, 0, 0));

    // forward from camera so it goes where you're looking
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const linvel = dir.multiplyScalar(speed);

    spawnBlock({
      pos: origin.add(dir.clone().multiplyScalar(1.2)),
      linvel,
      color: 0xff8855,
      half: new THREE.Vector3(0.3, 0.3, 0.3),
    });
  }

  // Little “machine gun” for fun
  let burstInterval = null;
  function startBurst() {
    if (burstInterval) return;
    burstInterval = setInterval(() => shootBlockFromPlayer(22), 120);
  }
  function stopBurst() {
    if (!burstInterval) return;
    clearInterval(burstInterval);
    burstInterval = null;
  }

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    
    if (e.code === 'KeyB') {
      shootBlockFromPlayer(); // tap B to fire one block
      console.log("b key pressed");
    }
    if (e.code === 'KeyN') startBurst();          // hold N to start burst
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyN') stopBurst();
  });

  // Expose for console testing
  window.spawnBlock = spawnBlock;
  window.shootBlockFromPlayer = shootBlockFromPlayer;



  // Game Over UI elements
  const gameOverOverlay = document.getElementById('game-over-overlay');
  const gameOverMessage = document.getElementById('game-over-message');
  const continueSection = document.getElementById('continue-section');
  const countdownEl = document.getElementById('countdown');
  const yesBtn = document.getElementById('continue-yes');
  const noBtn = document.getElementById('continue-no');

  function showGameOver() {
    gameOverOverlay.classList.remove('hidden');
    continueSection.classList.add('hidden');
    gameOverMessage.style.opacity = 0;
    gameOverMessage.classList.remove('hidden');
    setTimeout(() => {
      gameOverMessage.style.opacity = 1;
      setTimeout(() => {
        gameOverMessage.style.opacity = 0;
        setTimeout(() => {
          gameOverMessage.classList.add('hidden');
          showContinue();
        }, 1000);
      }, 1500);
    }, 50);
  }

  function showContinue() {
    continueSection.classList.remove('hidden');
    let countdown = 9;
    countdownEl.textContent = countdown;
    const interval = setInterval(() => {
      countdown--;
      countdownEl.textContent = countdown;
      if (countdown <= 0) {
        clearInterval(interval);
        hideGameOver();
      }
    }, 1000);

    yesBtn.onclick = () => {
      clearInterval(interval);
      respawnPlayer();
      hideGameOver();
    };

    noBtn.onclick = () => {
      clearInterval(interval);
      hideGameOver();
    };
  }

  function hideGameOver() {
    gameOverOverlay.classList.add('hidden');
  }

  function respawnPlayer() {
    updateSprintUI();
    const spawn = getTeamSpawnPosition(localPlayerTeam);
    playerModel.position.set(spawn.x, spawn.y, spawn.z);
    playerControls.playerX = spawn.x;
    playerControls.playerY = spawn.y;
    playerControls.playerZ = spawn.z;
    playerControls.lastPosition.set(spawn.x, spawn.y, spawn.z);
    if (playerControls.body) {
      playerControls.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      playerControls.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    playerControls.velocity.set(0, 0, 0);
    playerControls.enabled = true;
    const actions = playerModel.userData.actions;
    const current = playerModel.userData.currentAction;
    actions?.[current]?.fadeOut(0.2);
    actions?.idle?.reset().fadeIn(0.2).play();
    playerModel.userData.currentAction = 'idle';
  }

  // Initialize speech commands for voice-controlled actions
  const speech = initSpeechCommands({
    jump: () => playerControls.triggerJump(),
    fire: () => playerControls.triggerFire(),
    shoot: () => playerControls.triggerFire()
  });

  const bindActionButton = (id, action) => {
    const button = document.getElementById(id);
    if (!button) return;
    const handler = (e) => {
      e.preventDefault();
      action();
    };
    button.addEventListener('touchstart', handler, { passive: false });
    button.addEventListener('mousedown', handler);
  };

  bindActionButton('roll-button', () => playerControls.triggerRoll());
  bindActionButton('slide-button', () => playerControls.triggerSlide());
  bindActionButton('sprint-button', () => playerControls.triggerSprint());
  bindActionButton('lob-button', () => playerControls.playAction('farKick'));
  bindActionButton('bicycle-button', () => playerControls.playAction('bicycleKick'));

  let localStream = null;
  let micActive = false;
  const voiceButton = document.getElementById('voice-button');

  voiceButton.addEventListener('click', async () => {
    if (!micActive) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        multiplayer.startVoice(localStream);
        micActive = true;
        voiceButton.textContent = "Mute";
      } catch (err) {
        console.error("Microphone access denied:", err);
      }
    } else {
      if (localStream) {
        multiplayer.stopVoice();
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
      }
      micActive = false;
      voiceButton.textContent = "Unmute";
    }
  });

  let followBallCamera = false;
  const followBallBtn = document.getElementById('follow-ball-button');
  followBallBtn.addEventListener('click', () => {
    followBallCamera = !followBallCamera;
    followBallBtn.classList.toggle('active', followBallCamera);
  });

  const settingsBtn = document.getElementById('settings-button');
  const overlay = document.getElementById('settings-overlay');
  const nameInput = document.getElementById('name-input');
  const characterSelect = document.getElementById('character-select');
  const consoleDiv = document.getElementById("console-log");

  function swapPlayerCharacter(newModelPath, teamColor = null) {
    if (!newModelPath || (newModelPath === characterModel && teamColor === null)) {
      return;
    }

    const previousModel = playerModel;
    const previousLabel = player?.nameLabel;
    const currentPosition = previousModel ? previousModel.position.clone() : new THREE.Vector3();
    const currentRotation = previousModel ? previousModel.rotation.clone() : new THREE.Euler();
    const currentUp = previousModel ? previousModel.up.clone() : new THREE.Vector3(0, 1, 0);

    if (playerControls?.parachute && previousModel && playerControls.parachute.parent === previousModel) {
      previousModel.remove(playerControls.parachute);
    }

    const resolvedColor = teamColor ?? (localPlayerTeam === 'home' ? 0x3399ff : 0xff3322);
    const newPlayer = new PlayerCharacter(playerName, newModelPath, resolvedColor);
    const newModel = newPlayer.model;
    newModel.position.copy(currentPosition);
    newModel.rotation.copy(currentRotation);
    newModel.up.copy(currentUp);

    scene.add(newModel);
    document.body.appendChild(newPlayer.nameLabel);

    if (playerControls?.parachute) {
      newModel.add(playerControls.parachute);
    }

    if (previousModel?.parent) {
      previousModel.parent.remove(previousModel);
    }
    if (previousLabel?.parentNode) {
      previousLabel.parentNode.removeChild(previousLabel);
    }

    player = newPlayer;
    playerModel = newModel;
    window.playerModel = playerModel;
    playerControls?.setPlayerModel(playerModel);
  }

  async function populateCharacterSelect() {
    try {
      const characters = ['old_man', 'base_character_2', 'Chimpanzee', 'cowboy', 'golem', 'seagull', 'zombie_boy', 'zombie_green', 'zombie'];
      characters.forEach(name => {
        const option = document.createElement('option');
        option.value = `/models/${name}.fbx`;
        option.textContent = name;
        characterSelect.appendChild(option);
        console.log(option.value);
      });
      characterSelect.value = characterModel;
    } catch (e) {
      console.error('Failed to load character list', e);
    }
  }
  populateCharacterSelect();

  // In-game audio sliders
  const musicSlider = document.getElementById('music-volume-slider');
  const sfxSlider = document.getElementById('sfx-volume-slider');
  if (musicSlider) {
    musicSlider.value = audioManager.musicVolume;
    musicSlider.addEventListener('input', () => audioManager.setMusicVolume(parseFloat(musicSlider.value)));
  }
  if (sfxSlider) {
    sfxSlider.value = audioManager.sfxVolume;
    sfxSlider.addEventListener('input', () => audioManager.setSfxVolume(parseFloat(sfxSlider.value)));
  }

  // Side tab switching
  document.querySelectorAll('.side-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.side-tab-content').forEach(c => (c.style.display = 'none'));
      btn.classList.add('active');
      const tab = document.getElementById(`tab-${btn.dataset.tab}`);
      if (tab) tab.style.display = 'block';
      if (btn.dataset.tab === 'multiplayer') {
        refreshMultiplayerTab();
      }
    });
  });

  // Leaderboard rank cache: name -> rank
  let _lbRankCache = {};
  let _lbRankLoaded = false;
  async function ensureLbRanks() {
    if (_lbRankLoaded) return;
    try {
      const rows = await getLeaderboard();
      rows.forEach((row, i) => { _lbRankCache[row.name] = i + 1; });
      _lbRankLoaded = true;
    } catch (e) { /* ignore */ }
  }

  function pingClass(ms) {
    if (ms == null) return '';
    if (ms < 80) return 'ping-good';
    if (ms < 180) return 'ping-ok';
    return 'ping-bad';
  }

  async function refreshMultiplayerTab() {
    const container = document.getElementById('teams-table-container');
    if (!container) return;
    await ensureLbRanks();

    const localPing = multiplayer?.lastPingMs ?? null;

    // Build data for each team
    const teamDefs = [
      { key: 'home', label: 'Blue Team', cls: 'home' },
      { key: 'away', label: 'Red Team', cls: 'away' },
    ];

    container.innerHTML = '';

    for (const { key, label, cls } of teamDefs) {
      const section = document.createElement('div');
      section.className = 'teams-section';

      const header = document.createElement('div');
      header.className = `teams-section-header ${cls}`;
      header.textContent = label;
      section.appendChild(header);

      const table = document.createElement('table');
      table.className = 'teams-table';
      table.innerHTML = '<thead><tr><th>Player</th><th>Rank</th><th>Goals</th><th>Ping</th></tr></thead>';
      const tbody = document.createElement('tbody');

      // Local player row (if on this team)
      if (localPlayerTeam === key) {
        const rank = _lbRankCache[playerName];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${playerName} <span style="font-size:10px;color:#aaa">(you)</span></td>
          <td class="player-rank">${rank ? `#${rank}` : '—'}</td>
          <td>—</td>
          <td class="${pingClass(localPing)}">${localPing != null ? `${localPing}ms` : '—'}</td>
        `;
        tbody.appendChild(tr);
      }

      // Remote human players on this team
      for (const [pid, info] of Object.entries(otherPlayers)) {
        if ((playerTeams[pid] ?? info.team) !== key) continue;
        const name = info.name || pid;
        const rank = _lbRankCache[name];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${name}</td>
          <td class="player-rank">${rank ? `#${rank}` : '—'}</td>
          <td>—</td>
          <td>—</td>
        `;
        tbody.appendChild(tr);
      }

      // AI players on this team
      (aiPlayers[key] || []).forEach((ai, i) => {
        const name = ai.name || `Bot ${i + 1}`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${name}</td>
          <td class="player-rank">—</td>
          <td>—</td>
          <td class="ping-bot">Bot</td>
        `;
        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      section.appendChild(table);
      container.appendChild(section);
    }
  }

  settingsBtn.addEventListener('click', () => {
    overlay.style.display = 'flex';
    if (musicSlider) musicSlider.value = audioManager.musicVolume;
    if (sfxSlider) sfxSlider.value = audioManager.sfxVolume;
    // Default to Audio tab
    document.querySelectorAll('.side-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.side-tab-content').forEach(c => (c.style.display = 'none'));
    const audioBtn = document.querySelector('.side-tab-btn[data-tab="audio"]');
    const audioTab = document.getElementById('tab-audio');
    if (audioBtn) audioBtn.classList.add('active');
    if (audioTab) audioTab.style.display = 'block';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  document.getElementById('leave-game-btn').addEventListener('click', () => {
    sessionStorage.setItem('skipToGame', '1');
    window.location.reload();
  });

  (function() {
    const originalLog = console.log;
    console.log = function(...args) {
      originalLog(...args);
      const msg = document.createElement("div");
      msg.textContent = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(" ");
      consoleDiv.appendChild(msg);
      consoleDiv.scrollTop = consoleDiv.scrollHeight;
    };
  })();

  function animate() {
    requestAnimationFrame(animate);

    // --- RAPIER FIXED-STEP & SYNC ---
    // Accumulate variable rAF time into fixed physics steps
    const frameDelta = clock.getDelta();
    physicsAccumulator += frameDelta;
    while (physicsAccumulator >= FIXED_DT) {
      applyGlobalGravity(rapierWorld, window.moon);
      rapierWorld.step();
      physicsAccumulator -= FIXED_DT;
    }

    // Sync Rapier bodies -> Three meshes
    for (const [rb, mesh] of rbToMesh.entries()) {
      const t = rb.translation();
      const r = rb.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);

      if (!mesh.userData?.isTerrain) {
        mesh.updateMatrixWorld();
        const bbox = new THREE.Box3().setFromObject(mesh);
        const terrainY = getTerrainHeight(mesh.position.x, mesh.position.z);
        if (bbox.min.y < terrainY) {
          const correction = terrainY - bbox.min.y;
          mesh.position.y += correction;
          rb.setTranslation({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, true);
          const lv = rb.linvel();
          if (lv.y < 0) {
            rb.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
          }
        }
      }

      // Simple cleanup: remove if it falls far below the world
      if (mesh.position.y < -50) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
        rbToMesh.delete(rb);
        rapierWorld.removeRigidBody(rb);
      }
    }



    if (followBallCamera && playerModel && soccerBall?.body) {
      const ballRaw = soccerBall.getPosition();
      const ballPos = new THREE.Vector3(ballRaw.x, ballRaw.y, ballRaw.z);
      const playerPos = playerModel.position;
      const toBall = new THREE.Vector3(ballPos.x - playerPos.x, 0, ballPos.z - playerPos.z);
      const horizDist = toBall.length();
      const fwd = horizDist > 0.1 ? toBall.clone().normalize() : new THREE.Vector3(0, 0, -1);
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
      playerControls.followBallCameraForward = fwd;
      playerControls.followBallCameraRight = right;
    } else {
      playerControls.followBallCameraForward = null;
      playerControls.followBallCameraRight = null;
    }

    playerControls.update();

    soccerBall?.update();
    if (soccerBall?.body) {
      // During the lock phase of a set piece the set piece player is placed right
      // next to the ball. Suppress lastTouchedTeam updates until the lock releases
      // so that the spawn teleport doesn't corrupt who last touched the ball.
      const spLocked = setPieceManager?.active?.ballLocked ?? false;
      const spTeam   = setPieceManager?.active?.teamTaking;
      if (playerControls.body) {
        soccerBall.resolvePlayerContact(
          playerControls.body.translation(),
          playerControls.body.linvel(),
          0.3,
          0.6,
          spLocked && spTeam === localPlayerTeam ? null : localPlayerTeam,
          playerName
        );
      }
      Object.entries(aiPlayers).forEach(([team, players]) => {
        players.forEach((ai) => {
          if (!ai.body) return;
          soccerBall.resolvePlayerContact(
            ai.body.translation(),
            ai.body.linvel(),
            0.3,
            0.6,
            spLocked && spTeam === team ? null : team,
            ai.name || 'Computer'
          );
        });
      });
    }
    checkGoal();

    const now = performance.now();
    tickGameTimer(now);
    const localStates = collectLocalControlStates();

    if (multiplayer.isHost) {
      localStates.forEach(({ state, sourceId }, id) => {
        updateAuthoritativeState(id, state, sourceId);
      });

      if (now - lastEntityBroadcast >= ENTITY_BROADCAST_INTERVAL) {
        const payload = serializeAuthoritativeStates();
        if (Object.keys(payload).length > 0) {
          multiplayer.send({ type: 'entityStates', states: payload });
        }
        lastEntityBroadcast = now;
      }
    } else if (localStates.size > 0 && now - lastControlSend >= CONTROL_SEND_INTERVAL) {
      localStates.forEach(({ state, sourceId }, id) => {
        multiplayer.send({ type: 'entityControl', id, state, sourceId });
      });
      lastControlSend = now;
    }

    updateSprintUI();

    const mixerDelta = mixerClock.getDelta();

    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(mixerDelta);
    });

    Object.entries(aiPlayers).forEach(([team, players]) => {
      let ballChaser = null;
      let ballChaserIndex = -1;
      let ballChaserPosition = null;
      const ballPos = soccerBall?.getPosition?.();

      // During a set piece, force the designated taker (if on this team) to be
      // the ball chaser so they always approach and kick rather than standing in
      // formation while a different bot chases.
      const sp = setPieceManager?.isActive() ? setPieceManager.active : null;
      if (sp && sp.teamTaking === team) {
        const takerAi = players.find(ai => ai.networkId === sp.takerNetworkId);
        if (takerAi?.body) {
          const aiPos = takerAi.body.translation();
          ballChaser = takerAi;
          ballChaserIndex = players.indexOf(takerAi);
          ballChaserPosition = { x: aiPos.x, y: aiPos.y, z: aiPos.z };
        }
      }

      if (!ballChaser && ballPos) {
        let closestDistSq = Infinity;
        players.forEach((ai, index) => {
          if (!ai.body) return;
          const aiPos = ai.body.translation();
          const dx = aiPos.x - ballPos.x;
          const dz = aiPos.z - ballPos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq < closestDistSq) {
            closestDistSq = distSq;
            ballChaser = ai;
            ballChaserIndex = index;
            ballChaserPosition = { x: aiPos.x, y: aiPos.y, z: aiPos.z };
          }
        });
      }

      players.forEach((ai, index) => {
        if (ai.frozen) {
          ai.model.userData.mixer?.update(frameDelta);
          return;
        }
        if (multiplayer.isHost) {
          const opposingTeam = team === 'home' ? 'away' : 'home';
          const opponentAIs = (aiPlayers[opposingTeam] || []).map(op => op.body ? op.body.translation() : null).filter(Boolean);
          const opponentHumans = Object.entries(otherPlayers)
            .filter(([, p]) => p.team === opposingTeam && p.model)
            .map(([, p]) => p.model.position);
          if (localPlayerTeam === opposingTeam && playerControls?.body) {
            opponentAIs.push(playerControls.body.translation());
          }
          const opponents = [...opponentAIs, ...opponentHumans];

          const humanTeammates = Object.entries(otherPlayers)
            .filter(([, p]) => p.team === team && p.model)
            .map(([, p]) => p.model.position);
          if (localPlayerTeam === team && playerControls?.body) {
            const lt = playerControls.body.translation();
            humanTeammates.push(new THREE.Vector3(lt.x, lt.y, lt.z));
          }

          // During a corner kick, non-taker bots position near the attacking goal.
          let cornerKickGoalZ = null;
          if (sp?.type === 'cornerKick' && sp.teamTaking === team && ai !== ballChaser) {
            // The goal being attacked is opposite to the corner's z side.
            // ballFixedPos.z tells us which end the corner is at; bots attack the same end.
            cornerKickGoalZ = sp.ballFixedPos.z > 0 ? 50 : -50;
          }

          ai.update(frameDelta, soccerBall, {
            pursueBall: !ballChaser || ai === ballChaser,
            formationIndex: index,
            formationCount: players.length,
            chaserIndex: ballChaserIndex >= 0 ? ballChaserIndex : null,
            chaserPosition: ballChaserPosition,
            teammates: players,
            opponents,
            humanTeammates,
            cornerKickGoalZ
          });
        } else {
          ai.model.userData.mixer?.update(frameDelta);
        }
      });
    });

    // Set piece zone enforcement (runs after AI update so AI can't immediately
    // walk back into the exclusion zone in the same frame it was pushed out)
    if (setPieceManager?.isActive() && soccerBall) {
      const sp = setPieceManager.active;
      const myId = multiplayer.getId();

      // Resolve the designated taker's physics body
      let takerBody = null;
      if (sp.takerNetworkId === myId) {
        takerBody = playerControls?.body ?? null;
      } else {
        outer: for (const team of ['home', 'away']) {
          for (const ai of (aiPlayers[team] ?? [])) {
            if (ai.networkId === sp.takerNetworkId) {
              takerBody = ai.body ?? null;
              break outer;
            }
          }
        }
      }

      // Split locally-simulated bodies into two groups:
      // - otherBodies: all non-taker bodies pushed out of the small taker zone
      // - opposingBodies: non-taker bodies pushed out of the larger exclusion zone
      //   (opposing team human player + all non-taker AI bots from both teams)
      const opposingTeam = sp.teamTaking === 'home' ? 'away' : 'home';
      const otherBodies = [];
      const opposingBodies = [];
      if (playerControls?.body && playerControls.body !== takerBody) {
        otherBodies.push(playerControls.body);
        if (localPlayerTeam === opposingTeam) {
          opposingBodies.push(playerControls.body);
        }
      }
      for (const team of ['home', 'away']) {
        for (const ai of (aiPlayers[team] ?? [])) {
          if (ai.body && ai.body !== takerBody) {
            otherBodies.push(ai.body);
            // All AI bots (both teams) stay out of the exclusion zone
            opposingBodies.push(ai.body);
          }
        }
      }

      const ended = setPieceManager.update(soccerBall, takerBody, otherBodies, opposingBodies);
      if (ended) {
        clearThrowIn();
        clearBotThrowIn();
        if (multiplayer.isHost) {
          multiplayer.send({ type: 'setPieceClear' });
        }
      }

      // While player is holding ball for throw-in, pin ball to hand bone each frame
      if (throwInState.holding && soccerBall?.body) {
        const _handPos = new THREE.Vector3();
        if (throwInState.handBone) {
          throwInState.handBone.getWorldPosition(_handPos);
        } else if (playerModel) {
          // Fallback: slightly in front and up from player
          const rot = playerModel.rotation.y;
          _handPos.set(
            playerModel.position.x + Math.sin(rot) * 0.5,
            playerModel.position.y + 1.4,
            playerModel.position.z + Math.cos(rot) * 0.5
          );
        }
        soccerBall.body.setTranslation({ x: _handPos.x, y: _handPos.y, z: _handPos.z }, true);
        soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }

      // Trigger bot throw-in once the set piece ball lock releases and taker is an AI
      if (!ended && multiplayer.isHost && sp && sp.type === 'throwIn' && !sp.ballLocked
          && !botThrowInState.active && sp.takerNetworkId !== myId) {
        let takerAI = null;
        outer2: for (const team of ['home', 'away']) {
          for (const ai of (aiPlayers[team] ?? [])) {
            if (ai.networkId === sp.takerNetworkId) { takerAI = ai; break outer2; }
          }
        }
        if (takerAI) startBotThrowIn(takerAI);
      }

      // Pin ball to bot's hand bone while bot is holding it
      if (botThrowInState.holding && soccerBall?.body) {
        const _handPos = new THREE.Vector3();
        const botAI = botThrowInState.ai;
        if (botThrowInState.handBone) {
          botThrowInState.handBone.getWorldPosition(_handPos);
        } else if (botAI?.model) {
          const rot = botAI.model.rotation.y;
          _handPos.set(
            botAI.model.position.x + Math.sin(rot) * 0.5,
            botAI.model.position.y + 1.4,
            botAI.model.position.z + Math.cos(rot) * 0.5
          );
        }
        soccerBall.body.setTranslation({ x: _handPos.x, y: _handPos.y, z: _handPos.z }, true);
        soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    } else {
      // Set piece not active; clear throw-in state if it lingered
      if (throwInState.holding || throwInState.button) clearThrowIn();
      if (botThrowInState.active) clearBotThrowIn();
    }

    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
      model: characterModel,
      team: localTeamConfirmed ? localPlayerTeam : null,
      x: playerModel.position.x,
      y: playerModel.position.y,
      z: playerModel.position.z,
      rotation: playerModel.rotation.y,
      action: playerModel.userData.currentAction
    });

    Object.entries(multiplayer.voiceAudios || {}).forEach(([peerId, { audio }]) => {
      const peerModel = otherPlayers[peerId]?.model;
      if (!peerModel || !peerModel.position) return;
      const dist = playerModel.position.distanceTo(peerModel.position);
      const maxDist = 30;
      const rawVolume = 1 - dist / maxDist;
      const volume = Math.max(0, rawVolume * rawVolume);
      audio.volume = volume;
    });

    Object.entries(otherPlayers).forEach(([id, { model, nameLabel }]) => {
      const pos = model.position.clone().add(new THREE.Vector3(0, 2, 0));
      pos.project(camera);
      if (pos.z < 0 || pos.z > 1) {
        nameLabel.style.display = "none";
        return;
      }
      const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;
      const cameraDist = camera.position.distanceTo(model.position);
      const scale = Math.max(0.5, 1.5 - cameraDist / 30);
      const opacity = Math.max(0, 1 - cameraDist / 40);
      nameLabel.style.display = "block";
      nameLabel.style.left = `${x}px`;
      nameLabel.style.top = `${y}px`;
      nameLabel.style.transform = `translate(-50%, -50%) scale(${scale})`;
      nameLabel.style.opacity = opacity.toFixed(2);
    });

    updateProjectiles({
      scene,
      projectiles,
      playerModel,
      otherPlayers,
      multiplayer,
      delta: frameDelta
    });

    updateMeleeAttacks({ playerModel, otherPlayers, audioManager });

    breakManager.update();

    _updateConfetti();
    updateDustParticles(frameDelta);
    if (playerModel) updateRainbowTrail(playerModel, playerControls?.isMoving ?? false);

    if (followBallCamera && playerModel && soccerBall?.body) {
      const ballRaw = soccerBall.getPosition();
      const ballPos = new THREE.Vector3(ballRaw.x, ballRaw.y, ballRaw.z);
      const playerPos = playerModel.position;

      const toBall = new THREE.Vector3(ballPos.x - playerPos.x, 0, ballPos.z - playerPos.z);
      const horizDist = toBall.length();

      const camHeight = 2.5;
      const camBack = 5;
      const behindDir = horizDist > 0.1
        ? toBall.clone().normalize().negate()
        : new THREE.Vector3(0, 0, 1);

      const camPos = playerPos.clone()
        .add(behindDir.multiplyScalar(camBack))
        .add(new THREE.Vector3(0, camHeight, 0));
      camera.position.copy(camPos);
      camera.lookAt(ballPos);
    }

    updateGrass(clock.getElapsedTime());
    for (const m of fanMixers) m.update(mixerDelta);
    renderer.render(scene, camera);
  }

  animate();

  // After the game loop is running, load the remaining heavy assets in the background.
  // Stagger them so they don't all hit the GPU/network at once.
  setTimeout(() => {
    createGrassBladesOnField(scene);
  }, 500);
  setTimeout(() => {
    createMoon(scene, rapierWorld, rbToMesh);
  }, 1000);
  setTimeout(() => {
    addSceneryProps(scene).catch(e => console.warn('addSceneryProps error', e));
  }, 1500);
  setTimeout(() => {
    addFans(scene).then(mixers => { fanMixers = mixers; }).catch(e => console.warn('addFans error', e));
  }, 2500);
  createMountainRing(scene);
}

window.addEventListener('DOMContentLoaded', main);
