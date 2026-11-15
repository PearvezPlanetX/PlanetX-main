
const STORAGE_KEY = 'spherex_candidates';
const SCANNED_KEY = 'spherex_scanned_sectors';
const BRIEFING_SEEN_KEY = 'spherex_briefing_seen';

const localBackendBase = window.location.hostname
  ? `${window.location.protocol}//${window.location.hostname}:5001`
  : 'http://127.0.0.1:5001';
const configuredApiBase = window.PLANETX_API_BASE
  && window.PLANETX_API_BASE.trim();
const isLocalDevelopment = (
  window.location.hostname === 'localhost'
  || window.location.hostname === '127.0.0.1'
  || window.location.protocol === 'file:'
);
const API_BASE = configuredApiBase
  || (isLocalDevelopment
    ? (window.location.port === '5001' ? '' : localBackendBase)
    : '');

const DEMO_TARGET = {
  ra: 133.795129,
  dec: -7.245147
};

const KNOWN_TARGETS = {
  'barnards-star': {
    name: "Barnard's Star",
    ra: 269.452075,
    dec: 4.693365
  },
  'epsilon-indi-b': {
    name: 'Epsilon Indi B',
    ra: 331.044146,
    dec: -56.782844
  },
  'wise-0855': {
    name: 'WISE 0855',
    ra: 133.795129,
    dec: -7.245147
  },
  'rw-aurigae': {
    name: 'RW Aurigae',
    ra: 76.956525,
    dec: 30.401438
  },
  'r-draconis': {
    name: 'R Draconis',
    ra: 248.167612,
    dec: 66.754979
  }
};

const REAL_DEMO_SECTOR = 'SEC-19';
const STATIC_IMAGE_PATH = new URL('data/target_cutout.png', document.baseURI).href;
const STATIC_OBSERVATION_DATE = '2025-05-05';

// ==========================================
// 1. DOM ELEMENTS
// ==========================================

const canvas = document.getElementById('sky-canvas');
const ctx = canvas.getContext('2d');

const sectorSearchInput = document.getElementById('sector-search');
const logoHome = document.getElementById('logo-home');

const missionModal = document.getElementById('mission-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnStartExploring = document.getElementById('btn-start-exploring');
const btnOpenGuide = document.getElementById('btn-open-guide');
const exploreTrigger = document.getElementById('explore-trigger');

const bannerBandEl = document.getElementById('banner-band');
const bannerWavelengthEl = document.getElementById('banner-wavelength');
const bannerScannedEl = document.getElementById('banner-scanned');
const bannerFlaggedEl = document.getElementById('banner-flagged');

const sectorTitleEl = document.getElementById('sector-title');
const sectorBadge = document.getElementById('sector-badge');
const btnBackAllSky = document.getElementById('btn-back-allsky');
const btnMarkClear = document.getElementById('btn-mark-clear');
const bandSlider = document.getElementById('band-slider');
const bandLabel = document.getElementById('band-label');
const viewportModeTag = document.getElementById('viewport-mode-tag');
const hudReadout = document.getElementById('hud-readout');
const btnBlink = document.getElementById('btn-blink');
const btnDipole = document.getElementById('btn-dipole');
const targetCoordsEl = document.getElementById('target-coords');
const btnFlag = document.getElementById('btn-flag');

const tabExplorer = document.getElementById('tab-explorer');
const tabCandidates = document.getElementById('tab-candidates');
const viewExplorer = document.getElementById('view-explorer');
const viewCandidates = document.getElementById('view-candidates');

const candidateCountEl = document.getElementById('candidate-count');
const candidatesTbody = document.getElementById('candidates-tbody');

const btnExportJson = document.getElementById('btn-export-json');
const btnClearLog = document.getElementById('btn-clear-log');
const surveyStatus = document.getElementById('survey-status');
const targetPreset = document.getElementById('target-preset');
const raInput = document.getElementById('ra-input');
const decInput = document.getElementById('dec-input');
const btnInspectCoordinates = document.getElementById('btn-inspect-coordinates');
const coordinateStatus = document.getElementById('coordinate-status');

// ==========================================
// 2. BACKEND CONNECTION
// ==========================================

let backendConnected = false;
let sectorCoverage = new Map();
let sectorCoverageLoaded = false;
const cutoutCache = new Map();
let requestedTarget = null;

function parseCoordinate(value, isRightAscension) {
  const text = value.trim();
  if (!text) return NaN;

  const decimal = Number(text);
  if (Number.isFinite(decimal)) return decimal;

  const parts = text
    .replace(/[hHdDmMsS:]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(Number);

  if (parts.some(part => !Number.isFinite(part)) || parts.length < 2) {
    return NaN;
  }

  const sign = parts[0] < 0 || (!isRightAscension && text.startsWith('-'))
    ? -1
    : 1;
  const degrees = Math.abs(parts[0]) + parts[1] / 60 + (parts[2] || 0) / 3600;
  return isRightAscension ? degrees * 15 : sign * degrees;
}

function getSectorForCoordinates(ra, dec) {
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
  const column = Math.min(Math.floor(ra / (360 / GRID_COLS)), GRID_COLS - 1);
  const row = Math.min(Math.floor((90 - dec) / (180 / GRID_ROWS)), GRID_ROWS - 1);
  return SECTORS.find(sector => sector.col === column && sector.row === row) || null;
}

function setCoordinateStatus(message, isError = false) {
  coordinateStatus.textContent = message;
  coordinateStatus.classList.toggle('error', isError);
}

function isRealSector(sectorId) {
  const coverage = sectorCoverage.get(sectorId);
  return Boolean(coverage && coverage.has_real_data);
}

function getRealSectors() {
  return SECTORS.filter(sector => isRealSector(sector.id));
}

targetPreset.addEventListener('change', () => {
  const target = KNOWN_TARGETS[targetPreset.value];
  if (!target) return;

  raInput.value = target.ra;
  decInput.value = target.dec;
  setCoordinateStatus(`${target.name} coordinates loaded. Inspect to query FITS coverage.`);
});

async function inspectCoordinates() {
  const ra = parseCoordinate(raInput.value, true);
  const dec = parseCoordinate(decInput.value, false);

  if (!Number.isFinite(ra) || !Number.isFinite(dec)
      || ra < 0 || ra >= 360 || dec < -90 || dec > 90) {
    setCoordinateStatus('Enter RA 0–360° and Dec -90° to +90°.', true);
    return;
  }

  if (!sectorCoverageLoaded) {
    setCoordinateStatus('Waiting for verified FITS coverage to load.', true);
    return;
  }

  const sector = getSectorForCoordinates(ra, dec);
  if (!sector || !isRealSector(sector.id)) {
    setCoordinateStatus('No verified local FITS coverage for these coordinates.', true);
    hudReadout.textContent = 'NO REAL FITS COVERAGE FOR THIS QUERY';
    return;
  }

  const selectedPreset = KNOWN_TARGETS[targetPreset.value];
  requestedTarget = {
    name: selectedPreset
      && Math.abs(selectedPreset.ra - ra) < 0.0001
      && Math.abs(selectedPreset.dec - dec) < 0.0001
      ? selectedPreset.name
      : 'CUSTOM TARGET',
    ra,
    dec
  };
  setCoordinateStatus(`Loading real FITS data in ${sector.id}...`);
  switchTab('explorer');
  enterSector(sector);
}

btnInspectCoordinates.addEventListener('click', inspectCoordinates);

raInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') inspectCoordinates();
});

decInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') inspectCoordinates();
});

async function checkBackend() {
  try {
    const response = await fetch(`${API_BASE}/api/health`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    backendConnected = data.status === 'ok';
    surveyStatus.lastChild.textContent = backendConnected
      ? ' REAL_DATA_CONNECTED'
      : ' BACKEND_OFFLINE';

    console.log('PLANETX BACKEND:', data);

    return backendConnected;

  } catch (error) {
    backendConnected = false;
    surveyStatus.lastChild.textContent = ' BACKEND_OFFLINE';

    console.error('BACKEND CONNECTION FAILED:', error);

    return false;
  }
}

async function fetchSpherexCutout(ra, dec, size = 0.05) {
  const cacheKey = `${ra}:${dec}:${size}`;
  if (cutoutCache.has(cacheKey)) {
    return cutoutCache.get(cacheKey);
  }

  try {
    const params = new URLSearchParams({
      ra: String(ra),
      dec: String(dec),
      size: String(size)
    });

    const response = await fetch(
      `${API_BASE}/api/cutout?${params.toString()}`
    );

    if (!response.ok) {
      throw new Error(`Cutout API returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'real_data' || !data.image) {
      throw new Error(data.message || 'No real image returned.');
    }

    cutoutCache.set(cacheKey, data);
    return data;

  } catch (error) {
    console.error('SPHEREx API ERROR:', error);
    return null;
  }
}

async function fetchCandidates() {
  const response = await fetch(`${API_BASE}/api/candidates`);

  if (!response.ok) {
    throw new Error(`Candidate API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data.candidates)) {
    throw new Error('Candidate API returned an invalid archive.');
  }

  return data.candidates;
}

async function fetchSectorCoverage() {
  const response = await fetch(`${API_BASE}/api/sectors`);
  if (!response.ok) {
    throw new Error(`Sector API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.sectors)) {
    throw new Error('Sector API returned an invalid response.');
  }

  return new Map(data.sectors.map(sector => [sector.id, sector]));
}

function getStaticSectorCoverage() {
  return new Map(SECTORS.map(sector => [
    sector.id,
    {
      ...sector,
      has_real_data: sector.id === REAL_DEMO_SECTOR,
      observations: sector.id === REAL_DEMO_SECTOR
        ? [{
            file: 'sample_spherex.fits',
            date: STATIC_OBSERVATION_DATE,
            pixel_x: null,
            pixel_y: null
          }]
        : [],
      sample_ra: sector.id === REAL_DEMO_SECTOR ? DEMO_TARGET.ra : null,
      sample_dec: sector.id === REAL_DEMO_SECTOR ? DEMO_TARGET.dec : null
    }
  ]));
}

async function saveCandidate(candidate) {
  const response = await fetch(`${API_BASE}/api/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(candidate)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Candidate API returned HTTP ${response.status}`);
  }
}

async function clearCandidates() {
  const response = await fetch(`${API_BASE}/api/candidates`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Candidate API returned HTTP ${response.status}`);
  }
}

// ==========================================
// 3. MODAL CONTROLS
// ==========================================

function openMissionModal() {
  missionModal.classList.remove('hidden');
}

function closeMissionModal() {
  missionModal.classList.add('hidden');
  localStorage.setItem(BRIEFING_SEEN_KEY, 'true');
}

function isModalOpen() {
  return !missionModal.classList.contains('hidden');
}

btnCloseModal.addEventListener('click', closeMissionModal);
btnStartExploring.addEventListener('click', closeMissionModal);
btnOpenGuide.addEventListener('click', openMissionModal);
exploreTrigger.addEventListener('click', openMissionModal);

missionModal.addEventListener('click', e => {
  if (e.target === missionModal) {
    closeMissionModal();
  }
});

if (localStorage.getItem(BRIEFING_SEEN_KEY) === 'true') {
  closeMissionModal();
}

// ==========================================
// 4. DEMONSTRATION SECTORS
// ==========================================

const GRID_COLS = 8;
const GRID_ROWS = 4;
const SECTORS = [];

for (let r = 0; r < GRID_ROWS; r++) {
  for (let c = 0; c < GRID_COLS; c++) {
    const idx = r * GRID_COLS + c + 1;
    const id = `SEC-${String(idx).padStart(2, '0')}`;

    const ra = Number(((c + 0.5) * (360 / GRID_COLS)).toFixed(1));
    const dec = Number((67.5 - r * 45).toFixed(1));

    SECTORS.push({
      id,
      index: idx,
      col: c,
      row: r,
      ra,
      dec
    });
  }
}

// ==========================================
// 5. APPLICATION STATE
// ==========================================

let viewportLevel = 'allsky';
let activeSector = null;
let hoveredSector = null;

let epoch1Source = null;
let epoch2Source = null;

let activeEpoch = 1;
let viewMode = 'blink';
let selectedTarget = null;

let realObservation = false;
let realObservationDate = null;
let realObservationFile = null;
let staticRealImage = false;

let savedCandidates;
try {
  savedCandidates = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (!Array.isArray(savedCandidates)) savedCandidates = [];
} catch (error) {
  console.warn('Could not read local candidate cache:', error);
  savedCandidates = [];
}

let scannedSectors;
try {
  const storedSectors = JSON.parse(localStorage.getItem(SCANNED_KEY) || '[]');
  scannedSectors = new Set(Array.isArray(storedSectors) ? storedSectors : []);
} catch (error) {
  console.warn('Could not read local scanned-sector cache:', error);
  scannedSectors = new Set();
}

// ==========================================
// 6. SEEDED RANDOM GENERATOR
// ==========================================

function createSeededRng(seed) {
  let s = seed * 2654435761;

  return function () {
    s = (s ^ (s >>> 15)) * 2246822519;
    s = (s ^ (s >>> 13)) * 3266489917;

    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

function getSectorData(sector) {
  const rng = createSeededRng(sector.index * 137);

  const stars = Array.from({ length: 65 }, () => ({
    x: Math.floor(rng() * (canvas.width - 32)) + 16,
    y: Math.floor(rng() * (canvas.height - 32)) + 16,
    brightness: Math.floor(110 + rng() * 145),
    radius: 1.2 + rng() * 1.2
  }));

  const hasMover = sector.index % 4 !== 0;
  const isSlowColdObject = sector.index % 2 === 1;

  const mover = hasMover
    ? {
        e1x: Math.floor(120 + rng() * (canvas.width - 240)),
        e1y: Math.floor(80 + rng() * (canvas.height - 160)),
        dx: isSlowColdObject
          ? Math.floor(18 + rng() * 16)
          : Math.floor(45 + rng() * 35),
        dy: isSlowColdObject
          ? Math.floor(-12 + rng() * 24)
          : Math.floor(-30 + rng() * 60),
        type: isSlowColdObject ? 'cold_ir' : 'asteroid'
      }
    : null;

  return { stars, mover };
}

// ==========================================
// 7. ALL-SKY MAP
// ==========================================

const MAP_CX = canvas.width / 2;
const MAP_CY = canvas.height / 2;
const MAP_RX = 296;
const MAP_RY = 156;

function getSectorScreenBox(sector) {
  const gridLeft = MAP_CX - MAP_RX;
  const gridTop = MAP_CY - MAP_RY;

  const cellW = (MAP_RX * 2) / GRID_COLS;
  const cellH = (MAP_RY * 2) / GRID_ROWS;

  return {
    x: gridLeft + sector.col * cellW,
    y: gridTop + sector.row * cellH,
    w: cellW,
    h: cellH
  };
}

function renderAllSkyMap() {
  const band = Number(bandSlider.value);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();

  ctx.beginPath();
  ctx.ellipse(MAP_CX, MAP_CY, MAP_RX, MAP_RY, 0, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const irIntensity = 0.08 + (band / 102) * 0.16;

  ctx.strokeStyle = `rgba(225, 29, 72, ${irIntensity})`;
  ctx.lineWidth = 34;
  ctx.beginPath();

  for (let x = MAP_CX - MAP_RX; x <= MAP_CX + MAP_RX; x += 8) {
    const normX = (x - MAP_CX) / MAP_RX;
    const galY = MAP_CY + Math.sin(normX * Math.PI) * 65;

    if (x === MAP_CX - MAP_RX) {
      ctx.moveTo(x, galY);
    } else {
      ctx.lineTo(x, galY);
    }
  }

  ctx.stroke();

  const skyRng = createSeededRng(999);

  for (let i = 0; i < 220; i++) {
    const sx = MAP_CX - MAP_RX + skyRng() * MAP_RX * 2;
    const sy = MAP_CY - MAP_RY + skyRng() * MAP_RY * 2;

    ctx.fillStyle = `rgba(248, 250, 252, ${0.25 + skyRng() * 0.6})`;
    ctx.fillRect(sx, sy, 1.3, 1.3);
  }

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;

  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();

    ctx.ellipse(
      MAP_CX,
      MAP_CY,
      Math.abs(i) * (MAP_RX / 3) || 2,
      MAP_RY,
      0,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  }

  for (let r = 1; r < GRID_ROWS; r++) {
    const y = MAP_CY - MAP_RY + (r * MAP_RY * 2) / GRID_ROWS;

    ctx.beginPath();
    ctx.moveTo(MAP_CX - MAP_RX, y);
    ctx.lineTo(MAP_CX + MAP_RX, y);
    ctx.stroke();
  }

  if (!sectorCoverageLoaded) {
    viewportModeTag.textContent = 'LOADING VERIFIED FITS COVERAGE';
    hudReadout.textContent = backendConnected
      ? 'CHECKING ALL SECTORS...'
      : 'BACKEND OFFLINE — VERIFIED SECTORS UNAVAILABLE';
    ctx.restore();
    return;
  }

  getRealSectors().forEach(sector => {
    const box = getSectorScreenBox(sector);

    const hasCandidate = savedCandidates.some(
      c => (c.sectorId || 'SEC-01') === sector.id
    );

    const isScanned = scannedSectors.has(sector.id);
    const isHovered = hoveredSector && hoveredSector.id === sector.id;

    if (hasCandidate) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.18)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    } else if (isScanned) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }

    if (isHovered) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.28)';
      ctx.fillRect(box.x, box.y, box.w, box.h);

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    } else {
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.65)';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }

    ctx.fillStyle = isHovered ? '#f8fafc' : 'rgba(148, 163, 184, 0.7)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(sector.id, box.x + 5, box.y + 13);

    if (hasCandidate) {
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(box.x + box.w - 10, box.y + box.h - 10, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const coverage = sectorCoverage.get(sector.id);
    if (coverage && coverage.has_real_data) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x + 3, box.y + 3, box.w - 6, box.h - 6);
    }
  });

  ctx.restore();

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.ellipse(MAP_CX, MAP_CY, MAP_RX, MAP_RY, 0, 0, Math.PI * 2);
  ctx.stroke();

  viewportModeTag.textContent = 'VERIFIED REAL-DATA SECTORS';

  hudReadout.textContent = hoveredSector
    ? `${hoveredSector.id} // RA ${hoveredSector.ra}° DEC ${hoveredSector.dec}°`
    : 'GREEN SECTOR = VERIFIED FITS COVERAGE | CLICK TO INSPECT';
}

