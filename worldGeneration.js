import * as THREE from "three";
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const themeGrid = new Map(); // keys: "x,z" → "themeName"
const loadedThemes = {
  glb_kenney_fantasy_town: [
    "balcony-wall-fence.glb",
    "balcony-wall.glb",
    "banner-green.glb",
    "banner-red.glb",
    "blade.glb",
    "cart-high.glb",
    "cart.glb",
    "chimney-base.glb",
    "chimney-top.glb",
    "chimney.glb",
    "fence-broken.glb",
    "fence-curved.glb",
    "fence-gate.glb",
    "fence.glb",
    "fountain-center.glb",
    "fountain-corner-inner-square.glb",
    "fountain-corner-inner.glb",
    "fountain-corner.glb",
    "fountain-curved.glb",
    "fountain-edge.glb",
    "fountain-round-detail.glb",
    "fountain-round.glb",
    "fountain-square-detail.glb",
    "fountain-square.glb",
    "hedge-curved.glb",
    "hedge-gate.glb",
    "hedge-large-curved.glb",
    "hedge-large-gate.glb",
    "hedge-large.glb",
    "hedge.glb",
    "lantern.glb",
    "overhang.glb",
    "pillar-stone.glb",
    "pillar-wood.glb",
    "planks-half.glb",
    "planks-opening.glb",
    "planks.glb",
    "poles-horizontal.glb",
    "poles.glb",
    "road-bend.glb",
    "road-corner-inner.glb",
    "road-corner.glb",
    "road-curb-end.glb",
    "road-curb.glb",
    "road-edge-slope.glb",
    "road-edge.glb",
    "road-slope.glb",
    "road.glb",
    "rock-large.glb",
    "rock-small.glb",
    "rock-wide.glb",
    "roof-corner-inner.glb",
    "roof-corner-round.glb",
    "roof-corner.glb",
    "roof-flat.glb",
    "roof-gable-detail.glb",
    "roof-gable-end.glb",
    "roof-gable-top.glb",
    "roof-gable.glb",
    "roof-high-corner-round.glb",
    "roof-high-corner.glb",
    "roof-high-cornerinner.glb",
    "roof-high-flat.glb",
    "roof-high-gable-detail.glb",
    "roof-high-gable-end.glb",
    "roof-high-gable-top.glb",
    "roof-high-gable.glb",
    "roof-high-left.glb",
    "roof-high-point.glb",
    "roof-high-right.glb",
    "roof-high-window.glb",
    "roof-high.glb",
    "roof-left.glb",
    "roof-point.glb",
    "roof-right.glb",
    "roof-window.glb",
    "roof.glb",
    "stairs-full-corner-inner.glb",
    "stairs-full-corner-outer.glb",
    "stairs-full.glb",
    "stairs-stone-corner.glb",
    "stairs-stone-handrail.glb",
    "stairs-stone-round.glb",
    "stairs-stone.glb",
    "stairs-wide-stone-handrail.glb",
    "stairs-wide-stone.glb",
    "stairs-wide-wood-handrail.glb",
    "stairs-wide-wood.glb",
    "stairs-wood-handrail.glb",
    "stairs-wood.glb",
    "stall-bench.glb",
    "stall-green.glb",
    "stall-red.glb",
    "stall-stool.glb",
    "stall.glb",
    "tree-crooked.glb",
    "tree-high-crooked.glb",
    "tree-high-round.glb",
    "tree-high.glb",
    "tree.glb",
    "wall-arch-top-detail.glb",
    "wall-arch-top.glb",
    "wall-arch.glb",
    "wall-block-half.glb",
    "wall-block.glb",
    "wall-broken.glb",
    "wall-corner-detail.glb",
    "wall-corner-diagonal-half.glb",
    "wall-corner-diagonal.glb",
    "wall-corner-edge.glb",
    "wall-corner.glb",
    "wall-curved.glb",
    "wall-detail-cross.glb",
    "wall-detail-diagonal.glb",
    "wall-detail-horizontal.glb",
    "wall-diagonal.glb",
    "wall-door.glb",
    "wall-doorway-base.glb",
    "wall-doorway-round.glb",
    "wall-doorway-square-wide-curved.glb",
    "wall-doorway-square-wide.glb",
    "wall-doorway-square.glb",
    "wall-half.glb",
    "wall-rounded.glb",
    "wall-side.glb",
    "wall-slope.glb",
    "wall-window-glass.glb",
    "wall-window-round.glb",
    "wall-window-shutters.glb",
    "wall-window-small.glb",
    "wall-window-stone.glb",
    "wall-wood-arch-top-detail.glb",
    "wall-wood-arch-top.glb",
    "wall-wood-arch.glb",
    "wall-wood-block-half.glb",
    "wall-wood-block.glb",
    "wall-wood-broken.glb",
    "wall-wood-corner-diagonal-half.glb",
    "wall-wood-corner-diagonal.glb",
    "wall-wood-corner-edge.glb",
    "wall-wood-corner.glb",
    "wall-wood-curved.glb",
    "wall-wood-detail-cross.glb",
    "wall-wood-detail-diagonal.glb",
    "wall-wood-detail-horizontal.glb",
    "wall-wood-diagonal.glb",
    "wall-wood-door.glb",
    "wall-wood-doorway-base.glb",
    "wall-wood-doorway-round.glb",
    "wall-wood-doorway-square-wide-curved.glb",
    "wall-wood-doorway-square-wide.glb",
    "wall-wood-doorway-square.glb",
    "wall-wood-half.glb",
    "wall-wood-rounded.glb",
    "wall-wood-side.glb",
    "wall-wood-slope.glb",
    "wall-wood-window-glass.glb",
    "wall-wood-window-round.glb",
    "wall-wood-window-shutters.glb",
    "wall-wood-window-small.glb",
    "wall-wood-window-stone.glb",
    "wall-wood.glb",
    "wall.glb",
    "watermill-wide.glb",
    "watermill.glb",
    "wheel.glb",
    "windmill.glb"
  ]
};
let availableThemes = [
  'glb_kenney_fantasy_town'
];
let activeThemeAreaSize = 5; // size of themed zone

