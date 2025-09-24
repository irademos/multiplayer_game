import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

// Easily tweakable placement and gameplay constants
const DEFAULT_BOAT_POSITION = new THREE.Vector3(8, 0, 14);
const BOAT_SCALE = 0.01;
const OAR_LOCAL_POSITION = new THREE.Vector3(0, 0.55, -0.2);
const OAR_LOCAL_ROTATION = new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ');
const MOUNT_LOCAL_POSITION = new THREE.Vector3(15.0, 85.0, 75.0);
const MOUNT_LOCAL_ROTATION = new THREE.Euler(0, Math.PI/2, 0, 'YXZ');
const FLOAT_HEIGHT = 0.25;
const LINEAR_DAMPING = 1.8;
const ANGULAR_DAMPING = 3.2;
const PADDLE_FORWARD_IMPULSE = 2.2;
const PADDLE_SIDE_IMPULSE = 0.7;
const PADDLE_TURN_RATE = 1.5;
const PADDLE_COOLDOWN = 0.65; // seconds

const TEMP_POSITION = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();
const TEMP_LOCAL_MATRIX = new THREE.Matrix4();
const TEMP_WORLD_MATRIX = new THREE.Matrix4();
const TEMP_OFFSET = new THREE.Vector3();
const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

const TEMP_SCALE = new THREE.Vector3();



export class RowBoat {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.oar = null;
    this.occupant = null;
    this.type = 'rowboat';

    this.velocity = new THREE.Vector3();
    this.angularVelocity = 0;
    this.paddleCooldown = 0;
    this.paddleResetTime = 0;
    this.paddleActionName = null;
    this.lastUpdateTime = null;

