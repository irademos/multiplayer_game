import * as THREE from "three";
import { SPHERE_RADIUS } from "./worldGeneration.js";
import RAPIER from "@dimforge/rapier3d-compat";

// Movement constants
const SPEED = 5;
const JUMP_FORCE = 5;
const PLAYER_RADIUS = 0.3;

export class PlayerControls {
  constructor({ scene, camera, playerModel, renderer, multiplayer, spawnProjectile, projectiles, audioManager }) {
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
    this.wasMoving = false;
    this.isMoving = false;
    this.spawnProjectile = spawnProjectile;
    this.projectiles = projectiles;
    this.audioManager = audioManager;
    this.isKnocked = false;
    this.knockbackRestYaw = 0;
    this.slideMomentum = new THREE.Vector3();
    this.lastMoveDirection = new THREE.Vector3();
    this.grabbedTarget = null;
    this.isGrabbed = false;
    this.grabberId = null;
    this.externalGrabPos = null;

    // Player state
    this.canJump = true;
    this.keysPressed = new Set();
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    this.hasDoubleJumped = false;
    this.currentSpecialAction = null;
    this.runningKickTimer = null;
    this.runningKickOriginalY = 0;
    
    // Mobile control variables
    this.joystick = null;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.touchSensitivity = 0.005;
    this.moveVector = { x: 0, z: 0 };
    this.jumpButtonPressed = false;
    this.moveForward = 0;
    this.moveRight = 0;
    
    // Initial player position on the sphere surface
    this.playerX = 0;
    this.playerZ = 0;
    this.playerY = SPHERE_RADIUS + PLAYER_RADIUS;

    
    // Set initial player model position if it exists
    if (this.playerModel) {
      this.playerModel.position.set(this.playerX, this.playerY, this.playerZ);
      this.lastPosition.set(this.playerX, this.playerY, this.playerZ);
    }
    
    const world = window.rapierWorld;
    if (world) {
      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(this.playerX, this.playerY, this.playerZ)
        .setLinearDamping(0.9)
        .setAngularDamping(0.9);
      this.body = world.createRigidBody(rbDesc);
      const colDesc = RAPIER.ColliderDesc.ball(PLAYER_RADIUS);
      world.createCollider(colDesc, this.body);
    }

    // Set camera to third-person perspective
    this.camera.position.set(this.playerX, this.playerY + 2, this.playerZ + 5);
    this.camera.lookAt(this.playerX, this.playerY + 1, this.playerZ);
    // Store the initial camera offset (relative to player's target position)
    this.cameraOffset = new THREE.Vector3();
    const initialUp = new THREE.Vector3(this.playerX, this.playerY, this.playerZ).normalize();
    this.cameraOffset.copy(this.camera.position).sub(new THREE.Vector3(this.playerX, this.playerY, this.playerZ).add(initialUp));

    // Initialize controls based on device
    this.initializeControls();

    // Setup event listeners
    this.setupEventListeners();
    
    this.enabled = true; // Add enabled flag for chat input
  }
  
  initializeControls() {
    if (this.isMobile) {
      this.initializeMobileControls();
    } else {
      // this.setupPointerLock(); // leave pointer lock in PlayerControls
    }
  }
  
