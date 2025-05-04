
import * as THREE from "three";
import { createPlayerModel } from "./player.js";
import { createBarriers, createTrees, createClouds } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';

async function main() {
  const playerName = `Player${Math.floor(Math.random() * 1000)}`;
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

  const playerModel = createPlayerModel(THREE, playerName);
  scene.add(playerModel);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshStandardMaterial({ color: 0x55aa55 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const otherPlayers = {};
  const chatMessages = {};
  const keys = new Set();

  document.addEventListener('keydown', e => keys.add(e.key.toLowerCase()));
  document.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

  const chatInput = document.getElementById("chat-input");
  const chatButton = document.getElementById("chat-button");

  chatButton.onclick = () => {
    const message = chatInput.value.trim();
    if (message) {
      multiplayer.send({ type: "chat", id: multiplayer.getId(), name: playerName, message });
      chatInput.value = "";
    }
  };

  // Manual connection
  const connectInput = document.getElementById("connect-id");
  const connectButton = document.getElementById("connect-button");

  connectButton.onclick = () => {
    const peerId = connectInput.value.trim();
    if (peerId) multiplayer.connectToPeer(peerId);
  };

  function handleIncomingData(peerId, data) {
    if (data.type === "presence") {
      if (!otherPlayers[data.id]) {
        const model = createPlayerModel(THREE, data.name);
        scene.add(model);
        otherPlayers[data.id] = model;
      }
      otherPlayers[data.id].position.set(data.x, data.y, data.z);
      otherPlayers[data.id].rotation.y = data.rotation;
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
  }

  const speed = 0.05;

  function animate() {
    requestAnimationFrame(animate);

    const moveDir = new THREE.Vector3();
    if (keys.has('w')) moveDir.z -= 1;
    if (keys.has('s')) moveDir.z += 1;
    if (keys.has('a')) moveDir.x -= 1;
    if (keys.has('d')) moveDir.x += 1;

    if (keys.has('arrowleft')) cameraAngle += 0.03;
    if (keys.has('arrowright')) cameraAngle -= 0.03;
    if (keys.has('arrowup')) cameraHeightAngle = Math.min(Math.PI / 2, cameraHeightAngle + 0.02);
    if (keys.has('arrowdown')) cameraHeightAngle = Math.max(0.05, cameraHeightAngle - 0.02);

    if (moveDir.length() > 0) {
      moveDir.normalize().multiplyScalar(speed);
      const moveRotated = new THREE.Vector3(
        dir.x * Math.cos(cameraAngle) + dir.z * Math.sin(cameraAngle),
        0,
        -dir.x * Math.sin(cameraAngle) + dir.z * Math.cos(cameraAngle)
      );
      playerModel.position.add(moveRotated);
      playerModel.rotation.y = Math.atan2(moveRotated.x, moveRotated.z);
    }

    const target = playerModel.position.clone();
    const offset = new THREE.Vector3(
      cameraDistance * Math.sin(cameraAngle) * Math.cos(cameraHeightAngle),
      cameraDistance * Math.sin(cameraHeightAngle),
      cameraDistance * Math.cos(cameraAngle) * Math.cos(cameraHeightAngle)
    );

    camera.position.copy(target).add(offset);
    camera.lookAt(target);

    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
      x: playerModel.position.x,
      y: playerModel.position.y,
      z: playerModel.position.z,
      rotation: playerModel.rotation.y
    });

    renderer.render(scene, camera);
  }

  animate();
}

window.addEventListener('DOMContentLoaded', main);
