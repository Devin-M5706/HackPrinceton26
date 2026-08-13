/**
 * Screening panel on the landing page: collect the child's details and a
 * photograph, run the pipeline, then hand the result to the 3D viewer.
 */

import { RESULT_KEY } from './config.js';
import { byId, maybeId } from './dom.js';
import { isSignedIn, screen } from './api.js';

/** Mirrors the backend limit; rejecting here avoids a wasted upload. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const GEOLOCATION_TIMEOUT_MS = 5000;
const MAX_AGE_YEARS = 18;

let imageDataUrl = '';

function showError(message) {
  const element = byId('screen-error');
  element.textContent = message;
  element.style.display = message ? 'block' : 'none';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

async function handleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  showError('');

  if (!ACCEPTED_TYPES.includes(file.type)) {
    showError('Please choose a JPEG, PNG or WebP image.');
    event.target.value = '';
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    showError('That image is over 8 MB. Please choose a smaller one.');
    event.target.value = '';
    return;
  }

  try {
    imageDataUrl = await readFileAsDataUrl(file);
  } catch (error) {
    showError(error.message);
    return;
  }

  byId('preview-img').src = imageDataUrl;
  byId('preview-wrap').style.display = 'block';
}

/** Best-effort coordinates; the pipeline works without them. */
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: GEOLOCATION_TIMEOUT_MS, enableHighAccuracy: false },
    );
  });
}

async function runAnalysis() {
  const button = byId('analyze-btn');
  showError('');

  if (!isSignedIn()) {
    showError('Please sign in before submitting a case.');
    return;
  }

  const ageYears = Number.parseFloat(byId('field-age').value);
  const region = byId('field-region').value.trim();

  if (!Number.isFinite(ageYears) || ageYears < 0 || ageYears > MAX_AGE_YEARS) {
    showError(`Enter the child's age in years (0–${MAX_AGE_YEARS}).`);
    return;
  }
  if (!region) {
    showError('Enter the village or region.');
    return;
  }
  if (!imageDataUrl) {
    showError('Upload a photograph first.');
    return;
  }

  const originalLabel = button.textContent;
  button.textContent = 'Analysing — please wait…';
  button.disabled = true;

  try {
    const position = await getPosition();
    const notes = byId('field-notes').value.trim();

    const result = await screen({
      imageB64: imageDataUrl.slice(imageDataUrl.indexOf(',') + 1),
      childMeta: {
        age_months: Math.round(ageYears * 12),
        sex: byId('field-sex').value,
        // Region belongs in the case record, not the symptom field; sending it
        // as "symptoms" put a place name into the clinical prompt.
        ...(notes ? { symptoms: notes } : {}),
      },
      lat: position?.lat,
      lng: position?.lng,
    });

    sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
    window.location.href = 'viewer.html';
  } catch (error) {
    showError(error.message ?? 'Analysis failed. Please try again.');
    button.textContent = originalLabel;
    button.disabled = false;
  }
}

export function initScreeningPanel() {
  const input = maybeId('main-img');
  const button = maybeId('analyze-btn');
  if (!input || !button) return;

  input.addEventListener('change', handleUpload);
  button.addEventListener('click', () => void runAnalysis());

  maybeId('choose-image-btn')?.addEventListener('click', () => input.click());
  maybeId('upload-zone')?.addEventListener('click', (event) => {
    // The inner button already forwards to the input; do not double-fire.
    if (event.target.closest('#choose-image-btn')) return;
    input.click();
  });
}
