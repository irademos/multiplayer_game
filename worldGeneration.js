import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DEFAULT_WORLD_SEED = 0x5f3759df;
let currentWorldSeed = DEFAULT_WORLD_SEED;

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 0x1a2b3c4d;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeedValue(seed, label) {
  let hash = seed >>> 0;
  const text = String(label ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return seed >>> 0;
  }
  if (typeof seed === "string") {
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    }
    return hash >>> 0;
  }
  return DEFAULT_WORLD_SEED;
}

function getSeededRandom(label) {
  return createSeededRandom(hashSeedValue(currentWorldSeed, label));
}

export function setWorldSeed(seed) {
  currentWorldSeed = normalizeSeed(seed);
}

export function createClouds(_scene) {
  // clouds removed
}

export const MOON_RADIUS = 70;

export function createMoon(scene, rapierWorld, rbToMesh) {
  const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 32, 32);
  const moonMaterial = new THREE.MeshStandardMaterial({ color: 0xdddddd });
  const moon = new THREE.Mesh(moonGeometry, moonMaterial);
  moon.position.set(0, 200, -30);
  moon.rotation.set(0, 0, 0);
  moon.quaternion.set(0, 0, 0, 1);
  moon.matrixAutoUpdate = false;
  moon.updateMatrix();
  scene.add(moon);
  window.moon = moon;

  if (rapierWorld) {
    const rb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(
        moon.position.x,
        moon.position.y,
        moon.position.z
      )
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.ball(MOON_RADIUS),
      rb
    );
    // Intentionally omit mapping to rbToMesh to keep the moon stationary
  }

  return moon;
}

// Soccer field dimensions (in world units)
const FIELD_LENGTH = 100; // along Z axis
const FIELD_WIDTH = 60;   // along X axis
const STAND_HEIGHT = 8;
const STAND_DEPTH = 10;
const GOAL_WIDTH = 10;
const GOAL_HEIGHT = 3;
const GOAL_DEPTH = 2;

function addGoal(scene, zSign, rapierWorld, color = 0xffffff) {
  const postMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 });
  const postR = 0.12;
  const halfGoal = GOAL_WIDTH / 2;
  const zPos = zSign * (FIELD_LENGTH / 2);

  // Two vertical posts
  for (const xOff of [-halfGoal, halfGoal]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(postR, postR, GOAL_HEIGHT, 8),
      postMat
    );
    post.position.set(xOff, GOAL_HEIGHT / 2, zPos);
    post.castShadow = true;
    scene.add(post);

    if (rapierWorld) {
      const rb = rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(xOff, GOAL_HEIGHT / 2, zPos)
      );
      rapierWorld.createCollider(
        RAPIER.ColliderDesc.cylinder(GOAL_HEIGHT / 2, postR),
        rb
      );
    }
  }

  // Crossbar
  const crossbar = new THREE.Mesh(
    new THREE.CylinderGeometry(postR, postR, GOAL_WIDTH, 8),
    postMat
  );
  crossbar.rotation.z = Math.PI / 2;
  crossbar.position.set(0, GOAL_HEIGHT, zPos);
  crossbar.castShadow = true;
  scene.add(crossbar);

  if (rapierWorld) {
    // Rotate 90° around Z to make the cylinder lie along the X axis
    const sinZ = Math.sin(Math.PI / 4);
    const cosZ = Math.cos(Math.PI / 4);
    const rb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(0, GOAL_HEIGHT, zPos)
        .setRotation({ x: 0, y: 0, z: sinZ, w: cosZ })
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cylinder(GOAL_WIDTH / 2, postR),
      rb
    );
  }

  // Net (back plane)
  const netMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(GOAL_WIDTH, GOAL_HEIGHT),
    netMat
  );
  net.position.set(0, GOAL_HEIGHT / 2, zPos + zSign * GOAL_DEPTH);
  net.rotation.y = zSign > 0 ? 0 : Math.PI;
  scene.add(net);
}

function addFieldLine(scene, x, z, width, depth, y = 0.01, color = 0xffffff) {
  const lineMat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), lineMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  scene.add(mesh);
}

