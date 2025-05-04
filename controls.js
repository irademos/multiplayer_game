import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Movement constants
const SPEED = 0.08;
const GRAVITY = 0.01;
const JUMP_FORCE = 0.25;

export class PlayerControls {
  constructor({ scene, camera, playerModel, renderer, multiplayer }) {
    this.yaw = 0;
    this.pitch = 0;
    this.pointerLocked = false;
    this.renderer = renderer;
    this.domElement = this.renderer.domElement;
    this.scene = scene;
    this.playerModel = playerModel;
    this.camera = camera;
    this.multiplayer = multiplayer;
    
    // this.domElement = this.renderer ? this.renderer.domElement : document.body;
    this.lastPosition = new THREE.Vector3();
    this.isMoving = false;
    
    // Player state
    this.velocity = new THREE.Vector3();
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
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
    this.playerY = 0.5;
    this.playerZ = (Math.random() * 10) - 5;
    
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
      this.setupPointerLock(); // leave pointer lock in PlayerControls
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
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      if (this.renderer) {
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    });
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

        this.playerModel.rotation.y = -this.yaw; // Use computed yaw instead of raw angle
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
    
    if (newY <= 0 && !standingOnBlock) {
      newY = 0;
      this.velocity.y = 0;
      this.canJump = true;
    }
    
    const isMovingNow = movement.length() > 0;
    this.isMoving = isMovingNow;
    
    if (this.playerModel) {
      this.playerModel.position.set(newX, newY, newZ);
      
      if (movement.length() > 0) {
        // if (!this.isMobile) {
        //   const angle = Math.atan2(movement.x, movement.z);
        //   this.playerModel.rotation.y = angle;
        // }    
        const angle = Math.atan2(movement.x, movement.z);
        this.playerModel.rotation.y = angle; 
        
        const leftLeg = this.playerModel.getObjectByName("leftLeg");
        const rightLeg = this.playerModel.getObjectByName("rightLeg");
        
        if (leftLeg && rightLeg) {
          const walkSpeed = 5; 
          const walkAmplitude = 0.3;
          leftLeg.rotation.x = Math.sin(this.time * walkSpeed) * walkAmplitude;
          rightLeg.rotation.x = Math.sin(this.time * walkSpeed + Math.PI) * walkAmplitude;
        }
      } else {
        const leftLeg = this.playerModel.getObjectByName("leftLeg");
        const rightLeg = this.playerModel.getObjectByName("rightLeg");
        
        if (leftLeg && rightLeg) {
          leftLeg.rotation.x = 0;
          rightLeg.rotation.x = 0;
        }
      }
      
      const newTarget = new THREE.Vector3(this.playerModel.position.x, this.playerModel.position.y + 1, this.playerModel.position.z);
      if (this.controls) {
        this.controls.target.copy(newTarget);
      }
      // this.camera.position.copy(newTarget).add(this.cameraOffset);
      
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
      const rotationY = this.playerModel.rotation.y;
    
      const rotatedOffset = new THREE.Vector3(
        this.cameraOffset.x * Math.cos(rotationY) - this.cameraOffset.z * Math.sin(rotationY),
        this.cameraOffset.y,
        this.cameraOffset.x * Math.sin(rotationY) + this.cameraOffset.z * Math.cos(rotationY)
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
    this.time = (now * 0.01) % 1000; // Use performance.now() for consistent timing
    
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

