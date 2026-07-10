import * as THREE from 'three';

export interface LevelData {
  root: THREE.Group;
  grappleMeshes: THREE.Object3D[];
  colliders: THREE.Box3[];
  collectibles: THREE.Mesh[];
  finish: THREE.Mesh;
  movingHazards: THREE.Group[];
  spawn: THREE.Vector3;
  finishPosition: THREE.Vector3;
}

const palette = {
  ground: 0x263746,
  buildingA: 0x6d8294,
  buildingB: 0x8799a7,
  buildingC: 0x4d6678,
  accent: 0xf7c948,
  hazard: 0xe85d5d,
  finish: 0x57e389,
};

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.88, metalness: 0.02 });
}

export function createLevel(levelNumber: number): LevelData {
  const root = new THREE.Group();
  const grappleMeshes: THREE.Object3D[] = [];
  const colliders: THREE.Box3[] = [];
  const collectibles: THREE.Mesh[] = [];
  const movingHazards: THREE.Group[] = [];

  const ground = new THREE.Mesh(new THREE.BoxGeometry(90, 2, 210), material(palette.ground));
  ground.position.set(0, -2, -82);
  root.add(ground);
  colliders.push(new THREE.Box3().setFromObject(ground));

  const addBlock = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material(color));
    mesh.position.set(x, y + sy / 2, z);
    root.add(mesh);
    grappleMeshes.push(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  };

  const spacing = levelNumber === 1 ? 20 : levelNumber === 2 ? 17 : 15;
  const rows = 10 + levelNumber * 2;

  for (let row = 0; row < rows; row += 1) {
    const z = -18 - row * spacing;
    const offset = row % 2 === 0 ? 0 : 5;
    const heightScale = 11 + ((row * 7 + levelNumber * 5) % 18);

    addBlock(-15 - offset, 0, z, 10, heightScale + 6, 11, row % 3 === 0 ? palette.buildingA : palette.buildingC);
    addBlock(15 + offset, 0, z - 5, 10, heightScale + 10, 11, row % 2 === 0 ? palette.buildingB : palette.buildingA);

    if (row % 3 === 1) {
      addBlock(0, 0, z - 8, 7, 9 + levelNumber * 2, 7, palette.buildingC);
    }
  }

  const archMaterial = material(palette.accent);
  for (let i = 0; i < 4 + levelNumber; i += 1) {
    const z = -45 - i * (35 - levelNumber * 2);
    const arch = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(2.2, 16, 2.2), archMaterial);
    const right = left.clone();
    const top = new THREE.Mesh(new THREE.BoxGeometry(18, 2.2, 2.2), archMaterial);
    left.position.set(-9, 8, 0);
    right.position.set(9, 8, 0);
    top.position.set(0, 15, 0);
    arch.position.set((i % 2) * 7 - 3.5, 0, z);
    arch.add(left, right, top);
    root.add(arch);
    grappleMeshes.push(left, right, top);
    arch.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(left), new THREE.Box3().setFromObject(right), new THREE.Box3().setFromObject(top));
  }

  for (let i = 0; i < 8 + levelNumber * 3; i += 1) {
    const collectible = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.8, 0),
      new THREE.MeshStandardMaterial({ color: palette.accent, emissive: 0x8a5d00, emissiveIntensity: 0.8, flatShading: true }),
    );
    collectible.position.set(
      Math.sin(i * 1.7) * (9 + levelNumber),
      7 + (i % 4) * 2.4,
      -28 - i * (14 - levelNumber),
    );
    collectible.userData.baseY = collectible.position.y;
    collectible.userData.phase = i * 0.65;
    root.add(collectible);
    collectibles.push(collectible);
  }

  for (let i = 0; i < levelNumber; i += 1) {
    const pivot = new THREE.Group();
    const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 1.2, 1.2), material(palette.hazard));
    pivot.add(beam);
    pivot.position.set(i % 2 === 0 ? 0 : 5, 10 + i * 2, -85 - i * 52);
    pivot.userData.speed = 0.7 + levelNumber * 0.18 + i * 0.12;
    pivot.userData.beam = beam;
    root.add(pivot);
    movingHazards.push(pivot);
  }

  const finishPosition = new THREE.Vector3(0, 11, -195 - levelNumber * 8);
  const finish = new THREE.Mesh(
    new THREE.TorusGeometry(7, 0.75, 6, 20),
    new THREE.MeshStandardMaterial({ color: palette.finish, emissive: 0x165c35, emissiveIntensity: 1.3, flatShading: true }),
  );
  finish.position.copy(finishPosition);
  finish.rotation.y = Math.PI / 2;
  root.add(finish);

  return {
    root,
    grappleMeshes,
    colliders,
    collectibles,
    finish,
    movingHazards,
    spawn: new THREE.Vector3(0, 5, 8),
    finishPosition,
  };
}
