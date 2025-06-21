const video = document.getElementById('video');
const radar = document.getElementById('radar');
const ctx = radar.getContext('2d');
const statusDiv = document.getElementById('status');
const detectedListDiv = document.getElementById('detected-list');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');



// Fake loading animation
let progress = 0;
const progressBar = document.getElementById('progress-bar');
let loadingDone = false;

const fakeProgress = setInterval(() => {
  if (progress < 93 && !loadingDone) {
    progress += Math.random() * 2;
    progressBar.style.width = `${progress}%`;
  }
}, 222);


const width = radar.width;
const height = radar.height;
const centerX = width / 2;
const centerY = height / 2;
const radarRadius = 185;

let currentFacingMode = 'environment';
let model;
let detectionLog = [];
let detections = [];
let blips = [];
let sweepAngle = 0;
let voiceEnabled = true; 
let detectionEnabled = true;
let filterClass = null;
const SWEEP_SPEED = 0.03;

const ghostVoice = [
  new Audio("/ghostVoice/unusual.mp3"),
  new Audio("/ghostVoice/here.mp3"),
  new Audio("/ghostVoice/ghost.mp3"),
];

async function setupCamera(facingMode) {
  return new Promise((resolve) => {
    const tryCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: 640, height: 480 },
          audio: false,
        });

        video.srcObject = stream;
        video.oncanplay = () => {
          video.play();
          clearInterval(timer);
          resolve();
        };
      } catch (e) {
        alert('Need camera permission to run program');
      }
    };

    const timer = setInterval(tryCamera, 2000);
    tryCamera();
  });
};




function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 1.1;
  window.speechSynthesis.speak(utterance);
}


function toggleDetection() {
  detectionEnabled = !detectionEnabled;
  speak(detectionEnabled ? 'Detection started' : 'Detection paused');
  document.querySelector('#controls button:nth-child(1)').textContent =
    detectionEnabled ? 'Pause Detection' : 'Start Detection';
}

function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  speak(voiceEnabled ? 'Voice enabled' : 'Voice muted');
  document.querySelector('#controls button:nth-child(2)').textContent =
    voiceEnabled ? 'Mute Voice' : 'Unmute Voice';
}

function filterPeople() {
  filterClass = 'person';
  speak('Filtering for people only');
  statusDiv.textContent = "people only mode"
}

function clearFilter() {
  filterClass = null;
  speak('Showing all detected objects');
}

async function switchCamera() {
  currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';

  // Stop existing camera
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }

  await setupCamera(currentFacingMode);
  console.log("Switching to", currentFacingMode);
}

function bboxCenterToRadar(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const normX = (cx / video.videoWidth) * 2 - 1;
  const normY = (cy / video.videoHeight) * 2 - 1;
  const dist = Math.min(Math.sqrt(normX * normX + normY * normY), 1);
  return {
    x: normX * radarRadius,
    y: normY * radarRadius,
    dist,
  };
}

function updateBlips() {
  detections.forEach((det) => {
    if (det.score < 0.5) return;
    const [x, y, width, height] = det.bbox;
    const radarPos = bboxCenterToRadar(x, y, width, height);
    const existing = blips.find(
      (b) => Math.hypot(b.x - radarPos.x, b.y - radarPos.y) < 10
    );
    if (existing) {
      existing.hit = false;
    } else {
      blips.push({
        x: radarPos.x,
        y: radarPos.y,
        angle: Math.atan2(radarPos.y, radarPos.x),
        hit: false,
        class: det.class,
        spoken: false,
        fake: false,
        opacity: 1,
        size: 7,
      });
    };
  });
}

