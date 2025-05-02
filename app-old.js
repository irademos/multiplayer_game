import * as THREE from "three";
import { PlayerControls } from "./controls.js";
import { createPlayerModel } from "./player.js";
import { createBarriers, createTrees, createClouds } from "./worldGeneration.js";
import { Multiplayer } from './peerConnection.js';

// Simple seeded random number generator
class MathRandom {
  constructor(seed) {
    this.seed = seed;
  }
  
  random() {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
}

async function main() {
  // Initialize WebsimSocket for multiplayer functionality
  const playerName = `Player${Math.floor(Math.random() * 1000)}`;
  const multiplayer = new Multiplayer(playerName, handleIncomingData);

  // Optional: connect to a known peer
  // multiplayer.connectToPeer('some-peer-id');

  function handleIncomingData(peerId, data) {
    if (data.type === 'presence') {
      const { id, name, x, y, z, rotation } = data;
      if (!otherPlayers[id]) {
        const model = createPlayerModel(THREE, name);
        scene.add(model);
        otherPlayers[id] = model;
        playerLabels[id] = createPlayerLabel(id, name);
      }
      const model = otherPlayers[id];
      model.position.set(x, y, z);
      model.rotation.y = rotation;
    }
    if (data.type === 'chat') {
      const chatBox = chatMessages[data.id];
      if (chatBox) {
        chatBox.textContent = data.message;
        chatBox.style.display = 'block';
        setTimeout(() => {
          chatBox.style.display = 'none';
        }, 5000);
      }
    }    
  }
  
  
  // Voice chat variables
  let localStream = null;
  let peerConnections = {};
  let isMicrophoneActive = false;

  // Safe initial position values
  const playerX = (Math.random() * 10) - 5;
  const playerZ = (Math.random() * 10) - 5;

  // Setup Three.js scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB); // Light sky blue background
  
  // Create barriers, trees, clouds and platforms
  createBarriers(scene);
  createTrees(scene);
  createClouds(scene);
  
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game-container').appendChild(renderer.domElement);
  
  // Object to store other players
  const otherPlayers = {};
  const playerLabels = {};
  const chatMessages = {};
  
  // Create player model
  const playerModel = createPlayerModel(THREE, playerName);
  scene.add(playerModel);
  
  // Initialize player controls
  const playerControls = new PlayerControls(scene, multiplayer, { ... });
  const camera = playerControls.getCamera();
  
  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);
  
  // Directional light (sun)
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 50;
  dirLight.shadow.camera.left = -25;
  dirLight.shadow.camera.right = 25;
  dirLight.shadow.camera.top = 25;
  dirLight.shadow.camera.bottom = -25;
  scene.add(dirLight);
  
  // Ground
  const groundGeometry = new THREE.PlaneGeometry(150, 150);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x55aa55,
    roughness: 0.8,
    metalness: 0.2
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2; // Rotate to horizontal
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid helper for better spatial awareness
  const gridHelper = new THREE.GridHelper(150, 150);
  scene.add(gridHelper);
  
  // Create DOM element for player name label
  function createPlayerLabel(playerId, username) {
    const label = document.createElement('div');
    label.className = 'player-name';
    label.textContent = username;
    document.getElementById('game-container').appendChild(label);
    return label;
  }
  
  // Create DOM element for chat message
  function createChatMessage(playerId) {
    const message = document.createElement('div');
    message.className = 'chat-message';
    message.style.display = 'none';
    document.getElementById('game-container').appendChild(message);
    return message;
  }
  
  // Create chat input container
  const chatInputContainer = document.createElement('div');
  chatInputContainer.id = 'chat-input-container';
  const chatInput = document.createElement('input');
  chatInput.id = 'chat-input';
  chatInput.type = 'text';
  chatInput.maxLength = 100;
  chatInput.placeholder = 'Type a message...';
  chatInputContainer.appendChild(chatInput);
  
  // Add close button for chat input
  const closeChat = document.createElement('div');
  closeChat.id = 'close-chat';
  closeChat.innerHTML = '✕';
  chatInputContainer.appendChild(closeChat);
  
  document.getElementById('game-container').appendChild(chatInputContainer);
  
  // Create chat button for all devices
  const chatButton = document.createElement('div');
  chatButton.id = 'chat-button';
  chatButton.innerText = 'CHAT';
  document.getElementById('game-container').appendChild(chatButton);
  
