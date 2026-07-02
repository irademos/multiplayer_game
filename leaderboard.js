import { db } from './firebase-init.js';
import { ref, get, runTransaction } from 'firebase/database';

function sanitizeName(name) {
  return name.replace(/[.#$[\]/]/g, '_').slice(0, 50);
}

export async function recordGoal(playerName) {
  const key = sanitizeName(playerName);
  const playerRef = ref(db, `leaderboard/${key}`);
  await runTransaction(playerRef, (current) => {
    if (current === null) {
      return { name: playerName, goals: 1, wins: 0, draws: 0, losses: 0, coins: 5 };
    }
    return {
      ...current,
      name: playerName,
      goals: (current.goals || 0) + 1,
      coins: (current.coins || 0) + 5,
    };
  });
}

export async function recordGameResult(playerName, result) {
  const key = sanitizeName(playerName);
  const playerRef = ref(db, `leaderboard/${key}`);
  await runTransaction(playerRef, (current) => {
    const base = current ?? { name: playerName, goals: 0, wins: 0, draws: 0, losses: 0, coins: 0 };
    const coinBonus = result === 'win' ? 15 : 0;
    return {
      ...base,
      name: playerName,
      wins: (base.wins || 0) + (result === 'win' ? 1 : 0),
      draws: (base.draws || 0) + (result === 'draw' ? 1 : 0),
      losses: (base.losses || 0) + (result === 'loss' ? 1 : 0),
      coins: (base.coins || 0) + coinBonus,
    };
  });
}

export async function getPlayerStats(playerName) {
  const key = sanitizeName(playerName);
  const snap = await get(ref(db, `leaderboard/${key}`));
  if (!snap.exists()) return { name: playerName, goals: 0, wins: 0, draws: 0, losses: 0, coins: 0 };
  return snap.val();
}

export async function getLeaderboard() {
  const snap = await get(ref(db, 'leaderboard'));
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.values(data).sort((a, b) => (b.goals || 0) - (a.goals || 0));
}
