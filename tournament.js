// Tournament module — Firebase-backed daily tournament system
import { db } from './firebase-init.js';
import { ref, set, get, remove, update, onValue, runTransaction } from 'firebase/database';

// ── Constants ──────────────────────────────────────────────────────────────────
export const TOURNAMENT_TEAMS = 16;
export const TOURNAMENT_PLAYERS_PER_TEAM = 3;
export const JOIN_TIMEOUT_MS = 120_000;
export const READY_TIMEOUT_MS = 120_000;

// Daily tournament schedule (Eastern Time)
const SCHEDULE = [
  { hour: 12, minute: 30, label: '12:30 PM ET' },
  { hour: 20, minute: 30, label: '8:30 PM ET' },
];

// ── Eastern-time utilities ─────────────────────────────────────────────────────
function etParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(date);
  const g = t => parseInt(parts.find(p => p.type === t)?.value || '0');
  return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour'), minute: g('minute') };
}

// Newton's method: find UTC ms such that ET time is hour:minute on etDateStr
function etToUtcMs(etDateStr, hour, minute) {
  const [year, month, day] = etDateStr.split('-').map(Number);
  let utcMs = Date.UTC(year, month - 1, day, hour + 5, minute); // EST initial guess
  for (let i = 0; i < 4; i++) {
    const et = etParts(new Date(utcMs));
    const etMs = Date.UTC(et.year, et.month - 1, et.day, et.hour, et.minute);
    utcMs += Date.UTC(year, month - 1, day, hour, minute) - etMs;
  }
  return utcMs;
}

