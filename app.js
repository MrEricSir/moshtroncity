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

    setLiveModeActive(true);
    startMicrophoneMode().catch(err => {
      console.error('[mic]', err);
      setLiveModeActive(false);
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

// Loudness tracking 
//
// Maintains a rolling 30-second window of RMS values. loudnessLevel is the
// percentile rank of the current RMS in that window (0 = quietest, 1 = loudest),
// smoothed with an EMA so effect thresholds respond gradually over a few beats
// rather than jumping on transients.

const LOUDNESS_HISTORY_SIZE = 300; // 300 samples × 100 ms = 30 s
let loudnessLevel = 0.5;

function beginLoudnessTracking(analyserNode) {
  const sampleBuffer     = new Float32Array(analyserNode.fftSize);
  const rmsHistory       = [];
  let smoothedPercentile = 0.5;

  return setInterval(() => {
    analyserNode.getFloatTimeDomainData(sampleBuffer);

    let sumOfSquares = 0;
    for (let i = 0; i < sampleBuffer.length; i++) sumOfSquares += sampleBuffer[i] ** 2;
    const rms = Math.sqrt(sumOfSquares / sampleBuffer.length);

    rmsHistory.push(rms);
    if (rmsHistory.length > LOUDNESS_HISTORY_SIZE) rmsHistory.shift();
    if (rmsHistory.length < 10) return;

    const samplesAtOrBelow = rmsHistory.filter(v => v <= rms).length;
    const percentile       = samplesAtOrBelow / rmsHistory.length;

    smoothedPercentile = smoothedPercentile * 0.92 + percentile * 0.08;
    loudnessLevel = smoothedPercentile;
  }, 100);
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

function clearVisualEffects() {
  if (datamosh) datamosh.sync();
  loudnessLevel = 0.5;
  applyZoomLevel(0);
}

function applyBeatEffects(beatIndex) {
  if (!datamosh) return;

  datamosh.corruptRate = Math.min(Math.random() * loudnessLevel, 1.0);
  datamosh.corrupt();

  if (beatIndex % 2 === 0) {
    datamosh.drop();
  } else {
    datamosh.sync();
  }

  applyZoomLevel(loudnessLevel > 0.75 ? 3 : loudnessLevel > 0.5 ? 2 : 0);

  if (loudnessLevel > 0.75) flashRandomNeonColor();

  flashLedBriefly(beatLed, 'led-beat-on');
}

document.getElementById('btn-color-flash').addEventListener('click', flashRandomNeonColor);

//
// Play mode panel
//

const REALTIME_BPM_ANALYZER_URL =
  'https://cdn.jsdelivr.net/npm/realtime-bpm-analyzer@5.0.15/dist/index.esm.js';

let audioPlayer         = null;
let detectedBpm         = 0;
let playBeatIndex       = 0;
let beatIntervalId      = null;
let isAudioPlaying      = false;
let playLoudnessCtx     = null;
let playLoudnessTimerId = null;
let currentFileUrl      = null;

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
  updateBpmDisplay('detecting...');

  audioPlayer      = new Audio(currentFileUrl);
  audioPlayer.loop = false;
  seekBar.value    = 0;
  seekBar.disabled = true;
  timeCurrentEl.textContent = '--:--';
  timeTotalEl.textContent   = '--:--';
  attachAudioSeekListeners();

  try {
    playLoudnessCtx     = new AudioContext();
    const sourceNode    = playLoudnessCtx.createMediaElementSource(audioPlayer);
    const analyserNode  = playLoudnessCtx.createAnalyser();
    analyserNode.fftSize = 1024;
    sourceNode.connect(analyserNode);
    analyserNode.connect(playLoudnessCtx.destination);
    playLoudnessCtx.resume();
    playLoudnessTimerId = beginLoudnessTracking(analyserNode);
  } catch (e) {
    console.warn('[loudness] play setup failed:', e);
  }

  try {
    const { analyzeFullBuffer } = await import(REALTIME_BPM_ANALYZER_URL);
    const fileBytes    = await file.arrayBuffer();
    const offlineCtx   = new OfflineAudioContext(1, Math.max(1, (fileBytes.byteLength / 2) | 0), 44100);
    const audioBuffer  = await offlineCtx.decodeAudioData(fileBytes);
    const candidates   = await analyzeFullBuffer(audioBuffer);
    const topCandidate = Array.isArray(candidates)
      ? candidates.reduce((best, c) => (c.count > (best?.count ?? -1) ? c : best), null)
      : null;
    if (topCandidate) {
      detectedBpm = clampBpmToRange(topCandidate.tempo);
      updateBpmDisplay(`${detectedBpm} BPM`);
    } else {
      updateBpmDisplay('-- BPM');
    }
  } catch (e) {
    console.warn('[bpm] detection failed:', e);
    updateBpmDisplay('--- BPM');
  }
}

function handlePlayPauseToggle() {
  if (!audioPlayer) return;
  if (audioPlayer.paused) {
    if (playLoudnessCtx?.state === 'suspended') playLoudnessCtx.resume();
    audioPlayer.play();
    isAudioPlaying         = true;
    playPauseBtn.innerHTML = '&#9646;&#9646; Pause';

    if (detectedBpm > 0 && !beatIntervalId) {
      playBeatIndex      = 0;
      const msPerBeat    = (60 / detectedBpm) * 1000;
      beatIntervalId     = setInterval(() => {
        if (!isAudioPlaying) return;
        applyBeatEffects(playBeatIndex);
        playBeatIndex = (playBeatIndex + 1) % 4;
      }, msPerBeat);
    }
  } else {
    audioPlayer.pause();
    isAudioPlaying         = false;
    playPauseBtn.innerHTML = '&#9654; Play';
  }
}

function tearDownPlayMode() {
  isAudioPlaying = false;
  clearInterval(beatIntervalId);
  clearInterval(playLoudnessTimerId);
  beatIntervalId      = null;
  playLoudnessTimerId = null;
  detectedBpm         = 0;
  clearVisualEffects();

  if (playLoudnessCtx) { playLoudnessCtx.close(); playLoudnessCtx = null; }
  if (audioPlayer)     { audioPlayer.pause(); audioPlayer.src = ''; audioPlayer = null; }

  playPauseBtn.innerHTML     = '&#9654; Play';
  playPauseBtn.disabled      = true;
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
    isAudioPlaying         = false;
    playPauseBtn.innerHTML = '&#9654; Play';
    clearInterval(beatIntervalId);
    beatIntervalId = null;
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
// Microphone mode panel
//

// Audio graph:  mic → 10× boost → [loudness analyser]
//                                → 1kHz lowpass → BPM analyser → silent sink

const SILENCE_TIMEOUT_MS = 8_000;

let micStream                = null;
let micBpmAnalyser           = null;
let micLoudnessAnalyser      = null;
let micLoudnessTimerId       = null;
let silenceCheckIntervalId   = null;
let lastPeakDetectedAt       = 0;
let micIsListening           = false;
let tempoIsLocked            = false;
let lockedBpm                = 0;
let micBeatIndex             = 0;
let beatGridIntervalId       = null;
let beatGridAlignmentTimeout = null;

function clampBpmToRange(bpm) {
  while (bpm > 160) bpm /= 2;
  while (bpm < 70)  bpm *= 2;
  return Math.round(bpm);
}

function onMicBeat() {
  if (!micIsListening) return;
  applyBeatEffects(micBeatIndex);
  micBeatIndex = (micBeatIndex + 1) % 16;
}

function alignBeatGridToTempo(beatIntervalMs, detectedAt) {
  clearInterval(beatGridIntervalId);
  clearTimeout(beatGridAlignmentTimeout);
  beatGridIntervalId = null;
  tempoIsLocked      = true;

  const msElapsed      = performance.now() - detectedAt;
  const msUntilNextBeat = beatIntervalMs - (msElapsed % beatIntervalMs);

  beatGridAlignmentTimeout = setTimeout(() => {
    if (!micIsListening) return;
    onMicBeat();
    beatGridIntervalId = setInterval(onMicBeat, beatIntervalMs);
  }, msUntilNextBeat);
}

async function startMicrophoneMode() {
  // Set micIsListening immediately so stopMicrophoneMode() can cancel this
  // function mid-setup by setting it back to false.
  micIsListening = true;

  const audioCtx = gestureUnlockedAudioCtx ?? new (window.AudioContext || window.webkitAudioContext)();
  gestureUnlockedAudioCtx = null;
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});

  // On mobile, use AGC to increase volume of quiet ambient audio to a detectable level.
  const isMobile = navigator.maxTouchPoints > 0;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: isMobile },
    video: false,
  });
  if (!micIsListening) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    audioCtx.close();
    return;
  }

  const { createRealtimeBpmAnalyzer } = await import(REALTIME_BPM_ANALYZER_URL);
  if (!micIsListening) { audioCtx.close(); return; }

  const micSource   = audioCtx.createMediaStreamSource(micStream);
  const boostGain   = audioCtx.createGain();
  const kickHiPass  = audioCtx.createBiquadFilter();
  const kickLoPass  = audioCtx.createBiquadFilter();
  const silentSink  = audioCtx.createGain();

  boostGain.gain.value         = 10;
  kickHiPass.type              = 'highpass';
  kickHiPass.frequency.value   = 60;
  kickHiPass.Q.value           = 0.7;
  kickLoPass.type              = 'lowpass';
  kickLoPass.frequency.value   = 250;
  kickLoPass.Q.value           = 0.7;
  silentSink.gain.value        = 0;

  micLoudnessAnalyser         = audioCtx.createAnalyser();
  micLoudnessAnalyser.fftSize = 1024;

  micBpmAnalyser = await createRealtimeBpmAnalyzer(audioCtx, {
    continuousAnalysis: true,
    stabilizationTime:  10_000,
    debug:              true,
  });
  if (!micIsListening) {
    micBpmAnalyser.stop();
    micBpmAnalyser.disconnect();
    micBpmAnalyser = null;
    audioCtx.close();
    return;
  }

  micSource.connect(boostGain);
  boostGain.connect(micLoudnessAnalyser);
  boostGain.connect(kickHiPass);
  kickHiPass.connect(kickLoPass);
  kickLoPass.connect(micBpmAnalyser.node);
  kickLoPass.connect(silentSink);
  silentSink.connect(audioCtx.destination);

  micLoudnessTimerId = beginLoudnessTracking(micLoudnessAnalyser);
  micBeatIndex       = 0;
  tempoIsLocked      = false;
  lockedBpm          = 0;
  lastPeakDetectedAt = performance.now();
  updateBpmDisplay('listening...');

  function pickTopCandidate(candidates) {
    if (!candidates?.length) return null;
    return candidates.reduce((best, c) => (c.count > (best?.count ?? -1) ? c : best), null);
  }

  micBpmAnalyser.on('validPeak', () => {
    flashLedBriefly(peakLed, 'led-peak-on');
    lastPeakDetectedAt = performance.now();
  });

  function handleBpmReading(bpm, label) {
    const driftRatio = lockedBpm > 0 ? Math.abs(bpm - lockedBpm) / lockedBpm : 1;
    console.log(`[mic-bpm] ${label}: ${bpm} BPM (drift: ${(driftRatio * 100).toFixed(1)}%)`);
    if (driftRatio > 0.05) {
      lockedBpm = bpm;
      updateBpmDisplay(`${bpm} BPM`);
      alignBeatGridToTempo(60_000 / bpm, performance.now());
    }
  }

  micBpmAnalyser.on('bpm', ({ bpm: candidates }) => {
    const top = pickTopCandidate(candidates);
    if (!top || top.count < 10) return;
    handleBpmReading(clampBpmToRange(top.tempo), 'bpm');
  });

  micBpmAnalyser.on('bpmStable', ({ bpm: candidates }) => {
    const top = pickTopCandidate(candidates);
    if (!top) return;
    handleBpmReading(clampBpmToRange(top.tempo), 'bpmStable');
  });

  silenceCheckIntervalId = setInterval(() => {
    if (!micIsListening) return;
    const msSinceLastPeak = performance.now() - lastPeakDetectedAt;
    if (msSinceLastPeak > SILENCE_TIMEOUT_MS && tempoIsLocked) {
      lockedBpm  = 0;
      tempoIsLocked = false;
      clearInterval(beatGridIntervalId);
      clearTimeout(beatGridAlignmentTimeout);
      beatGridIntervalId       = null;
      beatGridAlignmentTimeout = null;
      clearVisualEffects();
      updateBpmDisplay('listening...');
    }
  }, 2_000);
}