function addStand(scene, rapierWorld, cx, cz, rotY, length, depth, height, seatColor = 0xcc2222) {
  const standMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.9 });
  const seatMat = new THREE.MeshStandardMaterial({ color: seatColor, roughness: 0.8 });

  // Inclined seating block
  const group = new THREE.Group();
  group.position.set(cx, 0, cz);
  group.rotation.y = rotY;

  // Stepped tiers (3 tiers)
  const tiers = 4;
  for (let t = 0; t < tiers; t++) {
    const tierH = height / tiers;
    const tierD = depth / tiers;
    const w = length;
    const h = tierH * (t + 1);
    const d = tierD;
    const zOff = -depth / 2 + tierD * t + tierD / 2;

    const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), standMat);
    back.position.set(0, h / 2, zOff);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);

    // Seat strip on top
    const seat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, tierD * 0.6), seatMat);
    seat.position.set(0, h + 0.05, zOff);
    group.add(seat);
  }

  scene.add(group);

  // Physics collider for the stand base
  if (rapierWorld) {
    const sinH = Math.sin(rotY / 2);
    const cosH = Math.cos(rotY / 2);
    const rb = rapierWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(cx, height / 2, cz)
        .setRotation({ x: 0, y: sinH, z: 0, w: cosH })
    );
    rapierWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(length / 2, height / 2, depth / 2),
      rb
    );
  }
}

let _grassUniforms = null;

export function updateGrass(time) {
  if (_grassUniforms) _grassUniforms.time.value = time;
}

