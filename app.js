'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

const overlay           = document.getElementById('overlay');
const errorMessage      = document.getElementById('error-msg');
const controlsPanel     = document.getElementById('controls');
const controlsToggleBtn = document.getElementById('btn-show-controls');
const canvasContainer   = document.getElementById('canvas-container');
const peakLed           = document.getElementById('led-peak');
const beatLed           = document.getElementById('led-beat');

// ── Shared helpers ────────────────────────────────────────────────────────────

function updateBpmDisplay(text) {
  document.querySelectorAll('.bpm-display').forEach(el => el.textContent = text);
}

function flashLedBriefly(ledElement, activeClass, durationMs = 80) {
  ledElement.classList.add(activeClass);
  setTimeout(() => ledElement.classList.remove(activeClass), durationMs);
}

function formatDuration(seconds) {
  if (!isFinite(seconds) || isNaN(seconds)) return '--:--';
  const minutes = Math.floor(seconds / 60);
  const secs    = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

// ── Camera → tinted canvas → DatamoshLive ────────────────────────────────────
// We capture the camera ourselves, route frames through an offscreen canvas
// where we can composite a neon color wash, then feed the result to
// datamosh.initVideo(). The tint is baked into the encoded bitstream, so color
// smears with the datamosh artifacts instead of sitting on top of them.

let datamosh         = null;
let tintCanvas       = null;
let tintCtx          = null;
let tintAnimFrameId  = null;
let currentTintColor = null;
let tintExpiresAt    = 0;
let rawCameraVideo   = null;  // kept at module scope so flipCamera() can swap srcObject
let rawCameraStream  = null;
let currentFacingMode = 'environment';

function createTintedCameraStream(cameraStream) {
  return new Promise((resolve, reject) => {
    const cameraVideo       = document.createElement('video');
    rawCameraVideo          = cameraVideo;
    cameraVideo.srcObject   = cameraStream;
    cameraVideo.muted       = true;
    cameraVideo.playsInline = true;
    cameraVideo.addEventListener('error', reject);

    tintCanvas        = document.createElement('canvas');
    tintCanvas.width  = window.innerWidth  || 1280;
    tintCanvas.height = window.innerHeight || 720;
    tintCtx           = tintCanvas.getContext('2d');

    function drawFrame() {
      tintAnimFrameId = requestAnimationFrame(drawFrame);
      if (cameraVideo.readyState < 2) return;

      // Cover-scale: fill the canvas while preserving the camera aspect ratio,
      // the same behaviour as CSS object-fit: cover.
      const canvasW = tintCanvas.width;
      const canvasH = tintCanvas.height;
      const videoW  = cameraVideo.videoWidth  || canvasW;
      const videoH  = cameraVideo.videoHeight || canvasH;
      const scale   = Math.max(canvasW / videoW, canvasH / videoH);
      const drawW   = videoW * scale;
      const drawH   = videoH * scale;
      tintCtx.drawImage(cameraVideo, (canvasW - drawW) / 2, (canvasH - drawH) / 2, drawW, drawH);

      if (currentTintColor && Date.now() < tintExpiresAt) {
        tintCtx.globalCompositeOperation = 'screen';
        tintCtx.globalAlpha = 0.75;
        tintCtx.fillStyle   = currentTintColor;
        tintCtx.fillRect(0, 0, canvasW, canvasH);
        tintCtx.globalCompositeOperation = 'source-over';
        tintCtx.globalAlpha = 1;
      }
    }

    cameraVideo.play().then(() => {
      drawFrame();
      const outputVideo       = document.createElement('video');
      outputVideo.srcObject   = tintCanvas.captureStream(30);
      outputVideo.muted       = true;
      outputVideo.playsInline = true;
      outputVideo.play().then(() => resolve(outputVideo)).catch(reject);
    }).catch(reject);
  });
}

// ── App init ──────────────────────────────────────────────────────────────────

let appHasStarted = false;

async function startApp() {
  if (appHasStarted) return;
  appHasStarted = true;
  displayError('');

  try {
    datamosh = new DatamoshLive({
      width:  window.innerWidth  || 1280,
      height: window.innerHeight || 720,
    });
    datamosh.mount(canvasContainer);

    rawCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: currentFacingMode },
      audio: false,
    });
    const tintedStream = await createTintedCameraStream(rawCameraStream);
    await datamosh.initVideo(tintedStream);
    datamosh.start();

    overlay.classList.add('hidden');
    controlsToggleBtn.classList.remove('hidden');
    if (navigator.maxTouchPoints > 0) flipCameraBtn.classList.remove('hidden');

    transitionTo(STATES.LIVE);
    startMicMode().catch(err => {
      console.error('[mic]', err);
      transitionTo(STATES.IDLE);
    });

  } catch (err) {
    appHasStarted = false;
    const msg = err?.message ?? String(err);
    displayError(
      msg.includes('Permission') || msg.includes('NotAllowed')
        ? 'Camera access was denied. Please allow camera access and try again.'
        : `Could not start camera: ${msg}`
    );
  }
}

