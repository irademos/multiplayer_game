import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { getTerrainHeightAt } from "./worldGeneration.js";
import { pass } from "three/tsl";

// Movement constants
const SPEED = 0.05;
const GRAVITY = 0.01;
const JUMP_FORCE = 0.25;

export class PlayerControls {
  constructor({ scene, camera, playerModel, renderer, multiplayer, spawnProjectile, projectiles }) {
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.renderer = renderer;
    this.domElement = this.renderer.domElement;
    this.scene = scene;
    this.playerModel = playerModel;
    this.camera = camera;
    this.multiplayer = multiplayer;
    this.lastPosition = new THREE.Vector3();
    this.isMoving = false;
    this.spawnProjectile = spawnProjectile;
    this.projectiles = projectiles;
    this.isKnocked = false;
    this.knockbackVelocity = new THREE.Vector3();
    this.knockbackRotationAxis = new THREE.Vector3(1, 0, 0);
    this.knockbackRestYaw = 0;
    
    // Player state
    this.velocity = new THREE.Vector3();
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.projectileKeyPressed = false;
    
    // Mobile control variables
    this.joystick = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchSensitivity = 0.005;
    this.moveVector = { x: 0, z: 0 };
    this.jumpButtonPressed = false;
    this.moveForward = 0;
    this.moveRight = 0;
    
    // Initial player position
    // const initialPos = { x: 0, y: 0.5, z: 0 };
    this.playerX = (Math.random() * 10) - 5;
    this.playerZ = (Math.random() * 10) - 5;
    this.playerY = getTerrainHeightAt(this.playerX, this.playerZ) + 0.5;

    
    // Set initial player model position if it exists
    if (this.playerModel) {
      this.playerModel.position.set(this.playerX, this.playerY, this.playerZ);
      this.lastPosition.set(this.playerX, this.playerY, this.playerZ);
    }
    
    // Set camera to third-person perspective
    this.camera.position.set(this.playerX, this.playerY + 2, this.playerZ + 5);
    this.camera.lookAt(this.playerX, this.playerY + 1, this.playerZ);
    // Store the initial camera offset (relative to player's target position)
    this.cameraOffset = new THREE.Vector3();
    this.cameraOffset.copy(this.camera.position).sub(new THREE.Vector3(this.playerX, this.playerY + 1, this.playerZ));
    
    // Initialize controls based on device
    this.initializeControls();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // If room is provided, initialize multiplayer presence
    if (this.multiplayer) {
      // Initialize player presence in the room
      this.multiplayer.send({
        x: this.playerX,
        y: this.playerY,
        z: this.playerZ,
        rotation: 0,
        moving: false
      });
    }
    
    this.enabled = true; // Add enabled flag for chat input
  }
  
  initializeControls() {
    if (this.isMobile) {
      this.initializeMobileControls();
    } else {
      pass
      // this.setupPointerLock(); // leave pointer lock in PlayerControls
    }
  }  
  