function createGrassBladesOnField(scene) {
  const rng = getSeededRandom("grass");

  // Tapered triangle blade (tip at top)
  const W = 0.035;
  const H = 0.32;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -W,   0, 0,
     W,   0, 0,
     0.0, H, 0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0.5, 1,
  ]), 2));
  geo.setIndex([0, 1, 2]);

  const COUNT = 40000;
  const STRIPE_DEPTH = FIELD_LENGTH / 10; // matches stripeCount in generateSoccerField

  // Generate positions first so color can be stripe-aligned
  const bladeX = new Float32Array(COUNT);
  const bladeZ = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    bladeX[i] = (rng() - 0.5) * FIELD_WIDTH;
    bladeZ[i] = (rng() - 0.5) * FIELD_LENGTH;
  }

  // Per-instance color — base hue follows the field stripe the blade sits in
  const colorData = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const stripeIdx = Math.floor((bladeZ[i] + FIELD_LENGTH / 2) / STRIPE_DEPTH) % 2;
    // Light stripe matches 0x2d8a2d, dark stripe matches 0x267a26
    const rBase = stripeIdx === 0 ? 0.18 : 0.15;
    const gBase = stripeIdx === 0 ? 0.52 : 0.46;
    colorData[i * 3 + 0] = rBase + rng() * 0.06;
    colorData[i * 3 + 1] = gBase + rng() * 0.10;
    colorData[i * 3 + 2] = 0.12  + rng() * 0.05;
  }
  geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorData, 3));

  const uniforms = { time: { value: 0 } };
  _grassUniforms = uniforms;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      uniform float time;
      attribute vec3 instanceColor;
      varying vec2 vUv;
      varying vec3 vColor;

      void main() {
        vUv = uv;
        vColor = instanceColor;

        vec3 transformed = position;

        // taper: narrow toward tip
        float taper = mix(1.0, 0.15, uv.y);
        transformed.x *= taper;

        // multi-wave wind — spatially varied, less synchronized
        vec3 wPos = vec3(instanceMatrix[3]);
        float wind =
          sin(wPos.x * 1.6 + time * 1.9) * 0.06 +
          sin(wPos.z * 2.3 + time * 2.6) * 0.04 +
          sin((wPos.x + wPos.z) * 0.8 + time * 1.1) * 0.03;

        // quadratic bend: tip moves most
        float bend = uv.y * uv.y;
        transformed.x += wind * bend;
        transformed.z += wind * 0.25 * bend;

        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vColor;

      void main() {
        vec3 rootColor = vec3(0.08, 0.38, 0.08);
        vec3 col = mix(rootColor, vColor, vUv.y);

        // fade near tip edges so blade visually narrows
        float edge = abs(vUv.x - 0.5) * 2.0;
        float alpha = 1.0 - smoothstep(0.7, 1.0, edge);
        alpha *= smoothstep(1.0, 0.75, vUv.y);

        if (alpha < 0.3) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.3,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < COUNT; i++) {
    dummy.position.set(bladeX[i], 0, bladeZ[i]);
    // random yaw + small random lean
    dummy.rotation.set(
      (rng() - 0.5) * 0.3,
      rng() * Math.PI * 2,
      (rng() - 0.5) * 0.3,
    );
    // width and height variation
    dummy.scale.set(
      0.5 + rng() * 0.8,
      0.7 + rng() * 0.9,
      1,
    );
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

export function generateSoccerField(scene, rapierWorld) {
  // Flat base ground panels (field lines sit on these)
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x2d8a2d, roughness: 0.95 });
  const grassAlt = new THREE.MeshStandardMaterial({ color: 0x267a26, roughness: 0.95 });

  // Main pitch — alternating stripe panels
  const stripeCount = 10;
  const stripeDepth = FIELD_LENGTH / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(FIELD_WIDTH, stripeDepth),
      i % 2 === 0 ? grassMat : grassAlt
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0, -FIELD_LENGTH / 2 + stripeDepth * i + stripeDepth / 2);
    stripe.receiveShadow = true;
    scene.add(stripe);
  }

  createGrassBladesOnField(scene);

  // Surround — darker ground beyond the pitch
  const surroundMat = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 });
  const totalSize = 300;
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(totalSize, totalSize), surroundMat);
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(0, -0.01, 0);
  surround.receiveShadow = true;
  scene.add(surround);

  const LT = 0.35; // line thickness
  const BLUE = 0x3399ff;
  const RED  = 0xff3322;

  // Touchlines (long sides) — split at halfway: blue on home (-Z) half, red on away (+Z) half
  for (const xPos of [FIELD_WIDTH / 2, -FIELD_WIDTH / 2]) {
    addFieldLine(scene, xPos, -FIELD_LENGTH / 4, LT, FIELD_LENGTH / 2, 0.01, BLUE);
    addFieldLine(scene, xPos,  FIELD_LENGTH / 4, LT, FIELD_LENGTH / 2, 0.01, RED);
  }

  // Goal lines
  addFieldLine(scene, 0,  FIELD_LENGTH / 2, FIELD_WIDTH, LT, 0.01, RED);   // away (+Z) side
  addFieldLine(scene, 0, -FIELD_LENGTH / 2, FIELD_WIDTH, LT, 0.01, BLUE);  // home (-Z) side

  // Halfway line — two full-width parallel lines: blue on blue team's side (−Z), red on red team's side (+Z)
  addFieldLine(scene, 0, -LT, FIELD_WIDTH, LT, 0.01, BLUE);
  addFieldLine(scene, 0,  LT, FIELD_WIDTH, LT, 0.01, RED);

  // Centre circle — blue on home (−Z) half, red on away (+Z) half
  const circleR = 9.15;
  const segments = 48;
  const circleBlueMat = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.8 });
  const circleRedMat  = new THREE.MeshStandardMaterial({ color: RED,  roughness: 0.8 });
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const x0 = Math.cos(a0) * circleR, z0 = Math.sin(a0) * circleR;
    const x1 = Math.cos(a1) * circleR, z1 = Math.sin(a1) * circleR;
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const mat = mz < 0 ? circleBlueMat : circleRedMat;
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(segLen, LT), mat);
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = -ang;
    seg.position.set(mx, 0.01, mz);
    scene.add(seg);
  }

  // Centre spot (white)
  const circleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), circleMat);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, 0.01, 0);
  scene.add(spot);

  // Penalty areas — colored to match team side
  const paWidth = 40.32, paDepth = 16.5;
  for (const zSign of [-1, 1]) {
    const paColor = zSign > 0 ? RED : BLUE;
    const zCenter = zSign * (FIELD_LENGTH / 2 - paDepth / 2);
    addFieldLine(scene, 0, zSign * FIELD_LENGTH / 2 - zSign * paDepth, paWidth, LT, 0.01, paColor);
    addFieldLine(scene, paWidth / 2, zCenter, LT, paDepth, 0.01, paColor);
    addFieldLine(scene, -paWidth / 2, zCenter, LT, paDepth, 0.01, paColor);
  }

  // Goals — blue for home (-Z), red for away (+Z)
  addGoal(scene,  1, rapierWorld, RED);
  addGoal(scene, -1, rapierWorld, BLUE);

}
const _sceneryLoader = new GLTFLoader();