// ==========================================
// 8. SIMULATED EPOCHS
// ==========================================

function buildMockEpochCanvas(sector, epochNum, band) {
  const offscreen = document.createElement('canvas');

  offscreen.width = canvas.width;
  offscreen.height = canvas.height;

  const octx = offscreen.getContext('2d');

  octx.fillStyle = '#020308';
  octx.fillRect(0, 0, canvas.width, canvas.height);

  const { stars, mover } = getSectorData(sector);

  stars.forEach(star => {
    octx.fillStyle =
      `rgb(${star.brightness}, ${star.brightness}, ${star.brightness})`;

    octx.beginPath();
    octx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    octx.fill();
  });

  if (mover) {
    const targetX = epochNum === 1 ? mover.e1x : mover.e1x + mover.dx;
    const targetY = epochNum === 1 ? mover.e1y : mover.e1y + mover.dy;

    const irGlow = mover.type === 'cold_ir'
      ? Math.min(255, Math.floor(40 + (band / 102) * 215))
      : Math.min(255, Math.floor(220 - (band / 102) * 110));

    octx.fillStyle = `rgb(${irGlow}, ${irGlow}, ${irGlow})`;
    octx.beginPath();
    octx.arc(targetX, targetY, 3, 0, Math.PI * 2);
    octx.fill();
  }

  return offscreen;
}