  initializeMobileControls() {
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
      if (!this.enabled) return;
      this.jumpButtonPressed = true;
      if (this.canJump && this.body) {
        const t = this.body.translation();
        const up = new THREE.Vector3(t.x, t.y, t.z).normalize();
        this.body.applyImpulse({ x: up.x * JUMP_FORCE, y: up.y * JUMP_FORCE, z: up.z * JUMP_FORCE }, true);
        this.canJump = false;
      }
      event.preventDefault();
    });

    document.getElementById('jump-button').addEventListener('touchend', (event) => {
      if (!this.enabled) return;
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

    // Touch camera control
    this.cameraTouchId = null;
    this.domElement.addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      for (const touch of event.changedTouches) {
        const target = document.elementFromPoint(touch.clientX, touch.clientY);
        if (target && !target.closest('#joystick-container') && !target.closest('#jump-button') && !target.closest('#action-buttons')) {
          this.cameraTouchId = touch.identifier;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;
          event.preventDefault();
          break;
        }
      }
    }, { passive: false });

    this.domElement.addEventListener('touchmove', (event) => {
      if (!this.enabled || this.cameraTouchId === null) return;
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.cameraTouchId) {
          const deltaX = touch.clientX - this.touchStartX;
          const deltaY = touch.clientY - this.touchStartY;
          this.touchStartX = touch.clientX;
          this.touchStartY = touch.clientY;

          this.yaw -= deltaX * this.touchSensitivity;
          this.pitch -= deltaY * this.touchSensitivity;

          const maxPitch = Math.PI / 3;
          const minPitch = -Math.PI / 8;
          this.pitch = Math.max(minPitch, Math.min(maxPitch, this.pitch));
          event.preventDefault();
          break;
        }
      }
    }, { passive: false });

    this.domElement.addEventListener('touchend', (event) => {
      for (const touch of event.changedTouches) {
        if (touch.identifier === this.cameraTouchId) {
          this.cameraTouchId = null;
          break;
        }
      }
    });

    // Action buttons container
    const actionContainer = document.getElementById('action-buttons');

    // Fire button
    if (!document.getElementById('fire-button')) {
      const newFireButton = document.createElement('button');
      newFireButton.id = 'fire-button';
      newFireButton.className = 'action-button';
      newFireButton.innerText = 'FIRE';
      actionContainer.appendChild(newFireButton);
    }

    document.getElementById('fire-button').addEventListener('touchstart', (event) => {
      if (!this.enabled) return;
      const position = this.playerModel.position.clone().add(new THREE.Vector3(0, 0.7, 0));
      const direction = new THREE.Vector3(0, 0, 1).applyEuler(this.playerModel.rotation);

      this.multiplayer.send({
        type: 'projectile',
        id: this.multiplayer.getId(),
        position: position.toArray(),
        direction: direction.toArray()
      });

      this.playAction('projectile');
      this.spawnProjectile(this.scene, this.projectiles, position, direction);

      event.preventDefault();
    });

    // Kick button
    if (!document.getElementById('kick-button')) {
      const kickButton = document.createElement('button');
      kickButton.id = 'kick-button';
      kickButton.className = 'action-button';
      kickButton.innerText = 'KICK';
      actionContainer.appendChild(kickButton);
      kickButton.addEventListener('touchstart', (event) => {
        if (!this.enabled) return;
        this.playAction('mmaKick');
        event.preventDefault();
      });
    }

    // Punch button
    if (!document.getElementById('punch-button')) {
      const punchButton = document.createElement('button');
      punchButton.id = 'punch-button';
      punchButton.className = 'action-button';
      punchButton.innerText = 'PUNCH';
      actionContainer.appendChild(punchButton);
      punchButton.addEventListener('touchstart', (event) => {
        if (!this.enabled) return;
        this.playAction('mutantPunch');
        event.preventDefault();
      });
    }
  }
  
  setupEventListeners() {
    // Listen for key events (for desktop controls)
    document.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      const key = e.key.toLowerCase();
      this.keysPressed.add(key);

      if (e.key === " ") {
        if (this.canJump && this.body) {
          const t = this.body.translation();
          const up = new THREE.Vector3(t.x, t.y, t.z).normalize();
          this.body.applyImpulse({ x: up.x * JUMP_FORCE, y: up.y * JUMP_FORCE, z: up.z * JUMP_FORCE }, true);
          this.canJump = false;
          this.hasDoubleJumped = false;
        } else if (!this.hasDoubleJumped && this.body) {
          const t = this.body.translation();
          const up = new THREE.Vector3(t.x, t.y, t.z).normalize();
          this.body.applyImpulse({ x: up.x * JUMP_FORCE, y: up.y * JUMP_FORCE, z: up.z * JUMP_FORCE }, true);
          this.hasDoubleJumped = true;
          this.playAction('hurricaneKick');
        }
      } else if (key === 'e') {
        if (this.isMoving) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.5);
        }
        this.playAction('mutantPunch');
        this.audioManager?.playAttack();
      } else if (key === 'r') {
        if (this.isMoving) {
          this.slideMomentum.copy(this.lastMoveDirection).multiplyScalar(0.5);
          this.playAction('runningKick');
          this.audioManager?.playAttack();
        } else {
          this.playAction('mmaKick');
          this.audioManager?.playAttack();
        }
      } else if (key === 'g') {
        if (this.grabbedTarget) {
          this.releaseGrab();
        } else {
          this.attemptGrab();
        }
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
        this.playAction('projectile');
        this.spawnProjectile(this.scene, this.projectiles, position, direction);
    });
  }

  playAction(actionName) {
    if (!this.playerModel) return;
    const actions = this.playerModel.userData.actions;
    if (!actions || !actions[actionName]) return;

    if (this.runningKickTimer) {
      clearTimeout(this.runningKickTimer);
      this.runningKickTimer = null;
      const pivot = this.playerModel.userData.pivot;
      if (pivot) {
        pivot.rotation.y = this.runningKickOriginalY;
      }
    }

    const current = this.playerModel.userData.currentAction;
    const action = actions[actionName];
    actions[current]?.fadeOut(0.1);
    action.reset().fadeIn(0.1).play();
    this.playerModel.userData.currentAction = actionName;
    this.currentSpecialAction = actionName;

    if (["mutantPunch", "hurricaneKick", "mmaKick", "runningKick"].includes(actionName)) {
      this.playerModel.userData.attack = {
        name: actionName,
        start: Date.now(),
        hasHit: false,
      };
    }

    if (actionName === "runningKick") {
      action.paused = true;
      const pivot = this.playerModel.userData.pivot;
      if (pivot) {
        this.runningKickOriginalY = pivot.rotation.y;
        pivot.rotation.y -= Math.PI / 2;
      }
      this.runningKickTimer = setTimeout(() => {
        action.stop();
        if (pivot) {
          pivot.rotation.y = this.runningKickOriginalY;
        }
        this.currentSpecialAction = null;
      }, 1000);
      return;
    }

    const mixer = this.playerModel.userData.mixer;
    const onFinished = (e) => {
      if (e.action === action) {
        mixer.removeEventListener("finished", onFinished);
        this.currentSpecialAction = null;
      }
    };
    mixer.addEventListener("finished", onFinished);
  }

  applyKnockback(impulse) {
    if (this.body) {
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
    }
    this.isKnocked = true;
    this.knockbackRestYaw = this.playerModel.rotation.y;
    const actions = this.playerModel.userData.actions;
    const current = this.playerModel.userData.currentAction;
    const hitAction = actions?.hit;
    if (hitAction) {
      actions[current]?.fadeOut(0.1);
      hitAction.reset().fadeIn(0.1).play();
      this.playerModel.userData.currentAction = 'hit';
    }
  }

  processMovement() {
    if (!this.enabled || !this.body) return;
    const t = this.body.translation();
    const vel = this.body.linvel();

    if (this.isGrabbed) {
      // Freeze movement and follow externally provided position
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      if (this.externalGrabPos) {
        t.x = this.externalGrabPos.x;
        t.y = this.externalGrabPos.y;
        t.z = this.externalGrabPos.z;
        this.body.setTranslation(this.externalGrabPos, true);
      }
      if (this.playerModel) {
        this.playerModel.position.set(t.x, t.y, t.z);
      }
      return;
    }

    const pos = new THREE.Vector3(t.x, t.y, t.z);
    const up = pos.clone().normalize();
    const velVec = new THREE.Vector3(vel.x, vel.y, vel.z);
    const radialVel = up.clone().multiplyScalar(velVec.dot(up));
    const surfaceDist = SPHERE_RADIUS + PLAYER_RADIUS;
    if (Math.abs(pos.length() - surfaceDist) < 0.05 && radialVel.length() < 0.1) {
      this.canJump = true;
      this.hasDoubleJumped = false;
    }
    const moveDirection = new THREE.Vector3(0, 0, 0);
    const movementLocked = ['mutantPunch', 'mmaKick', 'runningKick'].includes(this.currentSpecialAction);
    if (!movementLocked) {
      if (this.isMobile) {
        if (this.joystickForce > 0.1) {
          const cameraForward = new THREE.Vector3();
          this.camera.getWorldDirection(cameraForward);
          cameraForward.projectOnPlane(up).normalize();
          const cameraRight = new THREE.Vector3().crossVectors(cameraForward, up).normalize();
          const dx = Math.cos(this.joystickAngle);
          const dz = Math.sin(this.joystickAngle);
          moveDirection.addScaledVector(cameraForward, dz * this.joystickForce);
          moveDirection.addScaledVector(cameraRight, dx * this.joystickForce);
        }
      } else {
        if (this.keysPressed.has("w")) moveDirection.z = 1;
        if (this.keysPressed.has("s")) moveDirection.z = -1;
        if (this.keysPressed.has("a")) moveDirection.x = 1;
        if (this.keysPressed.has("d")) moveDirection.x = -1;
      }
    }
    if (!this.isMobile && moveDirection.length() > 0) moveDirection.normalize();
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    cameraDirection.projectOnPlane(up).normalize();
    const rightVector = new THREE.Vector3().crossVectors(cameraDirection, up).normalize();
    const movement = new THREE.Vector3();
    if (!this.isMobile) {
      if (moveDirection.z !== 0) movement.add(cameraDirection.clone().multiplyScalar(moveDirection.z));
      if (moveDirection.x !== 0) movement.add(rightVector.clone().multiplyScalar(moveDirection.x));
      if (movement.length() > 0) movement.normalize();
    } else {
      movement.copy(moveDirection);
    }
    if (movementLocked) {
      movement.copy(this.slideMomentum);
      this.slideMomentum.multiplyScalar(0.99);
      if (this.slideMomentum.length() < 0.01) this.slideMomentum.set(0, 0, 0);
    } else if (movement.length() > 0) {
      this.lastMoveDirection.copy(movement);
    }
    if (this.isKnocked) {
      if (Math.hypot(vel.x, vel.y, vel.z) < 0.05) {
        this.isKnocked = false;
        this.playerModel.rotation.set(0, this.knockbackRestYaw || this.playerModel.rotation.y, 0);
        const actions = this.playerModel.userData.actions;
        actions?.hit?.fadeOut(0.2);
        actions?.idle?.reset().fadeIn(0.2).play();
        this.playerModel.userData.currentAction = 'idle';
      }
    } else {
      let newVel;
      if (movement.length() > 0) {
        newVel = movement.clone().multiplyScalar(SPEED);
        if (!this.canJump) {
          newVel.add(radialVel);
        }
      } else {
        newVel = this.canJump ? new THREE.Vector3(0, 0, 0) : velVec;
      }
      if (this.canJump) {
        const surfacePos = up.clone().multiplyScalar(surfaceDist);
        this.body.setTranslation({ x: surfacePos.x, y: surfacePos.y, z: surfacePos.z }, true);
        pos.copy(surfacePos);
      }
      this.body.setLinvel({ x: newVel.x, y: newVel.y, z: newVel.z }, true);
    }
    const newX = pos.x;
    const newY = pos.y;
    const newZ = pos.z;
    const isMovingNow = movement.length() > 0;
    this.isMoving = isMovingNow;
    if (isMovingNow && this.canJump) {
      this.audioManager?.playFootstep();
    }
    if (this.playerModel) {
      this.playerModel.position.set(newX, newY, newZ);
      this.playerModel.up.copy(up);
      if (movement.length() > 0) {
        const target = this.playerModel.position.clone().add(movement);
        this.playerModel.lookAt(target);
      }
      const actions = this.playerModel.userData.actions;
      if (actions && !this.isKnocked && !this.currentSpecialAction) {
        let actionName = 'idle';
        if (!this.canJump) actionName = 'jump';
        else if (isMovingNow) actionName = 'run';
        const current = this.playerModel.userData.currentAction;
        if (actionName && current !== actionName) {
          actions[current]?.fadeOut(0.2);
          actions[actionName].reset().fadeIn(0.2).play();
          this.playerModel.userData.currentAction = actionName;
        }
      }
      const newTarget = this.playerModel.position.clone().add(up);
      if (this.controls) {
        this.controls.target.copy(newTarget);
      }
      if (this.multiplayer && (Math.abs(this.lastPosition.x - newX) > 0.01 || Math.abs(this.lastPosition.y - newY) > 0.01 || Math.abs(this.lastPosition.z - newZ) > 0.01 || this.isMoving !== this.wasMoving)) {
        this.multiplayer.send({ x: newX, y: newY, z: newZ, rotation: this.playerModel.rotation.y, moving: this.isMoving });
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

    const up = this.playerModel.position.clone().normalize();
    const orbitCenter = this.playerModel.position.clone().add(up);
    const rotatedOffset = new THREE.Vector3(
      this.cameraOffset.x * Math.cos(this.yaw) - this.cameraOffset.z * Math.sin(this.yaw),
      this.cameraOffset.y + 5 * Math.sin(this.pitch),
      this.cameraOffset.x * Math.sin(this.yaw) + this.cameraOffset.z * Math.cos(this.yaw)
    ).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up));

    this.camera.position.copy(orbitCenter).add(rotatedOffset);
    this.camera.up.copy(up);
    this.camera.lookAt(orbitCenter);

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
      if (this.grabbedTarget) {
        this.updateGrabbedTarget();
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

  /**
   * Trigger a jump action programmatically.
   * Useful for alternative input methods like voice commands.
   */
  triggerJump() {
    if (!this.enabled || !this.body) return;
    if (this.canJump) {
      const t = this.body.translation();
      const up = new THREE.Vector3(t.x, t.y, t.z).normalize();
      this.body.applyImpulse({ x: up.x * JUMP_FORCE, y: up.y * JUMP_FORCE, z: up.z * JUMP_FORCE }, true);
      this.canJump = false;
    }
  }

  /**
   * Trigger a projectile fire action programmatically.
   * Useful for alternative input methods like voice commands.
   */
  triggerFire() {
    if (!this.enabled) return;
    const position = this.playerModel.position.clone().add(new THREE.Vector3(0, 0.7, 0));
    const direction = new THREE.Vector3(0, 0, 1).applyEuler(this.playerModel.rotation);

    this.multiplayer.send({
      type: 'projectile',
      id: this.multiplayer.getId(),
      position: position.toArray(),
      direction: direction.toArray()
    });

    this.playAction('projectile');
    this.spawnProjectile(this.scene, this.projectiles, position, direction);
  }

  updateGrabbedTarget() {
    if (!this.grabbedTarget || !this.playerModel) return;
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(this.playerModel.rotation).normalize();
    const targetPos = this.playerModel.position.clone().addScaledVector(forward, 1);
    const target = this.grabbedTarget;
    if (target.type === 'player') {
      target.model.position.copy(targetPos);
      this.multiplayer.send({ type: 'grabMove', from: this.multiplayer.getId(), target: target.id, position: targetPos.toArray() });
    } else if (target.type === 'monster') {
      target.model.position.copy(targetPos);
      target.model.userData.rb?.setTranslation(targetPos, true);
    } else if (target.type === 'object') {
      target.object.position.copy(targetPos);
      if (target.object.userData?.rb) {
        target.object.userData.rb.setTranslation(targetPos, true);
      }
    }
  }

  attemptGrab() {
    const playerPos = this.playerModel.position;
    let closest = null;
    let minDist = 1.5;

    const others = window.otherPlayers || {};
    for (const [id, p] of Object.entries(others)) {
      const dist = playerPos.distanceTo(p.model.position);
      if (dist < minDist) {
        closest = { type: 'player', id, model: p.model };
        minDist = dist;
      }
    }

    const mon = window.monster;
    if (mon) {
      const dist = playerPos.distanceTo(mon.position);
      if (dist < minDist) {
        closest = { type: 'monster', model: mon };
        minDist = dist;
      }
    }

    const bm = window.breakManager;
    if (bm) {
      for (const [id, data] of bm.registry.entries()) {
        const obj = data.object;
        const dist = playerPos.distanceTo(obj.position);
        if (dist < minDist) {
          closest = { type: 'object', id, object: obj };
          minDist = dist;
        }
      }
    }

    if (closest) {
      this.grabbedTarget = closest;
      if (closest.type === 'player') {
        this.multiplayer.send({ type: 'grab', from: this.multiplayer.getId(), target: closest.id, active: true });
      }
    }
  }

  releaseGrab() {
    if (this.grabbedTarget && this.grabbedTarget.type === 'player') {
      this.multiplayer.send({ type: 'grab', from: this.multiplayer.getId(), target: this.grabbedTarget.id, active: false });
    }
    this.grabbedTarget = null;
  }

  setGrabbed(active, grabberId = null) {
    this.isGrabbed = active;
    this.grabberId = grabberId;
    if (!active) {
      this.externalGrabPos = null;
    }
  }

  updateGrabbedPosition(pos) {
    this.externalGrabPos = new THREE.Vector3(...pos);
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