const flipCameraBtn = document.getElementById('btn-flip-camera');

async function flipCamera() {
  const nextFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: nextFacingMode },
      audio: false,
    });
    rawCameraStream.getTracks().forEach(t => t.stop());
    rawCameraStream   = newStream;
    currentFacingMode = nextFacingMode;
    rawCameraVideo.srcObject = newStream;
    await rawCameraVideo.play();
    datamosh?.sync();
  } catch (err) {
    console.warn('[camera flip]', err);
  }
}

flipCameraBtn.addEventListener('click', flipCamera);

// Hold AudioContext for re-use as a workaround on Mobile Safari.
let gestureUnlockedAudioCtx = null;

overlay.addEventListener('click', () => {
  if (!gestureUnlockedAudioCtx) {
    gestureUnlockedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    gestureUnlockedAudioCtx.resume().catch(() => {});
  }
  startApp();
});

function displayError(msg) {
  if (msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  } else {
    errorMessage.classList.add('hidden');
  }
}

//
// Control panel
//

let panelIsOpen = false;

function openControlsPanel() {
  panelIsOpen = true;
  controlsPanel.classList.remove('hidden');
  controlsToggleBtn.innerHTML = '&#9660;';
}

function closeControlsPanel() {
  panelIsOpen = false;
  controlsPanel.classList.add('hidden');
  controlsToggleBtn.innerHTML = '&#9650;';
  if (activeMode === 'share' || activeMode === 'diagnose') {
    returnToModeSelector();
  }
}

controlsToggleBtn.addEventListener('click', () => {
  if (panelIsOpen) {
    closeControlsPanel();
  } else {
    openControlsPanel();
  }
});

canvasContainer.addEventListener('click', () => {
  if (panelIsOpen) closeControlsPanel();
});

//
// Audio event engine
//
// All rhythm and harmony detection lives in beatfinder.js. We build one
// dedicated AudioContext per mic/file session, hand beatfinder a source
// node, and wire its events to the datamosh visuals. Only one engine runs
// at a time; starting a new one always tears down the previous one.

const BEATFINDER_URL =
  'https://cdn.jsdelivr.net/npm/beatfinder@0.1.0/beatfinder.js';
const REALTIME_BPM_ANALYZER_URL =
  'https://cdn.jsdelivr.net/npm/realtime-bpm-analyzer@5.0.15/dist/index.esm.js';

const dependenciesPromise = Promise.all([
  import(BEATFINDER_URL),
  import(REALTIME_BPM_ANALYZER_URL),
]);

let activeEngine = null;

