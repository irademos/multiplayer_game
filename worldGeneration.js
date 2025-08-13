import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export function createClouds(scene) {
  const rng = () => Math.random();

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

export const terrainChunks = new Map();

export function generateTerrainChunk(scene, chunkX, chunkZ, size = 50) {
  const isInCity = chunkX >= -1 && chunkX <= 1 && chunkZ >= -1 && chunkZ <= 1;
  if (isInCity) return;

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

  terrainChunks.set(`${chunkX},${chunkZ}`, { mesh: terrain, heightFunction });
}

export function getTerrainHeightAt(x, z) {
  const chunkSize = 50;
  const cx = Math.floor(x / chunkSize);
  const cz = Math.floor(z / chunkSize);
  const key = `${cx},${cz}`;
  const chunk = terrainChunks.get(key);
  if (!chunk) return 0;
  return chunk.heightFunction(x, z);
}

export async function createCity(scene) {
  const loader = new GLTFLoader();
  const CITY_PACK_PATH = '/areas/glb_city_pack';
  const roadGLTF = await loader.loadAsync(`${CITY_PACK_PATH}/Road Bits.glb`);
  const road_scale = 90;
  const building_scale = .3;

  const roadParts = {};
  const rootNode = roadGLTF.scene.children[0];
  rootNode.children.forEach(child => {
    if (child.isMesh) {
      roadParts[child.name] = child.clone();
    }
  });

  const straightMesh = roadParts["road_straight"].clone();
  straightMesh.scale.set(road_scale, road_scale, road_scale);
  const straightBox = new THREE.Box3().setFromObject(straightMesh);
  const spacing = new THREE.Vector3();
  straightBox.getSize(spacing);

  const cols = 20;
  const rows = 20;

  const groundWidth = cols * spacing.x;
  const groundDepth = rows * spacing.z;
  const groundGeo = new THREE.PlaneGeometry(groundWidth, groundDepth);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const buildingNames = [
    "Big Building.glb",
    "Brown Building.glb",
    "Building Green.glb",
    "Building Red.glb",
    "Building Red Corner.glb",
    "Pizza Corner.glb"
  ];

  const buildingCache = {};

  async function loadBuilding(name) {
    if (buildingCache[name]) return buildingCache[name];
    const gltf = await loader.loadAsync(`${CITY_PACK_PATH}/${name}`);
    const model = gltf.scene;
    buildingCache[name] = model;
    return model;
  }

  for (let x = 0; x < cols; x++) {
    for (let z = 0; z < rows; z++) {
      let type = null;
      let yaw = 0;

      const onX = x % 5 === 0;
      const onZ = z % 5 === 0;

      if (onX && onZ) {
        type = "road_junction";
      } else if (onX) {
        type = "road_straight";
        yaw = 0;
      } else if (onZ) {
        type = "road_straight";
        yaw = Math.PI / 2;
      }

      if (type && roadParts[type]) {
        const roadModel = roadParts[type].clone();
        roadModel.scale.set(road_scale, road_scale, road_scale);

        const posX = (x - cols / 2) * spacing.x + spacing.x / 2;
        const posZ = (z - rows / 2) * spacing.z + spacing.z / 2;
        roadModel.position.set(posX, 0, posZ);
        roadModel.rotation.set(-Math.PI / 2, 0, yaw);
        scene.add(roadModel);

        const rightVec = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

        let side_rotation = (Math.PI);

        for (let side of [-1, 1]) {
          const buildingName = buildingNames[(x * rows + z + (side + 1)) % buildingNames.length];
          const buildingScene = await loadBuilding(buildingName);
          const buildingModel = buildingScene.clone();
          buildingModel.scale.set(building_scale, building_scale, building_scale);

          const buildingBox = new THREE.Box3().setFromObject(buildingModel);
          const buildingSize = new THREE.Vector3();
          buildingBox.getSize(buildingSize);

          const offsetDistance = (spacing.x + buildingSize.z) / 2;
          const offset = rightVec.clone().multiplyScalar(side * offsetDistance);

          const buildingPos = new THREE.Vector3(posX, 0, posZ).add(offset);
          buildingModel.position.copy(buildingPos);
          buildingModel.rotation.y = yaw - (Math.PI / 2) + side_rotation;
          side_rotation = 0;
          scene.add(buildingModel);
        }
      }
    }
  }
}