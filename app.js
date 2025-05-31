
import * as THREE from "three";
import { createPlayerModel } from "./player.js";
import { createBarriers, createTrees, createClouds, createMonster } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';

async function main() {
  document.body.addEventListener('touchstart', () => {}, { once: true });
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    console.log(match);
    return match ? decodeURIComponent(match[2]) : null;
  }

  function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
  }

  // Get from cookie or ask
  let playerName = getCookie("playerName");
  if (!playerName) {
    playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
    setCookie("playerName", playerName);
  }
  let isMonsterOwner = false;

  const multiplayer = new Multiplayer(playerName, handleIncomingData);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createBarriers(scene);
  createTrees(scene);
  createClouds(scene);

  let monster = null;
  createMonster(scene, loadedMonster => {
    monster = loadedMonster;
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

  const { model: playerModel, nameLabel: myNameLabel } = createPlayerModel(THREE, playerName);
  scene.add(playerModel);

  const projectiles = [];

  function spawnProjectile(position, direction) {
    const geometry = new THREE.SphereGeometry(0.1, 16, 16);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
      
    sphere.userData.velocity = direction.clone().multiplyScalar(0.1); // speed
    sphere.userData.lifetime = 4000; // ms

    const now = Date.now();                      // ← ADD THIS
    sphere.userData.spawnTime = now;

    scene.add(sphere);
    projectiles.push(sphere);
  }

  function updateMonster(monster) {
    const now = Date.now();
    const data = monster.userData;

    if (now - data.lastDirectionChange > 5000) {
      data.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      data.lastDirectionChange = now;
    }

    monster.position.add(data.direction.clone().multiplyScalar(data.speed));

    // Simple bounds check
    if (Math.abs(monster.position.x) > 70 || Math.abs(monster.position.z) > 70) {
      data.direction.negate();
    }

    if (monster && data.mixer) {
      monster.userData.mixer.update(1 / 60); // or use deltaTime for accuracy
    }
  }

  const playerControls = new PlayerControls({
    scene,
    camera,
    playerModel,
    renderer,
    multiplayer,
    spawnProjectile
  });
  
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshStandardMaterial({ color: 0x55aa55 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const otherPlayers = {};

  function handleIncomingData(peerId, data) {
    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const { model, nameLabel } = createPlayerModel(THREE, data.name);
        scene.add(model);
        document.body.appendChild(nameLabel);
        otherPlayers[data.id] = { model, nameLabel, name: data.name };
      }

      const player = otherPlayers[data.id];
      player.name = data.name;
      player.model.position.set(data.x, data.y, data.z);
      player.model.rotation.y = data.rotation;

      // Ensure we can update the player list UI
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
      console.log('incoming projectile.')
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(position, direction);
    }

    if (data.type === "monster" && monster) {
      const target = new THREE.Vector3(data.x, data.y, data.z);
      monster.position.lerp(target, 0.2); // smooth transition
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
      consoleDiv.scrollTop = consoleDiv.scrollHeight; // auto-scroll
    };
  })();


  function animate() {
    requestAnimationFrame(animate);
    playerControls.update();

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
    
      // Skip rendering label if behind the camera or off frustum
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

    const gravity = -0.0008; // Simulated gravity

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      const vel = proj.userData.velocity;

      // Apply gravity
      vel.y += gravity;

      // Move projectile
      proj.position.add(vel);

      // After adding the projectile to the scene
      // proj.geometry.computeBoundingBox();
      // proj.updateMatrixWorld(true);

      // Ground bounce
      if (proj.position.y <= 0.3) { // assuming projectile radius
        proj.position.y = 0.3;
        if (Math.abs(vel.y) > 0.01) {
          vel.y *= -0.5; // dampen the bounce
        } else {
          vel.y = 0;
        }
      }

      // Tree/barrier collision
      const barriers = scene.children.filter(obj => obj.userData?.isBarrier);
      for (const barrier of barriers) {
        const projBox = new THREE.Box3().setFromObject(proj);
        const barrierBox = new THREE.Box3().setFromObject(barrier);
        
        if (projBox.intersectsBox(barrierBox)) {
          // Simple bounce: reverse velocity and move out of collision
          vel.reflect(new THREE.Vector3(0, 1, 0)); // crude bounce upwards
          proj.position.add(vel.clone().multiplyScalar(0.5));
          break;
        }
      }

      // Remove after lifetime
      proj.userData.lifetime -= 16; // ~1 frame at 60fps
      if (proj.userData.lifetime <= 0) {
        scene.remove(proj);
        projectiles.splice(i, 1);
        continue;
      }

      // Collision with players
      const age = Date.now() - proj.userData.spawnTime;
      for (const [id, { model }] of Object.entries(otherPlayers)) {
        if (age < 80) continue; // Skip collisions in first 100ms

        const projBox = new THREE.Box3().setFromObject(proj);
        const playerBox = new THREE.Box3().setFromObject(model);

        if (projBox.intersectsBox(playerBox)) {
          console.log(`💥 Hit player: ${id}`);
          scene.remove(proj);
          projectiles.splice(i, 1);
          break;
        }
      }

      const projBox = new THREE.Box3().setFromObject(proj);
      const localBox = new THREE.Box3().setFromObject(playerModel);

      if (projBox.intersectsBox(localBox) && age >= 80) {
        console.log(`💥 You were hit`);
        scene.remove(proj);
        projectiles.splice(i, 1);
      }

      // if (isMonsterOwner) {
      updateMonster(monster);

        // multiplayer.send({
        //   type: "monster",
        //   x: monster.position.x,
        //   y: monster.position.y,
        //   z: monster.position.z
        // });
      // }

      

    }      

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