// Simple seeded random number generator
class MathRandom {
  constructor(seed) {
    this.seed = seed;
  }
  
  random() {
    const x = Math.sin(this.seed++) * 10000;
    return x - Math.floor(x);
  }
}


export const townTemplate = {
  center: "fountain-round.glb",

  walls: [
    "wall.glb", "wall-window.glb", "wall-door.glb", "wall-block.glb",
    "wall-half.glb", "wall-corner.glb", "wall-curved.glb",
    "wall-wood.glb", "wall-wood-window-shutters.glb", "wall-wood-door.glb"
  ],

  roofs: [
    "roof.glb", "roof-gable.glb", "roof-high.glb", "roof-high-point.glb",
    "roof-flat.glb", "roof-high-window.glb", "roof-window.glb"
  ],

  stairs: [
    "stairs-wood.glb", "stairs-wide-wood.glb", "stairs-stone.glb", "stairs-wide-stone.glb"
  ],

  stalls: [
    "stall.glb", "stall-red.glb", "stall-green.glb", "stall-stool.glb", "stall-bench.glb"
  ],

  fences: [
    "fence.glb", "fence-broken.glb", "fence-gate.glb", "fence-curved.glb"
  ],

  trees: [
    "tree.glb", "tree-high.glb", "tree-crooked.glb"
  ],

  decor: [
    "banner-red.glb", "banner-green.glb", "lantern.glb", "cart.glb",
    "planks.glb", "planks-half.glb", "planks-opening.glb", "wheel.glb",
    "pillar-wood.glb", "pillar-stone.glb", "rock-small.glb", "rock-wide.glb"
  ],

  roadPieces: [
    "road.glb", "road-bend.glb", "road-corner.glb", "road-curb.glb"
  ]
};

const prefabCache = new Map();
const glbLoader = new GLTFLoader();