// ==========================================
// 9. RETICLE
// ==========================================

function drawReticle(x, y) {
  const size = 14;
  const gap = 5;

  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 2;
  ctx.beginPath();

  ctx.moveTo(x - size, y - gap);
  ctx.lineTo(x - size, y - size);
  ctx.lineTo(x - gap, y - size);

  ctx.moveTo(x + gap, y - size);
  ctx.lineTo(x + size, y - size);
  ctx.lineTo(x + size, y - gap);

  ctx.moveTo(x - size, y + gap);
  ctx.lineTo(x - size, y + size);
  ctx.lineTo(x - gap, y + size);

  ctx.moveTo(x + gap, y + size);
  ctx.lineTo(x + size, y + size);
  ctx.lineTo(x + size, y + gap);

  ctx.stroke();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.stroke();
}

function buildRealComparisonCanvas(source) {
  const comparison = document.createElement('canvas');
  comparison.width = canvas.width;
  comparison.height = canvas.height;
  const comparisonContext = comparison.getContext('2d');

  comparisonContext.fillStyle = '#020308';
  comparisonContext.fillRect(0, 0, comparison.width, comparison.height);
  comparisonContext.globalAlpha = 0.9;
  comparisonContext.drawImage(
    source,
    10,
    0,
    comparison.width,
    comparison.height
  );
  comparisonContext.globalAlpha = 1;
  return comparison;
}

function drawWavelengthOverlay() {
  const band = Number(bandSlider.value);
  const wavelength = 0.75 + ((band - 1) / 101) * 4.25;
  const hue = 220 - ((band - 1) / 101) * 210;

  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = `hsl(${hue}, 90%, 55%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

}

// ==========================================
// 10. SECTOR RENDERER
// ==========================================

function renderSectorView() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (realObservation && epoch1Source) {
    if (viewMode === 'dipole' && epoch2Source) {
      ctx.drawImage(epoch1Source, 0, 0, canvas.width, canvas.height);
      const epoch1 = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.drawImage(epoch2Source, 0, 0, canvas.width, canvas.height);
      const epoch2 = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const difference = ctx.createImageData(canvas.width, canvas.height);

      for (let i = 0; i < difference.data.length; i += 4) {
        const delta = epoch2.data[i] - epoch1.data[i];
        difference.data[i] = delta > 12 ? delta * 2 : 0;
        difference.data[i + 1] = 0;
        difference.data[i + 2] = delta < -12 ? -delta * 2 : 0;
        difference.data[i + 3] = 255;
      }

      ctx.putImageData(difference, 0, 0);
    } else {
      const source = activeEpoch === 2 && epoch2Source
        ? epoch2Source
        : epoch1Source;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    }

    drawWavelengthOverlay();

    viewportModeTag.textContent = staticRealImage
      ? 'REAL SPHEREx — STATIC PREGENERATED OBSERVATION'
      : `SECTOR ${activeSector.id} // REAL FITS DATA`;

    hudReadout.textContent =
      viewMode === 'dipole'
        ? `${realObservationFile} | DERIVED DIFFERENCE VIEW`
        : `${realObservationFile} | EPOCH ${activeEpoch} | ${realObservationDate}`;
    const band = Number(bandSlider.value);
    const wavelength = 0.75 + ((band - 1) / 101) * 4.25;
    hudReadout.textContent += ` | BAND ${band} (${wavelength.toFixed(2)} µm)`;

    if (selectedTarget) {
      drawReticle(selectedTarget.x, selectedTarget.y);
    }
    return;
  }

  if (viewMode === 'blink') {
    const src = activeEpoch === 1 ? epoch1Source : epoch2Source;

    if (src) {
      ctx.drawImage(src, 0, 0);
    }

    viewportModeTag.textContent =
      `SECTOR ${activeSector.id} // SIMULATED BLINK`;

    hudReadout.textContent =
      `SIMULATED EPOCH ${activeEpoch} — NOT REAL OBSERVATION DATA`;

  } else if (viewMode === 'dipole') {
    if (!epoch1Source || !epoch2Source) return;

    ctx.drawImage(epoch1Source, 0, 0);

    const e1 = ctx.getImageData(0, 0, canvas.width, canvas.height);

    ctx.drawImage(epoch2Source, 0, 0);

    const e2 = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const out = ctx.createImageData(canvas.width, canvas.height);

    for (let i = 0; i < e1.data.length; i += 4) {
      const diff = e2.data[i] - e1.data[i];

      out.data[i] = diff > 15 ? diff * 2 : 0;
      out.data[i + 1] = 0;
      out.data[i + 2] = diff < -15 ? -diff * 2 : 0;
      out.data[i + 3] = 255;
    }

    ctx.putImageData(out, 0, 0);

    viewportModeTag.textContent =
      `SECTOR ${activeSector.id} // SIMULATED DIFFERENCE`;

    hudReadout.textContent =
      'SIMULATION ONLY — RED/BLUE SHOW MOCK PIXEL DIFFERENCES';
  }

  if (selectedTarget) {
    drawReticle(selectedTarget.x, selectedTarget.y);
  }
}

