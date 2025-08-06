// app.js
import * as THREE from "three";
import { PlayerCharacter } from "./characters/PlayerCharacter.js";
import { loadMonsterModel } from "./models/monsterModel.js";
import { createBarriers, createTrees, createClouds, generateTerrainChunk } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';
import { getCookie, setCookie } from './utils.js';
import { spawnProjectile, updateProjectiles } from './projectiles.js';

const clock = new THREE.Clock();

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });

  let playerName = getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    setCookie("playerName", playerName);
  }

  const multiplayer = new Multiplayer(playerName, handleIncomingData);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createBarriers(scene);
  createTrees(scene);
  createClouds(scene);

  let monster = null;
  loadMonsterModel(scene, data => {
    monster = data.model;
    monster.userData.mixer = data.mixer;
    monster.userData.actions = data.actions;
    monster.userData.currentAction = "Idle";
    monster.userData.direction = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    monster.userData.speed = 0.01;
    monster.userData.lastDirectionChange = Date.now();
  });

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

  const player = new PlayerCharacter(playerName);
  const playerModel = player.model;
  scene.add(playerModel);
  document.body.appendChild(player.nameLabel);
  window.playerModel = playerModel;

  window.localHealth = 100;
  window.monsterHealth = 100;

  const projectiles = [];

  const playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile,
    projectiles
  });
  window.playerControls = playerControls;

  const generatedChunks = new Set();
  const chunkSize = 50;

  function getChunkCoord(x, z) {
    return `${Math.floor(x / chunkSize)},${Math.floor(z / chunkSize)}`;
  }

  function updateTerrain() {
    const playerPos = playerModel.position;
    const cx = Math.floor(playerPos.x / chunkSize);
    const cz = Math.floor(playerPos.z / chunkSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const key = `${cx + dx},${cz + dz}`;
        if (!generatedChunks.has(key)) {
          generateTerrainChunk(scene, cx + dx, cz + dz, chunkSize);
          generatedChunks.add(key);
        }
      }
    }
  }


  const otherPlayers = {};

  function handleIncomingData(peerId, data) {
    console.log('📡 Incoming data:', data);
    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const other = new PlayerCharacter(data.name);
        scene.add(other.model);
        document.body.appendChild(other.nameLabel);
        otherPlayers[data.id] = { model: other.model, nameLabel: other.nameLabel, name: data.name, health: 100 };
      }

      const player = otherPlayers[data.id];
      player.name = data.name;
      player.model.position.set(data.x, data.y, data.z);
      player.model.rotation.y = data.rotation;

      if (!multiplayer.connections[peerId]) {
        multiplayer.connections[peerId] = {};
      }
      const conn = multiplayer.connections[peerId];
      if (!conn.listItem) {
        const list = document.getElementById('connected-players-list');
        const item = document.createElement('li');
        item.id = `peer-${peerId}`;
        conn.listItem = item;
        list.appendChild(item);
      }
      conn.listItem.textContent = `Connected to ${data.name}`;
    }

    if (data.type === 'projectile') {
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(scene, projectiles, position, direction);
    }

    if (data.type === "monster" && monster) {
      const target = new THREE.Vector3(data.x, data.y, data.z);
      if (!window.playerControls?.isKnocked || monster.position.distanceTo(target) > 2) {
        monster.position.lerp(target, 0.2);
      }
    }
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
  const toggleBtn = document.getElementById("toggle-console");
  const consoleDiv = document.getElementById("console-log");

  settingsBtn.addEventListener('click', () => {
    nameInput.value = playerName;
    overlay.style.display = 'flex';
  });

  saveBtn.addEventListener('click', () => {
    playerName = nameInput.value.trim() || playerName;
    setCookie("playerName", playerName);
    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

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
    playerControls.update();
    updateTerrain();

    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
      x: playerModel.position.x,
      y: playerModel.position.y,
      z: playerModel.position.z,
      rotation: playerModel.rotation.y
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
      monster,
      clock
    });

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