// Load and measure a single GLB
async function loadAndMeasureGLB(path) {
  console.log("path", path);
  return new Promise(resolve => {
    glbLoader.load(path, gltf => {
      const model = gltf.scene;
      console.log("model", model);
      const box = new THREE.Box3().setFromObject(model);
      console.log("box", box);
      const size = new THREE.Vector3();
      box.getSize(size);
      resolve({ model, size });
    });
  });
}

export async function createPrefabHouse(themeFolder, wallName, roofName, doorName, sizeInWalls = 4) {
  const basePath = `areas/${themeFolder}/`;
  const group = new THREE.Group();

  const wall = await loadAndMeasureGLB(basePath + wallName);
  const roof = await loadAndMeasureGLB(basePath + roofName);
  const door = await loadAndMeasureGLB(basePath + doorName);

  const wallW = wall.size.x;
  const wallH = wall.size.y;
  const wallD = wall.size.z;

  // Build four walls in a square layout
  for (let side = 0; side < 4; side++) {
    const angle = (Math.PI / 2) * side;
    const isFrontBack = side % 2 === 0;

    for (let y = 0; y < sizeInWalls; y++) {
      for (let x = 0; x < sizeInWalls; x++) {
        const clone = wall.model.clone(true);
        const posX = isFrontBack ? (x - sizeInWalls / 2) * wallW : (side === 1 ? sizeInWalls / 2 * wallW : -sizeInWalls / 2 * wallW);
        const posZ = isFrontBack ? (side === 0 ? -sizeInWalls / 2 * wallW : sizeInWalls / 2 * wallW) : (x - sizeInWalls / 2) * wallW;
        const posY = y * wallH + wallH / 2;

        clone.position.set(posX, posY, posZ);
        clone.rotation.y = angle;
        group.add(clone);
      }
    }
  }

  // Place a door on front wall (middle x, bottom row)
  const doorClone = door.model.clone(true);
  const doorOffsetX = 0;
  const doorOffsetY = door.size.y / 2;
  const doorOffsetZ = -sizeInWalls / 2 * wallW - door.size.z / 2;
  doorClone.position.set(doorOffsetX, doorOffsetY, doorOffsetZ);
  group.add(doorClone);

  // Add roof on top
  const roofClone = roof.model.clone(true);
  const roofY = wallH * sizeInWalls + roof.size.y / 2;
  roofClone.position.set(0, roofY, 0);
  group.add(roofClone);

  // Optional: stairs in front
  const stairName = townTemplate.stairs[Math.floor(Math.random() * townTemplate.stairs.length)];
  const stair = await loadAndMeasureGLB(basePath + stairName);
  const stairClone = stair.model.clone(true);
  const stairY = stair.size.y / 2;
  stairClone.position.set(0, stairY, doorOffsetZ - stair.size.z - 0.1);
  group.add(stairClone);

  prefabCache.set(`${wallName}_${roofName}_${doorName}_w${sizeInWalls}`, group);
  return group;
}


// Place multiple prefab houses in a town layout
export async function placePrefabTown(scene, chunkX, chunkZ, size, themeFolder) {
  const spacing = 30;
  const centerX = chunkX * size + size / 2;
  const centerZ = chunkZ * size + size / 2;
  const positions = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],         [1,  0],
    [-1,  1], [0,  1], [1,  1]
  ];

  for (const [gx, gz] of positions) {
    const wall = townTemplate.walls[Math.floor(Math.random() * townTemplate.walls.length)];
    const roof = townTemplate.roofs[Math.floor(Math.random() * townTemplate.roofs.length)];
    const door = "wall-door.glb";

    const size = [4, 5, 6][Math.floor(Math.random() * 3)];
    const prefab = await createPrefabHouse(themeFolder, wall, roof, door, size);

    const clone = prefab.clone(true);
    const x = centerX + gx * spacing;
    const z = centerZ + gz * spacing;
    const y = getTerrainHeightAt(centerX, centerZ);
    clone.position.set(x, y, z);
    scene.add(clone);
  }
}