    this.boundingSize = new THREE.Vector3(4, 1.5, 1.5);
    this.boundingCenterOffset = new THREE.Vector3();
  }

  

  async load(position = DEFAULT_BOAT_POSITION) {
    const loader = new GLTFLoader();

    try {
      const boatGltf = await loader.loadAsync('/assets/props/row_boat.glb');
      this.mesh = boatGltf.scene;
    } catch (error) {
      console.warn('Failed to load row boat model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(4, 1, 1.5);
      const material = new THREE.MeshStandardMaterial({ color: 0x8d5524 });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    this.mesh.name = 'RowBoat';
    this.mesh.scale.setScalar(BOAT_SCALE);
    this.mesh.position.copy(position);
    // this.mesh.rotation.set(0, -Math.PI / 2, 0);
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    try {
      const oarGltf = await loader.loadAsync('/assets/props/oar.glb');
      this.oar = oarGltf.scene;
    } catch (error) {
      console.warn('Failed to load oar model, using placeholder cylinder.', error);
      const geometry = new THREE.CylinderGeometry(0.03, 0.03, 3, 8);
      const material = new THREE.MeshStandardMaterial({ color: 0xdeb887 });
      this.oar = new THREE.Mesh(geometry, material);
    }

    if (this.oar) {
      this.oar.name = 'RowBoatOar';
      this.mesh.add(this.oar);
      this.setOarTransform();
    }

    const bbox = new THREE.Box3().setFromObject(this.mesh);
    bbox.getSize(this.boundingSize);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    this.boundingCenterOffset.copy(center).sub(this.mesh.position);

    return this.mesh;
  }

  setOarTransform() {
    if (!this.oar) return;
    this.oar.position.copy(OAR_LOCAL_POSITION);
    this.oar.rotation.copy(OAR_LOCAL_ROTATION);
  }

  getMountWorldTransform(outPosition = TEMP_POSITION, outQuaternion = TEMP_QUATERNION) {
    if (!this.mesh) {
      outPosition.set(0, 0, 0);
      outQuaternion.identity();
      return { position: outPosition, quaternion: outQuaternion };
    }

    TEMP_OFFSET.copy(MOUNT_LOCAL_POSITION);
    TEMP_QUATERNION.setFromEuler(MOUNT_LOCAL_ROTATION);
    TEMP_LOCAL_MATRIX.compose(TEMP_OFFSET, TEMP_QUATERNION, UNIT_SCALE);

    TEMP_WORLD_MATRIX.multiplyMatrices(this.mesh.matrixWorld, TEMP_LOCAL_MATRIX);
    // outPosition.setFromMatrixPosition(TEMP_WORLD_MATRIX);
    // outQuaternion.setFromRotationMatrix(TEMP_WORLD_MATRIX);
    
    TEMP_WORLD_MATRIX.decompose(outPosition, outQuaternion, TEMP_SCALE);

    return { position: outPosition, quaternion: outQuaternion };
  }

  tryMount(playerControls) {
    if (!this.mesh || this.occupant) return;
    if (!playerControls?.playerModel) return;

    const playerPosition = playerControls.playerModel.position;
    const distance = playerPosition.distanceTo(this.mesh.position);
    if (distance > 4) return;

    this.occupant = playerControls;
    playerControls.vehicle = this;
    playerControls.isMoving = false;
    this.alignOccupant();
    this.playOccupantAction('sit');
    this.paddleCooldown = 0;
    this.paddleActionName = null;
    this.paddleResetTime = 0;
  }

  dismount() {
    if (!this.occupant) return;

    const exitPos = this.mesh.position.clone();
    TEMP_FORWARD.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    exitPos.addScaledVector(TEMP_FORWARD, -1.2);
    exitPos.y += 0.2;

    const playerControls = this.occupant;
    const { playerModel, body } = playerControls;
    if (playerModel) {
      playerModel.position.copy(exitPos);
      playerModel.rotation.y = this.mesh.rotation.y;
      playerModel.userData.currentAction = playerModel.userData.currentAction || 'idle';
      this.playOccupantAction('idle');
    }
    if (body) {
      body.setTranslation({ x: exitPos.x, y: exitPos.y, z: exitPos.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }

    playerControls.vehicle = null;
    this.occupant = null;
    this.paddleActionName = null;
  }

  paddleLeft() {
    this.triggerPaddle('paddleLeft', 1);
  }

  paddleRight() {
    this.triggerPaddle('paddleRight', -1);
  }

  triggerPaddle(actionName, lateralSign) {
    if (!this.occupant || !this.mesh) return;
    if (this.paddleCooldown > 0) return;

    const actions = this.occupant.playerModel?.userData?.actions;
    if (!actions || !actions[actionName]) return;

    this.playOccupantAction(actionName, { immediate: true });

    const actionClip = actions[actionName]._clip || actions[actionName].getClip?.();
    const duration = actionClip?.duration ?? 0.8;
    this.paddleActionName = actionName;
    this.paddleResetTime = performance.now() + duration * 1000 * 0.9;
    this.paddleCooldown = PADDLE_COOLDOWN;

    const forward = TEMP_FORWARD.set(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const right = TEMP_RIGHT.set(1, 0, 0).applyQuaternion(this.mesh.quaternion);

    this.velocity.addScaledVector(forward, PADDLE_FORWARD_IMPULSE);
    this.velocity.addScaledVector(right, PADDLE_SIDE_IMPULSE * lateralSign);
    this.angularVelocity += lateralSign * PADDLE_TURN_RATE;
  }

  playOccupantAction(name, { immediate = false } = {}) {
    if (!this.occupant) return;
    const actions = this.occupant.playerModel?.userData?.actions;
    if (!actions || !actions[name]) return;

    const current = this.occupant.playerModel.userData.currentAction;
    if (current === name && !immediate) return;

    actions[current]?.fadeOut(0.2);
    actions[name].reset().fadeIn(0.1).play();
    this.occupant.playerModel.userData.currentAction = name;
  }

  alignOccupant() {
    if (!this.occupant) return;
    const { position, quaternion } = this.getMountWorldTransform();
    const { playerModel, body } = this.occupant;

    if (playerModel) {
      playerModel.position.copy(position);
      playerModel.quaternion.copy(quaternion);
    }
    if (body) {
      body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    this.occupant.yaw = -this.mesh.rotation.y;
  }

  update(deltaOverride) {
    if (!this.mesh) return;

    const now = performance.now();
    if (this.lastUpdateTime === null) {
      this.lastUpdateTime = now;
    }
    const delta = deltaOverride ?? (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    if (this.paddleCooldown > 0) {
      this.paddleCooldown = Math.max(0, this.paddleCooldown - delta);
    }

    const dampingFactor = Math.exp(-LINEAR_DAMPING * delta);
    this.velocity.multiplyScalar(dampingFactor);
    const angularDamping = Math.exp(-ANGULAR_DAMPING * delta);
    this.angularVelocity *= angularDamping;

    this.mesh.position.addScaledVector(this.velocity, delta);
    this.mesh.rotation.y += this.angularVelocity * delta;

    const waterDepth = getWaterDepth(this.mesh.position.x, this.mesh.position.z);
    if (waterDepth > 0) {
      this.mesh.position.y = FLOAT_HEIGHT;
    } else {
      const groundY = getTerrainHeight(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + FLOAT_HEIGHT * 0.2;
    }

    this.mesh.updateMatrixWorld(true);

    if (this.occupant) {
      this.alignOccupant();
      if (this.paddleActionName && performance.now() >= this.paddleResetTime) {
        this.playOccupantAction('sit');
        this.paddleActionName = null;
      }
    }
  }
}