function renderFrame() {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  } else {
    renderSectorView();
  }
}

// ==========================================
// 11. ENTER SECTOR
// ==========================================

function enterSector(sector) {
  activeSector = sector;
  viewportLevel = 'sector';

  viewMode = 'blink';
  activeEpoch = 1;
  selectedTarget = null;

  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = null;
  epoch2Source = null;

  canvas.classList.add('sector-mode');

  sectorTitleEl.textContent = `Sector ${sector.id}`;

  sectorBadge.textContent =
    `Grid Coordinates: RA ${sector.ra}°, Dec ${sector.dec}°`;

  targetCoordsEl.textContent = 'Click an object in this sector...';

  btnBackAllSky.disabled = false;
  btnMarkClear.disabled = false;

  btnBlink.disabled = false;
  btnDipole.disabled = false;

  btnFlag.disabled = true;
  btnFlag.textContent = 'Flag Moving Candidate';

  if (spectrumChart) {
    spectrumChart.data.datasets[0].data = Array(102).fill(0);
    spectrumChart.update();
  }

  loadSkyPatch(Number(bandSlider.value));
}

// ==========================================
// 12. RETURN TO ALL SKY
// ==========================================

function returnToAllSky() {
  viewportLevel = 'allsky';
  activeSector = null;
  selectedTarget = null;

  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = null;
  epoch2Source = null;

  canvas.classList.remove('sector-mode');

  sectorTitleEl.textContent = 'All-Sky Survey';

  const realSectorCount = getRealSectors().length;
  sectorBadge.textContent = sectorCoverageLoaded
    ? `${realSectorCount} verified FITS sectors available. Select a green sector.`
    : 'Loading verified FITS sectors...';

  targetCoordsEl.textContent =
    'Select a sector and click an object...';

  btnBackAllSky.disabled = true;
  btnMarkClear.disabled = true;
  btnBlink.disabled = true;
  btnDipole.disabled = true;
  btnFlag.disabled = true;

  renderFrame();
}

// ==========================================
// 13. STATIC IMAGE FALLBACK
// ==========================================

function loadStaticRealImage() {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = () => reject(
      new Error(`Could not load ${STATIC_IMAGE_PATH}`)
    );

    img.src = STATIC_IMAGE_PATH;
  });
}

// ==========================================
// 14. LOAD REAL OR SIMULATED SKY PATCH
// ==========================================

async function loadSkyPatch(band) {
  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
    return;
  }

  if (!activeSector) return;

  const coverage = sectorCoverage.get(activeSector.id);
  if ((coverage && coverage.has_real_data)
      || activeSector.id === REAL_DEMO_SECTOR) {
    const realTarget = requestedTarget
      || (coverage && coverage.sample_ra !== null
      ? { ra: coverage.sample_ra, dec: coverage.sample_dec }
      : DEMO_TARGET);

    try {
      hudReadout.textContent = 'CONNECTING TO SPHEREx BACKEND...';

      const data = await fetchSpherexCutout(
        realTarget.ra,
        realTarget.dec,
        0.05
      );

      if (!data) {
        throw new Error('Backend did not return real SPHEREx data.');
      }

      const img = new Image();

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(
          new Error('Could not decode returned SPHEREx image.')
        );
        img.src = data.image;
      });

      epoch1Source = img;
      epoch2Source = buildRealComparisonCanvas(img);

      realObservation = true;
      realObservationDate = data.date;
      realObservationFile = data.file;
      staticRealImage = false;

      if (requestedTarget) {
        selectedTarget = {
          x: canvas.width / 2,
          y: canvas.height / 2,
          ra: Number(data.ra).toFixed(4),
          dec: Number(data.dec).toFixed(4)
        };
        updateSpectrumChart(selectedTarget.x, selectedTarget.y);
      }

      btnBlink.disabled = false;
      btnDipole.disabled = false;
      btnFlag.disabled = true;

      targetCoordsEl.textContent =
        `${requestedTarget ? requestedTarget.name : 'REAL FITS TARGET'} | RA ${data.ra}° | DEC ${data.dec}°`;

      viewportModeTag.textContent = 'REAL SPHEREx OBSERVATION';
      setCoordinateStatus(`Loaded real FITS data in ${activeSector.id}.`);

      renderSectorView();

      console.log('REAL SPHEREx DATA LOADED:', data);

      return;

    } catch (apiError) {
      console.warn('Backend unavailable; trying static image.', apiError);
    }

    try {
      hudReadout.textContent = 'LOADING STATIC SPHEREx OBSERVATION...';

      const img = await loadStaticRealImage();

      epoch1Source = img;
      epoch2Source = null;

      realObservation = true;
      realObservationDate = STATIC_OBSERVATION_DATE;
      realObservationFile = 'sample_spherex.fits';
      staticRealImage = true;

      if (requestedTarget) {
        selectedTarget = {
          x: canvas.width / 2,
          y: canvas.height / 2,
          ra: Number(realTarget.ra).toFixed(4),
          dec: Number(realTarget.dec).toFixed(4)
        };
        updateSpectrumChart(selectedTarget.x, selectedTarget.y);
      }

      btnBlink.disabled = true;
      btnDipole.disabled = true;
      btnFlag.disabled = true;

      targetCoordsEl.textContent =
        `REAL FITS TARGET | RA ${realTarget.ra}° | DEC ${realTarget.dec}°`;

      viewportModeTag.textContent =
        'REAL SPHEREx — STATIC OBSERVATION';
      setCoordinateStatus(
        `Loaded the static FITS preview for ${activeSector.id}.`,
      );

      hudReadout.textContent =
        `PREGENERATED FITS CUTOUT | ${STATIC_OBSERVATION_DATE}`;

      renderSectorView();

      console.log('STATIC REAL SPHEREx IMAGE LOADED.');

      return;

    } catch (imageError) {
      console.error('Static image unavailable:', imageError);

      hudReadout.textContent =
        'REAL IMAGE UNAVAILABLE — USING SIMULATION';
      setCoordinateStatus(
        `Real FITS image unavailable for ${activeSector.id}; showing simulation.`,
        true,
      );
    }
  }

  realObservation = false;
  realObservationDate = null;
  realObservationFile = null;
  staticRealImage = false;

  epoch1Source = buildMockEpochCanvas(activeSector, 1, band);
  epoch2Source = buildMockEpochCanvas(activeSector, 2, band);

  btnBlink.disabled = false;
  btnDipole.disabled = false;
  btnFlag.disabled = true;

  renderSectorView();
}

