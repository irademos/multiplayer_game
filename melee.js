import * as THREE from 'three';
import { switchMonsterAnimation } from './characters/MonsterCharacter.js';

const ATTACKS = {
  mutantPunch: { damage: 10, range: 1.5, hitTime: 300, hitWindow: 300 },
  hurricaneKick: { damage: 15, range: 2.0, hitTime: 400, hitWindow: 400 },
  mmaKick: { damage: 12, range: 1.7, hitTime: 350, hitWindow: 300 }
};

export function updateMeleeAttacks({ playerModel, otherPlayers, monster }) {
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
      for (const target of players) {
        if (target === attacker) continue;
        const dist = attacker.model.position.distanceTo(target.model.position);
        if (dist <= cfg.range) {
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

      if (monster) {
        const dist = attacker.model.position.distanceTo(monster.position);
        if (dist <= cfg.range) {
          window.monsterHealth = Math.max(0, window.monsterHealth - cfg.damage);
          if (window.monsterHealth > 0 && !monster.userData.hitReacting) {
            switchMonsterAnimation(monster, "Death");
            monster.userData.hitReacting = true;
            setTimeout(() => {
              monster.userData.hitReacting = false;
            }, 100);
          }
        }
      }
      info.hasHit = true;
    }
    if (elapsed > cfg.hitTime + cfg.hitWindow) {
      info.hasHit = true;
    }
  }
}
