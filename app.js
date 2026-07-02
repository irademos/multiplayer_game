// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { createClouds, generateSoccerField, createMoon, MOON_RADIUS } from "./worldGeneration.js";
import { getTerrainHeight } from './water.js';
import { Multiplayer, subscribeOnlineCount } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { initLogin } from './login.js';
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

const clock = new THREE.Clock();
const mixerClock = new THREE.Clock();


// --- Rapier demo state ---
let rapierWorld;
const rbToMesh = new Map(); // RigidBody -> THREE.Mesh
let physicsAccumulator = 0;
const FIXED_DT = 1 / 60;

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  // ── Arcade login gate — resolves when player authenticates ──────────────────
  const { username: playerName, character: characterModel } = await new Promise(resolve => {
    initLogin(({ username, character }) => {
      setCookie('playerName', username);
      setCookie('characterModel', character || DEFAULT_CHARACTER_MODEL);
      resolve({ username, character: character || DEFAULT_CHARACTER_MODEL });
    });
  });

  // ── Dashboard — choose Play Online vs Play Bots ─────────────────────────────
  const { botsOnly, botsPerTeam } = await new Promise(resolve => {
    const overlay = document.getElementById('dashboard-overlay');
    const onlineNumEl = document.getElementById('dashboard-online-num');
    overlay.classList.remove('hidden');

    const unsubCount = subscribeOnlineCount(count => {
      if (onlineNumEl) onlineNumEl.textContent = count;
    });

    // Bot team size picker (1–5 bots per team)
    let selectedBotsPerTeam = 3;
    const sizeDisplay = document.getElementById('bots-size-display');
    const updateSizeDisplay = () => { sizeDisplay.textContent = selectedBotsPerTeam; };
    document.getElementById('bots-size-dec').addEventListener('click', () => {
      if (selectedBotsPerTeam > 1) { selectedBotsPerTeam--; updateSizeDisplay(); }
    });
    document.getElementById('bots-size-inc').addEventListener('click', () => {
      if (selectedBotsPerTeam < 5) { selectedBotsPerTeam++; updateSizeDisplay(); }
    });

    document.getElementById('btn-play-online').addEventListener('click', () => {
      unsubCount();
      overlay.classList.add('hidden');
      resolve({ botsOnly: false, botsPerTeam: selectedBotsPerTeam });
    });

    document.getElementById('btn-play-bots').addEventListener('click', () => {
      unsubCount();
      overlay.classList.add('hidden');
      resolve({ botsOnly: true, botsPerTeam: selectedBotsPerTeam });
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
        if (['mutantPunch','hurricaneKick','mmaKick'].includes(data.action)) {
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

  const audioManager = new AudioManager();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

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

    // After 4 seconds reveal the Play Again button
    setTimeout(() => {
      playAgainBtn.classList.remove('hidden');
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

    const { type, teamTaking, ballFixedPos, zone } = params;

    // Determine the designated taker: prefer local player if on the taking team,
    // otherwise fall back to the first AI on that team.
    let takerNetworkId = null;
    if (localPlayerTeam === teamTaking) {
      takerNetworkId = multiplayer.getId();
    } else {
      takerNetworkId = aiPlayers[teamTaking]?.[0]?.networkId ?? null;
    }

    applySetPiece({ spType: type, teamTaking, ballFixedPos, zone, takerNetworkId });

    // Broadcast the set piece to all connected clients
    multiplayer.send({ type: 'setPiece', spType: type, teamTaking, ballFixedPos, zone, takerNetworkId });
  }

  // Apply a set piece locally (runs on host via triggerSetPiece and on clients via network message).
  function applySetPiece({ spType, teamTaking, ballFixedPos, zone, takerNetworkId }) {
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

    setPieceManager.trigger(spType, teamTaking, ballFixedPos, zone, takerNetworkId);
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
  rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
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
  soccerBall.create(0, 1, 0);
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
  audioManager.playBGS('Forest Day/Forest Day.ogg');

  window.localHealth = 100;

  const healthFill = document.getElementById('health-fill');
  function updateHealthUI() {
    if (healthFill) {
      healthFill.style.width = `${window.localHealth}%`;
    }
  }
  updateHealthUI();

  let playerDead = false;

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
    const ai = new AIPlayer(scene, rapierWorld, {
      spawnX,
      spawnZ,
      targetGoalZ,
      color,
      name: `Computer ${team === 'home' ? 'Home' : 'Away'} ${index + 1}`
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
    window.localHealth = 100;
    updateHealthUI();
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
    playerDead = false;
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

  const rollButton = document.getElementById('roll-button');
  if (rollButton) {
    const doRoll = (e) => {
      e.preventDefault();
      if (!playerControls.enabled || playerControls.isInWater || playerControls.currentSpecialAction) return;
      playerControls.slideMomentum.copy(playerControls.lastMoveDirection).multiplyScalar(1.4);
      playerControls.playAction('runningKick');
      playerControls.audioManager?.playAttack();
    };
    rollButton.addEventListener('touchstart', doRoll, { passive: false });
    rollButton.addEventListener('mousedown', doRoll);
  }

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
    }
    setCookie("characterModel", characterModel);

    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
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

    updateHealthUI();
    if (window.localHealth <= 0 && !playerDead) {
      playerDead = true;
      playerControls.enabled = false;
      const actions = playerModel.userData.actions;
      const current = playerModel.userData.currentAction;
      const die = actions?.die;
      if (die) {
        actions[current]?.fadeOut(0.2);
        die.reset().fadeIn(0.2).play();
        playerModel.userData.currentAction = 'die';
      }
      showGameOver();
    }

    const mixerDelta = mixerClock.getDelta();

    Object.values(otherPlayers).forEach(p => {
      p.model.userData.mixer?.update(mixerDelta);
    });

    Object.values(aiPlayers).forEach((players) => {
      let ballChaser = null;
      let ballChaserIndex = -1;
      let ballChaserPosition = null;
      const ballPos = soccerBall?.getPosition?.();
      if (ballPos) {
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
          ai.update(frameDelta, soccerBall, {
            pursueBall: !ballChaser || ai === ballChaser,
            formationIndex: index,
            formationCount: players.length,
            chaserIndex: ballChaserIndex >= 0 ? ballChaserIndex : null,
            chaserPosition: ballChaserPosition,
            teammates: players
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

      // All other locally-simulated bodies must be pushed out of the zone
      const otherBodies = [];
      if (playerControls?.body && playerControls.body !== takerBody) {
        otherBodies.push(playerControls.body);
      }
      for (const team of ['home', 'away']) {
        for (const ai of (aiPlayers[team] ?? [])) {
          if (ai.body && ai.body !== takerBody) otherBodies.push(ai.body);
        }
      }

      const ended = setPieceManager.update(soccerBall, takerBody, otherBodies);
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
    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