export function createBarriers(scene) {
  // Use a deterministic random number generator based on a fixed seed
  const barrierSeed = 12345; // Fixed seed for deterministic generation
  let rng = new MathRandom(barrierSeed);
  
  // Create colorful mushrooms instead of gray barriers
  const mushroomColors = [
    0xFF5252, // Red
    0xFFEB3B, // Yellow
    0x2196F3, // Blue
    0x9C27B0, // Purple
    0x4CAF50, // Green
    0xFF9800  // Orange
  ];
  
  // Create some random mushrooms
  for (let i = 0; i < 25; i++) {  
    const scale = 0.8 + rng.random() * 1.5;
    
    // Create mushroom group
    const mushroom = new THREE.Group();
    
    // Random color for cap
    const capColor = mushroomColors[Math.floor(rng.random() * mushroomColors.length)];
    const capMaterial = new THREE.MeshStandardMaterial({ 
      color: capColor,
      roughness: 0.7,
      metalness: 0.1
    });
    
    // Create stem
    const stemHeight = (1 + rng.random() * 2) * scale;
    const stemRadius = (0.3 + rng.random() * 0.2) * scale;
    const stemGeometry = new THREE.CylinderGeometry(stemRadius * 0.8, stemRadius * 1.1, stemHeight, 8);
    const stemMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFFFDE7, // Cream color
      roughness: 0.8,
      metalness: 0.1
    });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = stemHeight / 2;
    stem.castShadow = true;
    stem.receiveShadow = true;
    mushroom.add(stem);
    
    // Create cap
    const capRadius = (0.8 + rng.random() * 0.6) * scale;
    const capHeight = (0.5 + rng.random() * 0.3) * scale;
    const capGeometry = new THREE.SphereGeometry(capRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.rotation.x = Math.PI;
    cap.position.y = stemHeight;
    cap.castShadow = true;
    cap.receiveShadow = true;
    mushroom.add(cap);
    
    // Add spots to cap for some mushrooms
    if (rng.random() > 0.4) {
      const spotCount = 3 + Math.floor(rng.random() * 5);
      const spotMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFFFFFF,
        roughness: 0.7,
        metalness: 0.1
      });
      
      for (let j = 0; j < spotCount; j++) {
        const spotSize = capRadius * 0.15;
        const spotGeometry = new THREE.SphereGeometry(spotSize, 8, 8);
        const spot = new THREE.Mesh(spotGeometry, spotMaterial);
        
        // Position on the cap surface
        const spotAngle = rng.random() * Math.PI * 2;
        const spotRadius = rng.random() * capRadius * 0.7;
        spot.position.set(
          Math.cos(spotAngle) * spotRadius,
          stemHeight + capHeight * 0.4,
          Math.sin(spotAngle) * spotRadius
        );
        mushroom.add(spot);
      }
    }
    
    // Random position, but not too close to center
    const angle = rng.random() * Math.PI * 2;
    const distance = 10 + rng.random() * 40;  
    mushroom.position.x = Math.cos(angle) * distance;
    mushroom.position.z = Math.sin(angle) * distance;
    
    mushroom.userData.isBarrier = true;
    
    scene.add(mushroom);
  }
  
  // Add decorative pillars throughout the scene
  const pillarCount = 15;
  for (let i = 0; i < pillarCount; i++) {
    const angle = rng.random() * Math.PI * 2;
    const distance = 10 + rng.random() * 40;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    
    // Create giant mushrooms as pillars
    const scale = 2 + rng.random() * 3;
    const mushroom = new THREE.Group();
    
    // Random vibrant color
    const capColor = mushroomColors[Math.floor(rng.random() * mushroomColors.length)];
    const capMaterial = new THREE.MeshStandardMaterial({ 
      color: capColor,
      roughness: 0.7,
      metalness: 0.2
    });
    
    // Create tall stem
    const stemHeight = (2 + rng.random() * 15);
    const stemRadius = 0.8 + rng.random() * 0.6;
    const stemGeometry = new THREE.CylinderGeometry(stemRadius * 0.8, stemRadius * 1.2, stemHeight, 8);
    const stemMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFFFDE7, // Cream color
      roughness: 0.8,
      metalness: 0.1
    });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = stemHeight / 2;
    stem.castShadow = true;
    stem.receiveShadow = true;
    mushroom.add(stem);
    
    // Create cap
    const capRadius = stemRadius * 2;
    const capGeometry = new THREE.SphereGeometry(capRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const cap = new THREE.Mesh(capGeometry, capMaterial);
    cap.rotation.x = Math.PI;
    cap.position.y = stemHeight;
    cap.scale.set(1.5, 1.0, 1.5); // Slightly oval cap
    cap.castShadow = true;
    cap.receiveShadow = true;
    mushroom.add(cap);
    
    // Add spots to cap
    const spotCount = 5 + Math.floor(rng.random() * 8);
    const spotMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xFFFFFF,
      roughness: 0.7,
      metalness: 0.1
    });
    
    for (let j = 0; j < spotCount; j++) {
      const spotSize = capRadius * 0.15;
      const spotGeometry = new THREE.SphereGeometry(spotSize, 8, 8);
      const spot = new THREE.Mesh(spotGeometry, spotMaterial);
      
      // Position on the cap surface
      const spotAngle = rng.random() * Math.PI * 2;
      const spotRadius = rng.random() * capRadius * 0.7;
      spot.position.set(
        Math.cos(spotAngle) * spotRadius * 1.5, // Adjust for oval shape
        stemHeight + capRadius * 0.3,
        Math.sin(spotAngle) * spotRadius * 1.5 // Adjust for oval shape
      );
      mushroom.add(spot);
    }
    
    mushroom.position.set(x, 0, z);
    mushroom.userData.isBarrier = true;
    
    scene.add(mushroom);
  }
}
export function createTrees(scene) {
  // Use a deterministic random number generator for consistent tree placement
  const treeSeed = 54321; // Different seed than barriers
  let rng = new MathRandom(treeSeed);
  
  // Tree trunk materials (varying browns)
  const trunkMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.9, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ color: 0x6B4423, roughness: 0.9, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ color: 0x5D4037, roughness: 0.8, metalness: 0.1 })
  ];
  
  // Tree leaves materials (varying greens)
  const leavesMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x2E8B57, roughness: 0.8, metalness: 0.0 }),
    new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.8, metalness: 0.0 }),
    new THREE.MeshStandardMaterial({ color: 0x006400, roughness: 0.7, metalness: 0.0 })
  ];
  
  // Create different types of trees
  for (let i = 0; i < 30; i++) {  
    // Select random materials
    const trunkMaterial = trunkMaterials[Math.floor(rng.random() * trunkMaterials.length)];
    const leavesMaterial = leavesMaterials[Math.floor(rng.random() * leavesMaterials.length)];
    
    // Create tree group
    const tree = new THREE.Group();
    
    // Create tree trunk
    const trunkHeight = 5 + rng.random() * 7;
    const trunkRadius = 0.3 + rng.random() * 0.3;
    const trunkGeometry = new THREE.CylinderGeometry(trunkRadius * 0.8, trunkRadius * 1.2, trunkHeight, 8);
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);
    
    // Determine tree type (pine or broad-leaf)
    const isPine = rng.random() > 0.5;
    
    if (isPine) {
      // Pine tree (multiple cones stacked)
      const layers = 2 + Math.floor(rng.random() * 3);
      const baseRadius = trunkRadius * 6;
      const layerHeight = trunkHeight * 0.4;
      
      for (let j = 0; j < layers; j++) {
        const layerRadius = baseRadius * (1 - j * 0.2);
        const coneGeometry = new THREE.ConeGeometry(layerRadius, layerHeight, 8);
        const cone = new THREE.Mesh(coneGeometry, leavesMaterial);
        cone.position.y = trunkHeight * 0.5 + j * (layerHeight * 0.6);
        cone.castShadow = true;
        cone.receiveShadow = true;
        tree.add(cone);
      }
    } else {
      // Broad-leaf tree (ellipsoidQuestion of and also a sphere
      const leafShape = rng.random() > 0.5 ? 'ellipsoid' : 'sphere';
      const leavesRadius = trunkRadius * (4 + rng.random() * 2);
      
      if (leafShape === 'ellipsoid') {
        // Create ellipsoid using scaled sphere
        const leavesGeometry = new THREE.SphereGeometry(leavesRadius, 8, 8);
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.position.y = trunkHeight * 0.7;
        leaves.scale.set(1, 1.2 + rng.random() * 0.5, 1);
        leaves.castShadow = true;
        leaves.receiveShadow = true;
        tree.add(leaves);
      } else {
        // Create multiple spheres for a more natural canopy
        const sphereCount = 2 + Math.floor(rng.random() * 3);
        for (let j = 0; j < sphereCount; j++) {
          const sphereSize = leavesRadius * (0.7 + rng.random() * 0.5);
          const leavesGeometry = new THREE.SphereGeometry(sphereSize, 8, 8);
          const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
          leaves.position.y = trunkHeight * 0.7;
          leaves.position.x = (rng.random() - 0.5) * trunkRadius * 2;
          leaves.position.z = (rng.random() - 0.5) * trunkRadius * 2;
          leaves.castShadow = true;
          leaves.receiveShadow = true;
          tree.add(leaves);
        }
      }
    }
    
    // Random position, avoiding center area and existing barriers
    const angle = rng.random() * Math.PI * 2;
    const distance = 15 + rng.random() * 40;  
    tree.position.x = Math.cos(angle) * distance;
    tree.position.z = Math.sin(angle) * distance;
    
    // Add some random rotation and scale variation
    tree.rotation.y = rng.random() * Math.PI * 2;
    const treeScale = 0.8 + rng.random() * 0.5;
    tree.scale.set(treeScale, treeScale, treeScale);
    
    // Add custom property for collision detection - move barrier detection to the whole tree instead
    tree.userData.isTree = true;
    tree.userData.isBarrier = true;
    
    scene.add(tree);
  }
}
export function createClouds(scene) {
  const cloudSeed = 67890; // Different seed for clouds
  let rng = new MathRandom(cloudSeed);
  
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, // Pure white
    opacity: 0.95, // Slightly increased opacity
    transparent: true,
    roughness: 0.9, // Increased roughness to make it less shiny
    metalness: 0.0,
    emissive: 0xcccccc, // Add slight emissive color to make it brighter
    emissiveIntensity: 0.2 // Subtle emission to enhance whiteness
  });
  
  for (let i = 0; i < 20; i++) {
    const cloudGroup = new THREE.Group();
    
    // Create cloud with multiple spheres
    const puffCount = 3 + Math.floor(rng.random() * 5);
    for (let j = 0; j < puffCount; j++) {
      const puffSize = 2 + rng.random() * 3;
      const puffGeometry = new THREE.SphereGeometry(puffSize, 7, 7);
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
      
      puff.position.x = (rng.random() - 0.5) * 5;
      puff.position.y = (rng.random() - 0.5) * 2;
      puff.position.z = (rng.random() - 0.5) * 5;
      
      cloudGroup.add(puff);
    }
    
    // Position the cloud
    const angle = rng.random() * Math.PI * 2;
    const distance = 20 + rng.random() * 60;
    cloudGroup.position.x = Math.cos(angle) * distance;
    cloudGroup.position.z = Math.sin(angle) * distance;
    cloudGroup.position.y = 20 + rng.random() * 15;
    
    // Random rotation
    cloudGroup.rotation.y = rng.random() * Math.PI * 2;
    
    // Add to scene
    scene.add(cloudGroup);
  }
}

