import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

export class Surfboard {
  constructor(scene, world, rbToMesh) {
    this.scene = scene;
    this.world = world;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.occupant = null;
    this.mountOffset = new THREE.Vector3(-0.7, 0.3, -1.2);
    this.type = 'surfboard';
    this.standing = false;
    this.prevKeys = new Set();
    this.nextPumpTime = 0;
    this.pumpCooldownMs = 700;
    this.lowSpeedTime = 0;
    this.lastUpdateTs = performance.now();
  }

  async load(position = { x: 0, y: 0, z: 0 }) {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/assets/props/surfboard__tabla_de_surf.glb');
      
      this.mesh = gltf.scene;
      this.scene.add(this.mesh);
      this.mesh.position.set(0, 0, 0);
      this.mesh.scale.set(1, 1, 1);
      this.mesh.updateMatrixWorld(true);
      this.mesh.scale.setScalar(0.008);     

    } catch (e) {
      // Fallback to simple box if the GLB is missing or fails to load
      const geometry = new THREE.BoxGeometry(2, 0.1, 0.5);
      const material = new THREE.MeshStandardMaterial({ color: 0xffe0bd });
      this.mesh = new THREE.Mesh(geometry, material);
    }
    this.mesh.castShadow = true;
    
    // Compute bounding box for camera and collider setup
    this.mesh.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);
    this.boundingSize = size;
    this.boundingCenterOffset = new THREE.Vector3().subVectors(center, this.mesh.position);

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setLinearDamping(2)
      .setAngularDamping(2)
      .setGravityScale(0);
    this.body = this.world.createRigidBody(rbDesc);

    const tilt = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 2
    );
    this.body.setRotation({ x: tilt.x, y: tilt.y, z: tilt.z, w: tilt.w }, false);

    // Only allow yaw
    this.body.setEnabledRotations(false, true, false, true);

    // Use a cuboid collider approximating the model's bounding box
    const colDesc = RAPIER.ColliderDesc.cuboid(
      size.x / 2,
      size.y / 2,
      size.z / 2
    )
      .setTranslation(
        this.boundingCenterOffset.x,
        this.boundingCenterOffset.y,
        this.boundingCenterOffset.z
      )
      .setRestitution(0)
      .setFriction(1);
    this.world.createCollider(colDesc, this.body);

    this.rbToMesh?.set(this.body, this.mesh);
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel || !this.body) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 3) {
      this.occupant = playerControls;
      playerControls.vehicle = this;

      if (this.occupant.body) {
        this._savedBodyType = this.occupant.body.bodyType();
        this.occupant.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
    }
  }


  dismount() {
    if (!this.occupant) return;
    if (this.occupant.body && this._savedBodyType !== undefined) {
      this.occupant.body.setBodyType(this._savedBodyType, true);
      this._savedBodyType = undefined;
    }
    this.occupant.vehicle = null;
    this.occupant = null;
    this.standing = false;
  }


  toggleStand() {
    if (!this.occupant) return;
    this.standing = !this.standing;
    const actions = this.occupant.playerModel?.userData?.actions;
    const current = this.occupant.playerModel?.userData?.currentAction;
    if (actions) {
      const target = this.standing ? 'idle' : 'swim';
      if (current !== target) {
        actions[current]?.fadeOut(0.2);
        actions[target]?.reset().fadeIn(0.2).play();
        this.occupant.playerModel.userData.currentAction = target;
      }
    }
  }

  handleControls(playerControls) {
    if (!this.body || !this.occupant) return;
    // Only special handling when standing
    if (!this.standing) return;

    const now = performance.now();
    const dt = Math.min(0.05, (now - (this._lastControlsTs || now)) / 1000);
    this._lastControlsTs = now;

    const keys = playerControls.keysPressed || new Set();

    // Extract yaw-only forward/right from body rotation
    const rot = this.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    let yaw = e.y;
    const forward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    const left = right.clone().multiplyScalar(-1);

    // Rotation with A/D and lateral push while pressed
    const yawRate = 1.5; // rad/s
    const lateralPush = 0.5; // impulse strength per tick when held
    let yawDelta = 0;
    if (keys.has('a')) {
      yawDelta -= yawRate * dt;
      this.body.applyImpulse({ x: left.x * lateralPush, y: 0, z: left.z * lateralPush }, true);
    }
    if (keys.has('d')) {
      yawDelta += yawRate * dt;
      this.body.applyImpulse({ x: right.x * lateralPush, y: 0, z: right.z * lateralPush }, true);
    }
    if (yawDelta !== 0) {
      yaw += yawDelta;
      const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
      this.body.setRotation({ x: yawQ.x, y: yawQ.y, z: yawQ.z, w: yawQ.w }, true);
    }

    // W pump: short forward impulse on key press with cooldown
    const pumpImpulse = 6.0;
    if (keys.has('w') && !this.prevKeys.has('w') && now >= this.nextPumpTime) {
      this.body.applyImpulse({ x: forward.x * pumpImpulse, y: 0, z: forward.z * pumpImpulse }, true);
      this.nextPumpTime = now + this.pumpCooldownMs;
    }

    // S brake: small continuous push against forward while held
    const brakePush = 1.8;
    if (keys.has('s')) {
      this.body.applyImpulse({ x: -forward.x * brakePush, y: 0, z: -forward.z * brakePush }, true);
    }

    // Face the rider toward movement direction
    const lv = this.body.linvel();
    const speedXY = Math.hypot(lv.x, lv.z);
    if (this.occupant?.playerModel) {
      let faceYaw = yaw;
      if (speedXY > 0.05) {
        faceYaw = Math.atan2(lv.x, lv.z);
      }
      this.occupant.playerModel.rotation.set(0, faceYaw, 0);
      const actions = this.occupant.playerModel.userData?.actions;
      const current = this.occupant.playerModel.userData?.currentAction;
      if (actions && current !== 'idle') {
        actions[current]?.fadeOut(0.2);
        actions['idle']?.reset().fadeIn(0.2).play();
        this.occupant.playerModel.userData.currentAction = 'idle';
      }
    }

    // Remember keys for edge detection
    this.prevKeys = new Set(keys);
  }

  applyInput(moveVec) {
    if (!this.body) return;
    const speed = 15; // Surfing speed
    const vel = moveVec.clone().multiplyScalar(speed);
    this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
  }

  update() {
    if (!this.body) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastUpdateTs) / 1000);
    this.lastUpdateTs = now;

    const t = this.body.translation();
    const lv = this.body.linvel();
    const rv = this.body.angvel ? this.body.angvel() : { x: 0, y: 0, z: 0 };

    // Determine environment
    const waterDepth = getWaterDepth(t.x, t.z);
    const onWater = waterDepth > 0;
    const halfThickness = 0.05; // collider half-height

    if (onWater) {
      const targetY = 0 + halfThickness;
      if (t.y !== targetY) {
        this.body.setTranslation({ x: t.x, y: targetY, z: t.z }, true);
      }
      // No vertical motion on water
      if (lv.y !== 0) {
        this.body.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
      }
    } else {
      const terrainY = getTerrainHeight(t.x, t.z) + halfThickness;
      if (t.y !== terrainY) {
        this.body.setTranslation({ x: t.x, y: terrainY, z: t.z }, true);
      }
      if (!this.occupant) {
        // Stay still on land unless mounted
        if (lv.x !== 0 || lv.y !== 0 || lv.z !== 0) {
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        if (rv.x !== 0 || rv.y !== 0 || rv.z !== 0) {
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }

    if (this.occupant) {
      const t2 = this.body.translation();

      // yaw-only rotation
      const rot = this.body.rotation();
      const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
      const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
      const yawQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, e.y, 0, 'YXZ'));

      const offset = this.mountOffset.clone().applyQuaternion(yawQ);
      const top = { x: t2.x + offset.x, y: t2.y + offset.y, z: t2.z + offset.z };

      if (this.occupant.body) {
        // kinematic drive — single source of truth
        this.occupant.body.setNextKinematicTranslation(top);
        // DO NOT also set playerModel.position here
      } else {
        // no physics body; drive the model directly
        this.occupant.playerModel.position.set(top.x, top.y, top.z);
      }

      // Keep rider facing board yaw (avoid velocity-based flip-flop)
      this.occupant.playerModel.rotation.set(0, e.y + Math.PI, 0);


      const actions = this.occupant.playerModel.userData.actions;
      const current = this.occupant.playerModel.userData.currentAction;
      const desired = this.standing ? 'idle' : 'swim';
      if (actions && current !== desired) {
        actions[current]?.fadeOut(0.2);
        actions[desired]?.reset().fadeIn(0.2).play();
        this.occupant.playerModel.userData.currentAction = desired;
      }
    }

    // Auto-dismount with fall-flat if speed too low while standing
    if (this.standing && this.occupant) {
      const v = this.body.linvel();
      const speed = Math.hypot(v.x, v.z);
      const threshold = 0.2;
      if (speed < threshold) {
        this.lowSpeedTime += dt;
        if (this.lowSpeedTime > 0.4) {
          const rider = this.occupant;
          this.dismount();
          rider.playAction?.('hit');
        }
      } else {
        this.lowSpeedTime = 0;
      }
    } else {
      this.lowSpeedTime = 0;
    }
  }
}
