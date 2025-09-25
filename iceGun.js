import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from './water.js';

const DEFAULT_POSITION = new THREE.Vector3(-6, 0, 5);
const PICKUP_RADIUS = 3;

export class IceGun {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.holder = null;
    this.type = 'iceGun';
    this._holdOffset = new THREE.Vector3(0.4, 1, -0.3);
    this._holdRotation = new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'YXZ');
  }

  async load(position = DEFAULT_POSITION) {
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('/assets/props/ice_gun.glb');
      this.mesh = gltf.scene;
    } catch (error) {
      console.warn('Failed to load ice gun model, using placeholder box.', error);
      const geometry = new THREE.BoxGeometry(0.6, 0.2, 0.8);
      const material = new THREE.MeshStandardMaterial({ color: 0x99ccff });
      this.mesh = new THREE.Mesh(geometry, material);
    }

    if (!this.mesh) return;

    const targetPos = position.clone();
    const terrainHeight = getTerrainHeight(targetPos.x, targetPos.z);
    targetPos.y = terrainHeight + 0.5;

    this.mesh.traverse(child => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    this.mesh.position.copy(targetPos);
    this.mesh.scale.setScalar(0.8);
    this.scene.add(this.mesh);
  }

  tryPickup(playerControls) {
    if (!this.mesh || !playerControls?.playerModel) return;
    if (this.holder === playerControls) {
      this.drop();
      return;
    }
    if (this.holder) return;
    const distance = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (distance > PICKUP_RADIUS) return;

    this.holder = playerControls;
    console.log('Player picked up the ice gun');
  }

  drop() {
    if (!this.holder || !this.mesh) return;
    const player = this.holder.playerModel;
    if (player) {
      const dropPosition = player.position.clone();
      const terrainHeight = getTerrainHeight(dropPosition.x, dropPosition.z);
      dropPosition.y = terrainHeight + 0.5;
      this.mesh.position.copy(dropPosition);
      this.mesh.quaternion.copy(player.quaternion);
    }
    this.holder = null;
  }

  update() {
    if (!this.mesh) return;
    if (!this.holder || !this.holder.playerModel) return;

    const player = this.holder.playerModel;
    const quaternion = player.quaternion;

    const offset = this._holdOffset.clone().applyQuaternion(quaternion);
    this.mesh.position.copy(player.position).add(offset);

    const holdQuaternion = new THREE.Quaternion().setFromEuler(this._holdRotation);
    this.mesh.quaternion.copy(quaternion).multiply(holdQuaternion);
  }
}
