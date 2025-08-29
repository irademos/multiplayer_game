import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";

export class Spaceship {
  constructor(scene, world, rbToMesh) {
    this.scene = scene;
    this.world = world;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.occupant = null; // PlayerControls instance
    this.mountOffset = new THREE.Vector3(0, 1, 0);
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('/assets/props/mother_spaceship.glb');
    const ship = gltf.scene;
    const scale = 0.1;
    ship.scale.set(scale, scale, scale);
    ship.position.set(0, 3, 5);

    // Add mesh and update transforms
    this.mesh = ship;
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);

    // Compute world-space AABB
    const bbox = new THREE.Box3().setFromObject(this.mesh);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);

    // Create physics body centered on mesh
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(ship.position.x, ship.position.y, ship.position.z)
      .setLinearDamping(0.5)
      .setAngularDamping(0.5)
      .setGravityScale(0);
    this.body = this.world.createRigidBody(rbDesc);

    const offset = new THREE.Vector3().subVectors(center, ship.position);
    const colDesc = RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
      .setTranslation(offset.x, offset.y, offset.z);
    this.world.createCollider(colDesc, this.body);

    // Mount point on top of the box
    this.mountOffset.set(0, size.y * 0.5, 0);
  }

  update() {
    if (!this.occupant) return;
    const top = this.mesh.position.clone().add(this.mountOffset);
    const player = this.occupant.playerModel;
    player.position.copy(top);
    if (this.occupant.body) {
      this.occupant.body.setTranslation(top, true);
      this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  tryMount(playerControls) {
    if (this.occupant || !playerControls?.playerModel || !this.mesh) return;
    const dist = playerControls.playerModel.position.distanceTo(this.mesh.position);
    if (dist < 2) {
      this.occupant = playerControls;
      playerControls.vehicle = this;
    }
  }

  applyInput(dir) {
    if (!this.body) return;
    const speed = 5;
    this.body.setLinvel({ x: dir.x * speed, y: dir.y * speed, z: dir.z * speed }, true);
  }

  dismount() {
    if (!this.occupant) return;
    const playerControls = this.occupant;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const dismountPos = this.mesh.position.clone().add(forward.multiplyScalar(-3)).add(this.mountOffset);
    if (playerControls.playerModel) {
      playerControls.playerModel.position.copy(dismountPos);
    }
    if (playerControls.body) {
      playerControls.body.setTranslation(dismountPos, true);
      playerControls.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    playerControls.vehicle = null;
    this.occupant = null;
  }
}
