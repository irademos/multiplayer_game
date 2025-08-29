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
    this.locked = false;
    this.halfHeight = 0;
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync('/assets/props/mother_spaceship.glb');
    const ship = gltf.scene;
    const scale = 1;
    ship.scale.set(scale, scale, scale);
    ship.position.set(1, 5, 50);

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
      .setGravityScale(0.1);
    this.body = this.world.createRigidBody(rbDesc);

    const offset = new THREE.Vector3().subVectors(center, ship.position);
    const colDesc = RAPIER.ColliderDesc.cuboid(size.x * 0.5, size.y * 0.5, size.z * 0.5)
      .setTranslation(offset.x, offset.y, offset.z);
    this.world.createCollider(colDesc, this.body);

    // Register with global rigid-body map so physics sync updates the mesh
    this.rbToMesh?.set(this.body, this.mesh);

    // Mount point on top of the box
    this.mountOffset.set(0, size.y * 0.5, 0);
    this.halfHeight = size.y * 0.5;
  }

  update() {
    if (this.occupant) {
      const top = this.mesh.position.clone().add(this.mountOffset);
      const player = this.occupant.playerModel;
      player.position.copy(top);
      if (this.occupant.body) {
        this.occupant.body.setTranslation(top, true);
        this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    if (this.body) {
      const vel = this.body.linvel();
      const speed = Math.hypot(vel.x, vel.y, vel.z);
      const onGround = this.body.translation().y - this.halfHeight <= 0.05;
      if (onGround && speed < 0.1) {
        if (!this.locked) {
          this.locked = true;
          this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          this.body.sleep();
        }
      } else if (this.locked && speed > 0.1) {
        this.locked = false;
        this.body.wakeUp();
      }
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
    if (this.locked) {
      this.locked = false;
      this.body.wakeUp();
    }
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
