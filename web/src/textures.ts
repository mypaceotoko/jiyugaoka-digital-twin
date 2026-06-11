import * as THREE from "three";

/**
 * Procedural facade textures (no asset downloads, mobile-friendly).
 * One tile = one window cell (~3.2 m x 3.2 m of wall).
 */
export interface FacadeTextures {
  map: THREE.Texture;
  emissiveMap: THREE.Texture;
}

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return [c, c.getContext("2d")!];
}

export function makeFacadeTextures(): FacadeTextures {
  const S = 128;

  // base wall with one window
  const [wallC, wall] = makeCanvas(S);
  wall.fillStyle = "#ffffff";
  wall.fillRect(0, 0, S, S);
  // subtle horizontal floor line
  wall.fillStyle = "rgba(0,0,0,0.08)";
  wall.fillRect(0, S - 4, S, 4);
  // window: frame + glass
  const wx = S * 0.22, wy = S * 0.2, ww = S * 0.56, wh = S * 0.5;
  wall.fillStyle = "#9b9b96";
  wall.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
  const glass = wall.createLinearGradient(0, wy, 0, wy + wh);
  glass.addColorStop(0, "#6f7c86");
  glass.addColorStop(1, "#4d575f");
  wall.fillStyle = glass;
  wall.fillRect(wx, wy, ww, wh);
  // mullion
  wall.fillStyle = "#9b9b96";
  wall.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);

  const map = new THREE.CanvasTexture(wallC);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  // emissive: some windows lit (warm), rest dark — drawn on a larger tile
  // (4x4 cells) so the lit pattern varies across the facade
  const E = S * 4;
  const [emiC, emi] = makeCanvas(E);
  emi.fillStyle = "#000000";
  emi.fillRect(0, 0, E, E);
  for (let cy = 0; cy < 4; cy++) {
    for (let cx = 0; cx < 4; cx++) {
      if (Math.random() < 0.45) continue; // dark window
      const ox = cx * S, oy = cy * S;
      const warm = 200 + Math.floor(Math.random() * 55);
      emi.fillStyle = `rgb(${warm},${Math.floor(warm * 0.82)},${Math.floor(warm * 0.5)})`;
      emi.fillRect(ox + wx, oy + wy, ww, wh);
    }
  }
  const emissiveMap = new THREE.CanvasTexture(emiC);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  // emissive tile covers 4x4 wall cells
  emissiveMap.repeat.set(0.25, 0.25);

  return { map, emissiveMap };
}

/** Ground-floor storefront strip: glass front + awning band (tinted by vertex color). */
export function makeStorefrontTextures(): FacadeTextures {
  const W = 256, H = 128;
  const [c, g] = makeCanvas(W);
  c.height = H;
  // wall base
  g.fillStyle = "#f2f0ea";
  g.fillRect(0, 0, W, H);
  // awning band (top 22%) — near-white so vertex color tints it
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H * 0.22);
  g.fillStyle = "rgba(0,0,0,0.10)";
  for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 8, H * 0.22); // awning stripes
  // glass front
  const gy = H * 0.26, gh = H * 0.62;
  g.fillStyle = "#5a6670";
  g.fillRect(6, gy, W - 12, gh);
  const grad = g.createLinearGradient(0, gy, 0, gy + gh);
  grad.addColorStop(0, "rgba(255,255,255,0.28)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.05)");
  grad.addColorStop(1, "rgba(0,0,0,0.18)");
  g.fillStyle = grad;
  g.fillRect(6, gy, W - 12, gh);
  // mullions + door
  g.fillStyle = "#3c4248";
  for (let x = 64; x < W; x += 64) g.fillRect(x - 2, gy, 4, gh);
  g.fillRect(W / 2 - 14, gy + gh * 0.25, 28, gh * 0.75);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  // emissive: warm glow from the glass area
  const [ec, eg] = makeCanvas(W);
  ec.height = H;
  eg.fillStyle = "#000000";
  eg.fillRect(0, 0, W, H);
  eg.fillStyle = "#ffd9a0";
  eg.fillRect(6, gy, W - 12, gh);
  eg.fillStyle = "rgba(0,0,0,0.45)";
  for (let x = 64; x < W; x += 64) eg.fillRect(x - 2, gy, 4, gh);
  const emissiveMap = new THREE.CanvasTexture(ec);
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}

/** Subtle gray noise for the ground plane (breaks up flat shading). */
export function makeGroundTexture(): THREE.Texture {
  const S = 256;
  const [c, g] = makeCanvas(S);
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 232 + Math.floor(Math.random() * 18) - 9;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v - 3;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(56, 56);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Warm brick-paver tile for the greenway promenade. */
export function makePaverTexture(): THREE.Texture {
  const S = 128;
  const [c, g] = makeCanvas(S);
  g.fillStyle = "#b9a890";
  g.fillRect(0, 0, S, S);
  const colors = ["#c4b29a", "#b39f86", "#bfa98c", "#ad9a82", "#c9b8a2", "#a8927a"];
  const bw = S / 4, bh = S / 8;
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let col = -1; col < 5; col++) {
      g.fillStyle = colors[(row * 5 + col + 6) % colors.length];
      g.fillRect(col * bw + off + 1, row * bh + 1, bw - 2, bh - 2);
    }
  }
  // mortar joints darkening
  g.fillStyle = "rgba(60,50,40,0.18)";
  for (let row = 0; row <= 8; row++) g.fillRect(0, row * bh - 1, S, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Floating text label (e.g. station name). */
export function makeLabelSprite(text: string, sub?: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.lineWidth = 8;
  g.strokeStyle = "rgba(10,14,30,0.85)";
  g.fillStyle = "#ffffff";
  g.font = "bold 72px 'Hiragino Sans', 'Noto Sans JP', sans-serif";
  g.strokeText(text, 256, 78);
  g.fillText(text, 256, 78);
  if (sub) {
    g.font = "500 34px 'Hiragino Sans', sans-serif";
    g.strokeText(sub, 256, 130);
    g.fillText(sub, 256, 130);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }),
  );
  sprite.scale.set(48, 15, 1);
  return sprite;
}
