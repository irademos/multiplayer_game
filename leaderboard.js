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
      return { name: playerName, goals: 1 };
    }
    return { ...current, name: playerName, goals: (current.goals || 0) + 1 };
  });
}

export async function getLeaderboard() {
  const snap = await get(ref(db, 'leaderboard'));
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.values(data).sort((a, b) => (b.goals || 0) - (a.goals || 0));
}
