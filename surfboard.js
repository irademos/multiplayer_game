import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class Surfboard {
  constructor(scene, world, rbToMesh) {
    this.scene = scene;
    this.world = world;
    this.rbToMesh = rbToMesh;
    this.mesh = null;
    this.body = null;
    this.occupant = null;
    this.mountOffset = new THREE.Vector3(0, 0.1, 0);
    this.type = 'surfboard';
  }

  load(position = { x: 25, y: 0, z: 0 }) {
    const geometry = new THREE.BoxGeometry(2, 0.1, 0.5);
    const material = new THREE.MeshStandardMaterial({ color: 0xffe0bd });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.castShadow = true;
    this.scene.add(this.mesh);

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

    const colDesc = RAPIER.ColliderDesc.cuboid(1, 0.05, 0.25)
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
    }
  }

  dismount() {
    if (!this.occupant) return;
    this.occupant.vehicle = null;
    this.occupant = null;
  }

  applyInput(moveVec) {
    if (!this.body) return;
    const speed = 8; // Surfing speed
    const vel = moveVec.clone().multiplyScalar(speed);
    this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
  }

  update() {
    if (this.occupant && this.body) {
      const t = this.body.translation();
      const top = { x: t.x, y: t.y + 0.1, z: t.z };
      this.occupant.playerModel.position.set(top.x, top.y, top.z);
      if (this.occupant.body) {
        this.occupant.body.setTranslation(top, true);
        this.occupant.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      const actions = this.occupant.playerModel.userData.actions;
      const current = this.occupant.playerModel.userData.currentAction;
      if (actions && current !== 'swim') {
        actions[current]?.fadeOut(0.2);
        actions['swim']?.reset().fadeIn(0.2).play();
        this.occupant.playerModel.userData.currentAction = 'swim';
      }
    }
  }
}