async function startBeatFinder(audioContext, source, { boost, audible }) {
  if (audible) source.connect(audioContext.destination);

  const [{ createBeatFinder }, { createRealtimeBpmAnalyzer }] = await dependenciesPromise;

  const engine = await createBeatFinder({
    audioContext,
    source,
    boost,
    Meyda: window.Meyda,
    createRealtimeBpmAnalyzer,
  });

  engine.on('peak',          () => flashLedBriefly(peakLed, 'led-peak-on'));
  engine.on('predictedBeat', ({ tickIndex }) => applyBeatEffects(tickIndex));
  engine.on('downbeat',      () => datamosh?.drop());
  engine.on('loudnessSpike', () => { flashRandomNeonColor(); pulseZoom(); });
  engine.on('chordChange',   () => flashRandomNeonColor());
  engine.on('keyChange',     ({ key }) => setTintForKey(key));
  engine.on('bpmChange',     ({ bpm }) => {
    updateBpmDisplay(`${Math.round(bpm)} BPM`);
    setBeatSpeed(60_000 / bpm);
  });
  engine.on('tempoLost', () => {
    clearVisualEffects();
    updateBpmDisplay('listening...');
  });

  updateBpmDisplay('listening...');
  activeEngine = engine;
  return engine;
}

function tearDownActiveEngine() {
  // Safe to close the context here: every mic/file session below builds a
  // dedicated AudioContext just for its engine and never shares it.
  activeEngine?.stop({ closeContext: true });
  activeEngine = null;
}

//
// Visual effects
//

const ZOOM_SCALES = [1.0, 1.2, 1.4, 1.65];
const NEON_COLORS = ['#ffff00', '#39ff14', '#00ffff', '#ff4af8'];

let currentZoomLevel = 0;

function applyZoomLevel(level) {
  if (level === currentZoomLevel) return;
  currentZoomLevel = level;
  const canvas = canvasContainer.querySelector('canvas');
  if (canvas) canvas.style.transform = `scale(${ZOOM_SCALES[level]})`;
}

function flashRandomNeonColor() {
  if (!datamosh || !tintCtx) return;
  currentTintColor = NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
  tintExpiresAt    = Date.now() + 200;
}

// Key names beatfinder reports, e.g. "A minor" -- index maps to a hue.
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function setTintForKey(key) {
  const index = PITCH_CLASSES.indexOf(key.split(' ')[0]);
  if (index < 0) return;
  currentTintColor = `hsl(${index * 30}, 100%, 60%)`;
  tintExpiresAt    = Date.now() + 3000;
}

let zoomPulseTimer = null;

function pulseZoom() {
  applyZoomLevel(2);
  clearTimeout(zoomPulseTimer);
  zoomPulseTimer = setTimeout(() => applyZoomLevel(0), 350);
}

function clearVisualEffects() {
  if (datamosh) datamosh.sync();
  applyZoomLevel(0);
}

function applyBeatEffects(tickIndex) {
  if (!datamosh) return;

  datamosh.corruptRate = Math.random() * 0.6;
  datamosh.corrupt();

  if (tickIndex % 2 === 0) {
    datamosh.drop();
  } else {
    datamosh.sync();
  }

  flashLedBriefly(beatLed, 'led-beat-on');
}

document.getElementById('btn-color-flash').addEventListener('click', flashRandomNeonColor);

//
// Play mode panel
//

let audioPlayer    = null;
let currentFileUrl = null;

const playPauseBtn   = document.getElementById('btn-play-pause');
const trackNameLabel = document.getElementById('play-track-name');
const seekBar        = document.getElementById('seek-bar');
const timeCurrentEl  = document.getElementById('time-current');
const timeTotalEl    = document.getElementById('time-total');