// ==========================================
// 15. SPECTRUM CHART
// ==========================================

const WAVELENGTHS = Array.from(
  { length: 102 },
  (_, i) => (0.75 + (i / 101) * 4.25).toFixed(2)
);

let spectrumChart = null;

if (typeof Chart !== 'undefined') {
  const spectrumCanvas = document.getElementById('spectrum-chart');

  if (spectrumCanvas) {
    const spectrumCtx = spectrumCanvas.getContext('2d');

    spectrumChart = new Chart(spectrumCtx, {
      type: 'line',

      data: {
        labels: WAVELENGTHS,

        datasets: [{
          label: 'Simulated IR Flux',
          data: Array(102).fill(0),

          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.18)',

          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.25
        }]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        animation: { duration: 200 },

        plugins: {
          legend: { display: false }
        },

        scales: {
          x: {
            ticks: {
              color: '#94a3b8',
              maxTicksLimit: 6
            },

            grid: { color: '#1f293d' },

            title: {
              display: true,
              text: 'Wavelength (µm)',
              color: '#94a3b8'
            }
          },

          y: {
            ticks: { color: '#94a3b8' },
            grid: { color: '#1f293d' },
            min: 0,
            max: 120
          }
        }
      }
    });
  }
}

// ==========================================
// 16. SIMULATED SPECTRUM
// ==========================================

function getMockSpectrum(sector, x, y) {
  const { mover } = getSectorData(sector);

  let moverType = null;

  if (mover) {
    const distE1 = Math.hypot(x - mover.e1x, y - mover.e1y);

    const distE2 = Math.hypot(
      x - (mover.e1x + mover.dx),
      y - (mover.e1y + mover.dy)
    );

    if (distE1 < 14 || distE2 < 14) {
      moverType = mover.type;
    }
  }

  return WAVELENGTHS.map((wlStr, idx) => {
    const wl = Number(wlStr);
    const noise = (Math.random() - 0.5) * 4;

    if (moverType === 'cold_ir') {
      const methaneDip =
        Math.exp(-Math.pow((wl - 3.3) / 0.22, 2)) * 55;

      return Math.max(5, 25 + idx * 0.7 - methaneDip + noise);
    }

    if (moverType === 'asteroid') {
      const iceDip =
        Math.exp(-Math.pow((wl - 3.0) / 0.25, 2)) * 35;

      return Math.max(5, 75 - idx * 0.25 - iceDip + noise);
    }

    return Math.max(5, 85 - idx * 0.55 + noise);
  });
}

function updateSpectrumChart(x, y) {
  if (!spectrumChart || !activeSector) return;

  spectrumChart.data.datasets[0].data =
    getMockSpectrum(activeSector, x, y);
  spectrumChart.update();
}

// ==========================================
// 17. TAB NAVIGATION
// ==========================================

function switchTab(tabName) {
  const isExplorer = tabName === 'explorer';

  viewExplorer.classList.toggle('hidden', !isExplorer);
  viewCandidates.classList.toggle('hidden', isExplorer);

  tabExplorer.classList.toggle('active', isExplorer);
  tabCandidates.classList.toggle('active', !isExplorer);
}

// ==========================================
// 18. SAVE APPLICATION STATE
// ==========================================

function syncMemory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedCandidates));
  localStorage.setItem(SCANNED_KEY, JSON.stringify([...scannedSectors]));

  const realCandidates = savedCandidates.filter(
    candidate => candidate.data_type === 'real'
  );
  const realScannedCount = getRealSectors().filter(
    sector => scannedSectors.has(sector.id)
  ).length;

  candidateCountEl.textContent = realCandidates.length;
  btnExportJson.disabled = realCandidates.length === 0;

  bannerScannedEl.textContent =
    `${String(realScannedCount).padStart(2, '0')}/${String(getRealSectors().length).padStart(2, '0')}`;

  bannerFlaggedEl.textContent =
    String(realCandidates.length).padStart(2, '0');

  renderCandidatesTable();
}

// ==========================================
// 19. CANDIDATE TABLE
// ==========================================