// ── Schedule computation ───────────────────────────────────────────────────────
export function getUpcomingTournaments(count = 8) {
  const now = Date.now();
  const results = [];
  for (let d = 0; d < 14 && results.length < count; d++) {
    const etDateStr = new Date(now + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    for (const { hour, minute, label } of SCHEDULE) {
      const ts = etToUtcMs(etDateStr, hour, minute);
      if (ts > now - 300_000) { // include up to 5 min after start time
        results.push({
          id: `${etDateStr}-${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`,
          scheduledTime: ts,
          label,
        });
      }
    }
  }
  return results.sort((a, b) => a.scheduledTime - b.scheduledTime).slice(0, count);
}

// ── Bot / team name generation ────────────────────────────────────────────────
const BOT_FIRSTS = ['Shadow','Thunder','Blaze','Storm','Iron','Turbo','Speedy','Night','Neon','Cyber','Atomic','Ghost','Rapid','Quantum','Mega','Ultra','Super','Prime','Hyper','Stealth'];
const BOT_LASTS  = ['Eagle','Wolf','Tiger','Bear','Fox','Hawk','Lion','Shark','Falcon','Panther','Cobra','Viper','Bolt','Fury','Claw','Fang','Slash','Strike','Rush','Blaze'];
const TEAM_ADJS  = ['Fire','Thunder','Storm','Iron','Shadow','Crystal','Neon','Golden','Silver','Crimson','Sapphire','Electric','Frozen','Ancient','Cosmic','Savage','Blazing','Arctic','Phantom','Turbo'];
const TEAM_NOUNS = ['Eagles','Wolves','Tigers','Bears','Lions','Sharks','Hawks','Falcons','Panthers','Cobras','Vipers','Knights','Rangers','Warriors','Titans','Dragons','Phoenixes','Stallions','Raptors','Cyclones'];
const BOT_CHARS  = ['/models/old_man.fbx','/models/cowboy.fbx','/models/golem.fbx','/models/zombie.fbx','/models/zombie_boy.fbx','/models/zombie_green.fbx','/models/Chimpanzee.fbx','/models/seagull.fbx'];

const rand = arr => arr[Math.floor(Math.random() * arr.length)];

// ── Bracket generation ─────────────────────────────────────────────────────────
export function generateBracket(registrations) {
  const total = TOURNAMENT_TEAMS * TOURNAMENT_PLAYERS_PER_TEAM;
  const players = Object.keys(registrations || {}).map(u => ({ username: u, isBot: false, displayName: u }));
  players.sort(() => Math.random() - 0.5);
  while (players.length < total) {
    const id = `bot-${Math.random().toString(36).slice(2, 8)}`;
    players.push({ username: id, isBot: true, displayName: `${rand(BOT_FIRSTS)} ${rand(BOT_LASTS)}`, character: rand(BOT_CHARS) });
  }

  const usedNames = new Set();
  const makeTeamName = () => {
    let name, tries = 0;
    do { name = `${rand(TEAM_ADJS)} ${rand(TEAM_NOUNS)}`; tries++; } while (usedNames.has(name) && tries < 200);
    usedNames.add(name);
    return name;
  };

  const teams = {};
  for (let i = 0; i < TOURNAMENT_TEAMS; i++) {
    teams[String(i)] = {
      name: makeTeamName(),
      players: players.slice(i * TOURNAMENT_PLAYERS_PER_TEAM, (i + 1) * TOURNAMENT_PLAYERS_PER_TEAM),
    };
  }

  const matches = {};
  for (let i = 0; i < TOURNAMENT_TEAMS / 2; i++) {
    matches[`r0_m${i}`] = {
      round: 0, matchIndex: i,
      team1: String(i * 2), team2: String(i * 2 + 1),
      status: 'waiting_join', winner: null, winnerId: null,
      joinedPlayers: {}, readyPlayers: {},
    };
  }

  return { teams, matches };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
export function getMatchRoomId(tournamentId, matchId) {
  // Keep under 50 chars for PeerJS
  const short = tournamentId.replace(/-/g, '').slice(-8);
  return `t${short}-${matchId}`;
}

export function findPlayerMatch(bracket, username) {
  if (!bracket?.matches || !bracket?.teams) return null;
  for (const [matchId, match] of Object.entries(bracket.matches)) {
    const t1players = bracket.teams[match.team1]?.players || [];
    const t2players = bracket.teams[match.team2]?.players || [];
    const inT1 = t1players.some(p => !p.isBot && p.username === username);
    const inT2 = t2players.some(p => !p.isBot && p.username === username);
    if (inT1 || inT2) {
      const myTeamId = inT1 ? match.team1 : match.team2;
      const oppTeamId = inT1 ? match.team2 : match.team1;
      return {
        matchId, match,
        myTeamId, oppTeamId,
        myTeam: bracket.teams[myTeamId],
        opponentTeam: bracket.teams[oppTeamId],
        isTeam1: inT1,
      };
    }
  }
  return null;
}

export function getRealPlayersForMatch(bracket, matchId) {
  const match = bracket?.matches?.[matchId];
  if (!match) return [];
  const teams = bracket?.teams || {};
  return [
    ...(teams[match.team1]?.players || []),
    ...(teams[match.team2]?.players || []),
  ].filter(p => !p.isBot).map(p => p.username);
}

export function getPlayerLatestMatch(bracket, username) {
  // Find the latest round match the player is in (highest round number)
  if (!bracket?.matches) return null;
  let best = null;
  for (const [matchId, match] of Object.entries(bracket.matches)) {
    const info = findPlayerMatchById(bracket, username, matchId);
    if (info && (!best || match.round > best.match.round)) {
      best = info;
    }
  }
  return best;
}

function findPlayerMatchById(bracket, username, matchId) {
  const match = bracket?.matches?.[matchId];
  if (!match) return null;
  const t1players = bracket.teams?.[match.team1]?.players || [];
  const t2players = bracket.teams?.[match.team2]?.players || [];
  const inT1 = t1players.some(p => !p.isBot && p.username === username);
  const inT2 = t2players.some(p => !p.isBot && p.username === username);
  if (!inT1 && !inT2) return null;
  const myTeamId = inT1 ? match.team1 : match.team2;
  const oppTeamId = inT1 ? match.team2 : match.team1;
  return {
    matchId, match,
    myTeamId, oppTeamId,
    myTeam: bracket.teams?.[myTeamId],
    opponentTeam: bracket.teams?.[oppTeamId],
    isTeam1: inT1,
  };
}

// ── Firebase operations ────────────────────────────────────────────────────────
export async function ensureTournamentsExist() {
  for (const t of getUpcomingTournaments(4)) {
    const snap = await get(ref(db, `tournaments/${t.id}`));
    if (!snap.exists()) {
      await set(ref(db, `tournaments/${t.id}`), {
        scheduledTime: t.scheduledTime, label: t.label,
        status: 'upcoming', registrations: {},
      });
    }
  }
}

export function subscribeTournamentList(callback) {
  const upcoming = getUpcomingTournaments(6);
  const data = {};
  const unsubs = [];
  for (const t of upcoming) {
    data[t.id] = { ...t, status: 'upcoming', registrations: {}, registrationCount: 0 };
    const unsub = onValue(ref(db, `tournaments/${t.id}`), snap => {
      const val = snap.val() || {};
      data[t.id] = {
        ...t,
        status: val.status || 'upcoming',
        registrations: val.registrations || {},
        registrationCount: Object.keys(val.registrations || {}).length,
        bracket: val.bracket || null,
        champion: val.championTeamId || null,
      };
      callback(Object.values(data).sort((a, b) => a.scheduledTime - b.scheduledTime));
    });
    unsubs.push(unsub);
  }
  return () => unsubs.forEach(u => u());
}

export function subscribeTournament(tournamentId, callback) {
  return onValue(ref(db, `tournaments/${tournamentId}`), snap => callback(snap.val()));
}

export async function registerForTournament(id, username) {
  await set(ref(db, `tournaments/${id}/registrations/${username}`), true);
}

export async function unregisterFromTournament(id, username) {
  await remove(ref(db, `tournaments/${id}/registrations/${username}`));
}

export async function tryStartTournament(id) {
  let didStart = false;
  await runTransaction(ref(db, `tournaments/${id}`), current => {
    if (!current || current.status !== 'upcoming') return undefined; // abort
    if (Date.now() < current.scheduledTime - 5000) return undefined; // too early
    didStart = true;
    return { ...current, status: 'starting', bracket: generateBracket(current.registrations || {}) };
  });
  return didStart;
}

export async function confirmJoin(tournamentId, matchId, username) {
  await set(ref(db, `tournaments/${tournamentId}/bracket/matches/${matchId}/joinedPlayers/${username}`), true);
}

export async function markReady(tournamentId, matchId, username) {
  await set(ref(db, `tournaments/${tournamentId}/bracket/matches/${matchId}/readyPlayers/${username}`), true);
}

export async function kickAndFillBots(tournamentId, matchId, bracket) {
  // Replace any non-joined real players with bots and mark match as playing
  const match = bracket?.matches?.[matchId];
  if (!match) return;
  const realPlayers = getRealPlayersForMatch(bracket, matchId);
  const joined = match.joinedPlayers || {};

  const updates = {};
  const teams = bracket.teams || {};

  for (const side of ['team1', 'team2']) {
    const teamId = match[side];
    const players = [...(teams[teamId]?.players || [])];
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.isBot && !joined[p.username]) {
        // Replace with bot
        const botId = `bot-${Math.random().toString(36).slice(2, 8)}`;
        players[i] = { username: botId, isBot: true, displayName: `${rand(BOT_FIRSTS)} ${rand(BOT_LASTS)}`, character: rand(BOT_CHARS) };
      }
    }
    updates[`tournaments/${tournamentId}/bracket/teams/${teamId}/players`] = players;
  }
  updates[`tournaments/${tournamentId}/bracket/matches/${matchId}/status`] = 'playing';
  await update(ref(db), updates);
}

