/**
 * 3D result viewer.
 *
 * Renders a generic anatomical model shaded by WHO stage. This is a schematic
 * illustration of severity — not the patient's own anatomy and not a rendering
 * of their photograph. The page says so, because a realistic-looking 3D lesion
 * reads as imaging to anyone who is not told otherwise.
 */

import './styles/theme.css';
import './styles/viewer.css';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { RESULT_KEY, triageColor } from './config.js';
import { byId, maybeId, titleCase } from './dom.js';

const MODEL_URL = '/models/mouth/scene.gltf';

/** Per-stage material treatment. Index 0 means "no disease identified". */
const STAGE_APPEARANCE = {
  0: { mouth: 0xffb8a0, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.65, lesion: null, teeth: 0xfff8f0, teethRoughness: 0.3 },
  1: { mouth: 0xff9090, emissive: 0x7a0000, emissiveIntensity: 0.25, roughness: 0.72, lesion: 0xff3030, teeth: 0xe8d5a0, teethRoughness: 0.5 },
  2: { mouth: 0xd96040, emissive: 0x8b3000, emissiveIntensity: 0.35, roughness: 0.8, lesion: 0xff6020, teeth: 0xb8853a, teethRoughness: 0.7 },
  3: { mouth: 0x8b3030, emissive: 0x3a0000, emissiveIntensity: 0.55, roughness: 0.9, lesion: 0xcc1010, teeth: 0x6b3a1a, teethRoughness: 0.88 },
  4: { mouth: 0x4a1a1a, emissive: 0x1a0000, emissiveIntensity: 0.65, roughness: 0.96, lesion: 0x880000, teeth: 0x2a1008, teethRoughness: 0.97 },
  5: { mouth: 0xd4a090, emissive: 0x000000, emissiveIntensity: 0.0, roughness: 0.85, lesion: null, teeth: 0xd4c090, teethRoughness: 0.6 },
};

// ── Load the result ──────────────────────────────────────────────────────────

function loadResult() {
  const raw = sessionStorage.getItem(RESULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A corrupt entry used to throw here after the redirect had been assigned
    // but before the page unloaded, leaving a blank screen.
    sessionStorage.removeItem(RESULT_KEY);
    return null;
  }
}

const result = loadResult();
if (!result) {
  window.location.replace('index.html');
}

// `window.location.replace` does not stop execution, so everything below is
// guarded rather than assuming `result` is present.
if (result) {
  initViewer(result);
}

// ── Overlay ──────────────────────────────────────────────────────────────────

function initViewer(data) {
  const stage = clampStage(data.stage);
  const stageColor = triageColor(data.triage);

  byId('result-stage').textContent = `Stage ${data.stage ?? '—'} — ${titleCase(data.triage)}`;
  byId('result-stage').style.color = stageColor;
  byId('badge-val').textContent = String(data.stage ?? '—');
  byId('badge-val').style.color = stageColor;
  byId('result-note').textContent = data.clinical_note ?? '';

  if (data.clinic?.name) {
    const parts = [data.clinic.name];
    if (Number.isFinite(data.clinic.distance_km) && data.clinic.distance_km > 0) {
      parts.push(`${data.clinic.distance_km} km`);
    }
    if (data.clinic.contact) parts.push(data.clinic.contact);
    byId('result-clinic').textContent = `Nearest clinic: ${parts.join(' · ')}`;
  }

  // Surface an incomplete assessment instead of letting a fallback result look
  // like a real one.
  const banner = maybeId('result-banner');
  if (banner) {
    if (data.mock) {
      banner.textContent =
        'Demonstration mode — this result is simulated and is not a clinical assessment.';
      banner.style.display = 'block';
    } else if (data.degraded) {
      banner.textContent =
        'Automated analysis was incomplete for this screening. Refer the child for ' +
        'in-person assessment; do not treat this as a result.';
      banner.style.display = 'block';
    }
  }

  wireCopyButton(data.referral_note ?? '');
  void renderModel(stage, data.findings ?? []);
}

function clampStage(value) {
  const stage = Number(value);
  if (!Number.isFinite(stage)) return 0;
  return Math.max(0, Math.min(5, Math.round(stage)));
}

function wireCopyButton(note) {
  const button = byId('copy-btn');
  if (!note) {
    button.disabled = true;
    return;
  }
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(note);
      button.textContent = 'Copied ✓';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => {
      button.textContent = 'Copy referral note';
    }, 2000);
  });
}

// ── Three.js scene ───────────────────────────────────────────────────────────

async function renderModel(stage, findings) {
  const canvas = byId('viewer-canvas');
  const appearance = STAGE_APPEARANCE[stage] ?? STAGE_APPEARANCE[0];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050810);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 100);
  camera.position.set(0, 0.02, 0.32);

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.DirectionalLight(0xfff5ee, 1.6);
  key.position.set(1.5, 2, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6080ff, 0.35);
  fill.position.set(-2, 0.5, 1);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 0.08;
  controls.maxDistance = 1.2;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.addEventListener('start', () => {
    controls.autoRotate = false;
    const hint = maybeId('hint');
    if (hint) hint.style.display = 'none';
  });

  // Lesion highlight only where the assessment found disease. A fixed
  // blinking necrotic lesion used to be added unconditionally, so a "healthy"
  // result still rendered an angry red wound.
  let lesionLight = null;
  if (appearance.lesion && stage >= 1) {
    const onLeft = findings.some((f) => /left/i.test(String(f)));
    lesionLight = new THREE.PointLight(appearance.lesion, 3, 0.18);
    lesionLight.position.set(onLeft ? -0.05 : 0.05, 0.01, 0.05);
    scene.add(lesionLight);
  }

  let model;
  try {
    const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
    model = gltf.scene;
  } catch {
    const hint = maybeId('hint');
    if (hint) hint.textContent = '3D model unavailable';
    return;
  }

  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(0.2 / Math.max(size.x, size.y, size.z));
  model.position.sub(center.multiplyScalar(0.2 / Math.max(size.x, size.y, size.z)));

  const pulsing = [];
  model.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materialName = String(child.material.name ?? '').toLowerCase();
    const meshName = String(child.name ?? '').toLowerCase();
    const isTeeth = /teeth|tooth/.test(materialName) || /teeth|tooth/.test(meshName);

    child.material = child.material.clone();

    if (isTeeth) {
      child.material.color.setHex(appearance.teeth);
      child.material.roughness = appearance.teethRoughness;
    } else {
      child.material.color.setHex(appearance.mouth);
      child.material.emissive.setHex(appearance.emissive);
      child.material.emissiveIntensity = appearance.emissiveIntensity;
      child.material.roughness = appearance.roughness;
      if (stage >= 2 && stage <= 4) {
        pulsing.push({ material: child.material, base: appearance.emissiveIntensity });
      }
    }
  });

  scene.add(model);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }
  resize();
  window.addEventListener('resize', resize);

  let elapsed = 0;
  renderer.setAnimationLoop(() => {
    elapsed += 0.016;
    controls.update();
    if (lesionLight && stage >= 2) {
      lesionLight.intensity = 2.5 + Math.sin(elapsed * 2.2) * 1.0;
    }
    for (const { material, base } of pulsing) {
      material.emissiveIntensity = base + Math.sin(elapsed * 1.6) * 0.15;
    }
    renderer.render(scene, camera);
  });
}
