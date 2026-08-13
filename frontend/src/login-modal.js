/**
 * Sign-in modal: role → phone → OTP → done.
 */

import { byId, maybeId } from './dom.js';
import { confirmOtp, FIREBASE_ENABLED, requestOtp, resetOtp } from './auth.js';
import { getHealth, setToken } from './api.js';
import { NAME_KEY } from './config.js';

const PIN_LENGTH = 6;
const MIN_PHONE_DIGITS = 8;

let selectedRole = null;
let pin = '';
let submitting = false;
let onSignedIn = () => {};

function goToStep(id) {
  for (const step of document.querySelectorAll('.login-step')) {
    step.classList.remove('active');
  }
  byId(id).classList.add('active');
  if (id === 'step-pin') resetPin();
}

function showStepError(id, message) {
  const element = byId(id);
  element.textContent = message;
  element.style.display = message ? 'block' : 'none';
}

// ── PIN entry ────────────────────────────────────────────────────────────────

function renderPin() {
  for (let i = 0; i < PIN_LENGTH; i += 1) {
    maybeId(`pd${i}`)?.classList.toggle('filled', i < pin.length);
  }
}

function resetPin() {
  pin = '';
  renderPin();
  showStepError('pin-error', '');
}

function pressPin(digit) {
  if (submitting || pin.length >= PIN_LENGTH) return;
  pin += digit;
  renderPin();
  showStepError('pin-error', '');
  if (pin.length === PIN_LENGTH) void submitPin();
}

function deletePin() {
  if (submitting || pin.length === 0) return;
  pin = pin.slice(0, -1);
  renderPin();
}

async function submitPin() {
  submitting = true;
  try {
    const session = await confirmOtp(pin);
    byId('success-title').textContent = `Welcome, ${session.name ?? 'CHW'}.`;
    byId('success-body').textContent =
      selectedRole === 'parent'
        ? 'You can now upload a photograph of your child for free AI screening.'
        : 'You are signed in as a community health worker. Submit patient cases below.';
    goToStep('step-success');
    onSignedIn();
  } catch (error) {
    showStepError('pin-error', error.message ?? 'Incorrect code — please try again.');
    resetPin();
  } finally {
    submitting = false;
  }
}

// ── Open / close ─────────────────────────────────────────────────────────────

export function openLogin() {
  byId('login-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  selectedRole = null;
  for (const button of document.querySelectorAll('.role-btn')) {
    button.classList.remove('selected');
    button.setAttribute('aria-pressed', 'false');
  }
  byId('role-next-btn').disabled = true;
  byId('phone-input').value = '';
  byId('phone-next-btn').disabled = true;
  showStepError('phone-error', '');
  resetOtp();
  resetPin();
  goToStep('step-role');

  if (!FIREBASE_ENABLED) {
    showStepError(
      'phone-error',
      'Phone sign-in is not configured for this deployment.',
    );
  }
}

/**
 * Offer a one-click demo sign-in, but only when the server confirms it is
 * running in mock mode.
 *
 * The demo token is worthless against a real deployment — the backend rejects
 * it unless MOCK_MODE is on — so gating the button on the server's own answer
 * keeps a stray demo button from appearing in production.
 */
async function setUpDemoSignIn() {
  const button = maybeId('demo-signin-btn');
  if (!button) return;

  let health;
  try {
    health = await getHealth();
  } catch {
    return;
  }
  if (!health?.mock_mode) return;

  button.hidden = false;
  button.addEventListener('click', () => {
    setToken('demo');
    localStorage.setItem(NAME_KEY, 'Demo CHW');
    byId('success-title').textContent = 'Demo mode';
    byId('success-body').textContent =
      'You are signed in to a demonstration account. Results are simulated and are ' +
      'not clinical assessments.';
    goToStep('step-success');
    onSignedIn();
  });
}

function closeLogin() {
  byId('login-modal').classList.remove('open');
  document.body.style.overflow = '';
  resetOtp();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

/**
 * Wire up the modal.
 * @param {() => void} [onSessionChange] called after a successful sign-in
 */
export function initLoginModal(onSessionChange) {
  const modal = maybeId('login-modal');
  if (!modal) return;

  onSignedIn = onSessionChange ?? (() => {});

  maybeId('nav-login-btn')?.addEventListener('click', openLogin);
  maybeId('modal-close-btn')?.addEventListener('click', closeLogin);

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeLogin();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeLogin();
  });

  for (const button of document.querySelectorAll('.role-btn')) {
    button.addEventListener('click', () => {
      selectedRole = button.dataset.role;
      for (const other of document.querySelectorAll('.role-btn')) {
        other.classList.remove('selected');
        other.setAttribute('aria-pressed', 'false');
      }
      button.classList.add('selected');
      button.setAttribute('aria-pressed', 'true');
      byId('role-next-btn').disabled = false;
    });
  }

  byId('role-next-btn').addEventListener('click', () => goToStep('step-phone'));

  byId('phone-input').addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\D/g, '');
    byId('phone-next-btn').disabled = digits.length < MIN_PHONE_DIGITS;
    showStepError('phone-error', '');
  });

  byId('phone-next-btn').addEventListener('click', async () => {
    const button = byId('phone-next-btn');
    const phone = byId('phone-input').value.trim();

    button.textContent = 'Sending…';
    button.disabled = true;
    try {
      await requestOtp(phone, 'recaptcha-anchor');
      goToStep('step-pin');
    } catch (error) {
      showStepError(
        'phone-error',
        error.message ?? 'Could not send a code — check the number and try again.',
      );
    } finally {
      button.textContent = 'Send verification code';
      button.disabled = false;
    }
  });

  for (const key of document.querySelectorAll('.pin-key[data-digit]')) {
    key.addEventListener('click', () => pressPin(key.dataset.digit));
  }
  maybeId('pin-delete')?.addEventListener('click', deletePin);

  // Physical keyboards should work as well as the on-screen pad.
  document.addEventListener('keydown', (event) => {
    if (!byId('step-pin').classList.contains('active')) return;
    if (/^\d$/.test(event.key)) pressPin(event.key);
    else if (event.key === 'Backspace') deletePin();
  });

  for (const button of document.querySelectorAll('[data-goto]')) {
    button.addEventListener('click', () => goToStep(button.dataset.goto));
  }

  byId('success-continue').addEventListener('click', () => {
    closeLogin();
    maybeId('screen')?.scrollIntoView({ behavior: 'smooth' });
  });

  void setUpDemoSignIn();
}