async function loadAudioFile(file) {
  tearDownPlayMode();

  if (currentFileUrl) { URL.revokeObjectURL(currentFileUrl); currentFileUrl = null; }
  currentFileUrl = URL.createObjectURL(file);

  trackNameLabel.textContent = file.name;
  playPauseBtn.disabled      = false;

  audioPlayer      = new Audio(currentFileUrl);
  audioPlayer.loop = false;
  seekBar.value    = 0;
  seekBar.disabled = true;
  timeCurrentEl.textContent = '--:--';
  timeTotalEl.textContent   = '--:--';
  attachAudioSeekListeners();

  // An HTMLMediaElement can only ever be connected to one
  // MediaElementSourceNode, so this engine is built once per loaded file
  // and reused across play/pause. boost lifts the analysis chain only --
  // audible: true routes the unboosted signal to the speakers.
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  const source = audioContext.createMediaElementSource(audioPlayer);
  try {
    await startBeatFinder(audioContext, source, { boost: 10, audible: true });
  } catch (e) {
    console.warn('[beatfinder] play setup failed:', e);
    updateBpmDisplay('-- BPM');
  }
}

function handlePlayPauseToggle() {
  if (!audioPlayer) return;
  if (audioPlayer.paused) {
    if (appState === STATES.LIVE) stopMicMode();
    audioPlayer.play();
    playPauseBtn.innerHTML = '&#x2016; Pause';
    transitionTo(STATES.PLAYING);
  } else {
    audioPlayer.pause();
    playPauseBtn.innerHTML = '&#x25BA; Play';
    transitionTo(STATES.IDLE);
  }
}

function tearDownPlayMode() {
  tearDownActiveEngine();
  clearVisualEffects();

  if (currentFileUrl) { URL.revokeObjectURL(currentFileUrl); currentFileUrl = null; }
  if (audioPlayer)    { audioPlayer.pause(); audioPlayer.src = ''; audioPlayer = null; }

  playPauseBtn.innerHTML = '&#x25BA; Play';
  playPauseBtn.disabled  = true;
  if (appState === STATES.PLAYING) transitionTo(STATES.IDLE);
  trackNameLabel.textContent = 'No file selected';
  seekBar.value              = 0;
  seekBar.disabled           = true;
  timeCurrentEl.textContent  = '--:--';
  timeTotalEl.textContent    = '--:--';
  updateBpmDisplay('-- BPM');
}

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadAudioFile(file);
  e.target.value = '';
});
document.getElementById('btn-open-file').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
playPauseBtn.addEventListener('click', handlePlayPauseToggle);


// Seek bar

let userIsSeeking = false;
seekBar.addEventListener('mousedown',  () => { userIsSeeking = true; });
seekBar.addEventListener('touchstart', () => { userIsSeeking = true; }, { passive: true });
window.addEventListener('mouseup',  () => { userIsSeeking = false; });
window.addEventListener('touchend', () => { userIsSeeking = false; });

seekBar.addEventListener('input', () => {
  if (!audioPlayer || isNaN(audioPlayer.duration)) return;
  const seekTime            = (seekBar.value / +seekBar.max) * audioPlayer.duration;
  timeCurrentEl.textContent = formatDuration(seekTime);
  audioPlayer.currentTime   = seekTime;
});

function attachAudioSeekListeners() {
  audioPlayer.addEventListener('loadedmetadata', () => {
    seekBar.max             = 1000;
    seekBar.disabled        = false;
    timeTotalEl.textContent = formatDuration(audioPlayer.duration);
  });
  audioPlayer.addEventListener('timeupdate', () => {
    if (userIsSeeking || !audioPlayer || isNaN(audioPlayer.duration)) return;
    seekBar.value             = (audioPlayer.currentTime / audioPlayer.duration) * +seekBar.max;
    timeCurrentEl.textContent = formatDuration(audioPlayer.currentTime);
  });
  audioPlayer.addEventListener('ended', () => {
    playPauseBtn.innerHTML = '&#x25BA; Play';
    clearVisualEffects();
    transitionTo(STATES.IDLE);
  });
}

document.getElementById('btn-skip-back').addEventListener('click', () => {
  if (audioPlayer) audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 15);
});
document.getElementById('btn-skip-forward').addEventListener('click', () => {
  if (audioPlayer && isFinite(audioPlayer.duration))
    audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 15);
});

//
// Microphone mode
//

let micStream = null;

