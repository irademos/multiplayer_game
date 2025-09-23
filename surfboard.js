import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

export class Surfboard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.occupant = null;
    this.type = 'surfboard';
    this.standing = false;
    this.holdingOffset = new THREE.Vector3(0.5, 0.1, -0.5);
    this.swimOffset = new THREE.Vector3(0, -0.4, 0.8);
  }

  async load(position = { x: 0, y: 0, z: 0 }) {
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/assets/props/surfboard__tabla_de_surf.glb');
      this.mesh = gltf.scene;
      this.mesh.scale.setScalar(0.008);
    } catch (e) {
      const geometry = new THREE.BoxGeometry(2, 0.1, 0.5);
      const material = new THREE.MeshStandardMaterial({ color: 0xffe0bd });
      this.mesh = new THREE.Mesh(geometry, material);
    }
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.castShadow = true;
    this.mesh.rotation.set(-Math.PI / 2, 0, 0);
    this.scene.add(this.mesh);
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 3) {
      this.occupant = playerControls;
      playerControls.vehicle = this;
    }
  }

  dismount() {
    if (!this.occupant) return;
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

  update() {
    if (!this.mesh) return;

    if (this.occupant) {
      // ---------- Tweakable constants ----------
      const HOLDING_OFFSET = new THREE.Vector3(0.1, -0.5, -1.2); // right/forward/up relative to player
      const SWIM_OFFSET    = new THREE.Vector3(-0.55, -0.1, -1.1); // under/forward while swimming

      // Extra rotation you want the mesh to have relative to the player (in radians)
      const HOLDING_ROT_OFFSET_EULER = new THREE.Euler(Math.PI, Math.PI/2, Math.PI/2, 'YXZ');         // adjust if you need a tilt when holding
      const SWIM_ROT_OFFSET_EULER    = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ'); // e.g., lay flat when swimming

      // Optional smoothing (0 = snap, 1 = frozen). 0.2–0.4 feels good.
      const POS_LERP = 0.0;
      const ROT_SLERP = 0.0;
      // ----------------------------------------

      // Update attachment transform
      const player = this.occupant;
      const playerWorldPos = player.playerModel.getWorldPosition(new THREE.Vector3());
      const playerWorldQ   = player.playerModel.getWorldQuaternion(new THREE.Quaternion());

      // Select offsets based on state
      const localPosOffset = (player.isInWater ? SWIM_OFFSET : HOLDING_OFFSET);
      const rotOffsetEuler = (player.isInWater ? SWIM_ROT_OFFSET_EULER : HOLDING_ROT_OFFSET_EULER);

      // Compute target world position
      const worldOffset = localPosOffset.clone().applyQuaternion(playerWorldQ);
      const targetPos = playerWorldPos.clone().add(worldOffset);

      // Compute target world rotation
      const rotOffsetQ = new THREE.Quaternion().setFromEuler(rotOffsetEuler);
      const targetQ = playerWorldQ.clone().multiply(rotOffsetQ);

      // Apply (with optional smoothing)
      if (POS_LERP > 0) {
        this.mesh.position.lerp(targetPos, POS_LERP);
      } else {
        this.mesh.position.copy(targetPos);
      }

      if (ROT_SLERP > 0) {
        this.mesh.quaternion.slerp(targetQ, ROT_SLERP);
      } else {
        this.mesh.quaternion.copy(targetQ);
      }

    } else {
      const t = this.mesh.position;
      const waterDepth = getWaterDepth(t.x, t.z);
      const onWater = waterDepth > 0;
      const halfThickness = 0.05;
      if (onWater) {
        this.mesh.position.y = 0 + halfThickness;
      } else {
        this.mesh.position.y = getTerrainHeight(t.x, t.z) + halfThickness;
      }
    }
  }
}