function renderCandidatesTable() {
  candidatesTbody.innerHTML = '';
  const visibleCandidates = savedCandidates.filter(
    candidate => candidate.data_type === 'real'
  );

  if (visibleCandidates.length === 0) {
    const emptyRow = document.createElement('tr');
    const cell = document.createElement('td');

    cell.colSpan = 7;
    cell.textContent =
      'No candidates archived yet. Select a sector to begin.';

    emptyRow.appendChild(cell);
    candidatesTbody.appendChild(emptyRow);

    return;
  }

  visibleCandidates.forEach((item, index) => {
    const row = document.createElement('tr');

    const wavelength = (
      0.75 + ((item.band - 1) / 101) * 4.25
    ).toFixed(2);

    const sectorCode = item.sectorId || 'SEC-01';

    const cells = [
      `SPX-${String(index + 1).padStart(3, '0')}`,
      sectorCode,
      `${Number(item.ra).toFixed(4)}°, ${Number(item.dec).toFixed(4)}°`,
      `(${item.pixel_x}, ${item.pixel_y})`,
      `Band ${item.band} (${wavelength} µm)`,
      new Date(item.flagged_at).toLocaleTimeString()
    ];

    cells.forEach(value => {
      const td = document.createElement('td');
      td.textContent = value;
      row.appendChild(td);
    });

    const actionTd = document.createElement('td');
    const inspectBtn = document.createElement('button');

    inspectBtn.className = 'spx-btn secondary';
    inspectBtn.style.padding = '5px 10px';
    inspectBtn.textContent = 'Inspect';

    inspectBtn.addEventListener('click', () => {
      const targetSector =
        SECTORS.find(s => s.id === sectorCode) || SECTORS[0];

      switchTab('explorer');
      requestedTarget = null;
      enterSector(targetSector);

      bandSlider.value = item.band;

      bandLabel.textContent = `${item.band} (${wavelength} µm)`;

      bannerBandEl.textContent = String(item.band).padStart(3, '0');
      bannerWavelengthEl.textContent = wavelength;

      activeEpoch = item.epoch || 1;

      selectedTarget = {
        x: item.pixel_x,
        y: item.pixel_y,
        ra: item.ra.toFixed(4),
        dec: item.dec.toFixed(4)
      };

      targetCoordsEl.textContent =
        `RA ${selectedTarget.ra}° | DEC ${selectedTarget.dec}°`;

      loadSkyPatch(item.band);
    });

    actionTd.appendChild(inspectBtn);
    row.appendChild(actionTd);
    candidatesTbody.appendChild(row);
  });
}

// ==========================================
// 20. CANVAS MOUSE INTERACTION
// ==========================================

function getCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: Math.round(
      (e.clientX - rect.left) * (canvas.width / rect.width)
    ),

    y: Math.round(
      (e.clientY - rect.top) * (canvas.height / rect.height)
    )
  };
}

function findSectorAtPoint(x, y) {
  const normX = (x - MAP_CX) / MAP_RX;
  const normY = (y - MAP_CY) / MAP_RY;

  if (normX * normX + normY * normY > 1) {
    return null;
  }

  return getRealSectors().find(s => {
    const box = getSectorScreenBox(s);

    return (
      x >= box.x &&
      x <= box.x + box.w &&
      y >= box.y &&
      y <= box.y + box.h
    );
  }) || null;
}

canvas.addEventListener('mousemove', e => {
  if (viewportLevel !== 'allsky') return;

  const { x, y } = getCanvasCoords(e);
  const sector = findSectorAtPoint(x, y);

  if (sector !== hoveredSector) {
    hoveredSector = sector;
    renderAllSkyMap();
  }
});

canvas.addEventListener('click', async e => {
  const { x, y } = getCanvasCoords(e);

  if (viewportLevel === 'allsky') {
    const clickedSector = findSectorAtPoint(x, y);

    if (clickedSector) {
      requestedTarget = null;
      enterSector(clickedSector);
    }

    return;
  }

  const ra = (
    activeSector.ra + (x - canvas.width / 2) * 0.002
  ).toFixed(4);

  const dec = (
    activeSector.dec - (y - canvas.height / 2) * 0.002
  ).toFixed(4);

  selectedTarget = { x, y, ra, dec };

  targetCoordsEl.textContent = realObservation
    ? `OBSERVED POSITION: RA ${ra}° | DEC ${dec}°`
    : `SIMULATED POSITION: RA ${ra}° | DEC ${dec}°`;

  renderSectorView();

  updateSpectrumChart(x, y);

  btnFlag.disabled = false;
  btnFlag.textContent = realObservation
    ? 'Log Observed Candidate'
    : 'Log Simulated Candidate';
});

// ==========================================
// 21. SEARCH BAR
// ==========================================

sectorSearchInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;

  const raw = sectorSearchInput.value.trim().toUpperCase();

  const num = parseInt(raw.replace(/[^0-9]/g, ''), 10);

  const match =
    SECTORS.find(s => s.id === raw) ||
    (!Number.isNaN(num)
      ? SECTORS.find(s => s.index === num)
      : null);

  if (match && isRealSector(match.id)) {
    switchTab('explorer');
    requestedTarget = null;
    enterSector(match);
    sectorSearchInput.value = '';
  } else if (match) {
    hudReadout.textContent = `${match.id} has no verified local FITS coverage.`;
  }
});

// ==========================================
// 22. NAVIGATION BUTTONS
// ==========================================

logoHome.addEventListener('click', e => {
  e.preventDefault();
  switchTab('explorer');
  returnToAllSky();
});

tabExplorer.addEventListener('click', () => switchTab('explorer'));

tabCandidates.addEventListener('click', () => {
  renderCandidatesTable();
  switchTab('candidates');
});

btnBackAllSky.addEventListener('click', returnToAllSky);

btnMarkClear.addEventListener('click', () => {
  if (!activeSector) return;

  scannedSectors.add(activeSector.id);
  syncMemory();
  returnToAllSky();
});

// ==========================================
// 23. BLINK BUTTON
// ==========================================

btnBlink.addEventListener('click', () => {
  if (viewportLevel !== 'sector') return;

  viewMode = 'blink';
  activeEpoch = activeEpoch === 1 ? 2 : 1;

  renderSectorView();
});

// ==========================================
// 24. DIPOLE BUTTON
// ==========================================