function drawRadar() {
  ctx.clearRect(0, 0, width, height);
  
  // Radar background
  const bg = ctx.createRadialGradient(
    centerX, centerY,
    radarRadius * 0.6,
    centerX, centerY,
    radarRadius
  );
  bg.addColorStop(0, '#004400aa');
  bg.addColorStop(1, '#001100ff');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
  ctx.fill();

  // Outer glowing ring
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ff00ffaa';
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radarRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner grid
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '0f0';
  for (let r = radarRadius / 5; r < radarRadius; r += radarRadius / 5) {
    ctx.beginPath();
    ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(centerX - radarRadius, centerY);
  ctx.lineTo(centerX + radarRadius, centerY);
  ctx.moveTo(centerX, centerY - radarRadius);
  ctx.lineTo(centerX, centerY + radarRadius);
  ctx.stroke();

  // Sweep
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(sweepAngle);

  const sweepRange = 0.5;
  const nearGhost = blips.some((b) => {
    
    if (b.fake !== true) return false;
    const angle = Math.atan2(b.y, b.x);
    const normBlip = (angle + 2 * Math.PI) % (2 * Math.PI);
    const normSweep = (sweepAngle + 2 * Math.PI) % (2 * Math.PI);
    const diff = Math.abs(normSweep - normBlip);
    return diff < sweepRange || 2 * Math.PI - diff < sweepRange;
  });

  const sweepGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radarRadius);
  if (nearGhost) {
    sweepGradient.addColorStop(0, 'rgba(255,0,0,0.8)'); // Magenta
    sweepGradient.addColorStop(1, 'rgba(255,0,255,0)');
  } else {
    sweepGradient.addColorStop(0, 'rgba(0,255,0,0.7)'); // Lime
    sweepGradient.addColorStop(1, 'rgba(0,255,0,0)');
  }

  ctx.fillStyle = sweepGradient;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radarRadius, -0.04, 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

function drawBlips() {
  const sweepRange = 0.08;

  blips.forEach((blip) => {
    const angle = Math.atan2(blip.y, blip.x);
    const normBlip = (angle + 2 * Math.PI) % (2 * Math.PI);
    const normSweep = (sweepAngle + 2 * Math.PI) % (2 * Math.PI);
    const angleDiff = Math.abs(normSweep - normBlip);
    const near = angleDiff < sweepRange || 2 * Math.PI - angleDiff < sweepRange;

    if (near) blip.hit = true;

    const outerColor = blip.fake ? 'magenta' : 'red';
    const innerColor = blip.fake ? '#ff77ff' : '#ff6666';

    if (!blip.hit) {
      ctx.shadowColor = outerColor;
      ctx.shadowBlur = 12;
      ctx.fillStyle = outerColor;
      ctx.beginPath();
      ctx.arc(centerX + blip.x, centerY + blip.y, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.fillStyle = innerColor;
      ctx.beginPath();
      ctx.arc(centerX + blip.x, centerY + blip.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Remove hit blips
  blips = blips.filter((b) => !b.hit);
};

function drawDetections() {
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  detections.forEach((pred) => {
    if (pred.score > 0.5) {
      const [x, y, width, height] = pred.bbox;
      const scaleX = overlay.width / video.videoWidth;
      const scaleY = overlay.height / video.videoHeight;

      const boxX = x * scaleX;
      const boxY = y * scaleY;

      overlayCtx.strokeStyle = 'lime';
      overlayCtx.lineWidth = 2;
      overlayCtx.strokeRect(
        boxX,
        boxY,
        width * scaleX,
        height * scaleY
      );

      overlayCtx.fillStyle = 'lime';
      overlayCtx.font = '12px monospace';

      const labelY = boxY > 12 ? boxY - 2 : boxY + 14;

      overlayCtx.fillText(
        `${pred.class} ${(pred.score * 100).toFixed(1)}%`,
        boxX,
        labelY
      );
    }
  });
};

function spawnFakeGhostBlip() {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * radarRadius * 0.9;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  blips.push({ x, y, angle, hit: false, fake: true });

  overlay.style.filter = 'invert(1)';
  setTimeout(() => (overlay.style.filter = 'invert(0)'), 150);
  
   const voice = ghostVoice[Math.floor(Math.random() * ghostVoice.length)];
     voice.play().catch((e) => {
      console.warn('Playback failed:', e);
});
};

function startDetectionLoop() {
  setInterval(async () => {
    if (!model || !detectionEnabled) return;
    const rawDetections = await model.detect(video);
    
    
    detections = filterClass
      ? rawDetections.filter(
          (d) => d.class === filterClass && d.score > 0.5
        )
      : rawDetections.filter((d) => d.score > 0.5);
    drawDetections();
    
    detections.forEach((e)=>{
      detectionLog.push(e.class)
    });

    statusDiv.textContent = `Detected: ${detections.length} objects`;
    detectedListDiv.textContent = detections
      .map(
        (d, i) =>
          `${i + 1}. ${d.class} (${(d.score * 100).toFixed(1)}%)`
      )
      .join('\n');

    if (voiceEnabled) {
      const classCounts = {};
      detections.forEach((det) => {
        classCounts[det.class] = (classCounts[det.class] || 0) + 1;
      });
      for (const objClass in classCounts) {
        const count = classCounts[objClass];
        const label =
          count > 1 ? `${count} ${objClass}s` : `${count} ${objClass}`;
        speak(`${label} detected`);
      }
    }
    updateBlips();
  }, 2500);
}

function animationLoop() {
  sweepAngle += SWEEP_SPEED;
  if (sweepAngle > Math.PI * 2) sweepAngle -= Math.PI * 2;
  drawRadar();
  drawBlips();
  drawDetections();
  requestAnimationFrame(animationLoop);
}

async function main() {
  await setupCamera(currentFacingMode);
  statusDiv.textContent = 'Loading model...';
  
  model = await cocoSsd.load();
  loadingDone = true;
  speak("System initialized");

const finishInterval = setInterval(() => {
  if (progress < 100) {
    progress += 5;
    progressBar.style.width = `${Math.min(progress, 100)}%`;
    document.querySelector('.loader-text').textContent = "System initialized..."
  } else {
    clearInterval(finishInterval);
    clearInterval(fakeProgress);
    document.getElementById('loader-screen').style.display = 'none';
  }
}, 60);
  
  statusDiv.textContent = 'Starting detection...';
  
  animationLoop();
  startDetectionLoop();
  updateBlips();

  setTimeout(() => {
    setInterval(() => {
      if (Math.random() < 0.7) spawnFakeGhostBlip();
    }, 3500);
  }, 4000);

  setInterval(() => {
    overlay.style.opacity = Math.random() > 0.95 ? '0.8' : '1';
    radar.style.filter =
      Math.random() > 0.97 ? 'brightness(1.5)' : 'brightness(1)';
  }, 150);
};


main();