async function startMicMode() {
  tearDownActiveEngine();

  const isMobile = navigator.maxTouchPoints > 0;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: isMobile },
    video: false,
  });

  const audioContext = gestureUnlockedAudioCtx ?? new (window.AudioContext || window.webkitAudioContext)();
  gestureUnlockedAudioCtx = null;
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

  const source = audioContext.createMediaStreamSource(micStream);
  // 10x boost (20x on mobile, plus hardware AGC) lifts quiet ambient audio
  // to a level beatfinder's peak detector can work with.
  await startBeatFinder(audioContext, source, { boost: isMobile ? 20 : 10, audible: false });
}

function stopMicMode() {
  tearDownActiveEngine();
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  updateBpmDisplay('-- BPM');
}

//
// Modes overview panel
//

let activeMode = null;

const liveModeBtn = document.querySelector('.mode-btn-live');

const playModeBtn = document.querySelector('.mode-btn-play');

// Elements that "flash" to the beat.
let beatAnimTargets = [];

//
// Mode state machine
//

// IDLE    : no audio source selected
// LIVE    : microphone is listening
// PLAYING : an audio track is playing

const STATES = { IDLE: 'idle', LIVE: 'live', PLAYING: 'playing' };
let appState = STATES.IDLE;

function transitionTo(newState) {
  if (appState === newState) return;
  console.log(`[state] ${appState} -> ${newState}`);
  appState = newState;

  liveModeBtn.classList.remove('mode-btn-live-active');
  playModeBtn.classList.remove('mode-btn-play-active');
  playPauseBtn.classList.remove('btn-play-active');
  beatAnimTargets = [];

  if (newState === STATES.LIVE) {
    liveModeBtn.classList.add('mode-btn-live-active');
    beatAnimTargets = [liveModeBtn];
  } else if (newState === STATES.PLAYING) {
    playModeBtn.classList.add('mode-btn-play-active');
    playPauseBtn.classList.add('btn-play-active');
    beatAnimTargets = [playModeBtn, playPauseBtn];
  }
}

function setBeatSpeed(beatMs) {
  beatAnimTargets.forEach(el => el.style.setProperty('--beat-ms', `${beatMs}ms`));
}

function activateMode(mode) {
  activeMode = mode;
  document.getElementById('mode-selector').classList.add('hidden');
  document.querySelectorAll('.mode-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`mode-${mode}`).classList.remove('hidden');

}

function returnToModeSelector() {
  activeMode = null;
  document.querySelectorAll('.mode-content').forEach(el => el.classList.add('hidden'));
  document.getElementById('mode-selector').classList.remove('hidden');
}

let liveBtnLastTapAt = 0;

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'live') {
      const now = Date.now();
      if (now - liveBtnLastTapAt < 300) {
        liveBtnLastTapAt = 0;
        flipCamera();
        return;
      }
      liveBtnLastTapAt = now;

      if (appState === STATES.LIVE) return;  // already live, no-op
      if (appState === STATES.PLAYING) tearDownPlayMode();
      transitionTo(STATES.LIVE);
      startMicMode().catch(err => {
        console.error('[mic]', err);
        transitionTo(STATES.IDLE);
      });
    } else {
      activateMode(btn.dataset.mode);
    }
  });
});

document.querySelectorAll('.btn-back').forEach(btn => {
  btn.addEventListener('click', returnToModeSelector);
});

//
// Share mode panel
//

//
// Diagnose mode panel
//

let diagnoseModeZoomIndex = 0;
document.getElementById('btn-diagnose-sync').addEventListener('click', () => datamosh?.sync());
document.getElementById('btn-diagnose-drop').addEventListener('click', () => datamosh?.drop());
document.getElementById('btn-diagnose-zoom').addEventListener('click', () => {
  diagnoseModeZoomIndex = (diagnoseModeZoomIndex + 1) % ZOOM_SCALES.length;
  applyZoomLevel(diagnoseModeZoomIndex);
});
document.getElementById('btn-open-diagnose').addEventListener('click', () => activateMode('diagnose'));
