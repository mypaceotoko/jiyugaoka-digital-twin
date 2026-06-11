import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { benchGeometry } from "./greenway";
import { makeClockTexture, makePaverTexture } from "./textures";

/**
 * 自由が丘駅 正面口ロータリー — hand-detailed station plaza:
 * circular paved square, green centre island with a clock tower
 * (the meeting-spot symbol of the square), shelters, benches,
 * crossings and bollards.
 */

// front rotary, see docs/area-definition.md (35.6081 N, 139.6685 E)
const CENTER = new THREE.Vector3(-45, 0, -67);
const PLAZA_R = 21;

export function buildStationFront(): THREE.Group {
  const group = new THREE.Group();
  group.name = "stationFront";
  group.position.copy(CENTER);
  const dummy = new THREE.Object3D();

  // --- paved plaza disc ---
  const paver = makePaverTexture();
  paver.repeat.set(14, 14);
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_R, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: paver, color: 0xd8d4cc }),
  );
  plaza.position.y = 0.08;
  plaza.receiveShadow = true;
  group.add(plaza);

  // --- rotary lane ring (asphalt) ---
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PLAZA_R * 0.42, PLAZA_R * 0.8, 48).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x4a4c51 }),
  );
  ring.position.y = 0.09;
  ring.receiveShadow = true;
  group.add(ring);

  // --- green centre island ---
  const island = new THREE.Mesh(
    new THREE.CircleGeometry(PLAZA_R * 0.4, 32).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x76a05a }),
  );
  island.position.y = 0.1;
  island.receiveShadow = true;
  group.add(island);

  const curb = new THREE.Mesh(
    new THREE.TorusGeometry(PLAZA_R * 0.4, 0.14, 6, 40).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xb8b4aa }),
  );
  curb.position.y = 0.12;
  group.add(curb);

  // flower ring on the island
  const flowerGeo = new THREE.IcosahedronGeometry(0.22, 0);
  flowerGeo.translate(0, 0.28, 0);
  const flowers = new THREE.InstancedMesh(
    flowerGeo,
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    26,
  );
  const fc = new THREE.Color();
  const palette = [0xe46a7e, 0xf2f0e4, 0xd9534f, 0xe8a3b8];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const r = PLAZA_R * 0.4 - 0.9;
    dummy.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    dummy.scale.setScalar(0.8 + (i % 3) * 0.2);
    dummy.rotation.set(0, a, 0);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    fc.setHex(palette[i % palette.length]);
    flowers.setColorAt(i, fc);
  }
  group.add(flowers);

  // --- clock tower (meeting spot) ---
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 5.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.4 }),
  );
  pole.position.y = 2.6;
  pole.castShadow = true;
  group.add(pole);
  const clockTex = makeClockTexture();
  const clockBox = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.05, 0.4),
    [
      new THREE.MeshLambertMaterial({ color: 0x3c4046 }),
      new THREE.MeshLambertMaterial({ color: 0x3c4046 }),
      new THREE.MeshLambertMaterial({ color: 0x3c4046 }),
      new THREE.MeshLambertMaterial({ color: 0x3c4046 }),
      new THREE.MeshLambertMaterial({ map: clockTex }),
      new THREE.MeshLambertMaterial({ map: clockTex }),
    ],
  );
  clockBox.position.y = 5.6;
  clockBox.castShadow = true;
  group.add(clockBox);
  const cap = new THREE.Mesh(
    new THREE.ConeGeometry(0.8, 0.5, 4),
    new THREE.MeshLambertMaterial({ color: 0x2e5d46 }),
  );
  cap.position.y = 6.4;
  group.add(cap);

  // --- shelters (taxi / bus waiting) ---
  const shelterParts: THREE.BufferGeometry[] = [];
  for (const ang of [Math.PI * 0.15, Math.PI * 0.75]) {
    const sx = Math.cos(ang) * (PLAZA_R * 0.88);
    const sz = Math.sin(ang) * (PLAZA_R * 0.88);
    const roof = new THREE.BoxGeometry(4.2, 0.14, 2.2);
    roof.translate(sx, 2.5, sz);
    shelterParts.push(roof);
    for (const [px, pz] of [[-1.9, -0.95], [1.9, -0.95], [-1.9, 0.95], [1.9, 0.95]]) {
      const post = new THREE.CylinderGeometry(0.05, 0.05, 2.5, 5);
      post.translate(sx + px, 1.25, sz + pz);
      shelterParts.push(post);
    }
  }
  const shelters = new THREE.Mesh(
    mergeGeometries(shelterParts, false)!,
    new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.45, metalness: 0.35 }),
  );
  shelterParts.forEach((g) => g.dispose());
  shelters.castShadow = true;
  group.add(shelters);

  // --- benches around the island ---
  const benches = new THREE.InstancedMesh(
    benchGeometry(),
    new THREE.MeshLambertMaterial({ color: 0x7a5b3e }),
    5,
  );
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const r = PLAZA_R * 0.4 + 1.1;
    dummy.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
    dummy.rotation.set(0, -a + Math.PI / 2, 0); // back to the island, facing outward
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    benches.setMatrixAt(i, dummy.matrix);
  }
  benches.castShadow = true;
  group.add(benches);

  // --- bollards along the plaza edge (with gaps for the road mouths) ---
  const bollardGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.75, 6);
  bollardGeo.translate(0, 0.45, 0);
  const bollardAngles: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    // leave openings toward the station (east) and the two approach streets
    if (Math.abs(a - 0) < 0.45 || Math.abs(a - Math.PI * 0.5) < 0.35 || Math.abs(a - Math.PI * 1.4) < 0.35) continue;
    bollardAngles.push(a);
  }
  const bollards = new THREE.InstancedMesh(
    bollardGeo,
    new THREE.MeshLambertMaterial({ color: 0x55534e }),
    bollardAngles.length,
  );
  bollardAngles.forEach((a, i) => {
    dummy.position.set(Math.cos(a) * (PLAZA_R - 0.6), 0.08, Math.sin(a) * (PLAZA_R - 0.6));
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    bollards.setMatrixAt(i, dummy.matrix);
  });
  group.add(bollards);

  // --- zebra crossings at the road mouths ---
  const stripeGeos: THREE.BufferGeometry[] = [];
  for (const a of [0, Math.PI * 0.5, Math.PI * 1.4]) {
    const cx = Math.cos(a) * (PLAZA_R + 3.2);
    const cz = Math.sin(a) * (PLAZA_R + 3.2);
    for (let k = -2; k <= 2; k++) {
      const stripe = new THREE.PlaneGeometry(0.45, 3.6).rotateX(-Math.PI / 2);
      // stripes run across the road mouth, fanned around the plaza
      stripe.rotateY(-a);
      stripe.translate(
        cx + Math.cos(a + Math.PI / 2) * k * 0.95,
        0.1,
        cz + Math.sin(a + Math.PI / 2) * k * 0.95,
      );
      stripeGeos.push(stripe);
    }
  }
  const crossings = new THREE.Mesh(
    mergeGeometries(stripeGeos, false)!,
    new THREE.MeshLambertMaterial({ color: 0xdedcd4 }),
  );
  stripeGeos.forEach((g) => g.dispose());
  crossings.receiveShadow = true;
  group.add(crossings);

  return group;
}
