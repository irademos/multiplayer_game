// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { createClouds, generateSoccerField, createMoon, MOON_RADIUS } from "./worldGeneration.js";
import { getTerrainHeight } from './water.js';
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { initLogin } from './login.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';
import { updateMeleeAttacks } from './melee.js';
import { LevelLoader } from './levelLoader.js';
import { BreakManager } from './breakManager.js';
import { initSpeechCommands } from './speechCommands.js';
import { recordGoal, getLeaderboard } from './leaderboard.js';
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
            moveLocalPlayerToSpawn(team);
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
      } else if ('aiTeam' in data) {
        // Backward compatibility with older hosts that only supported one computer player.
        setAITeamCounts({ home: data.aiTeam === 'home' ? 1 : 0, away: data.aiTeam === 'away' ? 1 : 0 });
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

  multiplayer = new Multiplayer(playerName, handleIncomingData);
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
  const audioManager = new AudioManager();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createClouds(scene);

  let soccerBall;
  const MIN_PLAYERS_PER_TEAM = 3;
  const aiPlayers = { home: [], away: [] };
  let setPieceManager;

  // Team management: tracks which team each peer is on ('home' | 'away')
  const playerTeams = {};
  let localPlayerTeam = 'home';
  let localTeamConfirmed = false;

  const score = { home: 0, away: 0 };
  let goalCooldown = 0;
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

  const SCORE_FIELD_X_HALF = 30; // field is 60 wide

  function checkGoal() {
    if (!soccerBall?.body) return;
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
      goalCooldown = now + 3000;
      soccerBall.reset();
      if (soccerBall.lastTouchedTeam === 'home') {
        recordGoal(playerName).catch(() => {});
      }
      return;
    }
    if (inX && inY && pos.z < -SCORE_FIELD_HALF && vel.z < 0) {
      // Blue goal is on the -Z end, so scoring there awards the red/away score.
      score.away++;
      updateScoreUI();
      goalCooldown = now + 3000;
      soccerBall.reset();
      return;
    }

    // Not a goal — trigger the appropriate set piece
    triggerSetPiece(pos);
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

    // Place ball at set piece spot
    soccerBall.body.setTranslation(ballFixedPos, true);
    soccerBall.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    soccerBall.body.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Teleport the taking player into the zone, offset from the ball so they
    // don't start overlapping it (which would corrupt lastTouchedTeam tracking).
    const spBody = getBodyForTeam(teamTaking);
    if (spBody) {
      const sy = 1.5; // drops onto ground via physics; ground collider top is Y=0
      let spawnX = ballFixedPos.x;
      let spawnZ = ballFixedPos.z;
      const OFFSET = 1.5;
      if (type === 'throwIn') {
        // Player stands just outside the sideline, offset in X away from field
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
      } else if (type === 'cornerKick') {
        // Player stands outside the field in the corner zone
        spawnX = ballFixedPos.x + Math.sign(ballFixedPos.x) * OFFSET;
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
      } else if (type === 'goalKick') {
        // Player stands behind the ball (toward their own goal line)
        spawnZ = ballFixedPos.z + Math.sign(ballFixedPos.z) * OFFSET;
      }
      spBody.setTranslation({ x: spawnX, y: sy, z: spawnZ }, true);
      spBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      spBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

      // Sync the Three.js model and PlayerControls state for the local player
      if (teamTaking === 'home' && playerModel && playerControls) {
        playerModel.position.set(spawnX, sy, spawnZ);
        playerControls.playerX = spawnX;
        playerControls.playerY = sy;
        playerControls.playerZ = spawnZ;
        playerControls.lastPosition.set(spawnX, sy, spawnZ);
      }
    }

    setPieceManager.trigger(type, teamTaking, ballFixedPos, zone);
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
    multiplayer.send({ type: 'teamAssignments', assignments, aiCounts: countNeededAIByTeam() });
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
      if (!playerControls.enabled || playerControls.isInWater) return;
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
      table.innerHTML = '<thead><tr><th>#</th><th>Player</th><th>Goals</th></tr></thead>';
      const tbody = document.createElement('tbody');
      rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${i + 1}</td><td>${row.name}</td><td>${row.goals}</td>`;
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
        if (multiplayer.isHost) {
          ai.update(frameDelta, soccerBall, {
            pursueBall: !ballChaser || ai === ballChaser,
            formationIndex: index,
            formationCount: players.length,
            chaserIndex: ballChaserIndex >= 0 ? ballChaserIndex : null,
            chaserPosition: ballChaserPosition
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
      const otherTeam = sp.teamTaking === 'home' ? 'away' : 'home';
      const setPieceBody = getBodyForTeam(sp.teamTaking);
      const otherBody    = getBodyForTeam(otherTeam);
      setPieceManager.update(soccerBall, setPieceBody, otherBody);
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

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
