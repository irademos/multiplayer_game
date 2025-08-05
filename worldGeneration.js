import * as THREE from "three";

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

export const terrainChunks = new Map(); // NEW

export function generateTerrainChunk(scene, chunkX, chunkZ, size = 50) {
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