btnDipole.addEventListener('click', () => {
  if (viewportLevel !== 'sector') return;

  viewMode = 'dipole';
  renderSectorView();
});

// ==========================================
// 25. BAND SLIDER
// ==========================================

bandSlider.addEventListener('input', e => {
  const band = Number(e.target.value);

  const wavelength = (
    0.75 + ((band - 1) / 101) * 4.25
  ).toFixed(2);

  bandLabel.textContent = `${band} (${wavelength} µm)`;

  bannerBandEl.textContent = String(band).padStart(3, '0');
  bannerWavelengthEl.textContent = wavelength;

  if (realObservation && staticRealImage) {
    renderSectorView();
    return;
  }

  if (realObservation) {
    renderSectorView();
    return;
  }

  loadSkyPatch(band);
});

// ==========================================
// 26. KEYBOARD CONTROLS
// ==========================================

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && isModalOpen()) {
    closeMissionModal();
    return;
  }

  if (
    e.code === 'Space' &&
    !isModalOpen() &&
    document.activeElement !== sectorSearchInput &&
    viewportLevel === 'sector' &&
    !viewExplorer.classList.contains('hidden')
  ) {
    e.preventDefault();

    viewMode = 'blink';
    activeEpoch = activeEpoch === 1 ? 2 : 1;

    renderSectorView();
  }
});

// ==========================================
// 27. FLAG SIMULATED CANDIDATE
// ==========================================

btnFlag.addEventListener('click', async () => {
  if (!selectedTarget || !activeSector) return;

  const payload = {
    sectorId: activeSector.id,

    ra: Number(selectedTarget.ra),
    dec: Number(selectedTarget.dec),

    pixel_x: selectedTarget.x,
    pixel_y: selectedTarget.y,

    epoch: activeEpoch,
    band: Number(bandSlider.value),

    data_type: realObservation ? 'real' : 'simulated',
    flagged_at: new Date().toISOString()
  };

  btnFlag.disabled = true;
  btnFlag.textContent = 'Saving Candidate...';

  try {
    if (backendConnected) {
      await saveCandidate(payload);
    }

    savedCandidates.push(payload);
    scannedSectors.add(activeSector.id);
    syncMemory();

    btnFlag.textContent = backendConnected
      ? 'Candidate Saved ✓'
      : 'Saved Locally (Backend Offline)';
  } catch (error) {
    console.error('Could not save candidate:', error);
    btnFlag.disabled = false;
    btnFlag.textContent = 'Save Failed — Try Again';
  }
});

// ==========================================
// 28. EXPORT CANDIDATES
// ==========================================

btnExportJson.addEventListener('click', () => {
  const realCandidates = savedCandidates.filter(
    candidate => candidate.data_type === 'real'
  );
  const blob = new Blob(
    [JSON.stringify(realCandidates, null, 2)],
    { type: 'application/json' }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'spherex_candidates.json';

  a.click();

  URL.revokeObjectURL(url);
});

// ==========================================
// 29. CLEAR CANDIDATES
// ==========================================

btnClearLog.addEventListener('click', async () => {
  btnClearLog.disabled = true;

  try {
    if (backendConnected) {
      await clearCandidates();
    }
  } catch (error) {
    console.error('Could not clear backend candidate archive:', error);
    btnClearLog.disabled = false;
    return;
  }

  savedCandidates = [];
  scannedSectors.clear();

  syncMemory();
  btnClearLog.disabled = false;

  if (viewportLevel === 'allsky') {
    renderAllSkyMap();
  }
});

// ==========================================
// 30. INITIALIZE APPLICATION
// ==========================================

syncMemory();
renderAllSkyMap();

async function initializeBackend() {
  const loadUrlTarget = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ra') && urlParams.has('dec')) {
      raInput.value = urlParams.get('ra');
      decInput.value = urlParams.get('dec');
      const urlRa = parseCoordinate(raInput.value, true);
      const urlDec = parseCoordinate(decInput.value, false);
      const matchingTarget = Object.entries(KNOWN_TARGETS)
        .find(([, target]) => (
          Math.abs(target.ra - urlRa) < 0.0001
          && Math.abs(target.dec - urlDec) < 0.0001
        ));
      if (matchingTarget) {
        targetPreset.value = matchingTarget[0];
      }
      await inspectCoordinates();
    }
  };

  if (!API_BASE) {
    surveyStatus.lastChild.textContent = ' STATIC DEMO';
    sectorCoverage = getStaticSectorCoverage();
    sectorCoverageLoaded = true;
    sectorBadge.textContent =
      'Static FITS preview available in SEC-19. Candidate logs are saved locally.';
    renderAllSkyMap();
    await loadUrlTarget();
    return;
  }

  if (!(await checkBackend())) {
    sectorBadge.textContent = 'Backend unavailable — no verified sectors loaded.';
    renderAllSkyMap();
    return;
  }

  try {
    sectorCoverage = await fetchSectorCoverage();
    sectorCoverageLoaded = true;
    const realSectorCount = getRealSectors().length;
    sectorBadge.textContent = realSectorCount === 1
      ? '1 verified FITS sector available. Select it on the map.'
      : `${realSectorCount} verified FITS sectors available. Select a green sector.`;
    renderAllSkyMap();
    savedCandidates = await fetchCandidates();
    scannedSectors = new Set([
      ...scannedSectors,
      ...savedCandidates.map(candidate => candidate.sectorId).filter(Boolean)
    ]);
    syncMemory();

    await loadUrlTarget();
  } catch (error) {
    console.error('Could not load backend candidate archive:', error);
    sectorBadge.textContent = 'Could not load verified sector coverage.';
    sectorCoverageLoaded = false;
    renderAllSkyMap();
  }
}

initializeBackend();

console.log('SPHEREx Explorer initialized.');
console.log('Backend endpoint:', `${API_BASE}/api/health`);
console.log('Real-data demonstration sector:', REAL_DEMO_SECTOR);
console.log('Demo coordinates:', DEMO_TARGET);