function loadThemeAssets(themeName) {
  const fileNames = loadedThemes[themeName] || [];
  return fileNames.map(name => `areas/${themeName}/${name}`);
}

export const terrainChunks = new Map(); // NEW

export async function generateTerrainChunk(scene, chunkX, chunkZ, size = 50) {
  const heightFunction = (x, z) => {
    return Math.sin(x * 0.1) * Math.cos(z * 0.1) * 2;
  };

  const geometry = new THREE.PlaneGeometry(size, size, 32, 32);
  geometry.rotateX(-Math.PI / 2);

  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i) + chunkX * size;
    const z = vertices.getZ(i) + chunkZ * size;
    const y = heightFunction(x, z);
    vertices.setY(i, y);
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ color: 0x77cc77 });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.position.set(chunkX * size, 0, chunkZ * size);
  scene.add(terrain);

  // Store the terrain data for elevation lookup
  terrainChunks.set(`${chunkX},${chunkZ}`, { mesh: terrain, heightFunction });

  // random assets from areas
  const zoneX = Math.floor(chunkX / activeThemeAreaSize);
  const zoneZ = Math.floor(chunkZ / activeThemeAreaSize);
  const zoneKey = `${zoneX},${zoneZ}`;

  if (!themeGrid.has(zoneKey)) {
    // ↓ Less frequent buffer zones
    const isBuffer = (Math.abs(zoneX) + Math.abs(zoneZ)) % 5 === 0;
    if (isBuffer) {
      themeGrid.set(zoneKey, null);
    } else {
      console.log("here");
      console.log(availableThemes);
      
      const themeName = availableThemes[Math.floor(Math.random() * availableThemes.length)];
      console.log("themeName", themeName);
      themeGrid.set(zoneKey, themeName);
    }
  }

  const theme = themeGrid.get(zoneKey);

  if (theme) {
    // placeTownChunk(scene, chunkX, chunkZ, size, theme);
    placePrefabTown(scene, chunkX, chunkZ, size, theme);
  }

}

