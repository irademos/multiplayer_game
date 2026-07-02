// login.js — Arcade-style login/signup with Firebase PIN auth
import { db } from './firebase-init.js';
import { ref, get, set, remove, runTransaction } from 'firebase/database';
import { getCookie, setCookie } from './utils.js';

const SESSION_COOKIE = 'arcadeSession';
const SESSION_DAYS = 7;

async function hashPin(username, pin) {
  const data = new TextEncoder().encode(`${username.toLowerCase()}:${pin}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getUser(username) {
  const snap = await get(ref(db, `users/${username.toLowerCase()}`));
  return snap.exists() ? snap.val() : null;
}

async function saveUser(username, pinHash, character) {
  await set(ref(db, `users/${username.toLowerCase()}`), {
    displayName: username,
    pinHash,
    character: character || '/models/old_man.fbx',
    createdAt: Date.now(),
  });
}

async function updateUserCharacter(username, character) {
  const userRef = ref(db, `users/${username.toLowerCase()}/character`);
  await set(userRef, character);
}

export async function updateUserDisplayName(username, newDisplayName) {
  const userRef = ref(db, `users/${username.toLowerCase()}/displayName`);
  await set(userRef, newDisplayName);
}

export async function getUserUpgrades(username) {
  const snap = await get(ref(db, `users/${username.toLowerCase()}/upgrades`));
  return snap.exists() ? snap.val() : {};
}

export async function purchaseUpgrade(playerName, upgradeKey, coinCost) {
  const sanitize = name => name.replace(/[.#$[\]/]/g, '_').slice(0, 50);
  const lbRef = ref(db, `leaderboard/${sanitize(playerName)}`);
  let success = false;
  await runTransaction(lbRef, (current) => {
    if (!current) return current;
    const coins = current.coins || 0;
    if (coins < coinCost) { success = false; return current; }
    success = true;
    return { ...current, coins: coins - coinCost };
  });
  if (!success) throw new Error('NOT_ENOUGH_COINS');
  const username = getSession();
  await set(ref(db, `users/${username.toLowerCase()}/upgrades/${upgradeKey}`), true);
}

function saveSession(username) {
  setCookie(SESSION_COOKIE, username, SESSION_DAYS);
}

function clearSession() {
  document.cookie = `${SESSION_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

function getSession() {
  return getCookie(SESSION_COOKIE);
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

function el(id) { return document.getElementById(id); }

function showScreen(id) {
  ['screen-welcome', 'screen-login', 'screen-signup'].forEach(s => {
    const node = el(s);
    if (!node) return;
    if (s === id) {
      node.classList.remove('hidden');
    } else {
      node.classList.add('hidden');
    }
  });
}

function setError(screenPrefix, msg) {
  const node = el(`${screenPrefix}-error`);
  if (node) { node.textContent = msg; node.classList.toggle('hidden', !msg); }
}

function pinDots(value, max) {
  return '●'.repeat(Math.min(value.length, max)) + '○'.repeat(Math.max(0, max - value.length));
}

function bindPinInput(inputId, displayId, max = 6) {
  const input = el(inputId);
  const display = el(displayId);
  if (!input || !display) return;
  display.textContent = pinDots('', max);
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, max);
    display.textContent = pinDots(input.value, max);
  });
}

// ─── Main init ─────────────────────────────────────────────────────────────────

export async function initLogin(onSuccess) {
  const overlay = el('login-overlay');
  if (!overlay) return;

  bindPinInput('login-pin', 'login-pin-display');
  bindPinInput('signup-pin', 'signup-pin-display');
  bindPinInput('signup-pin2', 'signup-pin2-display');

  // Check for existing session
  const sessionUser = getSession();
  if (sessionUser && sessionStorage.getItem('skipToGame')) {
    // Fast path: skip welcome screen, go straight to game
    sessionStorage.removeItem('skipToGame');
    const user = await getUser(sessionUser);
    overlay.classList.add('hidden');
    onSuccess({ username: user?.displayName || sessionUser, character: user?.character || '/models/old_man.fbx' });
    return;
  }
  if (sessionUser) {
    const welcomeLabel = el('welcome-name');
    if (welcomeLabel) welcomeLabel.textContent = sessionUser.toUpperCase();
    showScreen('screen-welcome');
  } else {
    showScreen('screen-login');
  }

  // ── Welcome screen ──────────────────────────────────────────────────────────
  el('btn-start-game')?.addEventListener('click', async () => {
    const username = getSession();
    if (!username) { showScreen('screen-login'); return; }
    const user = await getUser(username);
    overlay.classList.add('hidden');
    onSuccess({ username: user?.displayName || username, character: user?.character || '/models/old_man.fbx' });
  });

  el('btn-not-you')?.addEventListener('click', () => {
    clearSession();
    showScreen('screen-login');
  });

  // ── Login screen ────────────────────────────────────────────────────────────
  el('btn-login')?.addEventListener('click', async () => {
    const name = el('login-name').value.trim();
    const pin = el('login-pin').value.trim();
    setError('login', '');

    if (!name) { setError('login', 'ENTER YOUR NAME'); return; }
    if (!pin || pin.length < 4) { setError('login', 'PIN MUST BE 4-6 DIGITS'); return; }

    el('btn-login').textContent = 'CHECKING...';
    el('btn-login').disabled = true;

    try {
      const user = await getUser(name);
      if (!user) { setError('login', 'NAME NOT FOUND — SIGN UP?'); return; }
      const hash = await hashPin(name, pin);
      if (hash !== user.pinHash) { setError('login', 'WRONG PIN — TRY AGAIN'); return; }
      saveSession(name);
      overlay.classList.add('hidden');
      onSuccess({ username: user.displayName || name, character: user.character || '/models/old_man.fbx' });
    } catch (e) {
      setError('login', 'ERROR — CHECK CONNECTION');
    } finally {
      el('btn-login').textContent = 'LOGIN';
      el('btn-login').disabled = false;
    }
  });

  el('btn-go-signup')?.addEventListener('click', () => {
    const name = el('login-name').value.trim();
    if (name) el('signup-name').value = name;
    setError('signup', '');
    showScreen('screen-signup');
  });

  // ── Sign-up screen ──────────────────────────────────────────────────────────
  el('btn-signup')?.addEventListener('click', async () => {
    const name = el('signup-name').value.trim();
    const pin = el('signup-pin').value.trim();
    const pin2 = el('signup-pin2').value.trim();
    setError('signup', '');

    if (!name || name.length < 2) { setError('signup', 'NAME TOO SHORT (MIN 2 CHARS)'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(name)) { setError('signup', 'LETTERS, NUMBERS & _ ONLY'); return; }
    if (!pin || pin.length < 4) { setError('signup', 'PIN MUST BE 4-6 DIGITS'); return; }
    if (pin !== pin2) { setError('signup', 'PINS DO NOT MATCH'); return; }

    el('btn-signup').textContent = 'SAVING...';
    el('btn-signup').disabled = true;

    try {
      const existing = await getUser(name);
      if (existing) { setError('signup', 'NAME TAKEN — CHOOSE ANOTHER'); return; }
      const hash = await hashPin(name, pin);
      await saveUser(name, hash, null);
      saveSession(name);
      // Go to character select — overlay stays until char selected
      showCharacterSelect(overlay, name, onSuccess);
    } catch (e) {
      setError('signup', 'ERROR — CHECK CONNECTION');
    } finally {
      el('btn-signup').textContent = 'SIGN UP';
      el('btn-signup').disabled = false;
    }
  });

  el('btn-back-to-login')?.addEventListener('click', () => {
    setError('login', '');
    showScreen('screen-login');
  });

  // Allow Enter key on login
  ['login-name', 'login-pin'].forEach(id => {
    el(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') el('btn-login')?.click(); });
  });
  ['signup-name', 'signup-pin', 'signup-pin2'].forEach(id => {
    el(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') el('btn-signup')?.click(); });
  });
}

// ─── Character Select ──────────────────────────────────────────────────────────

const CHARACTERS = [
  { label: 'OLD MAN',     model: '/models/old_man.fbx',      emoji: '🧓' },
  { label: 'COWBOY',      model: '/models/cowboy.fbx',        emoji: '🤠' },
  { label: 'GOLEM',       model: '/models/golem.fbx',         emoji: '🪨' },
  { label: 'ZOMBIE',      model: '/models/zombie.fbx',        emoji: '🧟' },
  { label: 'ZOMBIE BOY',  model: '/models/zombie_boy.fbx',    emoji: '🧟' },
  { label: 'ZOMBIE GRN',  model: '/models/zombie_green.fbx',  emoji: '🟢' },
  { label: 'CHIMP',       model: '/models/Chimpanzee.fbx',    emoji: '🐒' },
  { label: 'SEAGULL',     model: '/models/seagull.fbx',       emoji: '🐦' },
];

function showCharacterSelect(overlay, username, onSuccess) {
  const existing = el('char-select-overlay');
  if (existing) existing.remove();

  let idx = 0;

  const charOverlay = document.createElement('div');
  charOverlay.id = 'char-select-overlay';
  charOverlay.className = 'arcade-overlay';
  charOverlay.innerHTML = `
    <div class="arcade-panel char-panel">
      <div class="arcade-title blink-slow">SELECT YOUR<br>CHARACTER</div>
      <div class="char-carousel">
        <button class="char-arrow" id="char-left">◀</button>
        <div class="char-display">
          <div class="char-emoji" id="char-emoji"></div>
          <div class="char-name" id="char-label"></div>
          <div class="char-counter" id="char-counter"></div>
        </div>
        <button class="char-arrow" id="char-right">▶</button>
      </div>
      <button class="arcade-btn arcade-btn-green" id="char-ok">OK!</button>
    </div>
  `;
  document.body.appendChild(charOverlay);
  overlay.classList.add('hidden');

  function render() {
    const c = CHARACTERS[idx];
    el('char-emoji').textContent = c.emoji;
    el('char-label').textContent = c.label;
    el('char-counter').textContent = `${idx + 1} / ${CHARACTERS.length}`;
  }

  render();

  el('char-left').addEventListener('click', () => { idx = (idx - 1 + CHARACTERS.length) % CHARACTERS.length; render(); });
  el('char-right').addEventListener('click', () => { idx = (idx + 1) % CHARACTERS.length; render(); });

  el('char-ok').addEventListener('click', async () => {
    const chosen = CHARACTERS[idx];
    el('char-ok').textContent = 'SAVING...';
    el('char-ok').disabled = true;
    try {
      await updateUserCharacter(username, chosen.model);
      setCookie('characterModel', chosen.model, 365);
      charOverlay.remove();
      onSuccess({ username, character: chosen.model });
    } catch (e) {
      el('char-ok').textContent = 'ERROR! RETRY';
      el('char-ok').disabled = false;
    }
  });
}

export async function changePin(username, oldPin, newPin) {
  const user = await getUser(username);
  if (!user) throw new Error('USER_NOT_FOUND');
  const oldHash = await hashPin(username, oldPin);
  if (oldHash !== user.pinHash) throw new Error('WRONG_PIN');
  const newHash = await hashPin(username, newPin);
  await set(ref(db, `users/${username.toLowerCase()}/pinHash`), newHash);
}

function sanitizeName(name) {
  return name.replace(/[.#$[\]/]/g, '_').slice(0, 50);
}

export async function deleteAccount(username) {
  await remove(ref(db, `users/${username.toLowerCase()}`));
  await remove(ref(db, `leaderboard/${sanitizeName(username)}`));
}

export { getSession, clearSession, getUser, updateUserCharacter, showCharacterSelect, CHARACTERS };
