
import * as THREE from "three";
import { createPlayerModel } from "./player.js";
import { createBarriers, createTrees, createClouds } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';
import { PlayerControls } from './controls.js';

async function main() {
  const playerName = prompt("Enter your name") || `Player${Math.floor(Math.random() * 1000)}`;
  const multiplayer = new Multiplayer(playerName, handleIncomingData);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);

  createBarriers(scene);
  createTrees(scene);
  createClouds(scene);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game-container').appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  let cameraAngle = 0;
  let cameraHeightAngle = 0.3;
  const cameraDistance = 5;

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

    scene.add(sphere);
    projectiles.push(sphere);
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
  const chatMessages = {};

  function handleIncomingData(peerId, data) {
    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const { model: model, nameLabel: nameLabel } = createPlayerModel(THREE, data.name);
        scene.add(model);
        document.body.appendChild(nameLabel);
        otherPlayers[data.id] = { model, nameLabel };
      }
      const player = otherPlayers[data.id];
      player.model.position.set(data.x, data.y, data.z);
      player.model.rotation.y = data.rotation;
    }

    if (data.type === "chat") {
      if (!chatMessages[data.id]) {
        const msg = document.createElement('div');
        msg.className = 'chat-message';
        document.getElementById('game-container').appendChild(msg);
        chatMessages[data.id] = msg;
      }
      const chatBox = chatMessages[data.id];
      chatBox.textContent = `${data.name}: ${data.message}`;
      chatBox.style.display = 'block';
      setTimeout(() => { chatBox.style.display = 'none'; }, 5000);
    }

    if (data.type === 'projectile') {
      const position = new THREE.Vector3(...data.position);
      const direction = new THREE.Vector3(...data.direction);
      spawnProjectile(position, direction);
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
      const peerModel = otherPlayers[peerId];
      if (!peerModel) return;
    
      const dist = playerModel.position.distanceTo(peerModel.position);
      const maxDist = 30; // Max voice distance
      const rawVolume = 1 - dist / maxDist;
      const volume = Math.max(0, rawVolume * rawVolume); // smoother falloff
    
      audio.volume = volume;
    
      console.log(`🎧 [${peerId}] Distance: ${dist.toFixed(2)} | Volume: ${volume.toFixed(2)}`);
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

    const gravity = -0.01; // Simulated gravity

    for (let i = projectiles.length - 1; i >= 0; i--) {
      const proj = projectiles[i];
      const vel = proj.userData.velocity;

      // Apply gravity
      vel.y += gravity;

      // Move projectile
      proj.position.add(vel);

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
      for (const [id, { model }] of Object.entries(otherPlayers)) {
        const projBox = new THREE.Box3().setFromObject(proj);
        const playerBox = new THREE.Box3().setFromObject(model);

        if (projBox.intersectsBox(playerBox)) {
          console.log(`💥 Hit player: ${id}`);
          scene.remove(proj);
          projectiles.splice(i, 1);
          break;
        }
      }
    }   

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