  // Create voice chat button
  const voiceButton = document.createElement('div');
  voiceButton.id = 'voice-button';
  voiceButton.innerText = 'VOICE';
  document.getElementById('game-container').appendChild(voiceButton);
  
  // Setup voice chat with WebRTC
  async function setupVoiceChat() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      
      isMicrophoneActive = true;
      voiceButton.classList.add('active');
      
      // Update presence to indicate voice chat is available
      multiplayer.send({
        type: 'chat',
        id: multiplayer.getId(),
        message: chatInput.value.trim()
      });
      
      
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access your microphone. Voice chat disabled.");
    }
  }
  
  function stopVoiceChat() {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    
    isMicrophoneActive = false;
    voiceButton.classList.remove('active');
    
    // Update presence to indicate voice chat is disabled
    room.updatePresence({
      ...room.presence[room.clientId],
      voiceEnabled: false
    });
    
    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.destroy());
    peerConnections = {};
  }
  
  voiceButton.addEventListener('click', () => {
    if (!isMicrophoneActive) {
      setupVoiceChat();
    } else {
      stopVoiceChat();
    }
  });

  function sendMyPresence() {
    const pos = playerModel.position;
    multiplayer.send({
      type: 'presence',
      id: multiplayer.getId(),
      name: playerName,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      rotation: playerModel.rotation.y
    });
  }  
  
  // Handle WebRTC peer connections
  function createPeerConnection(clientId, initiator = false) {
    if (peerConnections[clientId]) {
      peerConnections[clientId].destroy();
    }
    
    const peer = new SimplePeer({
      initiator,
      stream: localStream,
      trickle: false
    });
    
    peer.on('signal', data => {
      room.send({
        type: 'rtc-signal',
        to: clientId,
        from: room.clientId,
        signal: data
      });
    });
    
    peer.on('stream', stream => {
      // Create audio element for remote stream
      let audio = document.createElement('audio');
      audio.id = `audio-${clientId}`;
      audio.srcObject = stream;
      audio.autoplay = true;
      document.body.appendChild(audio);
      
      // Create audio indicator for the player
      if (!document.getElementById(`audio-indicator-${clientId}`)) {
        const indicator = document.createElement('div');
        indicator.id = `audio-indicator-${clientId}`;
        indicator.className = 'audio-indicator';
        document.getElementById('game-container').appendChild(indicator);
      }
    });
    
    peer.on('close', () => {
      const audioEl = document.getElementById(`audio-${clientId}`);
      if (audioEl) audioEl.remove();
      
      const indicator = document.getElementById(`audio-indicator-${clientId}`);
      if (indicator) indicator.remove();
      
      delete peerConnections[clientId];
    });
    
    peer.on('error', err => {
      console.error('Peer connection error:', err);
      peer.destroy();
      delete peerConnections[clientId];
    });
    
    peerConnections[clientId] = peer;
    return peer;
  }
  
  // Chat event listeners
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && chatInputContainer.style.display !== 'block') {
      e.preventDefault();
      openChatInput();
    } else if (e.key === 'Escape' && chatInputContainer.style.display === 'block') {
      closeChatInput();
    } else if (e.key === 'Enter' && chatInputContainer.style.display === 'block') {
      sendChatMessage();
    }
  });
  
  closeChat.addEventListener('click', () => {
    closeChatInput();
  });
  
  chatButton.addEventListener('click', (e) => {
    e.preventDefault();
    if (chatInputContainer.style.display === 'block') {
      closeChatInput();
    } else {
      openChatInput();
    }
  });
  
  function openChatInput() {
    chatInputContainer.style.display = 'block';
    chatInput.focus();
    
    // Disable player controls while chatting
    if (playerControls) {
      playerControls.enabled = false;
    }
  }
  
  function closeChatInput() {
    chatInputContainer.style.display = 'none';
    chatInput.value = '';
    
    // Re-enable player controls
    if (playerControls) {
      playerControls.enabled = true;
    }
  }
  
  function sendChatMessage() {
    const message = chatInput.value.trim();
    if (message) {
      // Send chat message to all players
      room.updatePresence({
        chat: {
          message: message,
          timestamp: Date.now()
        }
      });
      
      // Show message for local player too
      chatMessages[room.clientId].textContent = message;
      chatMessages[room.clientId].style.display = 'block';
      
      // Hide message after 5 seconds
      setTimeout(() => {
        if (chatMessages[room.clientId]) {
          chatMessages[room.clientId].style.display = 'none';
        }
      }, 5000);
      
      // Clear and close input
      chatInput.value = '';
      closeChatInput();
    }
  }
  
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Prevent movement keys from triggering while typing
    if (e.key === 'Enter') {
      sendChatMessage();
    } else if (e.key === 'Escape') {
      closeChatInput();
    }
  });
  
  // Subscribe to presence updates - handle player joining/leaving and position updates
  room.subscribePresence((presence) => {
    for (const clientId in presence) {
      if (clientId === room.clientId) continue; // Skip self
      
      const playerData = presence[clientId];
      if (!playerData) continue;
      
      // Check for voice chat enabled players
      if (playerData.voiceEnabled && isMicrophoneActive && localStream) {
        if (!peerConnections[clientId]) {
          createPeerConnection(clientId, true);
        }
      }
      
      // Create new player if needed
      if (!otherPlayers[clientId] && playerData.x !== undefined && playerData.z !== undefined) {
        const peerInfo = room.peers[clientId] || {};
        const peerName = peerInfo.username || `Player${clientId.substring(0, 4)}`;
        
        const playerModel = createPlayerModel(THREE, peerName);
        playerModel.position.set(playerData.x, playerData.y || 0.5, playerData.z);
        if (playerData.rotation !== undefined) {
          playerModel.rotation.y = playerData.rotation;
        }
        scene.add(playerModel);
        otherPlayers[clientId] = playerModel;
        
        // Create name label
        playerLabels[clientId] = createPlayerLabel(clientId, peerName);
        
        // Create chat message element
        chatMessages[clientId] = createChatMessage(clientId);
      }
      
      // Update existing player
      else if (otherPlayers[clientId] && playerData.x !== undefined && playerData.z !== undefined) {
        otherPlayers[clientId].position.set(playerData.x, playerData.y || 0, playerData.z);
        if (playerData.rotation !== undefined) {
          otherPlayers[clientId].rotation.y = playerData.rotation;
        }
        
        // Animate legs if moving
        if (playerData.moving) {
          const leftLeg = otherPlayers[clientId].getObjectByName("leftLeg");
          const rightLeg = otherPlayers[clientId].getObjectByName("rightLeg");
          
          if (leftLeg && rightLeg) {
            const walkSpeed = 5;
            const walkAmplitude = 0.3;
            const animationPhase = performance.now() * 0.01 * walkSpeed; // Use performance.now() for consistent timing
            leftLeg.rotation.x = Math.sin(animationPhase) * walkAmplitude;
            rightLeg.rotation.x = Math.sin(animationPhase + Math.PI) * walkAmplitude;
          }
        } else {
          // Reset legs when standing still
          const leftLeg = otherPlayers[clientId].getObjectByName("leftLeg");
          const rightLeg = otherPlayers[clientId].getObjectByName("rightLeg");
          
          if (leftLeg && rightLeg) {
            leftLeg.rotation.x = 0;
            rightLeg.rotation.x = 0;
          }
        }
        
        // Update chat message if present
        if (playerData.chat && playerData.chat.message) {
          chatMessages[clientId].textContent = playerData.chat.message;
          chatMessages[clientId].style.display = 'block';
          
          // Hide message after 5 seconds
          setTimeout(() => {
            if (chatMessages[clientId]) {
              chatMessages[clientId].style.display = 'none';
            }
          }, 5000);
        }
      }
    }
    
    // Remove disconnected players
    for (const clientId in otherPlayers) {
      if (!presence[clientId]) {
        scene.remove(otherPlayers[clientId]);
        delete otherPlayers[clientId];
        
        // Clean up voice chat connections
        if (peerConnections[clientId]) {
          peerConnections[clientId].destroy();
          delete peerConnections[clientId];
        }
        
        const audioEl = document.getElementById(`audio-${clientId}`);
        if (audioEl) audioEl.remove();
        
        const indicator = document.getElementById(`audio-indicator-${clientId}`);
        if (indicator) indicator.remove();
        
        if (playerLabels[clientId]) {
          document.getElementById('game-container').removeChild(playerLabels[clientId]);
          delete playerLabels[clientId];
        }
        
        if (chatMessages[clientId]) {
          document.getElementById('game-container').removeChild(chatMessages[clientId]);
          delete chatMessages[clientId];
        }
      }
    }
  });
  
  // Handle WebRTC signaling
  room.onmessage = (event) => {
    const data = event.data;
    switch (data.type) {
      case "connected":
        console.log(`Client ${data.clientId}, ${data.username}`);
        break;
      case "disconnected":
        console.log(`Client ${data.clientId}, ${data.username}`);
        break;
      case "rtc-signal":
        if (data.to === room.clientId) {
          if (!peerConnections[data.from] && isMicrophoneActive && localStream) {
            createPeerConnection(data.from, false);
          }
          
          if (peerConnections[data.from]) {
            peerConnections[data.from].signal(data.signal);
          }
        }
        break;
      default:
        console.log("Received event:", data);
    }
  };

  // Create a chat message element for local player
  chatMessages[room.clientId] = createChatMessage(room.clientId);

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    playerControls.update();
    sendMyPresence(); // broadcast every frame (later optimize with throttling)
    
    // Update name labels and chat messages for all players
    for (const clientId in otherPlayers) {
      if (playerLabels[clientId] && otherPlayers[clientId]) {
        const screenPosition = getScreenPosition(otherPlayers[clientId].position, camera, renderer);
        if (screenPosition) {
          playerLabels[clientId].style.left = `${screenPosition.x}px`;
          playerLabels[clientId].style.top = `${screenPosition.y - 20}px`;
          playerLabels[clientId].style.display = screenPosition.visible ? 'block' : 'none';
          
          // Position chat message above name label
          if (chatMessages[clientId]) {
            chatMessages[clientId].style.left = `${screenPosition.x}px`;
            chatMessages[clientId].style.top = `${screenPosition.y - 45}px`;
            // Only show if visible and has content
            if (chatMessages[clientId].textContent && screenPosition.visible) {
              chatMessages[clientId].style.display = 'block';
            }
          }
          
          // Position audio indicator
          const indicator = document.getElementById(`audio-indicator-${clientId}`);
          if (indicator) {
            indicator.style.left = `${screenPosition.x}px`;
            indicator.style.top = `${screenPosition.y - 70}px`;
            indicator.style.display = screenPosition.visible ? 'block' : 'none';
            
            // Audio visualization
            if (peerConnections[clientId] && peerConnections[clientId]._remoteStreams && peerConnections[clientId]._remoteStreams[0]) {
              indicator.style.opacity = '1';
            } else {
              indicator.style.opacity = '0';
            }
          }
        } else {
          playerLabels[clientId].style.display = 'none';
          if (chatMessages[clientId]) {
            chatMessages[clientId].style.display = 'none';
          }
          const indicator = document.getElementById(`audio-indicator-${clientId}`);
          if (indicator) {
            indicator.style.display = 'none';
          }
        }
      }
    }
    
    // Update local player's chat message position
    if (chatMessages[room.clientId] && playerModel) {
      const screenPosition = getScreenPosition(playerModel.position, camera, renderer);
      if (screenPosition && chatMessages[room.clientId].textContent) {
        chatMessages[room.clientId].style.left = `${screenPosition.x}px`;
        chatMessages[room.clientId].style.top = `${screenPosition.y - 45}px`;
        chatMessages[room.clientId].style.display = screenPosition.visible ? 'block' : 'none';
      } else {
        chatMessages[room.clientId].style.display = 'none';
      }
    }
    
    renderer.render(scene, camera);
  }
  
  // Helper function to convert 3D position to screen coordinates
  function getScreenPosition(position, camera, renderer) {
    const vector = new THREE.Vector3();
    const widthHalf = renderer.domElement.width / 2;
    const heightHalf = renderer.domElement.height / 2;
    
    // Get the position adjusted to account for player height
    vector.copy(position);
    vector.y += 1.5; // Position above the player's head
    
    // Project to screen space
    vector.project(camera);
    
    // Calculate whether object is in front of the camera
    const isInFront = vector.z < 1;
    
    // Convert to screen coordinates
    return {
      x: (vector.x * widthHalf) + widthHalf,
      y: -(vector.y * heightHalf) + heightHalf,
      visible: isInFront
    };
  }

  animate();
}

main();