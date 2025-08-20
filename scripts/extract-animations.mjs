// scripts/extract-animations.mjs
import fs from "fs/promises";
import fse from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

import { AnimationClip, Object3D } from "three";
import { FBXLoader } from "three-stdlib";

import { JSDOM } from "jsdom";
import { createCanvas, Image } from "canvas";

const { window } = new JSDOM();
global.window = window;
global.document = window.document;
global.Image = Image;
global.HTMLImageElement = Image;

// --- BEGIN: minimal DOM shims for Node ---
// Provide a browser-ish global so FBXLoader's image parsing doesn't crash.
// We don't actually need real images for extracting AnimationClips.

globalThis.window = globalThis; // simplest alias

// URL + createObjectURL
if (!globalThis.URL) globalThis.URL = {};
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => "";

// Basic document facade
if (!globalThis.document) {
  globalThis.document = {
    createElement: (tag) => {
      // only image/canvas are ever touched
      if (tag === "img" || tag === "image") {
        const img = {};
        // FBXLoader sets onload/onerror then assigns src
        Object.defineProperty(img, "src", {
          set(_) { setImmediate(() => img.onload && img.onload()); }
        });
        return img;
      }
      if (tag === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext: () => null,
          toBlob: (cb) => cb && cb(new Blob()),
        };
      }
      return {};
    }
  };
}

// Image constructor
if (!globalThis.Image) {
  globalThis.Image = class {
    constructor() { this.onload = null; this.onerror = null; }
    set src(_) { setImmediate(() => this.onload && this.onload()); }
  };
}

// createImageBitmap stub (not strictly required for FBX, but harmless)
if (!globalThis.createImageBitmap) {
  globalThis.createImageBitmap = async () => ({});
}

// Blob stub (rarely touched, but safe)
if (!globalThis.Blob) {
  globalThis.Blob = class Blob {};
}
// --- END: minimal DOM shims for Node ---


// --- config ---
const INPUT_DIR  = process.argv[2] || "./fbx";      // folder with your Mixamo FBX files
const OUT_DIR    = process.argv[3] || "./out";      // output root
const BASE_NAME  = process.argv[4] || null;         // optional: exact FBX filename to use as base
// ---------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

async function loadFBXFromDisk(filePath) {
  const loader = new FBXLoader();
  // Read file into ArrayBuffer and parse directly (avoids FileLoader/fetch in Node)
  const raw = await fs.readFile(filePath);
  return new Promise((resolve, reject) => {
    loader.parse(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      path.dirname(filePath) + "/",
      (obj) => resolve(obj),
      (err) => reject(err)
    );
  });
}

function hasMesh(o) {
  let found = false;
  o.traverse(n => { if (n.isMesh) found = true; });
  return found;
}

function getBones(root) {
  const bones = [];
  root.traverse(n => { if (n.isBone) bones.push(n.name); });
  return bones;
}

function sanitizeClipName(name) {
  // Mixamo often prefixes "mixamorig:" or has bar-delimited names; normalize
  return String(name)
    .replace(/^mixamorig[:|]/i, "")
    .replace(/\|/g, "_")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function main() {
  await fse.ensureDir(OUT_DIR);
  const animOutDir = path.join(OUT_DIR, "anims");
  const baseOutDir = path.join(OUT_DIR, "base");
  await fse.ensureDir(animOutDir);
  await fse.ensureDir(baseOutDir);

  const entries = (await fs.readdir(INPUT_DIR))
    .filter(f => f.toLowerCase().endsWith(".fbx"))
    .map(f => path.join(INPUT_DIR, f));

  if (entries.length === 0) {
    console.error(`No FBX files found in: ${INPUT_DIR}`);
    process.exit(1);
  }

  // Determine base FBX
  let basePath = null;
  if (BASE_NAME) {
    const candidate = path.join(INPUT_DIR, BASE_NAME);
    const exists = await fse.pathExists(candidate);
    if (!exists) {
      console.error(`BASE_NAME specified but not found: ${candidate}`);
      process.exit(1);
    }
    basePath = candidate;
  } else {
    // pick the first FBX that has a mesh (common for Mixamo model+anim files)
    console.log(entries);
    for (const p of entries) {
        try {
            console.log(p);
            const fbx = await loadFBXFromDisk(p);
            console.log(fbx);
            // NEW: print summary so we see what FBXLoader found
            const meshCount = (() => { let n=0; fbx.traverse(o=>{ if (o.isMesh) n++; }); return n; })();
            const boneCount = (() => { let n=0; fbx.traverse(o=>{ if (o.isBone) n++; }); return n; })();
            console.log(`→ ${path.basename(p)} | meshes=${meshCount} bones=${boneCount} clips=${fbx.animations?.length||0}`);

            const clips = fbx.animations || [];
            if (!clips.length) {
                console.warn(`(skip) No animations in ${path.basename(p)}. Try re-export as FBX Binary 7.4.`);
                continue;
            }
            if (hasMesh(fbx)) {
                basePath = p;
                break;
            }
        } catch (err) {
            console.log("here");
            console.error(`(error) ${path.basename(p)} ->`, err?.stack || err);
            continue;
        }
    }
    // fallback: just first file
    if (!basePath) basePath = entries[0];
  }

  console.log(`Using base model: ${path.basename(basePath)}`);
  await fse.copy(basePath, path.join(baseOutDir, "base.fbx"));

  // Save base bones list
  const baseFBX = await loadFBXFromDisk(basePath);
  const bones = getBones(baseFBX);
  await fs.writeFile(path.join(baseOutDir, "bones.json"), JSON.stringify({ count: bones.length, bones }, null, 2), "utf8");

  // Process all animations
  let exported = 0;
  for (const p of entries) {
    try {
      const fbx = await loadFBXFromDisk(p);
      const clips = fbx.animations || [];
      if (!clips.length) {
        console.log(`(skip) No animations in ${path.basename(p)}`);
        continue;
      }

      for (let i = 0; i < clips.length; i++) {
        const clip = clips[i];
        const base = path.basename(p, path.extname(p));
        const nice = sanitizeClipName(clip.name || base);
        const json = AnimationClip.toJSON(clip);

        const outFile = path.join(animOutDir, `${base}.${nice || `clip${i}`}.anim.json`);
        await fs.writeFile(outFile, JSON.stringify(json), "utf8");
        console.log(`✓ ${path.basename(outFile)}`);
        exported++;
      }
    } catch (err) {
      console.warn(`(warn) Failed ${path.basename(p)}:`, err.message || err);
    }
  }

  console.log(`\nDone. Exported ${exported} animation JSON file(s).`);
  console.log(`Base model saved to: ${path.join(baseOutDir, "base.fbx")}`);
  console.log(`Bone list saved to:  ${path.join(baseOutDir, "bones.json")}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