function stopMicrophoneMode() {
  micIsListening = false;
  tempoIsLocked  = false;
  lockedBpm      = 0;
  updateBpmDisplay('-- BPM');
  clearInterval(beatGridIntervalId);
  clearTimeout(beatGridAlignmentTimeout);
  clearInterval(silenceCheckIntervalId);
  clearInterval(micLoudnessTimerId);
  beatGridIntervalId       = null;
  beatGridAlignmentTimeout = null;
  silenceCheckIntervalId   = null;
  micLoudnessTimerId       = null;
  micLoudnessAnalyser      = null;
  clearVisualEffects();

  if (micBpmAnalyser) {
    micBpmAnalyser.stop();
    micBpmAnalyser.disconnect();
    micBpmAnalyser = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
}

//
// Modes overview panel
//

let activeMode = null;

const liveModeBtn = document.querySelector('.mode-btn-live');

function setLiveModeActive(isActive) {
  liveModeBtn.classList.toggle('mode-btn-live-active', isActive);
}

function activateMode(mode) {
  if (activeMode === 'play') tearDownPlayMode();

  // Switching to Play replaces mic audio with a file, so stop the mic.
  // Switching to Test just opens the manual controls -- mic keeps running.
  if (mode === 'play' && micIsListening) {
    try { stopMicrophoneMode(); } catch (e) { console.warn('[mic] cleanup failed:', e); }
    setLiveModeActive(false);
  }

  activeMode = mode;
  document.getElementById('mode-selector').classList.add('hidden');
  document.querySelectorAll('.mode-content').forEach(el => el.classList.add('hidden'));
  document.getElementById(`mode-${mode}`).classList.remove('hidden');

  if (mode === 'share') {
    try { ensureQrCode(); } catch (e) { console.warn('[qr] failed:', e); }
  }
}

function returnToModeSelector() {
  if (activeMode === 'play') tearDownPlayMode();
  activeMode = null;
  document.querySelectorAll('.mode-content').forEach(el => el.classList.add('hidden'));
  document.getElementById('mode-selector').classList.remove('hidden');
  setLiveModeActive(micIsListening);
}

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'live') {
      if (micIsListening) {
        try { stopMicrophoneMode(); } catch (e) { console.warn('[mic] cleanup failed:', e); }
        setLiveModeActive(false);
      } else {
        setLiveModeActive(true);
        startMicrophoneMode().catch(err => {
          console.error('[mic]', err);
          setLiveModeActive(false);
        });
      }
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

let qrCodeGenerated = false;

function ensureQrCode() {
  if (qrCodeGenerated) return;
  var qr = qrcode(0, 'M');
  qr.addData('https://mrericsir.github.io/moshtroncity/');
  qr.make();
  document.getElementById('qr-code').innerHTML = qr.createSvgTag({ cellSize: 7, margin: 4 });
  qrCodeGenerated = true;
}

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
