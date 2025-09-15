import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getWaterDepth, getTerrainHeight } from './water.js';

export class Surfboard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.occupant = null;
    this.type = 'surfboard';
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
  }

  update() {
    if (!this.mesh) return;

    if (this.occupant) {
      const player = this.occupant;
      const basePos = player.playerModel.position;
      const yaw = player.playerModel.rotation.y;
      const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const offset = (player.isInWater ? this.swimOffset : this.holdingOffset)
        .clone()
        .applyQuaternion(yawQ);
      this.mesh.position.copy(basePos).add(offset);
      this.mesh.rotation.set(-Math.PI / 2, yaw, 0);
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
