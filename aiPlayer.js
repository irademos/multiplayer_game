import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PlayerCharacter } from './characters/PlayerCharacter.js';
import { getTerrainHeight } from './water.js';

const AI_SPEED = 5;
const PLAYER_HALF_HEIGHT = 0.6;
const PLAYER_RADIUS = 0.3;
const KICK_RANGE = 1.8;
const KICK_COOLDOWN = 1200;
const KICK_IMPULSE = 20;
const GROUND_OFFSET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;

export class AIPlayer {
  constructor(scene, rapierWorld, { spawnZ = 35, targetGoalZ = -50 } = {}) {
    this.scene = scene;
    this.rapierWorld = rapierWorld;
    this.targetGoalZ = targetGoalZ;

    this.character = new PlayerCharacter('Computer', '/models/old_man.fbx');
    this.model = this.character.model;
    scene.add(this.model);
    document.body.appendChild(this.character.nameLabel);

    this.lastKickTime = 0;
    this.kickAnimating = false;

    const spawnX = 0;
    const spawnY = getTerrainHeight(spawnX, spawnZ) + GROUND_OFFSET + 0.5;
    this.model.position.set(spawnX, spawnY, spawnZ);

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, spawnZ)
      .setLinearDamping(0.9)
      .setAngularDamping(0.9);
    this.body = rapierWorld.createRigidBody(rbDesc);
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.capsule(PLAYER_HALF_HEIGHT, PLAYER_RADIUS).setRestitution(0).setFriction(1),
      this.body
    );
  }

  _playAction(actionName) {
    const actions = this.model.userData.actions;
    if (!actions?.[actionName]) return;
    const current = this.model.userData.currentAction;
    if (current === actionName && !['mmaKick', 'mutantPunch'].includes(actionName)) return;
    actions[current]?.fadeOut(0.15);
    actions[actionName].reset().fadeIn(0.15).play();
    this.model.userData.currentAction = actionName;
  }

  update(delta, soccerBall) {
    if (!this.body) return;

    const mixer = this.model.userData.mixer;
    if (mixer) mixer.update(delta);

    const t = this.body.translation();
    const vel = this.body.linvel();

    // Keep grounded
    const terrainY = getTerrainHeight(t.x, t.z);
    const groundY = terrainY + GROUND_OFFSET;
    if (t.y < groundY) {
      this.body.setTranslation({ x: t.x, y: groundY, z: t.z }, true);
      if (vel.y < 0) this.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);
      t.y = groundY;
    }

    const rawBallPos = soccerBall?.getPosition?.();
    if (!rawBallPos) return;
    const ballPos = new THREE.Vector3(rawBallPos.x, rawBallPos.y, rawBallPos.z);

    const myPos = new THREE.Vector3(t.x, t.y, t.z);
    const distToBall = myPos.distanceTo(ballPos);
    const now = Date.now();

    // Sync model to physics
    this.model.position.set(t.x, t.y, t.z);

    if (this.kickAnimating) {
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      return;
    }

    if (distToBall < KICK_RANGE && now - this.lastKickTime > KICK_COOLDOWN) {
      // Kick ball toward the target goal
      this.lastKickTime = now;
      this.kickAnimating = true;

      const goalDir = new THREE.Vector3(
        -ballPos.x * 0.05,
        0.25,
        this.targetGoalZ < 0 ? -1 : 1
      ).normalize();

      soccerBall.body.applyImpulse(
        { x: goalDir.x * KICK_IMPULSE, y: goalDir.y * KICK_IMPULSE, z: goalDir.z * KICK_IMPULSE },
        true
      );

      const faceDir = new THREE.Vector3().subVectors(ballPos, myPos);
      faceDir.y = 0;
      if (faceDir.length() > 0.01) {
        this.model.rotation.y = Math.atan2(faceDir.x, faceDir.z);
      }

      this._playAction('mmaKick');
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);

      setTimeout(() => { this.kickAnimating = false; }, 900);
      return;
    }

    // Position to approach ball from goal side so AI is behind ball relative to target
    const backingOffset = new THREE.Vector3(0, 0, this.targetGoalZ < 0 ? 1.0 : -1.0);
    const targetPos = ballPos.clone().add(backingOffset);

    const moveDir = new THREE.Vector3(targetPos.x - t.x, 0, targetPos.z - t.z);
    const dist = moveDir.length();

    if (dist > 0.5) {
      moveDir.normalize();
      this.body.setLinvel({ x: moveDir.x * AI_SPEED, y: vel.y, z: moveDir.z * AI_SPEED }, true);
      this.model.rotation.y = Math.atan2(moveDir.x, moveDir.z);
      this._playAction('run');
    } else {
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      this._playAction('idle');
    }
  }
}