  initializeMobileControls() {    
    // Initialize OrbitControls for camera rotation (similar to desktop)
    this.controls = new OrbitControls(this.camera, this.domElement);
    
    // Add joystick container for mobile
    const joystickContainer = document.getElementById('joystick-container');
    if (!joystickContainer) {
      const newJoystickContainer = document.createElement('div');
      newJoystickContainer.id = 'joystick-container';
      document.body.appendChild(newJoystickContainer);
    }
    
    // Add jump button for mobile
    const jumpButton = document.getElementById('jump-button');
    if (!jumpButton) {
      const newJumpButton = document.createElement('div');
      newJumpButton.id = 'jump-button';
      newJumpButton.innerText = 'JUMP';
      document.body.appendChild(newJumpButton);
    }
    
    // Jump button event listeners
    document.getElementById('jump-button').addEventListener('touchstart', (event) => {
      this.jumpButtonPressed = true;
      if (this.canJump) {
        this.velocity.y = JUMP_FORCE;
        this.canJump = false;
      }
      event.preventDefault();
    });
    
    document.getElementById('jump-button').addEventListener('touchend', (event) => {
      this.jumpButtonPressed = false;
      event.preventDefault();
    });
    
    // Initialize joystick with improved behavior
    this.joystick = nipplejs.create({
      zone: document.getElementById('joystick-container'),
      mode: 'static',
      position: { left: '50%', top: '50%' },
      color: 'rgba(255, 255, 255, 0.5)',
      size: 120
    });
    
    this.joystick.on('move', (evt, data) => {
      const angle = data.angle.radian;
      this.joystickAngle = angle;
      this.joystickForce = Math.min(data.force, 1);
    
      // this.yaw = -angle; // Flip joystick angle to align with world yaw
    });
    
    this.joystick.on('end', () => {
      this.joystickForce = 0;
    });

    // Add fire button for mobile
    const fireButton = document.getElementById('fire-button');
    if (!fireButton) {
      const newFireButton = document.createElement('div');
      newFireButton.id = 'fire-button';
      newFireButton.innerText = 'FIRE';
      newFireButton.style.position = 'absolute';
      newFireButton.style.bottom = '100px';
      newFireButton.style.right = '70px';
      newFireButton.style.padding = '12px 20px';
      newFireButton.style.background = '#ff4e4e';
      newFireButton.style.color = 'white';
      newFireButton.style.borderRadius = '10px';
      newFireButton.style.fontWeight = 'bold';
      newFireButton.style.zIndex = '10';
      newFireButton.style.opacity = '0.9';
      document.body.appendChild(newFireButton);
    }

    // Fire button logic
    document.getElementById('fire-button').addEventListener('touchstart', (event) => {
      const position = this.playerModel.position.clone().add(new THREE.Vector3(0, 0.7, 0));
      const direction = new THREE.Vector3(0, 0, 1).applyEuler(this.playerModel.rotation);

      this.multiplayer.send({
        type: 'projectile',
        id: this.multiplayer.getId(),
        position: position.toArray(),
        direction: direction.toArray()
      });

      this.spawnProjectile(this.scene, this.projectiles, position, direction);

      event.preventDefault();
    });
  }
  
  setupEventListeners() {
    // Listen for key events (for desktop controls)
    document.addEventListener("keydown", (e) => {
      this.keysPressed.add(e.key.toLowerCase());
      
      // Handle jump with spacebar
      if (e.key === " " && this.canJump) {
        this.velocity.y = JUMP_FORCE;
        this.canJump = false;
      }
    });

    document.addEventListener("keyup", (e) => {
      this.keysPressed.delete(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'e') {
        this.projectileKeyPressed = false;
      }
    });    
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (this.renderer) {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });

    this.domElement.addEventListener("click", (event) => {
      // Don't fire if chat or settings are open
      if (!this.enabled || this.isMobile) return;

        const position = this.playerModel.position.clone().add(new THREE.Vector3(0, 0.7, 0));
        const direction = new THREE.Vector3(0, 0, 1).applyEuler(this.playerModel.rotation);

        this.multiplayer.send({
          type: 'projectile',
          id: this.multiplayer.getId(),
          position: position.toArray(),
          direction: direction.toArray()
        });

        this.spawnProjectile(this.scene, this.projectiles, position, direction);
    });
  }

  applyKnockback(impulse) {
    this.isKnocked = true;
    this.knockbackVelocity.copy(impulse);
    // this.knockbackRestYaw = this.playerModel.rotation.y;
    const up = new THREE.Vector3(0, 1, 0);
    const axis = new THREE.Vector3().crossVectors(up, impulse.clone().normalize());
    if (axis.lengthSq() === 0) {
      axis.set(1, 0, 0);
    }
    // this.knockbackRotationAxis.copy(axis.normalize());
    this.playerModel.userData.mixer?.stopAllAction();
    this.playerModel.userData.actions?.hit?.play();
    this.playerModel.userData.currentAction = 'hit';
  }

  processMovement() {
    // Skip movement processing if controls are disabled (e.g. when chat is open)
    if (!this.enabled) return;
    
    // Get current position
    let x = this.playerModel ? this.playerModel.position.x : this.camera.position.x;
    let y = this.playerModel ? this.playerModel.position.y : (this.camera.position.y - 1.2);
    let z = this.playerModel ? this.playerModel.position.z : this.camera.position.z;
    
    // Create movement vector
    const moveDirection = new THREE.Vector3(0, 0, 0);
    
    if (this.isMobile) {
      if (this.joystickForce > 0.1) {
        // Define direction from yaw
        const forward = new THREE.Vector3(0, 0, 1);
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        forward.applyQuaternion(yawQuat);
      
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), forward).normalize();
      
        // Decompose joystick input into directional components
        const dx = Math.cos(this.joystickAngle); // right-left
        const dz = Math.sin(this.joystickAngle); // forward-back

        moveDirection.addScaledVector(forward, dz * this.joystickForce * SPEED);
        moveDirection.addScaledVector(right, dx * this.joystickForce * SPEED);

        this.playerModel.rotation.y = this.yaw; // Use computed yaw instead of raw angle
      }      
    } else {
      if (this.keysPressed.has("w")) {
        moveDirection.z = 1; 
      } else if (this.keysPressed.has("s")) {
        moveDirection.z = -1; 
      }
      
      if (this.keysPressed.has("a")) {
        moveDirection.x = 1; 
      } else if (this.keysPressed.has("d")) {
        moveDirection.x = -1; 
      } 
    }
    
    if (!this.isMobile && moveDirection.length() > 0) {
      moveDirection.normalize();
    }
    
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0; 
    cameraDirection.normalize();
    
    const rightVector = new THREE.Vector3();
    rightVector.crossVectors(this.camera.up, cameraDirection).normalize();
    
    const movement = new THREE.Vector3();
    if (!this.isMobile) {
      if (moveDirection.z !== 0) {
        movement.add(cameraDirection.clone().multiplyScalar(moveDirection.z));
      }
      if (moveDirection.x !== 0) {
        movement.add(rightVector.clone().multiplyScalar(moveDirection.x));
      }
      
      if (movement.length() > 0) {
        movement.normalize().multiplyScalar(SPEED);
      }
    } else {
      movement.copy(moveDirection);
    }
    
    this.velocity.y -= GRAVITY;

    if (this.isKnocked) {
      // Apply knockback with simple physics
      this.knockbackVelocity.y -= GRAVITY;
      movement.set(this.knockbackVelocity.x, 0, this.knockbackVelocity.z);
      this.velocity.y = this.knockbackVelocity.y;
      this.knockbackVelocity.multiplyScalar(0.95); // damping
      // this.playerModel.setRotationFromAxisAngle(this.knockbackRotationAxis || new THREE.Vector3(-1, 0, 0), Math.PI / 2);


      if (this.knockbackVelocity.length() < 0.01 && this.velocity.y === 0) {
        this.isKnocked = false;
        this.velocity.set(0, 0, 0);
        this.playerModel.setRotationFromAxisAngle(new THREE.Vector3(0, 1, 0), this.playerModel.rotation.y);
        this.playerModel.userData.actions?.idle?.play();
        this.playerModel.userData.currentAction = 'idle';
        console.log("🤕 Got up");
      }
    }
    
    let newX = x + movement.x;
    let newY = y + this.velocity.y;
    let newZ = z + movement.z;

    if (!this.scene || !(this.scene && this.scene.children ? this.scene.children : [])) return;
    
    const blockMeshes = (this.scene && this.scene.children ? this.scene.children : []).filter(child => 
      child.userData.isBlock || child.userData.isBarrier || 
      (child.type === "Group" && child.userData.isTree));
    
    const playerRadius = 0.3;
    const playerHeight = 1.8;
    
    let standingOnBlock = false;
    blockMeshes.forEach(block => {
      if (block.type === "Group" && block.userData.isTree) {
        checkCollision.call(this, block, 1.0, 2.0, 1.0); 
      } else {
        checkCollision.call(this, block);
      }
    });
    
    function checkCollision(block, overrideWidth, overrideHeight, overrideDepth) {
      const blockSize = new THREE.Vector3();
      if (block.geometry) {
        const boundingBox = new THREE.Box3().setFromObject(block);
        boundingBox.getSize(blockSize);
      } else {
        blockSize.set(1, 1, 1);
      }
      
      const blockWidth = overrideWidth || blockSize.x;
      const blockHeight = overrideHeight || blockSize.y;
      const blockDepth = overrideDepth || blockSize.z;
      
      if (
        this.velocity.y <= 0 &&
        Math.abs(newX - block.position.x) < (blockWidth / 2 + playerRadius) &&
        Math.abs(newZ - block.position.z) < (blockDepth / 2 + playerRadius) &&
        Math.abs(y - (block.position.y + blockHeight / 2)) < 0.2 &&
        y >= block.position.y
      ) {
        standingOnBlock = true;
        newY = block.position.y + blockHeight / 2 + 0.01;
        this.velocity.y = 0;
        this.canJump = true;
      } else if (
        Math.abs(newX - block.position.x) < (blockWidth / 2 + playerRadius) &&
        Math.abs(newZ - block.position.z) < (blockDepth / 2 + playerRadius) &&
        newY < block.position.y + blockHeight / 2 &&
        newY + playerHeight > block.position.y - blockHeight / 2
      ) {
        if (Math.abs(movement.x) > 0) {
          newX = x;
        }
        if (Math.abs(movement.z) > 0) {
          newZ = z;
        }
      }
    }
    
    if (!standingOnBlock) {
      const terrainY = getTerrainHeightAt(newX, newZ);
      if (newY <= terrainY + 0.01) {
        newY = terrainY;
        this.velocity.y = 0;
        this.canJump = true;
      }
    }

    if (this.isKnocked && this.velocity.y === 0) {
      this.knockbackVelocity.y = 0;
    }

    if (this.isKnocked && this.knockbackVelocity.length() < 0.05 && this.velocity.y === 0) {
      this.isKnocked = false;
      this.knockbackVelocity.set(0, 0, 0);
      this.velocity.set(0, 0, 0);
      this.playerModel.rotation.set(0, this.knockbackRestYaw || this.playerModel.rotation.y, 0);
      this.playerModel.userData.actions?.idle?.play();
      this.playerModel.userData.currentAction = 'idle';
      console.log("🤕 Got up");
    }
    
    const isMovingNow = movement.length() > 0;
    this.isMoving = isMovingNow;
    
    if (this.playerModel) {
      this.playerModel.position.set(newX, newY, newZ);
      
        if (movement.length() > 0) {
          const angle = Math.atan2(movement.x, movement.z);
          this.playerModel.rotation.y = angle;
        }

        const actions = this.playerModel.userData.actions;
        if (actions && !this.isKnocked) {
          let actionName = 'idle';
          if (!this.canJump) {
            actionName = 'jump';
          } else if (isMovingNow) {
            actionName = 'run';
          }

          const current = this.playerModel.userData.currentAction;
          if (actionName && current !== actionName) {
            actions[current]?.fadeOut(0.2);
            actions[actionName].reset().fadeIn(0.2).play();
            this.playerModel.userData.currentAction = actionName;
          }
        }
      
      const newTarget = new THREE.Vector3(this.playerModel.position.x, this.playerModel.position.y + 1, this.playerModel.position.z);
      if (this.controls) {
        this.controls.target.copy(newTarget);
      }
      
      if (this.multiplayer && (
          Math.abs(this.lastPosition.x - newX) > 0.01 ||
          Math.abs(this.lastPosition.y - newY) > 0.01 ||
          Math.abs(this.lastPosition.z - newZ) > 0.01 ||
          this.isMoving !== this.wasMoving
        )) {
        this.multiplayer.send({
          x: newX,
          y: newY,
          z: newZ,
          rotation: this.playerModel.rotation.y,
          moving: this.isMoving
        });
        
        this.lastPosition.set(newX, newY, newZ);
        this.wasMoving = this.isMoving;
      }
    } else {
      this.camera.position.set(newX, newY + 1.2, newZ);
    }
    
    if (this.isMobile && this.controls) {
      this.controls.target.set(newX, newY + 1, newZ);
      this.controls.update();
    } else if (!this.isMobile && this.controls) {
      this.controls.update();
    }
  }
  
  update() {
    if (!this.keys) {
      this.keys = new Set();
      document.addEventListener('keydown', (e) => this.keys.add(e.key));
      document.addEventListener('keyup', (e) => this.keys.delete(e.key));
    }

    const rotateSpeed = 0.03;
    if (this.keys.has('ArrowLeft')) this.yaw += rotateSpeed;
    if (this.keys.has('ArrowRight')) this.yaw -= rotateSpeed;

    const maxPitch = Math.PI / 3;   // ~60° upward
    const minPitch = -Math.PI / 8;  // ~30° downward

    if (this.keys.has('ArrowUp')) {
      this.pitch = Math.min(maxPitch, this.pitch + 0.02);
    }
    if (this.keys.has('ArrowDown')) {
      this.pitch = Math.max(minPitch, this.pitch - 0.02);
    }

    if (this.isMobile) {
      const orbitCenter = this.playerModel.position.clone().add(new THREE.Vector3(0, 1, 0));
    
      // Define desired offset relative to player (e.g. 5 units behind)
      const desiredDistance = this.cameraOffset.length(); // Keep original distance
      const angle = this.playerModel.rotation.y;
    
      const rotatedOffset = new THREE.Vector3(
        -desiredDistance * Math.sin(angle),
        this.cameraOffset.y,
        -desiredDistance * Math.cos(angle)
      );      
    
      this.camera.position.copy(orbitCenter).add(rotatedOffset);
      this.camera.lookAt(orbitCenter);
    } else {
      const orbitCenter = this.playerModel.position.clone().add(new THREE.Vector3(0, 1, 0)); // target above the player's head
      const rotatedOffset = new THREE.Vector3(
        this.cameraOffset.x * Math.cos(this.yaw) - this.cameraOffset.z * Math.sin(this.yaw),
        this.cameraOffset.y + 5 * Math.sin(this.pitch), // optional tilt factor
        this.cameraOffset.x * Math.sin(this.yaw) + this.cameraOffset.z * Math.cos(this.yaw)
      );

      this.camera.position.copy(orbitCenter).add(rotatedOffset);
      this.camera.lookAt(orbitCenter);
    }

      const now = performance.now();
      if (!this.lastUpdate) this.lastUpdate = now;
      const delta = (now - this.lastUpdate) / 1000;
      this.lastUpdate = now;
      this.time = (now * 0.01) % 1000; // Use performance.now() for consistent timing

      if (this.playerModel && this.playerModel.userData.mixer) {
        this.playerModel.userData.mixer.update(delta);
      }

      if (this.enabled) {
        this.processMovement();
      }
    
    // Always update controls even when movement is disabled
    if (this.controls) {
      this.controls.update();
    }
  }
  
  getCamera() {
    return this.camera;
  }
  
  getPlayerModel() {
    return this.playerModel;
  }

  setupPointerLock() {
    this.domElement.addEventListener('click', () => {
      this.domElement.requestPointerLock();
    });
  
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.domElement;
    });
  
    document.addEventListener('mousemove', (event) => {
      if (this.pointerLocked) {
        const sensitivity = 0.002;
        this.yaw -= event.movementX * sensitivity;
        this.pitch -= event.movementY * sensitivity;
    
        // Clamp pitch to stay above ground
        const maxPitch = Math.PI / 3;    // ~60° upward
        const minPitch = -Math.PI / 8;   // ~30° downward
        this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
      }
    });
    
  
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        document.exitPointerLock();
      }
    });
  }

}