import * as THREE from 'three';

const ATTACKS = {
  mutantPunch: { damage: 10, range: 1.5, hitTime: 300, hitWindow: 300 },
  hurricaneKick: { damage: 15, range: 2.0, hitTime: 200, hitWindow: 200 },
  mmaKick: { damage: 12, range: 1.7, hitTime: 175, hitWindow: 150 },
  slide: { damage: 0, range: 1.8, hitTime: 50, hitWindow: 3000, ballForce: 0.55 }
};

export function updateMeleeAttacks({ playerModel, otherPlayers, audioManager }) {
  const now = Date.now();
  const players = [
    { id: 'local', model: playerModel },
    ...Object.entries(otherPlayers).map(([id, p]) => ({ id, model: p.model }))
  ];

  for (const attacker of players) {
    const info = attacker.model.userData.attack;
    if (!info) continue;
    const cfg = ATTACKS[info.name];
    if (!cfg) continue;
    const elapsed = now - info.start;
    if (elapsed >= cfg.hitTime && elapsed <= cfg.hitTime + cfg.hitWindow && !info.hasHit) {
      let hit = false;
      let playerHit = false;
      if (cfg.damage > 0) {
        for (const target of players) {
          if (target === attacker) continue;
          const dist = attacker.model.position.distanceTo(target.model.position);
          if (dist <= cfg.range) {
            hit = true;
            playerHit = true;
            if (target.id === 'local') {
              window.localHealth = Math.max(0, window.localHealth - cfg.damage);
              if (window.playerControls) {
                const dir = new THREE.Vector3().subVectors(target.model.position, attacker.model.position).normalize();
                const impulse = dir.multiplyScalar(0.15);
                window.playerControls.applyKnockback(impulse);
              }
            } else {
              const tp = otherPlayers[target.id];
              if (tp) {
                tp.health = Math.max(0, (tp.health || 100) - cfg.damage);
              }
            }
          }
        }
      }

      if (window.soccerBall?.body) {
        const ballPos = window.soccerBall.getPosition();
        if (ballPos) {
          const ballVec = new THREE.Vector3(ballPos.x, ballPos.y, ballPos.z);
          const dist = attacker.model.position.distanceTo(ballVec);
          if (dist <= cfg.range + 0.3) {
            hit = true;
            const team = attacker.id === 'local' ? 'home' : 'away';
            window.soccerBall.lastTouchedTeam = team;
            const dir = new THREE.Vector3()
              .subVectors(ballVec, attacker.model.position)
              .normalize();
            dir.y = Math.max(dir.y, 0.2);
            dir.normalize();
            const force = cfg.ballForce ?? 0.3;
            window.soccerBall.applyImpulse({ x: dir.x * force, y: dir.y * force, z: dir.z * force });
            audioManager?.playBallKick();
          }
        }
      }

      if (window.breakManager) {
        for (const [id, data] of window.breakManager.registry.entries()) {
          const center = data.center || data.object.position;
          const dist = attacker.model.position.distanceTo(center);
          if (dist <= cfg.range) {
            hit = true;
            const dir = new THREE.Vector3()
              .subVectors(center, attacker.model.position)
              .normalize();
            const impulse = dir.multiplyScalar(2);
            window.breakManager.onHit(id, cfg.damage, impulse);
            const remaining = window.breakManager.registry.get(id)?.health ?? 0;
            console.log(`🪓 ${id} health: ${remaining}`);

          }
        }
      }

      if (playerHit) {
        audioManager?.playSFX('SFX/Footsteps/Dirt/Dirt Run 1.ogg', 0.6);
      }
      if (hit) {
        info.hasHit = true;
      }
    }
    if (elapsed > cfg.hitTime + cfg.hitWindow) {
      info.hasHit = true;
    }
  }
}