function loadGLTF(url) {
  return new Promise((resolve, reject) => _sceneryLoader.load(url, resolve, undefined, reject));
}

const building1_scale = 0.04;
const building2_scale = 1.5;
const building3_scale = 0.02;
const building4_scale = 0.02;
const building5_scale = 0.02;
const pine_scale = 0.08;

export async function addSceneryProps(scene) {
  // field: X -30..+30, Z -50..+50; props placed outside this boundary
  const placements = [
    // ── Left side (x negative) ──
    { url: '/assets/props/coconut_tree.glb',            x: -55, z: -30, s: 6,   r: 0.5  },
    { url: '/assets/props/coconut_tree.glb',            x: -62, z:   5, s: 7,   r: 1.2  },
    { url: '/assets/props/coconut_tree.glb',            x: -56, z:  35, s: 5.5, r: 2.1  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x: -68, z: -20, s: pine_scale,   r: 0.3  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x: -72, z:  22, s: pine_scale,   r: 1.8  },
    { url: '/assets/props/fantasy_house.glb',           x: -78, z: -12, s: building1_scale,   r: 0.8  },
    { url: '/assets/props/fantasy_house.glb',           x: -82, z:  30, s: building1_scale,   r: -0.3 },
    { url: '/assets/props/medieval_building_002.glb',   x: -88, z:   0, s: building3_scale,   r: -0.5 },
    { url: '/assets/props/medieval_building_004.glb',   x: -90, z: -35, s: building4_scale,   r: 0.5  },

    // ── Right side (x positive) ──
    { url: '/assets/props/coconut_tree.glb',            x:  57, z: -25, s: 6.5, r: 2.5  },
    { url: '/assets/props/coconut_tree.glb',            x:  60, z:  15, s: 5,   r: 0.8  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x:  70, z: -35, s: pine_scale, r: 2.0  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x:  74, z:  28, s: pine_scale,   r: 0.5  },
    { url: '/assets/props/fantasy_house (1).glb',       x:  80, z:   8, s: building2_scale,   r: -0.8 },
    { url: '/assets/props/fantasy_house (1).glb',       x:  85, z: -22, s: building2_scale,   r: 0.4  },
    { url: '/assets/props/medieval_building_004.glb',   x:  90, z:  22, s: building4_scale,   r: -1.0 },
    { url: '/assets/props/medieval_building_005.glb',   x:  88, z: -50, s: building5_scale,   r: 0.7  },

    // ── North end (z negative) ──
    { url: '/assets/props/coconut_tree.glb',            x: -20, z: -72, s: 6,   r: 1.0  },
    { url: '/assets/props/coconut_tree.glb',            x:  25, z: -76, s: 5.5, r: 2.8  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x: -42, z: -78, s: pine_scale,   r: 1.5  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x:  38, z: -70, s: pine_scale, r: 0.9  },
    { url: '/assets/props/fantasy_house.glb',           x:  15, z: -68, s: building1_scale,   r: 1.2  },
    { url: '/assets/props/medieval_building_005.glb',   x:   0, z: -85, s: building5_scale,   r: 0.0  },
    { url: '/assets/props/medieval_building_002.glb',   x: -50, z: -70, s: building3_scale,   r: 1.0  },

    // ── South end (z positive) ──
    { url: '/assets/props/coconut_tree.glb',            x: -15, z:  70, s: 6,   r: 3.0  },
    { url: '/assets/props/coconut_tree.glb',            x:  30, z:  72, s: 7,   r: 0.6  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x: -40, z:  80, s: pine_scale,   r: 1.2  },
    { url: '/assets/props/stylized_pine_tree_tree.glb', x:  45, z:  75, s: pine_scale,   r: 2.5  },
    { url: '/assets/props/fantasy_house (1).glb',       x: -28, z:  70, s: building2_scale,   r: 2.0  },
    { url: '/assets/props/fantasy_house (1).glb',       x:  20, z:  80, s: building2_scale,   r: -0.5 },
    { url: '/assets/props/medieval_building_002.glb',   x:   0, z:  88, s: building3_scale,   r: 0.0  },
    { url: '/assets/props/medieval_building_005.glb',   x:  55, z:  72, s: building5_scale,   r: -0.8 },
  ];

  const cache = new Map();
  for (const p of placements) {
    if (!cache.has(p.url)) {
      try {
        const gltf = await loadGLTF(p.url);
        cache.set(p.url, gltf.scene);
      } catch (e) {
        console.warn('addSceneryProps: failed to load', p.url, e);
        continue;
      }
    }
    const clone = cache.get(p.url).clone(true);
    clone.position.set(p.x, 0, p.z);
    clone.rotation.y = p.r;
    clone.scale.setScalar(p.s);
    clone.traverse(child => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    scene.add(clone);
  }
}

function cloneSkinnedModel(source) {
  const clone = source.clone(true);
  // Remap SkinnedMesh bones to the cloned skeleton so animations work independently
  const sourceBones = [];
  const cloneBones = [];
  source.traverse(n => { if (n.isBone) sourceBones.push(n); });
  clone.traverse(n => { if (n.isBone) cloneBones.push(n); });
  clone.traverse(n => {
    if (n.isSkinnedMesh) {
      const remapped = n.skeleton.bones.map(b => {
        const idx = sourceBones.indexOf(b);
        return idx !== -1 ? cloneBones[idx] : b;
      });
      n.skeleton = new THREE.Skeleton(remapped, n.skeleton.boneInverses);
      n.bind(n.skeleton);
    }
  });
  return clone;
}

export async function addFans(scene) {
  const fanPositions = [
    // Left sideline
    { x: -36, z: -30 }, { x: -38, z: -10 }, { x: -36, z:  10 },
    { x: -38, z:  30 }, { x: -40, z:  -45 }, { x: -36, z:  45 },
    // Right sideline
    { x:  36, z: -25 }, { x:  38, z:   5  }, { x:  36, z:  25 },
    { x:  38, z: -45 }, { x:  36, z:  45  }, { x:  40, z: -10 },
    // Behind goals (north)
    { x: -15, z: -55 }, { x:   0, z: -57 }, { x:  15, z: -55 },
    // Behind goals (south)
    { x: -15, z:  55 }, { x:   0, z:  57 }, { x:  15, z:  55 },
  ];

  const mixers = [];
  let gltf;
  try {
    gltf = await loadGLTF('/models/fans/the_green_wizard_gnome_n64_style.glb');
  } catch (e) {
    console.warn('addFans: failed to load fan model', e);
    return mixers;
  }

  const fanScale = 0.02;
  const animName = 'Wizard_Gnome_Armature|idle';

  for (const pos of fanPositions) {
    const model = cloneSkinnedModel(gltf.scene);
    model.position.set(pos.x, 0, pos.z);
    model.scale.setScalar(fanScale);
    // model.rotation.y = 
    model.rotation.x = Math.PI / 2;
    model.rotation.z = -Math.atan2(-pos.x, -pos.z);
    model.traverse(child => { if (child.isMesh) child.castShadow = true; });
    scene.add(model);

    if (gltf.animations && gltf.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      const clip = THREE.AnimationClip.findByName(gltf.animations, animName) ?? gltf.animations[0];
      mixer.clipAction(clip).play();
      mixers.push(mixer);
    }
  }
  return mixers;
}