export async function reportMatchResult(tournamentId, matchId, winnerTournamentTeam) {
  const matchRef = ref(db, `tournaments/${tournamentId}/bracket/matches/${matchId}`);
  const snap = await get(matchRef);
  if (!snap.exists()) return;
  const match = snap.val();
  if (match.status === 'complete') return;

  const winnerId = winnerTournamentTeam === 'team1' ? match.team1 : match.team2;
  await update(matchRef, { status: 'complete', winner: winnerTournamentTeam, winnerId });
  await advanceIfRoundComplete(tournamentId, match.round);
}

async function advanceIfRoundComplete(tournamentId, round) {
  const snap = await get(ref(db, `tournaments/${tournamentId}`));
  if (!snap.exists()) return;
  const t = snap.val();
  const matches = t.bracket?.matches || {};
  const roundMatches = Object.entries(matches).filter(([, m]) => m.round === round);
  if (!roundMatches.every(([, m]) => m.status === 'complete')) return;

  const winners = roundMatches
    .sort(([, a], [, b]) => a.matchIndex - b.matchIndex)
    .map(([, m]) => m.winnerId);

  if (winners.length === 1) {
    // Tournament complete
    await update(ref(db, `tournaments/${tournamentId}`), { status: 'complete', championTeamId: winners[0] });
    return;
  }

  const nextRound = round + 1;
  const updates = { [`tournaments/${tournamentId}/currentRound`]: nextRound };
  for (let i = 0; i < Math.floor(winners.length / 2); i++) {
    updates[`tournaments/${tournamentId}/bracket/matches/r${nextRound}_m${i}`] = {
      round: nextRound, matchIndex: i,
      team1: winners[i * 2], team2: winners[i * 2 + 1],
      status: 'waiting_join', winner: null, winnerId: null,
      joinedPlayers: {}, readyPlayers: {},
    };
  }
  await update(ref(db), updates);
}

// ── Notification subscription ──────────────────────────────────────────────────
export function startTournamentNotifications(username, onTournamentStart) {
  const upcoming = getUpcomingTournaments(4);
  const seen = new Set();
  const unsubs = [];

  for (const t of upcoming) {
    const unsub = onValue(ref(db, `tournaments/${t.id}`), snap => {
      const data = snap.val();
      if (!data) return;
      if ((data.status === 'starting') && data.registrations?.[username] && !seen.has(t.id)) {
        seen.add(t.id);
        onTournamentStart(t.id, t.label, data);
      }
    });
    unsubs.push(unsub);
  }

  // Poll every 30s to start tournaments on time (any client can trigger start)
  const pollInterval = setInterval(async () => {
    for (const t of getUpcomingTournaments(4)) {
      if (Date.now() >= t.scheduledTime - 5000 && Date.now() < t.scheduledTime + 60000) {
        const snap = await get(ref(db, `tournaments/${t.id}`));
        const data = snap.val();
        if (data?.status === 'upcoming' && data.registrations?.[username]) {
          await tryStartTournament(t.id).catch(() => {});
        }
      }
    }
  }, 30_000);

  return () => {
    unsubs.forEach(u => u());
    clearInterval(pollInterval);
  };
}
