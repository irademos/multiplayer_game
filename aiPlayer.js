import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PlayerCharacter } from './characters/PlayerCharacter.js';
import { getTerrainHeight } from './water.js';

const AI_SPEED = 5 * 0.7;
const PLAYER_HALF_HEIGHT = 0.6;
const PLAYER_RADIUS = 0.3;
const KICK_RANGE = 1.8;
const KICK_COOLDOWN = 1200;
const KICK_IMPULSE = 0.3;
const KICK_AIM_SPREAD = 0.35;
const KICK_REGISTER_DELAY = 250;
const GROUND_OFFSET = PLAYER_HALF_HEIGHT + PLAYER_RADIUS;
const PLAYER_MODEL_HEIGHT_OFFSET = 0.5;
const FORMATION_X_SPACING = 4;
const FORMATION_BACK_MARGIN = 12;
const FORMATION_FRONT_MARGIN = 14;
const FORMATION_ROLE_Z_SPACING = 10;
const FORMATION_BALL_X_INFLUENCE = 0.35;
const FORMATION_ANCHOR_BALL_BLEND = 0.45;

export class AIPlayer {
  constructor(scene, rapierWorld, { spawnX = 0, spawnZ = 35, targetGoalZ = -50, color = 0xff3322, name = 'Computer' } = {}) {
    this.scene = scene;
    this.rapierWorld = rapierWorld;
    this.targetGoalZ = targetGoalZ;
    this.ownGoalZ = -targetGoalZ;

    this.character = new PlayerCharacter(name, '/models/old_man.fbx', color);
    this.model = this.character.model;
    scene.add(this.model);
    document.body.appendChild(this.character.nameLabel);

    this.lastKickTime = 0;
    this.kickAnimating = false;

    const spawnY = getTerrainHeight(spawnX, spawnZ) + GROUND_OFFSET + 0.5;
    this.model.position.set(spawnX, spawnY + PLAYER_MODEL_HEIGHT_OFFSET, spawnZ);

    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, spawnZ)
      .setLinearDamping(0.9)
      .setAngularDamping(0.9)
      .setCcdEnabled(true);
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
    const action = actions[actionName].reset().fadeIn(0.15);
    action.setEffectiveTimeScale(['mmaKick', 'hurricaneKick', 'runningKick'].includes(actionName) ? 2 : 1);
    action.play();
    this.model.userData.currentAction = actionName;
  }

  _getBallPressurePosition(ballPos) {
    // Position to approach ball from goal side so AI is behind ball relative to target.
    const backingOffset = new THREE.Vector3(0, 0, this.targetGoalZ < 0 ? 1.0 : -1.0);
    return ballPos.clone().add(backingOffset);
  }

  _getFormationPosition(ballPos, formationIndex, formationCount, chaserIndex, chaserPosition) {
    const count = Math.max(1, formationCount);
    const index = Math.max(0, Math.min(count - 1, formationIndex));
    const anchorIndex = chaserIndex ?? Math.floor((count - 1) / 2);
    const attackDir = Math.sign(this.targetGoalZ - this.ownGoalZ) || 1;
    const minZ = Math.min(this.ownGoalZ + attackDir * FORMATION_BACK_MARGIN, this.targetGoalZ - attackDir * FORMATION_FRONT_MARGIN);
    const maxZ = Math.max(this.ownGoalZ + attackDir * FORMATION_BACK_MARGIN, this.targetGoalZ - attackDir * FORMATION_FRONT_MARGIN);

    // Support players move with the play instead of parking on static field
    // thirds. Use the ball/chaser as the moving anchor, then keep each role a
    // few yards ahead or behind that anchor along the attacking direction.
    const anchorX = chaserPosition
      ? THREE.MathUtils.lerp(chaserPosition.x, ballPos.x, FORMATION_ANCHOR_BALL_BLEND)
      : ballPos.x;
    const anchorZ = chaserPosition
      ? THREE.MathUtils.lerp(chaserPosition.z, ballPos.z, FORMATION_ANCHOR_BALL_BLEND)
      : ballPos.z;
    const roleOffset = (index - anchorIndex) * FORMATION_ROLE_Z_SPACING * attackDir;
    const formationZ = THREE.MathUtils.clamp(anchorZ + roleOffset, minZ, maxZ);
    const centeredIndex = index - (count - 1) / 2;
    const laneX = centeredIndex * FORMATION_X_SPACING;
    const ballFollowX = THREE.MathUtils.clamp((ballPos.x - anchorX) * FORMATION_BALL_X_INFLUENCE, -8, 8);

    return new THREE.Vector3(anchorX + laneX + ballFollowX, ballPos.y, formationZ);
  }


  getState() {
    if (!this.body) return null;
    const t = this.body.translation();
    const v = this.body.linvel();
    return {
      position: [t.x, t.y, t.z],
      linvel: [v.x, v.y, v.z],
      rotationY: this.model.rotation.y,
      action: this.model.userData.currentAction || 'idle'
    };
  }

  applyState(state) {
    if (!state || !this.body) return;
    const [px, py, pz] = state.position || [];
    const [vx, vy, vz] = state.linvel || [];
    if (Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz)) {
      this.body.setTranslation({ x: px, y: py, z: pz }, true);
      this.model.position.set(px, py + PLAYER_MODEL_HEIGHT_OFFSET, pz);
    }
    if (Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz)) {
      this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    }
    if (Number.isFinite(state.rotationY)) {
      this.model.rotation.y = state.rotationY;
    }
    if (state.action) {
      this._playAction(state.action);
    }
  }

  update(delta, soccerBall, { pursueBall = true, formationIndex = 0, formationCount = 1, chaserIndex = null, chaserPosition = null } = {}) {
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
    this.model.position.set(t.x, t.y + PLAYER_MODEL_HEIGHT_OFFSET, t.z);

    if (this.kickAnimating) {
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);
      return;
    }

    if (distToBall < KICK_RANGE && now - this.lastKickTime > KICK_COOLDOWN) {
      // Kick ball toward the target goal, with some random inaccuracy
      this.lastKickTime = now;
      this.kickAnimating = true;

      const goalDir = new THREE.Vector3(
        -ballPos.x * 0.05 + (Math.random() * 2 - 1) * KICK_AIM_SPREAD,
        0.25 + (Math.random() * 2 - 1) * KICK_AIM_SPREAD * 0.5,
        this.targetGoalZ < 0 ? -1 : 1
      ).normalize();

      const faceDir = new THREE.Vector3().subVectors(ballPos, myPos);
      faceDir.y = 0;
      if (faceDir.length() > 0.01) {
        this.model.rotation.y = Math.atan2(faceDir.x, faceDir.z);
      }

      this._playAction('mmaKick');
      this.body.setLinvel({ x: 0, y: vel.y, z: 0 }, true);

      // Computer kicks register against the ball a bit later than the human player's
      setTimeout(() => {
        soccerBall.body.applyImpulse(
          { x: goalDir.x * KICK_IMPULSE, y: goalDir.y * KICK_IMPULSE, z: goalDir.z * KICK_IMPULSE },
          true
        );
      }, KICK_REGISTER_DELAY);

      setTimeout(() => { this.kickAnimating = false; }, 900);
      return;
    }

    const targetPos = pursueBall
      ? this._getBallPressurePosition(ballPos)
      : this._getFormationPosition(ballPos, formationIndex, formationCount, chaserIndex, chaserPosition);

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
