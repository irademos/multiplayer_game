
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
  camera.position.set(0, 2, 5);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  const playerModel = createPlayerModel(THREE, playerName);
  scene.add(playerModel);

  const otherPlayers = {};
  const chatMessages = {};

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshStandardMaterial({ color: 0x55aa55 })
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const chatInput = document.getElementById("chat-input");
  const chatButton = document.getElementById("chat-button");

  chatButton.onclick = () => {
    const message = chatInput.value.trim();
    if (message) {
      multiplayer.send({ type: "chat", id: multiplayer.getId(), name: playerName, message });
      chatInput.value = "";
    }
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

  function animate() {
    requestAnimationFrame(animate);

    // Send own position
    const pos = playerModel.position;
    multiplayer.send({
      type: "presence",
      id: multiplayer.getId(),
      name: playerName,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotation: playerModel.rotation.y
    });

    renderer.render(scene, camera);
  }

  animate();
}

main();