export function getTerrainHeightAt(x, z) {
  const chunkSize = 50;
  const cx = Math.floor(x / chunkSize);
  const cz = Math.floor(z / chunkSize);
  const key = `${cx},${cz}`;

  const chunk = terrainChunks.get(key);
  if (!chunk) return 0; // Default if not loaded

  const { heightFunction } = chunk;
  return heightFunction(x, z);
}


function addDirtPath(scene, chunkX, chunkZ, size, rng) {
  const path = new THREE.Group();
  const segments = 10;
  for (let i = 0; i < segments; i++) {
    const x = (chunkX * size) + rng.random() * size;
    const z = (chunkZ * size) + rng.random() * size;
    const y = getTerrainHeightAt(x, z) + 0.01;

    const radius = 0.7 + rng.random() * 0.5;
    const geo = new THREE.CircleGeometry(radius, 12);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const circle = new THREE.Mesh(geo, mat);
    circle.position.set(x, y, z);
    circle.receiveShadow = true;
    path.add(circle);
  }
  scene.add(path);
}

function addTreesToChunk(scene, chunkX, chunkZ, size, rng) {
  const treeCount = 3 + Math.floor(rng.random() * 5);
  for (let i = 0; i < treeCount; i++) {
    const x = chunkX * size + rng.random() * size;
    const z = chunkZ * size + rng.random() * size;
    const y = getTerrainHeightAt(x, z);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x228B22 });

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.2, 1),
      trunkMat
    );
    trunk.position.set(x, y + 0.5, z);

    const leaves = new THREE.Mesh(
      new THREE.SphereGeometry(0.5 + rng.random() * 0.3),
      leavesMat
    );
    leaves.position.set(x, y + 1.2, z);

    trunk.userData.isBarrier = true;
    leaves.userData.isBarrier = true;

    scene.add(trunk);
    scene.add(leaves);
  }
}

function addBuildingsToChunk(scene, chunkX, chunkZ, size, rng) {
  if (rng.random() > 0.5) return;

  const x = chunkX * size + rng.random() * size;
  const z = chunkZ * size + rng.random() * size;
  const y = getTerrainHeightAt(x, z);

  const building = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2 + rng.random() * 2, 2),
    new THREE.MeshStandardMaterial({ color: 0xCCCCCC })
  );
  building.position.set(x, y + 1, z);
  building.userData.isBarrier = true;
  building.castShadow = true;
  building.receiveShadow = true;
  scene.add(building);
}