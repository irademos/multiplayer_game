// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { createClouds, generateSoccerField, createMoon, MOON_RADIUS } from "./worldGeneration.js";
import { getTerrainHeight } from './water.js';
import { Multiplayer, subscribeOnlineCount } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { initLogin, getSession, clearSession, getUser, updateUserDisplayName, getUserUpgrades, purchaseUpgrade, unlockCharacterFree, showCharacterSelect, updateUserCharacter, CHARACTERS, ADVENTURE_ORDER, changePin, deleteAccount } from './login.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { LevelLoader } from './levelLoader.js';
import { BreakManager } from './breakManager.js';
import { initSpeechCommands } from './speechCommands.js';
import { recordGoal, recordGameResult, getPlayerStats, getLeaderboard } from './leaderboard.js';
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

  // ── Dashboard — choose Play Online vs Play Bots ─────────────────────────────
  const { botsOnly, botsPerTeam, ballSizeMultiplier, gravityMultiplier, adventureMode, adventureCharModel, adventureRoundConfig } = await new Promise(resolve => {
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

    function openProfileOverlay() {
      const profileOverlay = document.getElementById('profile-overlay');
      document.getElementById('profile-name-input').value = currentPlayerName;
      document.getElementById('profile-name-error').classList.add('hidden');
      document.getElementById('profile-name-ok').classList.add('hidden');
      profileOverlay.classList.remove('hidden');
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

    // Change character from profile
    document.getElementById('btn-profile-char').addEventListener('click', () => {
      const profileOverlay = document.getElementById('profile-overlay');
      const sessionUser = getSession();
      profileOverlay.classList.add('hidden');
      // Reuse the character select screen; pass a dummy overlay that won't be shown
      const dummyOverlay = document.createElement('div');
      showCharacterSelect(dummyOverlay, sessionUser, ({ character }) => {
        setCookie('characterModel', character, 365);
        if (character !== characterModel) {
          characterModel = character;
          swapPlayerCharacter(characterModel);
        }
        openProfileOverlay();
      });
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

    document.getElementById('btn-open-shop').addEventListener('click', () => {
      document.getElementById('profile-overlay').classList.add('hidden');
      openShopOverlay();
    });

    document.getElementById('btn-shop-close').addEventListener('click', () => {
      document.getElementById('shop-overlay').classList.add('hidden');
      openProfileOverlay();
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
        playerTeams[requesterId] = assignTeamToNewPlayer();
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

  multiplayer = new Multiplayer(playerName, handleIncomingData, { botsOnly });
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
      multiplayer.sendTo(peerId, { type: 'joinRequest', requesterId: multiplayer.getId() });
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

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

  createClouds(scene);

  let soccerBall;
  const MIN_PLAYERS_PER_TEAM = botsOnly ? botsPerTeam : 3;
  const aiPlayers = { home: [], away: [] };
  let setPieceManager;

  // Team management: tracks which team each peer is on ('home' | 'away')
  const playerTeams = {};
  let localPlayerTeam = 'home';
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
    el.innerHTML = `<div style="
      font-family:Impact,sans-serif;
      font-size:clamp(80px,18vw,200px);
      color:#ffe600;
      text-shadow:0 0 40px #ff8800,0 0 80px #ff4400,4px 4px 0 #000,-4px -4px 0 #000,4px -4px 0 #000,-4px 4px 0 #000;
      letter-spacing:10px;
      animation:goalPulse 0.5s ease-in-out infinite alternate;
    ">GOAL!</div>`;
    const style = document.createElement('style');
    style.textContent = `@keyframes goalPulse{from{transform:scale(1) rotate(-3deg)}to{transform:scale(1.08) rotate(3deg)}}`;
    document.head.appendChild(style);
    document.body.appendChild(el);
    _goalOverlayEl = el;
  }

  function _showGoalOverlay() {
    _ensureGoalOverlay();
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

  function triggerGoalCelebration(scoringTeam, goalPos, onComplete) {
    goalCelebrationActive = true;
    if (playerControls) playerControls.enabled = false;
    Object.values(aiPlayers).flat().forEach(ai => { ai.frozen = true; });

    // Freeze ball in place
    if (soccerBall?.body) {
      soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    _showGoalOverlay();
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

    // After 4 seconds reveal the Play Again button (or adventure result)
    setTimeout(async () => {
      if (adventureMode) {
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

    const outZ = pos.z > SCORE_FIELD_HALF || pos.z < -SCORE_FIELD_HALF;
    const outX = Math.abs(pos.x) > SCORE_FIELD_X_HALF;
    if (!outX && !outZ) return;

    const inX = Math.abs(pos.x) <= SCORE_GOAL_WIDTH / 2;
    const inY = pos.y >= -0.3 && pos.y <= SCORE_GOAL_HEIGHT + 0.3;
    const vel = soccerBall.body.linvel();

    // Goal scored?
    if (inX && inY && pos.z > SCORE_FIELD_HALF && vel.z > 0) {
      // Red goal is on the +Z end, so scoring there awards the blue/home score.
      score.home++;
      updateScoreUI();
      goalCooldown = now + 7000;
      const goalPos = { x: 0, y: 1.5, z: SCORE_FIELD_HALF };
      const didTouch = soccerBall.lastTouchedTeam;
      triggerGoalCelebration('home', goalPos, () => {
        if (didTouch === 'home') recordGoal(playerName).catch(() => {});
      });
      return;
    }
    if (inX && inY && pos.z < -SCORE_FIELD_HALF && vel.z < 0) {
      // Blue goal is on the -Z end, so scoring there awards the red/away score.
      score.away++;
      updateScoreUI();
      goalCooldown = now + 7000;
      const goalPos = { x: 0, y: 1.5, z: -SCORE_FIELD_HALF };
      triggerGoalCelebration('away', goalPos, null);
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
      const OFFSET = 1.5;
      if (spType === 'throwIn') {
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
      } else if (spType === 'cornerKick') {
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
      } else if (spType === 'goalKick') {
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
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
        const OFFSET = 1.5;
        if (spType === 'throwIn') {
          spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
        } else if (spType === 'cornerKick') {
          spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
          spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
        } else if (spType === 'goalKick') {
          spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
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
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
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

  generateSoccerField(scene, rapierWorld);
  createMoon(scene, rapierWorld, rbToMesh);

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
    spawnPosition: initialSpawn
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
  const saveBtn = document.getElementById('save-settings');
  const characterSelect = document.getElementById('character-select');
  const toggleBtn = document.getElementById("toggle-console");
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

  settingsBtn.addEventListener('click', () => {
    nameInput.value = playerName;
    characterSelect.value = characterModel;
    overlay.style.display = 'flex';
  });

  saveBtn.addEventListener('click', () => {
    const trimmedName = nameInput.value.trim();
    if (trimmedName) {
      playerName = trimmedName;
      if (player?.nameLabel) {
        player.nameLabel.innerText = playerName;
      }
    }
    setCookie("playerName", playerName);

    const selectedModel = characterSelect.value;
    if (selectedModel && selectedModel !== characterModel) {
      characterModel = selectedModel;
      swapPlayerCharacter(characterModel);
      const sessionUser = getSession();
      if (sessionUser) updateUserCharacter(sessionUser, characterModel);
    }
    setCookie("characterModel", characterModel);

    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

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
  settingsBtn.addEventListener('click', () => {
    if (musicSlider) musicSlider.value = audioManager.musicVolume;
    if (sfxSlider) sfxSlider.value = audioManager.sfxVolume;
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => (c.style.display = 'none'));
      btn.classList.add('active');
      const tab = document.getElementById(`tab-${btn.dataset.tab}`);
      if (tab) tab.style.display = 'block';
      if (btn.dataset.tab === 'leaderboard') {
        refreshLeaderboard();
      }
    });
  });

  async function refreshLeaderboard() {
    const el = document.getElementById('leaderboard-list');
    if (!el) return;
    el.innerHTML = '<em>Loading...</em>';
    try {
      const rows = await getLeaderboard();
      if (rows.length === 0) {
        el.innerHTML = '<em>No scores yet.</em>';
        return;
      }
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Goals</th><th>W</th><th>D</th><th>L</th></tr></thead>';
      const tbody = document.createElement('tbody');
      rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        [i + 1, row.name, row.goals || 0, row.wins || 0, row.draws || 0, row.losses || 0].forEach(val => {
          const td = document.createElement('td');
          td.textContent = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      el.innerHTML = '';
      el.appendChild(table);
    } catch (err) {
      el.innerHTML = '<em>Failed to load leaderboard.</em>';
      console.error('Leaderboard error:', err);
    }
  }

  toggleBtn.addEventListener("click", () => {
    const visible = consoleDiv.style.display === "block";
    consoleDiv.style.display = visible ? "none" : "block";
    toggleBtn.textContent = visible ? "Show Console" : "Hide Console";
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
          spLocked && spTeam === localPlayerTeam ? null : localPlayerTeam
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
            spLocked && spTeam === team ? null : team
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

          ai.update(frameDelta, soccerBall, {
            pursueBall: !ballChaser || ai === ballChaser,
            formationIndex: index,
            formationCount: players.length,
            chaserIndex: ballChaserIndex >= 0 ? ballChaserIndex : null,
            chaserPosition: ballChaserPosition,
            teammates: players,
            opponents,
            humanTeammates
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
      if (ended && multiplayer.isHost) {
        multiplayer.send({ type: 'setPieceClear' });
      }
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
    if (playerModel) updateRainbowTrail(playerModel, playerControls?.isMoving ?? false);

    if (followBallCamera && playerModel && soccerBall?.body) {
      const ballRaw = soccerBall.getPosition();
      const ballPos = new THREE.Vector3(ballRaw.x, ballRaw.y, ballRaw.z);
      const playerPos = playerModel.position;

      const toBall = new THREE.Vector3(ballPos.x - playerPos.x, 0, ballPos.z - playerPos.z);
      const horizDist = toBall.length();

      const camHeight = 7;
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

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
