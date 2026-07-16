import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

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

export function createClouds(scene) {
  const rng = getSeededRandom("clouds");

  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    opacity: 0.95,
    transparent: true,
    roughness: 0.9,
    metalness: 0.0,
    emissive: 0xcccccc,
    emissiveIntensity: 0.2,
  });

  for (let i = 0; i < 20; i++) {
    const cloudGroup = new THREE.Group();
    const puffCount = 3 + Math.floor(rng() * 5);
    for (let j = 0; j < puffCount; j++) {
      const puffSize = 2 + rng() * 3;
      const puffGeometry = new THREE.SphereGeometry(puffSize, 7, 7);
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
      puff.position.x = (rng() - 0.5) * 5;
      puff.position.y = (rng() - 0.5) * 2;
      puff.position.z = (rng() - 0.5) * 5;
      cloudGroup.add(puff);
    }
    const angle = rng() * Math.PI * 2;
    const distance = 20 + rng() * 60;
    cloudGroup.position.x = Math.cos(angle) * distance;
    cloudGroup.position.z = Math.sin(angle) * distance;
    cloudGroup.position.y = 20 + rng() * 15;
    cloudGroup.rotation.y = rng() * Math.PI * 2;
    scene.add(cloudGroup);
  }
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

  // Blade geometry: thin quad standing upright along Y
  const W = 0.06;
  const H = 0.28;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -W, 0, 0,
     W, 0, 0,
     W, H, 0,
    -W, H, 0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
  ]), 2));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));

  const uniforms = { time: { value: 0 } };
  _grassUniforms = uniforms;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute mat4 instanceMatrix;

      uniform float time;

      varying float vUvY;

      void main() {
        vUvY = uv.y;

        vec3 transformed = position;
        // use instance world X/Z for spatially varying wind
        vec3 wPos = vec3(instanceMatrix[3]);
        float wind =
          sin(wPos.x * 2.0 + time * 2.0) * 0.08 +
          cos(wPos.z * 1.5 + time * 1.6) * 0.05;
        transformed.x += wind * uv.y;

        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vUvY;

      void main() {
        vec3 rootColor = vec3(0.08, 0.38, 0.08);
        vec3 tipColor  = vec3(0.28, 0.65, 0.18);
        gl_FragColor = vec4(mix(rootColor, tipColor, vUvY), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const COUNT = 16000;
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < COUNT; i++) {
    dummy.position.set(
      (rng() - 0.5) * FIELD_WIDTH,
      0,
      (rng() - 0.5) * FIELD_LENGTH,
    );
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(0.8 + rng() * 0.7, 0.7 + rng() * 0.8, 1);
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

  // Stands (4 sides)
  const standGap = 4;
  // Long sides — split each into a blue half (−Z, blue team's side) and a red half (+Z, red team's side)
  const longStandLen = FIELD_LENGTH + 4;
  const halfStandLen = longStandLen / 2;
  const halfStandZ   = longStandLen / 4;
  for (const [cx, rotY] of [
    [ FIELD_WIDTH / 2 + standGap + STAND_DEPTH / 2,  Math.PI / 2],
    [-(FIELD_WIDTH / 2 + standGap + STAND_DEPTH / 2), -Math.PI / 2],
  ]) {
    addStand(scene, rapierWorld, cx, -halfStandZ, rotY, halfStandLen, STAND_DEPTH, STAND_HEIGHT, BLUE);
    addStand(scene, rapierWorld, cx,  halfStandZ, rotY, halfStandLen, STAND_DEPTH, STAND_HEIGHT, RED);
  }
  // Short ends
  const shortStandLen = FIELD_WIDTH + (STAND_DEPTH + standGap) * 2 + 4;
  addStand(scene, rapierWorld, 0, FIELD_LENGTH / 2 + standGap + STAND_DEPTH / 2, 0, shortStandLen, STAND_DEPTH, STAND_HEIGHT);
  addStand(scene, rapierWorld, 0, -(FIELD_LENGTH / 2 + standGap + STAND_DEPTH / 2), Math.PI, shortStandLen, STAND_DEPTH, STAND_HEIGHT, BLUE);
}