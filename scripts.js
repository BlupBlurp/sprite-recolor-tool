/* ===== helpers & logs ===== */
const $ = (s) => document.querySelector(s);

import "./pokedex.js";

// --- render shim (safe) ---
if (typeof window.render !== "function") {
  window.render = function (opts) {
    try {
      if (opts && opts.full && typeof window.drawSprite === "function") {
        window.drawSprite();
      }
      if (typeof window.applyShiny === "function") {
        window.applyShiny();
      }
      if (typeof window.drawDebug === "function") {
        window.drawDebug();
      }
    } catch (e) {
      console && console.warn && console.warn("render() shim error:", e);
    }
  };
}

const toast = (msg) => {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
};
const st = (t) => {
  $("#status").textContent = t;
};
window.addEventListener("error", (e) =>
  toast("Error: " + (e.message || "unknown"))
);
window.addEventListener("unhandledrejection", (e) =>
  toast("Error: " + ((e.reason && e.reason.message) || "promise"))
);

const trimPM = (name) => name.replace(/^pm\d{4}_/i, "");
const SPRITE_RE = /^pm\d{4}_\d{2}_\d{2}\.png$/i;
const TEX_COL_RE = /^pm\d{4}_\d{2}_\d{2}_.+?_col(?:_rare)?\.png$/i;

const POKEDEX_DEFAULT = Object.fromEntries(
  POKEDEX_DEFAULT_NAMES.map((n, i) => (n ? [i, n] : null)).filter(Boolean)
);
let POKEDEX = (() => {
  try {
    const s = localStorage.getItem("bdsp_pokedex");
    if (s) return JSON.parse(s);
  } catch (e) {}
  return POKEDEX_DEFAULT;
})();

/* ===== Seeded Random Number Generator ===== */
let currentSeed = null;
let rngState = 0;

// Simple but effective xorshift32 RNG
function setSeed(seed) {
  if (seed === null || seed === undefined || seed === "") {
    // Generate a random seed if none provided
    currentSeed = Math.floor(Math.random() * 2147483647);
  } else {
    // Parse the provided seed
    currentSeed = parseInt(seed);
    if (isNaN(currentSeed)) {
      currentSeed = hashString(seed.toString());
    }
  }

  // Ensure seed is a valid 32-bit integer and not zero
  currentSeed = Math.abs(currentSeed) || 1;
  rngState = currentSeed;

  // Save seed to localStorage for persistence
  try {
    localStorage.setItem("bdsp_rng_seed", currentSeed.toString());
  } catch (e) {}

  // Update the UI to show current seed
  updateSeedDisplay();

  return currentSeed;
}

// Initialize seed from localStorage or generate new one
function initializeSeed() {
  try {
    const savedSeed = localStorage.getItem("bdsp_rng_seed");
    if (savedSeed) {
      currentSeed = parseInt(savedSeed);
      if (!isNaN(currentSeed) && currentSeed > 0) {
        rngState = currentSeed;
        updateSeedDisplay();
        return;
      }
    }
  } catch (e) {}

  // No valid saved seed, generate a new one
  setSeed(null);
}

// Initialize the seed when the page loads
initializeSeed();

function hashString(str) {
  let hash = 0;
  if (str.length === 0) return 1;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) || 1;
}

function seededRandom() {
  // xorshift32 algorithm
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  return (rngState >>> 0) / 4294967296; // Convert to [0, 1)
}

function updateSeedDisplay() {
  const seedElement = $("#currentSeed");
  if (seedElement) {
    seedElement.textContent = currentSeed || "-";

    // Add click handler to copy seed to clipboard
    seedElement.onclick = () => {
      if (currentSeed) {
        navigator.clipboard
          .writeText(currentSeed.toString())
          .then(() => {
            toast("Seed copied to clipboard!");
          })
          .catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = currentSeed.toString();
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            toast("Seed copied to clipboard!");
          });
      }
    };
  }
}

/* ===== folder ingest ===== */
let pickedFiles = [];
let folders = new Map();
let currentFolder = null;
let currentTextures = [];
let currentSpriteFile = null;

$("#pickRoot").addEventListener("change", (e) => {
  pickedFiles = [...e.target.files].map((f) => ({
    file: f,
    rel: f.webkitRelativePath || f.name,
  }));
  indexFolders();
});

function indexFolders() {
  folders.clear();
  for (const { file, rel } of pickedFiles) {
    const parts = rel.split("/");
    const idx = parts.findIndex((s) => /^pm\d{4}_\d{2}_\d{2}$/i.test(s));
    if (idx < 0) continue;
    const key = parts[idx];
    const inIcon = parts[idx + 1] && parts[idx + 1].toLowerCase() === "icon";
    if (!folders.has(key))
      folders.set(key, { textures: [], sprites: [], extras: [] });
    if (inIcon && SPRITE_RE.test(file.name))
      folders.get(key).sprites.push(file);
    else if (TEX_COL_RE.test(file.name)) folders.get(key).textures.push(file);
    else if (/\.png$/i.test(file.name)) folders.get(key).extras.push(file);
  }
  renderFolderList();
  $("#texList").innerHTML = "<small>Select a folder to list textures</small>";
  $("#spriteSel").innerHTML = '<option value="">(icon/*.png)</option>';
  currentFolder = null;
  currentTextures = [];
  currentSpriteFile = null;
  st(`Found ${folders.size} folders`);
}

function renderFolderList() {
  const sel = $("#folderSel");
  sel.innerHTML = '<option value="">(choose)</option>';
  const keys = [...folders.keys()].sort();
  for (const key of keys) {
    const m = key.match(/^pm(\d{4})_(\d{2})_(\d{2})$/i);
    let label = key;
    if (m) {
      const dex = parseInt(m[1], 10);
      const form = m[2] + "_" + m[3];
      const name = POKEDEX[dex] || String(dex).padStart(3, "0");
      label = String(dex).padStart(3, "0") + ". " + name + " (" + form + ")";
    }
    const o = document.createElement("option");
    o.value = key;
    o.textContent = label;
    sel.appendChild(o);
  }
}

function renderTextureList() {
  const host = $("#texList");
  host.innerHTML = "";
  if (!currentFolder) {
    host.innerHTML = "<small>Select a folder</small>";
    return;
  }
  const pack = folders.get(currentFolder);
  if (!pack) {
    host.textContent = "(empty)";
    return;
  }

  const forms = new Map();
  for (const f of pack.textures) {
    const m = f.name.match(/^(pm\d{4}_\d{2}_\d{2})_(.+?)(_rare)?\.png$/i);
    if (!m) continue;
    const form = m[1],
      suffix = m[2].toLowerCase(),
      isRare = !!m[3];
    if (!forms.has(form)) forms.set(form, new Map());
    const bySuf = forms.get(form);
    if (!bySuf.has(suffix)) bySuf.set(suffix, { N: null, S: null });
    if (isRare) bySuf.get(suffix).S = f;
    else bySuf.get(suffix).N = f;
  }

  currentTextures = [];
  const q = ($("#texFilter")?.value || "").toLowerCase().trim();
  const sortedForms = [...forms.keys()].sort();
  for (const form of sortedForms) {
    if (q && !form.toLowerCase().includes(q)) {
      const any = [...forms.get(form).keys()].some((k) => k.includes(q));
      if (!any) continue;
    }
    const group = document.createElement("div");
    group.className = "item";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.checked = true;
    master.style.marginRight = "6px";
    const lbl = document.createElement("div");
    const m = form.match(/^pm(\d{4})_(\d{2})_(\d{2})$/i);
    const dex = parseInt(m[1], 10);
    const nm = POKEDEX[dex] || "pm" + m[1];
    lbl.innerHTML = `<strong>${String(dex).padStart(3, "0")}. ${nm} (${m[2]}_${
      m[3]
    })</strong>`;
    group.append(master, lbl);
    host.appendChild(group);

    const bySuf = forms.get(form);
    const keys = [...bySuf.keys()].sort();
    for (const k of keys) {
      const pair = bySuf.get(k);
      if (!pair.N) continue;
      if (q && !k.includes(q)) continue;
      const row = document.createElement("div");
      row.className = "item";
      row.style.marginLeft = "22px";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.form = form;
      cb.dataset.suf = k;
      const label = document.createElement("div");
      label.innerHTML = `<code>${trimPM(
        pair.N.name.replace(/\.png$/i, "")
      )}</code>`;
      row.append(cb, label);
      host.appendChild(row);
      cb.addEventListener("change", updateSelectedTextures);
      master.addEventListener("change", () => {
        cb.checked = master.checked;
        updateSelectedTextures();
      });
    }
  }
  updateSelectedTextures();
}
(() => {
  const tf = $("#texFilter");
  if (tf) tf.addEventListener("input", renderTextureList);
})();

function updateSelectedTextures() {
  if (!currentFolder) {
    currentTextures = [];
    return;
  }
  const pack = folders.get(currentFolder);
  if (!pack) {
    currentTextures = [];
    return;
  }
  const lookup = new Map();
  for (const f of pack.textures) {
    const m = f.name.match(/^(pm\d{4}_\d{2}_\d{2})_(.+?)(_rare)?\.png$/i);
    if (!m) continue;
    const key = m[1] + "|" + m[2].toLowerCase();
    const isRare = !!m[3];
    if (!lookup.has(key)) lookup.set(key, { N: null, S: null });
    if (isRare) lookup.get(key).S = f;
    else lookup.get(key).N = f;
  }
  currentTextures = [];
  $("#texList")
    .querySelectorAll("input[type=checkbox][data-form]")
    .forEach((cb) => {
      if (!cb.checked) return;
      const pair = lookup.get(cb.dataset.form + "|" + cb.dataset.suf);
      if (pair && (pair.N || pair.S)) currentTextures.push(pair);
    });
  st(`Selected ${currentTextures.length} texture(s)`);

  // Auto-apply: if a sprite is already loaded, rebuild texPairs for current folder and re-apply
  try {
    if (currentSpriteFile && currentFolder) {
      (async () => {
        st("Updating textures…");
        const key = currentFolder.toLowerCase();
        const Nobjs = [],
          Sobjs = [];
        for (const pr of currentTextures) {
          if (pr.N) Nobjs.push(await fileToImageObj(pr.N));
          if (pr.S) Sobjs.push(await fileToImageObj(pr.S));
        }
        texPairs[key] = { N: Nobjs, S: Sobjs };
        buildMap();
        fillTexDropdown();
        if (typeof applyShiny === "function") applyShiny();
        if (typeof drawDebug === "function") drawDebug();
        st("");
      })();
    }
  } catch (e) {
    console.warn("updateSelectedTextures auto-apply failed", e);
  }
}

function renderSpriteList() {
  const sel = $("#spriteSel");
  sel.innerHTML = '<option value="">(icon/*.png)</option>';
  if (!currentFolder) return;
  const pack = folders.get(currentFolder);
  (pack?.sprites || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((f, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = trimPM(f.name);
      sel.appendChild(o);
    });
}

/* ===== load selected ===== */
$("#loadBtn").addEventListener("click", async () => {
  if (!currentFolder) {
    toast("Pick a folder");
    return;
  }
  const pack = folders.get(currentFolder);
  const sIdx = +($("#spriteSel").value || "-1");
  if (!(pack && pack.sprites && pack.sprites[sIdx])) {
    toast("Pick a sprite from icon/");
    return;
  }
  currentSpriteFile = pack.sprites[sIdx];
  if (currentTextures.length === 0) {
    toast("Select at least one texture");
    return;
  }

  st("Loading textures…");
  texPairs = {};
  const key = currentFolder.toLowerCase();
  const Nobjs = [],
    Sobjs = [];
  for (const pr of currentTextures) {
    if (pr.N) Nobjs.push(await fileToImageObj(pr.N));
    if (pr.S) Sobjs.push(await fileToImageObj(pr.S));
  }
  texPairs[key] = { N: Nobjs, S: Sobjs };
  buildMap();
  fillTexDropdown();

  st("Loading sprite…");
  const sprC = await fileToCanvas(currentSpriteFile);
  sprite = new Image();
  sprite.onload = () => {
    drawSprite();
    requestAnimationFrame(() => {
      // Use existing seed for consistent results, or it can be changed via UI
      computeFamiliesAndRegions();
      applyShiny();
    });
  };
  sprite.src = sprC.toDataURL();
  if (typeof fillSourceDropdown === "function") fillSourceDropdown();
  if (typeof pickDefaultSourceForCurrentFolder === "function")
    pickDefaultSourceForCurrentFolder();

  // Load home texture preview
  loadHomeTexturePreview();
});

/* ===== Pokemon navigation ===== */
$("#prevPokemon").addEventListener("click", () => {
  navigatePokemon(-1);
});

$("#nextPokemon").addEventListener("click", () => {
  navigatePokemon(1);
});

function navigatePokemon(direction) {
  const folderSel = $("#folderSel");
  const currentIndex = folderSel.selectedIndex;
  const newIndex = currentIndex + direction;

  if (newIndex > 0 && newIndex < folderSel.options.length) {
    folderSel.selectedIndex = newIndex;
    folderSel.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

/* ===== Home texture preview ===== */
function loadHomeTexturePreview() {
  const canvasNormal = $("#homeTextureCanvasNormal");
  const statusNormal = $("#homeTextureStatusNormal");
  const canvasShiny = $("#homeTextureCanvas");
  const statusShiny = $("#homeTextureStatus");

  // Reset displays
  function resetCanvas(canvas, status, message) {
    canvas.style.display = "none";
    status.textContent = message;
    status.style.display = "block";
  }

  if (!currentFolder) {
    resetCanvas(canvasNormal, statusNormal, "No normal home texture");
    resetCanvas(canvasShiny, statusShiny, "No shiny home texture");
    return;
  }

  const pack = folders.get(currentFolder);
  if (!pack || !pack.textures) {
    resetCanvas(canvasNormal, statusNormal, "No textures found");
    resetCanvas(canvasShiny, statusShiny, "No textures found");
    return;
  }

  // Look for normal and shiny home textures
  const homeTextureNormal = pack.textures.find((f) =>
    /_home_col\.png$/i.test(f.name)
  );
  const homeTextureShiny = pack.textures.find((f) =>
    /_home_col_rare\.png$/i.test(f.name)
  );

  // Load normal texture
  if (!homeTextureNormal) {
    resetCanvas(canvasNormal, statusNormal, "No home_col texture found");
  } else {
    fileToImageObj(homeTextureNormal)
      .then((obj) => {
        const img = obj.img;
        canvasNormal.width = img.width;
        canvasNormal.height = img.height;
        const ctx = canvasNormal.getContext("2d");
        ctx.putImageData(img, 0, 0);

        canvasNormal.style.display = "block";
        statusNormal.style.display = "none";
      })
      .catch((err) => {
        console.warn("Failed to load normal home texture:", err);
        resetCanvas(
          canvasNormal,
          statusNormal,
          "Failed to load normal home texture"
        );
      });
  }

  // Load shiny texture
  if (!homeTextureShiny) {
    resetCanvas(canvasShiny, statusShiny, "No home_col_rare texture found");
  } else {
    fileToImageObj(homeTextureShiny)
      .then((obj) => {
        const img = obj.img;
        canvasShiny.width = img.width;
        canvasShiny.height = img.height;
        const ctx = canvasShiny.getContext("2d");
        ctx.putImageData(img, 0, 0);

        canvasShiny.style.display = "block";
        statusShiny.style.display = "none";
      })
      .catch((err) => {
        console.warn("Failed to load shiny home texture:", err);
        resetCanvas(
          canvasShiny,
          statusShiny,
          "Failed to load shiny home texture"
        );
      });
  }
}

/* ===== low-level IO ===== */
async function fileToImageObj(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return {
    name: file.name,
    img: x.getImageData(0, 0, c.width, c.height),
  };
}
async function fileToCanvas(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  return c;
}

/* ===== color utils ===== */
function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c) {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}
function rgbToXyz(r, g, b) {
  r = srgbToLinear(r);
  g = srgbToLinear(g);
  b = srgbToLinear(b);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}
function xyzToRgb(x, y, z) {
  let r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    g = -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    b = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [
    Math.round(linearToSrgb(r) * 255),
    Math.round(linearToSrgb(g) * 255),
    Math.round(linearToSrgb(b) * 255),
  ];
}
const Xn = 0.95047,
  Yn = 1,
  Zn = 1.08883,
  e = 216 / 24389,
  kc = 24389 / 27;
function fLab(t) {
  return t > e ? Math.cbrt(t) : (kc * t + 16) / 116;
}
function invfLab(t) {
  const t3 = t * t * t;
  return t3 > e ? t3 : (116 * t - 16) / kc;
}
function rgbToLab(r, g, b) {
  const [x, y, z] = rgbToXyz(r, g, b),
    fx = fLab(x / Xn),
    fy = fLab(y / Yn),
    fz = fLab(z / Zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb(L, a, b) {
  const fy = (L + 16) / 116,
    fx = fy + a / 500,
    fz = fy - b / 200;
  return xyzToRgb(Xn * invfLab(fx), Yn * invfLab(fy), Zn * invfLab(fz));
}
function dE(a, b) {
  const dL = a[0] - b[0],
    da = a[1] - b[1],
    db = a[2] - b[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

// Enhanced color analysis functions for better consensus
function labToHue(lab) {
  const a = lab[1],
    b = lab[2];
  if (a === 0 && b === 0) return 0; // Achromatic
  return (Math.atan2(b, a) * 180) / Math.PI;
}

function labToChroma(lab) {
  const a = lab[1],
    b = lab[2];
  return Math.sqrt(a * a + b * b);
}

function hueDistance(hue1, hue2) {
  const diff = Math.abs(hue1 - hue2);
  return Math.min(diff, 360 - diff);
}

function analyzeColorHarmony(colorLab, candidateLab) {
  const hue1 = labToHue(colorLab);
  const hue2 = labToHue(candidateLab);
  const hDist = hueDistance(hue1, hue2);

  // Bonus for complementary colors (opposite on color wheel)
  const complementaryBonus = hDist > 150 && hDist < 210 ? 1.2 : 1.0;

  // Bonus for analogous colors (close on color wheel)
  const analogousBonus = hDist < 30 ? 1.1 : 1.0;

  // Preserve saturation relationships
  const chroma1 = labToChroma(colorLab);
  const chroma2 = labToChroma(candidateLab);
  const chromaRatio =
    chroma1 > 0 ? Math.min(chroma2 / chroma1, chroma1 / chroma2) : 1.0;
  const chromaBonus = 0.5 + 0.5 * chromaRatio;

  return complementaryBonus * analogousBonus * chromaBonus;
}
const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
const unhex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/* ===== recolor state ===== */
let texPairs = {},
  mapIndex = [],
  shinyTextureKeys = [];
let sprite = null,
  width = 0,
  height = 0;
let kFamilies = 32,
  spatialW = 0.6,
  PROTECT_NEAR_BLACK = 8;
let pixLabs = null,
  pixRGB = null,
  pixMask = null;
let assignFam = null,
  famCenters = [],
  famShinyLab = [],
  famAutoLab = [];
let regions = [],
  regionIds = null,
  famToRegions = [],
  selectedRegion = -1;
let forceEditProtected = false,
  regionDark = {},
  pickMode = null,
  pickedColorForApply = null; // New state for pick & apply mode
let contrastFactor = 1.1; // 110%
let colorConsensusCount = 1; // Number of candidates to consider for consensus
let debugColorConsensus = false; // Enable debug logging for color consensus
let zoomMode = false; // Zoom feature state
let showRegionOutline = false; // Show selected region outline

/* ===== sliders/toggles ===== */
$("#k").oninput = (e) => {
  kFamilies = +e.target.value;
  $("#kVal").textContent = kFamilies;
};
(() => {
  const el = $("#spw");
  if (el) {
    el.oninput = (e) => {
      spatialW = +e.target.value / 100;
      const v = $("#spwVal");
      if (v) v.textContent = spatialW.toFixed(2);
    };
  }
})();
$("#ink").oninput = (e) => {
  PROTECT_NEAR_BLACK = +e.target.value;
  $("#inkVal").textContent = PROTECT_NEAR_BLACK;
  if (sprite) {
    drawSprite();
    applyShiny();
  }
};
$("#smoothPx").oninput = (e) => {
  $("#smoothPxVal").textContent = e.target.value;
  sprite && applyShiny();
};
$("#smoothAmt").oninput = (e) => {
  $("#smoothAmtVal").textContent = e.target.value + "%";
  sprite && applyShiny();
};
$("#contrast").oninput = (e) => {
  contrastFactor = +e.target.value / 100;
  $("#contrastVal").textContent = Math.round(contrastFactor * 100) + "%";
  sprite && applyShiny();
};
$("#colorConsensus").oninput = (e) => {
  colorConsensusCount = +e.target.value;
  $("#colorConsensusVal").textContent = colorConsensusCount;
  // Trigger recomputation if we have a sprite loaded
  if (sprite && pixLabs) {
    computeFamiliesAndRegions();
  }
};
$("#editProtected").onchange = (e) => {
  forceEditProtected = e.target.checked;
  applyShiny();
  drawDebug();
};
$("#showDebug").onchange = (e) => {
  drawDebug();
};
$("#debugColorConsensus").onchange = (e) => {
  debugColorConsensus = e.target.checked;
  if (debugColorConsensus) {
    console.log("Color consensus debugging enabled");
  }
};
$("#showRegionOutline").onchange = (e) => {
  showRegionOutline = e.target.checked;
  drawDebug();
};

// Initialize the state based on checkbox
showRegionOutline = $("#showRegionOutline").checked;

/* ===== Initialize slider values ===== */
function initializeSliderValues() {
  // Sync slider values with JavaScript variables and update display spans
  $("#k").value = kFamilies;
  $("#kVal").textContent = kFamilies;

  $("#ink").value = PROTECT_NEAR_BLACK;
  $("#inkVal").textContent = PROTECT_NEAR_BLACK;

  $("#smoothPx").value = $("#smoothPx").value; // Keep HTML default
  $("#smoothPxVal").textContent = $("#smoothPx").value;

  $("#smoothAmt").value = 45; // Ensure blending is set to 45%
  $("#smoothAmtVal").textContent = "45%";

  $("#contrast").value = Math.round(contrastFactor * 100);
  $("#contrastVal").textContent = Math.round(contrastFactor * 100) + "%";

  $("#colorConsensus").value = colorConsensusCount;
  $("#colorConsensusVal").textContent = colorConsensusCount;

  // Handle spatial weight if it exists
  const spwEl = $("#spw");
  if (spwEl) {
    spwEl.value = Math.round(spatialW * 100);
    const spwVal = $("#spwVal");
    if (spwVal) spwVal.textContent = spatialW.toFixed(2);
  }
}

// Initialize slider values on page load
initializeSliderValues();

$("#recluster").onclick = () => {
  if (!sprite) return;

  // Check if there's a seed in the input field
  const seedInput = $("#seedInput");
  const inputSeed = seedInput.value.trim();

  if (inputSeed) {
    // Use the provided seed and clear the field
    setSeed(inputSeed);
    seedInput.value = "";
  } else {
    // Generate new random seed
    setSeed(null);
  }

  computeFamiliesAndRegions();
  applyShiny();
};

// Allow pressing Enter in the seed input to trigger recluster
$("#seedInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    $("#recluster").click();
  }
});
$("#saveBtn").onclick = () => {
  if (!sprite) return;
  const a = document.createElement("a");
  const orig = currentSpriteFile?.name || "sprite.png";
  // pm####_##_##.png  ->  pm####_##_#1.png
  let outName;
  const m = orig.match(/^pm(\d{4})_(\d{2})_(\d)(\d)\.png$/i);
  if (m) {
    outName = `pm${m[1]}_${m[2]}_${m[3]}1.png`;
  } else {
    // Fallback: change last digit before .png to 1, else append _1
    const changed = orig.replace(/(\d)(?=\.png$)/i, "1");
    outName = changed !== orig ? changed : orig.replace(/\.png$/i, "_1.png");
  }
  a.download = outName;
  a.href = $("#c1").toDataURL("image/png");
  a.click();
};

/* ===== zoom functionality ===== */
function toggleZoomMode() {
  zoomMode = !zoomMode;
  const btn = $("#zoomToggle");
  if (btn) {
    btn.textContent = zoomMode ? "Zoom: ON" : "Zoom Mode";
    btn.style.background = zoomMode ? "#4ade80" : "";
    btn.style.color = zoomMode ? "#000" : "";
  }

  // Hide zoom overlays when disabled
  if (!zoomMode) {
    $("#zoomOverlay0").style.display = "none";
    $("#zoomOverlay1").style.display = "none";
  }

  st(zoomMode ? "Zoom mode enabled" : "Zoom mode disabled");
}

function updateZoomOverlay(canvasId, overlayId, zoomCanvasId, mouseX, mouseY) {
  if (!zoomMode) return;

  const canvas = $(canvasId);
  const overlay = $(overlayId);
  const zoomCanvas = $(zoomCanvasId);

  if (!canvas || !overlay || !zoomCanvas || !canvas.width || !canvas.height)
    return;

  const rect = canvas.getBoundingClientRect();
  const canvasX = ((mouseX - rect.left) * canvas.width) / rect.width;
  const canvasY = ((mouseY - rect.top) * canvas.height) / rect.height;

  // Position the overlay near the cursor but offset to avoid blocking
  const overlaySize = 100;
  const offset = 20;
  let overlayX = mouseX + offset;
  let overlayY = mouseY - overlaySize - offset;

  // Keep overlay within viewport
  if (overlayX + overlaySize > window.innerWidth) {
    overlayX = mouseX - overlaySize - offset;
  }
  if (overlayY < 0) {
    overlayY = mouseY + offset;
  }

  overlay.style.left = overlayX + "px";
  overlay.style.top = overlayY + "px";
  overlay.style.display = "block";

  // Draw zoomed content
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const zoomCtx = zoomCanvas.getContext("2d");

  const zoomFactor = 8;
  const captureSize = overlaySize / zoomFactor;
  const halfCapture = captureSize / 2;

  // Get source area to zoom
  const sourceX = Math.max(0, Math.floor(canvasX - halfCapture));
  const sourceY = Math.max(0, Math.floor(canvasY - halfCapture));
  const sourceW = Math.min(Math.ceil(captureSize), canvas.width - sourceX);
  const sourceH = Math.min(Math.ceil(captureSize), canvas.height - sourceY);

  if (sourceW > 0 && sourceH > 0) {
    try {
      const imageData = ctx.getImageData(sourceX, sourceY, sourceW, sourceH);

      // Clear zoom canvas
      zoomCtx.fillStyle = "#222";
      zoomCtx.fillRect(0, 0, overlaySize, overlaySize);

      // Create temporary canvas for scaling
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = sourceW;
      tempCanvas.height = sourceH;
      const tempCtx = tempCanvas.getContext("2d");
      tempCtx.putImageData(imageData, 0, 0);

      // Draw scaled image
      zoomCtx.imageSmoothingEnabled = false;
      const drawW = sourceW * zoomFactor;
      const drawH = sourceH * zoomFactor;
      const centerX = (overlaySize - drawW) / 2;
      const centerY = (overlaySize - drawH) / 2;

      zoomCtx.drawImage(
        tempCanvas,
        0,
        0,
        sourceW,
        sourceH,
        centerX,
        centerY,
        drawW,
        drawH
      );

      // Draw pixel selection box instead of crosshair
      // Calculate which pixel we're hovering over
      const pixelX = Math.floor(canvasX);
      const pixelY = Math.floor(canvasY);

      // Calculate the position of this pixel in the zoom view
      const pixelInSourceX = pixelX - sourceX;
      const pixelInSourceY = pixelY - sourceY;

      // Only draw if the pixel is within our zoomed area
      if (
        pixelInSourceX >= 0 &&
        pixelInSourceX < sourceW &&
        pixelInSourceY >= 0 &&
        pixelInSourceY < sourceH
      ) {
        const boxX = centerX + pixelInSourceX * zoomFactor;
        const boxY = centerY + pixelInSourceY * zoomFactor;

        // Draw pixel box with border for visibility
        zoomCtx.strokeStyle = "#000";
        zoomCtx.lineWidth = 2;
        zoomCtx.strokeRect(boxX, boxY, zoomFactor, zoomFactor);

        zoomCtx.strokeStyle = "#fff";
        zoomCtx.lineWidth = 1;
        zoomCtx.strokeRect(boxX, boxY, zoomFactor, zoomFactor);
      }
    } catch (e) {
      // Silently handle any drawing errors
    }
  }
}

function hideZoomOverlay(overlayId) {
  const overlay = $(overlayId);
  if (overlay) {
    overlay.style.display = "none";
  }
}

// Button click handler
$("#zoomToggle").onclick = toggleZoomMode;

/* ===== texture→shiny map ===== */
function buildMap() {
  mapIndex.length = 0;
  shinyTextureKeys.length = 0;
  for (const key in texPairs) {
    const P = texPairs[key];
    if (!(P.N && P.N.length && P.S && P.S.length)) continue;
    const buckets = new Map();
    const push = (code, nLab, sLab) => {
      let t = buckets.get(code);
      if (!t) {
        t = { nL: 0, na: 0, nb: 0, L: 0, a: 0, b: 0, c: 0 };
        buckets.set(code, t);
      }
      t.nL += nLab[0];
      t.na += nLab[1];
      t.nb += nLab[2];
      t.L += sLab[0];
      t.a += sLab[1];
      t.b += sLab[2];
      t.c++;
    };
    const pairs = Math.min(P.N.length, P.S.length);
    for (let k = 0; k < pairs; k++) {
      const A = P.N[k].img.data,
        B = P.S[k].img.data,
        len = Math.min(A.length, B.length);
      for (let i = 0; i < len; i += 4) {
        if (A[i + 3] < 16 || B[i + 3] < 16) continue;
        const code =
          ((A[i] >> 4) << 8) | ((A[i + 1] >> 4) << 4) | (A[i + 2] >> 4);
        push(
          code,
          rgbToLab(A[i], A[i + 1], A[i + 2]),
          rgbToLab(B[i], B[i + 1], B[i + 2])
        );
      }
    }
    for (const t of buckets.values())
      mapIndex.push({
        nLab: [t.nL / t.c, t.na / t.c, t.nb / t.c],
        sLab: [t.L / t.c, t.a / t.c, t.b / t.c],
        weight: t.c, // Frequency weight for consensus
        textureKey: key, // Track which texture this came from
      });
    shinyTextureKeys.push(key);
  }
}
function fillTexDropdown() {
  const sel = $("#texChooser");
  sel.innerHTML = "";
  let count = 0;
  for (const key in texPairs) {
    const arr = texPairs[key].S || [];
    arr.forEach((obj, idx) => {
      const o = document.createElement("option");
      o.value = key + "|" + idx;
      o.textContent = trimPM(obj.name);
      sel.appendChild(o);
      count++;
    });
  }
  if (!count) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "(no shiny textures)";
    sel.appendChild(o);
  }
}

/* ===== sprite cache ===== */
function drawSprite() {
  const c0 = $("#c0");
  width = c0.width = sprite.naturalWidth;
  height = c0.height = sprite.naturalHeight;

  const x0 = c0.getContext("2d");
  x0.imageSmoothingEnabled = false;
  x0.drawImage(sprite, 0, 0);
  const cG = document.getElementById("cGuide");
  if (cG) {
    cG.width = width;
    cG.height = height;
    const gx = cG.getContext("2d");
    gx.imageSmoothingEnabled = false;
    gx.clearRect(0, 0, width, height);
    gx.drawImage(sprite, 0, 0);
  }
  const id = x0.getImageData(0, 0, width, height),
    D = id.data;
  pixLabs = new Array(D.length / 4);
  pixRGB = new Uint8ClampedArray(D);
  pixMask = new Uint8Array(D.length / 4);
  let rec = 0,
    lock = 0,
    tr = 0;
  for (let p = 0, i = 0; i < D.length; i += 4, p++) {
    const a = D[i + 3],
      r = D[i],
      g = D[i + 1],
      b = D[i + 2];
    if (a < 5) {
      pixMask[p] = 0;
      tr++;
      continue;
    }
    if (Math.max(r, g, b) <= PROTECT_NEAR_BLACK) {
      pixMask[p] = 2;
      lock++;
      continue;
    }
    pixMask[p] = 1;
    rec++;
    pixLabs[p] = rgbToLab(r, g, b);
  }
  const c1 = $("#c1");
  c1.width = width;
  c1.height = height;
  $("#dbg0").width = width;
  $("#dbg0").height = height;
  $("#dbg1").width = width;
  $("#dbg1").height = height;
  st(`Sprite OK — recolorable ${rec}, locked ${lock}, transparent ${tr}`);
  drawDebug();

  try {
    if (_srcOverlay) drawSourceOverlay();
  } catch {}
}

/* ===== clustering / regions ===== */
function suggest(centerLab) {
  if (!mapIndex.length) return centerLab.slice();

  // If consensus count is 1, use original algorithm for efficiency
  if (colorConsensusCount === 1) {
    let bd = 1e9,
      best = mapIndex[0];
    for (let i = 0; i < mapIndex.length; i++) {
      const m = mapIndex[i];
      const d = dE(centerLab, m.nLab);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best.sLab.slice();
  }

  // Enhanced color consensus algorithm
  const candidates = [];

  // Find all potential matches within a reasonable distance
  // Adjust max distance based on consensus count - more candidates need broader search
  const MAX_DISTANCE = 20 + colorConsensusCount * 5; // 25-70 range

  for (let i = 0; i < mapIndex.length; i++) {
    const m = mapIndex[i];
    const distance = dE(centerLab, m.nLab);

    if (distance <= MAX_DISTANCE) {
      candidates.push({
        mapping: m,
        distance: distance,
        score: calculateConsensusScore(m, distance, centerLab),
      });
    }
  }

  if (candidates.length === 0) {
    // Fallback to original behavior if no good candidates
    // But use a more generous distance threshold
    let bd = 1e9,
      best = mapIndex[0];
    for (let i = 0; i < mapIndex.length; i++) {
      const m = mapIndex[i];
      const d = dE(centerLab, m.nLab);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    // console.log(`Fallback used for color [${centerLab.map(x => x.toFixed(1)).join(', ')}], distance: ${bd.toFixed(2)}`);
    if (debugColorConsensus) {
      console.log(
        `Fallback: No close candidates for LAB [${centerLab
          .map((x) => x.toFixed(1))
          .join(", ")}], using closest with distance ${bd.toFixed(2)}`
      );
    }
    return best.sLab.slice();
  }

  // Debug logging (uncomment for development)
  // console.log(`Color consensus for [${centerLab.map(x => x.toFixed(1)).join(', ')}]: ${candidates.length} candidates, using top ${Math.min(colorConsensusCount, candidates.length)}`);
  if (debugColorConsensus) {
    console.log(
      `Consensus: Found ${candidates.length} candidates for LAB [${centerLab
        .map((x) => x.toFixed(1))
        .join(", ")}], using top ${Math.min(
        colorConsensusCount,
        candidates.length
      )}`
    );
  }

  // Sort candidates by score (higher is better)
  candidates.sort((a, b) => b.score - a.score);

  // Take top N candidates for consensus
  const topCandidates = candidates.slice(
    0,
    Math.min(colorConsensusCount, candidates.length)
  );

  // Apply texture diversity bonus
  const textureUsage = new Map();
  for (const candidate of topCandidates) {
    const key = candidate.mapping.textureKey;
    textureUsage.set(key, (textureUsage.get(key) || 0) + 1);
  }

  // Boost scores for candidates from less-used textures
  for (const candidate of topCandidates) {
    const usageCount = textureUsage.get(candidate.mapping.textureKey);
    const totalTextures = textureUsage.size;
    if (totalTextures > 1) {
      // Diversity bonus: prefer textures used less frequently in this consensus
      candidate.score *= 1 + 0.3 / usageCount;
    }
  }

  // Re-sort after applying diversity bonus
  topCandidates.sort((a, b) => b.score - a.score);

  // Calculate weighted average of the top candidates
  let totalWeight = 0;
  let weightedL = 0,
    weightedA = 0,
    weightedB = 0;

  for (const candidate of topCandidates) {
    const weight = candidate.score;
    totalWeight += weight;
    weightedL += candidate.mapping.sLab[0] * weight;
    weightedA += candidate.mapping.sLab[1] * weight;
    weightedB += candidate.mapping.sLab[2] * weight;
  }

  const result = [
    weightedL / totalWeight,
    weightedA / totalWeight,
    weightedB / totalWeight,
  ];

  if (debugColorConsensus) {
    console.log(
      `  → Final consensus: LAB [${result
        .map((x) => x.toFixed(1))
        .join(", ")}] from ${topCandidates.length} textures`
    );
  }

  return result;
}

// Calculate a consensus score for a color mapping candidate
function calculateConsensusScore(mapping, distance, originalLab) {
  // Start with frequency weight (how often this color appears in textures)
  let score = Math.log(mapping.weight + 1); // Log to prevent extreme values

  // Inverse distance bonus (closer matches get higher scores)
  score += 10 / (distance + 1);

  // Color harmony bonus
  if (originalLab) {
    const harmonyBonus = analyzeColorHarmony(originalLab, mapping.sLab);
    score *= harmonyBonus;
  }

  // Bonus for mappings from different textures (diversity bonus)
  // This could be enhanced to track texture diversity if needed

  return score;
}
function computeFamiliesAndRegions() {
  if (!pixLabs) {
    st("No sprite");
    return;
  }

  const pts = [],
    idxs = [];
  for (let p = 0; p < pixLabs.length; p++) {
    if (pixMask[p] === 1 || (forceEditProtected && pixMask[p] === 2)) {
      const x = p % width,
        y = (p / width) | 0,
        L = pixLabs[p][0],
        a = pixLabs[p][1],
        b = pixLabs[p][2];
      pts.push([L, a, b, spatialW * x, spatialW * y]);
      idxs.push(p);
    }
  }
  if (!pts.length) {
    st("No pixels available");
    return;
  }
  const K = Math.min(kFamilies, pts.length);
  let centers = [];
  for (let i = 0; i < K; i++)
    centers.push(pts[(seededRandom() * pts.length) | 0].slice());
  const asg = new Array(pts.length).fill(0);
  for (let it = 0; it < 8; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0,
        bd = 1e9,
        u = pts[i];
      for (let c = 0; c < centers.length; c++) {
        const v = centers[c],
          d =
            (u[0] - v[0]) ** 2 +
            (u[1] - v[1]) ** 2 +
            (u[2] - v[2]) ** 2 +
            (u[3] - v[3]) ** 2 +
            (u[4] - v[4]) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      asg[i] = bi;
    }
    const sum = Array.from({ length: K }, () => [0, 0, 0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const a = asg[i],
        u = pts[i];
      sum[a][0] += u[0];
      sum[a][1] += u[1];
      sum[a][2] += u[2];
      sum[a][3] += u[3];
      sum[a][4] += u[4];
      sum[a][5]++;
    }
    for (let c = 0; c < K; c++) {
      const s = sum[c];
      if (s[5])
        centers[c] = [
          s[0] / s[5],
          s[1] / s[5],
          s[2] / s[5],
          s[3] / s[5],
          s[4] / s[5],
        ];
    }
  }
  assignFam = new Int16Array(pixLabs.length);
  assignFam.fill(-1);
  for (let i = 0; i < idxs.length; i++) assignFam[idxs[i]] = asg[i];
  famCenters = centers.map((c) => [c[0], c[1], c[2]]);
  famShinyLab = famCenters.map(suggest);
  famAutoLab = famShinyLab.map((v) => v.slice());

  regionIds = new Int32Array(pixLabs.length);
  regionIds.fill(-1);
  regions = [];
  famToRegions = Array.from({ length: famCenters.length }, () => []);
  regionDark = {};
  let rid = 0;
  const qx = new Int32Array(width * height),
    qy = new Int32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!(pixMask[p] === 1 || (forceEditProtected && pixMask[p] === 2)))
        continue;
      if (regionIds[p] !== -1) continue;
      const fam = assignFam[p];
      if (fam < 0) continue;
      let h = 0,
        t = 0;
      qx[t] = x;
      qy[t] = y;
      t++;
      regionIds[p] = rid;
      while (h < t) {
        const cx = qx[h],
          cy = qy[h];
        h++;
        const nb = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of nb) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const np = ny * width + nx;
          if (!(pixMask[np] === 1 || (forceEditProtected && pixMask[np] === 2)))
            continue;
          if (regionIds[np] !== -1) continue;
          if (assignFam[np] !== fam) continue;
          regionIds[np] = rid;
          qx[t] = nx;
          qy[t] = ny;
          t++;
        }
      }
      regions.push({
        id: rid,
        fam,
        linked: true,
        keep: false,
        lock: false,
        lab: null,
      });
      famToRegions[fam].push(rid);
      regionDark[rid] = 0;
      rid++;
    }
  renderPanel();
  st(`Clustering done — ${regions.length} regions`);
}

const labToHex = (Lab) => {
  const [r, g, b] = labToRgb(Lab[0], Lab[1], Lab[2]);
  return hex(r, g, b);
};
function renderPanel() {
  /* removed Families & Regions UI */

  // Update region panel based on current selection
  if (
    selectedRegion >= 0 &&
    regions[selectedRegion] &&
    !regions[selectedRegion].deleted
  ) {
    openSheet(selectedRegion);
  } else {
    // No region selected or invalid selection
    $("#sheetTitle").textContent = "No region selected";
    $("#pickedSwatch").style.background = "#000";
    drawDebug(); // Update debug overlay to hide region outline
  }
}
function openSheet(rid) {
  selectedRegion = rid;
  const R = regions[rid],
    fam = R.fam;
  $("#sheetTitle").textContent = `Region #${rid} (Family #${fam + 1})`;
  $("#sheetLink").checked = R.linked;
  $("#sheetKeep").checked = R.keep;
  $("#sheetLock").checked = R.lock;
  const lab = R.linked || !R.lab ? famShinyLab[fam] : R.lab;
  const col = labToHex(lab);
  $("#sheetColor").value = col;
  $("#pickedSwatch").style.background = col;
  $("#sheetDark").value = regionDark[rid] || 0;
  $("#sheetDarkVal").textContent = String(regionDark[rid] || 0);
  // right sidebar is always visible drawDebug();
  drawDebug(); // Update debug overlay to show selected region outline
}
(() => {
  const el = $("#sheetClose");
  if (el) {
    el.onclick = () => ($("#swSheet").style.display = "none");
  }
})();
$("#sheetLink").onchange = (e) => {
  const R = regions[selectedRegion];
  if (!R || R.deleted) return;
  R.linked = e.target.checked;
  if (R.linked) {
    R.lab = null;

    // If this is a pixel region, merge it back to the original family region
    if (R.isPixelRegion && R.originalFam !== undefined) {
      // Find the original family region
      let originalRegionId = -1;
      for (let i = 0; i < regions.length; i++) {
        if (regions[i].fam === R.originalFam && !regions[i].isPixelRegion) {
          originalRegionId = i;
          break;
        }
      }

      if (originalRegionId >= 0) {
        // Update all pixels that belong to this pixel region to use the original region
        if (regionIds) {
          for (let p = 0; p < regionIds.length; p++) {
            if (regionIds[p] === selectedRegion) {
              regionIds[p] = originalRegionId;
            }
          }
        }

        // Remove the pixel region from the regions array (mark as deleted)
        R.deleted = true;

        // Switch selection to the original region
        selectedRegion = originalRegionId;
        renderPanel();
        openSheet(selectedRegion);
      }
    }
  }
  renderPanel();
  applyShiny();
};
$("#sheetKeep").onchange = (e) => {
  const R = regions[selectedRegion];
  if (!R || R.deleted) return;
  R.keep = e.target.checked;
  applyShiny();
};
$("#sheetLock").onchange = (e) => {
  const R = regions[selectedRegion];
  if (!R || R.deleted) return;
  R.lock = e.target.checked;
};
$("#sheetColor").oninput = (e) => {
  const rid = selectedRegion;
  const R = regions[rid];
  if (!R || R.deleted) return;
  const [r, g, b] = unhex(e.target.value);
  R.lab = rgbToLab(r, g, b);
  R.linked = false;
  const link = $("#sheetLink");
  if (link) link.checked = false;
  const sw = $("#pickedSwatch");
  if (sw) sw.style.background = e.target.value;
  render();
};
$("#sheetRevert").onclick = () => {
  const R = regions[selectedRegion];
  if (!R || R.deleted || R.keep) return;
  if (R.linked) famShinyLab[R.fam] = famAutoLab[R.fam].slice();
  else {
    R.lab = null;
    R.linked = true;
  }
  const c = labToHex(R.linked || !R.lab ? famShinyLab[R.fam] : R.lab);
  $("#sheetColor").value = c;
  $("#pickedSwatch").style.background = c;
  renderPanel();
  applyShiny();
};
$("#sheetDark").oninput = (e) => {
  const rid = selectedRegion;
  if (rid < 0) return;
  regionDark[rid] = +e.target.value | 0;
  $("#sheetDarkVal").textContent = String(regionDark[rid]);
  applyShiny();
  renderPanel();
};

function regionAtCanvas(canvas, cx, cy) {
  if (!regionIds) return -1;
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((cx - r.left) * canvas.width) / r.width),
    y = Math.floor(((cy - r.top) * canvas.height) / r.height);
  return regionIds[y * canvas.width + x];
}
$("#c0").onclick = (e) => {
  try {
    const c = $("#c0");
    if (!c) return;
    const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) * c.width) / r.width);
    const y = Math.floor(((e.clientY - r.top) * c.height) / r.height);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const pix = ctx.getImageData(x, y, 1, 1).data;
    const a = pix[3];
    if (!a) return; // ignore transparent clicks

    // Handle Pick & Apply mode
    if (pickMode === "pickAndApply") {
      const [rr, gg, bb] = [pix[0], pix[1], pix[2]];
      pickedColorForApply = rgbToLab(rr, gg, bb);
      const colorHex = hex(rr, gg, bb);

      // Show the picked color
      document.getElementById("pickedColorForApply").style.display = "flex";
      document.getElementById("pickedColorSwatch").style.background = colorHex;

      st(
        "Color picked! Now click on Shiny to apply to region. Pick & Apply mode active."
      );
      return;
    }

    // Original functionality - direct color picking for selected region
    if (
      selectedRegion == null ||
      selectedRegion < 0 ||
      !regions[selectedRegion]
    ) {
      st("Pick a region on the shiny first");
      return;
    }
    const [rr, gg, bb] = [pix[0], pix[1], pix[2]];
    const R = regions[selectedRegion];
    R.lab = rgbToLab(rr, gg, bb);
    R.linked = false;
    const link = $("#sheetLink");
    if (link) link.checked = false;
    const sw = $("#pickedSwatch");
    if (sw) sw.style.background = hex(rr, gg, bb);
    render();
  } catch (err) {
    console.error("pick-from-original failed", err);
  }
};
$("#c1").onclick = (e) => {
  if (pickMode === "preview") {
    const c = $("#c1"),
      r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) * c.width) / r.width),
      y = Math.floor(((e.clientY - r.top) * c.height) / r.height);
    const d = c
      .getContext("2d", { willReadFrequently: true })
      .getImageData(x, y, 1, 1).data;
    const R = regions[selectedRegion];
    if (R && !R.lock && !R.keep) {
      const lab = rgbToLab(d[0], d[1], d[2]);
      if (R.linked) famShinyLab[R.fam] = lab;
      else R.lab = lab;
      const col = labToHex(lab);
      $("#sheetColor").value = col;
      $("#pickedSwatch").style.background = col;
      renderPanel();
      applyShiny();
    }
    pickMode = null;
    st("Picked from preview");
  } else if (pickMode === "pickAndApply" && pickedColorForApply) {
    // Handle Pick & Apply mode - apply picked color to clicked region or pixel
    const c = $("#c1");
    const r = c.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) * c.width) / r.width);
    const y = Math.floor(((e.clientY - r.top) * c.height) / r.height);
    const pixelIndex = y * width + x;

    const rid = regionAtCanvas($("#c1"), e.clientX, e.clientY);
    if (rid >= 0) {
      const R = regions[rid];
      if (R && !R.lock && !R.keep) {
        const isPixelLevelMode =
          document.getElementById("pixelLevelMode").checked;

        if (isPixelLevelMode) {
          // Create a new region for this individual pixel
          const newRid = regions.length;
          const originalFam = R.fam;

          // Create new region for this pixel
          const newRegion = {
            id: newRid,
            fam: originalFam, // Keep original family reference for potential re-linking
            originalFam: originalFam, // Store original family for re-linking
            linked: false,
            keep: false,
            lock: false,
            lab: pickedColorForApply.slice(),
            isPixelRegion: true, // Mark as pixel-level region
          };

          regions.push(newRegion);
          regionDark[newRid] = 0;

          // Update this specific pixel to belong to the new region
          regionIds[pixelIndex] = newRid;

          // Update UI
          selectedRegion = newRid;
          const col = labToHex(newRegion.lab);
          $("#sheetColor").value = col;
          $("#pickedSwatch").style.background = col;
          $("#sheetLink").checked = false;

          renderPanel();
          openSheet(newRid);
          applyShiny();
          st(
            `Applied picked color to individual pixel. Pick & Apply mode still active.`
          );
        } else {
          // Apply the picked color to entire region (original behavior)
          R.lab = pickedColorForApply.slice(); // Clone the color
          R.linked = false;

          // Update UI
          selectedRegion = rid;
          const col = labToHex(R.lab);
          $("#sheetColor").value = col;
          $("#pickedSwatch").style.background = col;
          $("#sheetLink").checked = false;

          renderPanel();
          openSheet(rid);
          applyShiny();
          st(
            `Applied picked color to region #${rid}. Pick & Apply mode still active.`
          );
        }
      } else {
        st("Cannot apply to locked or kept regions");
      }
    } else {
      st("Click on a valid region");
    }
  } else {
    const rid = regionAtCanvas($("#c1"), e.clientX, e.clientY);
    if (rid >= 0) {
      selectedRegion = rid;
      renderPanel();
      openSheet(rid);
    }
  }
};

// Add zoom functionality to canvas mouse events
$("#c0").addEventListener("mousemove", (e) => {
  updateZoomOverlay(
    "#c0",
    "#zoomOverlay0",
    "#zoomCanvas0",
    e.clientX,
    e.clientY
  );
});

$("#c0").addEventListener("mouseleave", () => {
  hideZoomOverlay("#zoomOverlay0");
});

$("#c1").addEventListener("mousemove", (e) => {
  updateZoomOverlay(
    "#c1",
    "#zoomOverlay1",
    "#zoomCanvas1",
    e.clientX,
    e.clientY
  );
});

$("#c1").addEventListener("mouseleave", () => {
  hideZoomOverlay("#zoomOverlay1");
});

document.getElementById("pickFromTexture").onclick = () => {
  const sel = $("#texChooser");
  if (!sel || !sel.value) {
    toast("Pick a shiny texture in the dropdown");
    return;
  }
  const [key, idxStr] = sel.value.split("|");
  const idx = parseInt(idxStr || "0", 10);
  const pack = texPairs[key];
  if (!pack || !pack.S || !pack.S[idx]) {
    toast("Texture not found");
    return;
  }
  openTexOverlayWithObj(pack.S[idx]);
};
document.getElementById("pickFromPreview").onclick = () => {
  pickMode = "preview";
  st("Tap shiny preview to pick");
};

// New Pick & Apply functionality
document.getElementById("colorPickAndApply").onclick = () => {
  if (pickMode === "pickAndApply") {
    // Disable mode
    pickMode = null;
    pickedColorForApply = null;
    document.getElementById("colorPickAndApply").textContent = "Apply Multiple";
    document.getElementById("colorPickAndApply").style.background = "";
    document.getElementById("pickedColorForApply").style.display = "none";
    // Hide the individual pixels toggle
    document.getElementById("pixelLevelMode").parentElement.style.display =
      "none";
    st("Apply Multiple mode disabled");
  } else {
    // Enable mode
    pickMode = "pickAndApply";
    pickedColorForApply = null;
    selectedRegion = -1; // Clear selection to prevent applying to previously selected region
    document.getElementById("colorPickAndApply").textContent = "Cancel";
    document.getElementById("colorPickAndApply").style.background =
      "var(--acc)";
    document.getElementById("pickedColorForApply").style.display = "none";
    // Show the individual pixels toggle
    document.getElementById("pixelLevelMode").parentElement.style.display =
      "inline-block";
    renderPanel(); // Update UI to reflect no region selected
    st("Apply Multiple mode: Click Original to pick color");
  }
};

function openTexOverlayWithObj(obj) {
  const overlay = $("#pickerOverlay"),
    texC = $("#texCanvas");
  const S = obj.img;
  texC.width = S.width;
  texC.height = S.height;
  texC.getContext("2d").putImageData(S, 0, 0);
  overlay.style.display = "flex";
  const loupe = $("#loupe"),
    lctx = $("#loupeCanvas").getContext("2d"),
    L = 120,
    SCALE = 3,
    RAD = L / 2 / SCALE;
  function sampleAt(cx, cy) {
    const r = texC.getBoundingClientRect();
    const x = Math.floor(((cx - r.left) * texC.width) / r.width),
      y = Math.floor(((cy - r.top) * texC.height) / r.height);
    const xx = Math.max(0, Math.min(texC.width - 1, x)),
      yy = Math.max(0, Math.min(texC.height - 1, y));
    const d = texC
      .getContext("2d", { willReadFrequently: true })
      .getImageData(xx, yy, 1, 1).data;
    const R = regions[selectedRegion];
    if (R && !R.lock && !R.keep) {
      const lab = rgbToLab(d[0], d[1], d[2]);
      if (R.linked) famShinyLab[R.fam] = lab;
      else R.lab = lab;
      const col = labToHex(lab);
      $("#sheetColor").value = col;
      $("#pickedSwatch").style.background = col;
      renderPanel();
      applyShiny();
    }
    lctx.imageSmoothingEnabled = false;
    lctx.clearRect(0, 0, L, L);
    const sx = Math.max(0, Math.min(texC.width - 2 * RAD, xx - RAD)),
      sy = Math.max(0, Math.min(texC.height - 2 * RAD, yy - RAD));
    lctx.drawImage(texC, sx, sy, 2 * RAD, 2 * RAD, 0, 0, L, L);
    const br = texC.getBoundingClientRect();
    loupe.style.left = Math.round(cx - br.left - L / 2) + "px";
    loupe.style.top = Math.round(cy - br.top - L - 16) + "px";
    loupe.style.display = "block";
  }
  function onMouse(e) {
    sampleAt(e.clientX, e.clientY);
  }
  function onTouch(e) {
    e.preventDefault();
    const t = e.touches[0];
    if (t) sampleAt(t.clientX, t.clientY);
  }
  texC.addEventListener("mousemove", onMouse);
  texC.addEventListener("click", onMouse);
  texC.addEventListener("touchstart", onTouch, { passive: false });
  texC.addEventListener("touchmove", onTouch, { passive: false });
  function done() {
    overlay.style.display = "none";
    loupe.style.display = "none";
    texC.removeEventListener("mousemove", onMouse);
    texC.removeEventListener("click", onMouse);
    texC.removeEventListener("touchstart", onTouch);
    texC.removeEventListener("touchmove", onTouch);
  }
  $("#pickerDone").onclick = done;
  $("#pickerCancel").onclick = done;
}

/* ===== source image picker under Original ===== */
let _srcOverlay = null; // {canvas,w,h,scale,dx,dy}

function fillSourceDropdown() {
  const sel = document.getElementById("sourceSel");
  if (!sel) {
    return;
  }
  sel.innerHTML =
    '<option value="">(choose source image: textures & sprites)</option>';
  if (!currentFolder) {
    return;
  }
  const pack = folders.get(currentFolder);
  if (!pack) {
    return;
  }
  if (pack.textures) {
    pack.textures.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = "T|" + i;
      o.textContent = f.name;
      sel.appendChild(o);
    });
  }
  if (pack.extras) {
    pack.extras.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = "E|" + i;
      o.textContent = f.name;
      sel.appendChild(o);
    });
  }
  if (pack.sprites) {
    pack.sprites.forEach((f, i) => {
      const o = document.createElement("option");
      o.value = "S|" + i;
      o.textContent = "icon/" + f.name;
      sel.appendChild(o);
    });
  }
}
function setSourceFromFile(file) {
  return (async () => {
    if (!file) {
      _srcOverlay = null;
      return;
    }
    // fileToImageObj returns {name, img: ImageData}
    const obj = await fileToImageObj(file);
    const imgData = obj && obj.img ? obj.img : null;
    if (!imgData) {
      _srcOverlay = null;
      return;
    }
    // Put ImageData into a canvas we can draw
    const srcC = document.createElement("canvas");
    srcC.width = imgData.width;
    srcC.height = imgData.height;
    const sctx = srcC.getContext("2d", { willReadFrequently: true });
    sctx.putImageData(imgData, 0, 0);
    _srcOverlay = {
      canvas: srcC,
      w: srcC.width,
      h: srcC.height,
      scale: 1,
      dx: 0,
      dy: 0,
    };

    // Ensure #c0 keeps its width, expand height if needed to fit aspect
    const c0 = document.getElementById("c0");
    if (c0) {
      const targetW = c0.width; // logical pixels
      const needH = Math.round(imgData.height * (targetW / imgData.width));
      if (needH > c0.height) c0.height = needH;
    }
    // draw the new source overlay now that sizes are correct
    drawSourceOverlay();
  })();
}
function drawSourceOverlay() {
  const c0 = document.getElementById("c0");
  if (!c0 || !_srcOverlay) return;
  const ctx = c0.getContext("2d", { willReadFrequently: true });
  const W = c0.width,
    H = c0.height;
  const iw = _srcOverlay.w,
    ih = _srcOverlay.h;
  if (!(W && H && iw && ih)) return;
  const scale = Math.min(W / iw, H / ih);
  const vw = Math.round(iw * scale),
    vh = Math.round(ih * scale);
  const dx = Math.floor((W - vw) / 2),
    dy = Math.floor((H - vh) / 2);
  _srcOverlay.scale = scale;
  _srcOverlay.dx = dx;
  _srcOverlay.dy = dy;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // clear previous source image
  ctx.clearRect(0, 0, c0.width, c0.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c0.width, c0.height);
  ctx.drawImage(_srcOverlay.canvas, 0, 0, iw, ih, dx, dy, vw, vh);
  ctx.restore();
}
// Always-on color pick from Original
(function attachC0Picker() {
  const c0 = document.getElementById("c0");
  if (!c0) return;
  c0.addEventListener("click", (e) => {
    const rect = c0.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (c0.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (c0.height / rect.height));
    const d = c0.getContext("2d").getImageData(x, y, 1, 1).data;
    const r = d[0],
      g = d[1],
      b = d[2];
    const rid = typeof selectedRegion === "number" ? selectedRegion : -1;
    if (rid >= 0 && regions && regions[rid]) {
      regions[rid].lab = rgbToLab(r, g, b);
      regions[rid].linked = false;
      const link = document.getElementById("sheetLink");
      if (link) link.checked = false;
      const sw = document.getElementById("pickedSwatch");
      if (sw) sw.style.background = hex(r, g, b);
      if (typeof applyShiny === "function") applyShiny();
      if (typeof drawDebug === "function") drawDebug();
    }
  });
})();
// Populate list and handle selection
(() => {
  const sel = document.getElementById("sourceSel");
  if (sel) {
    sel.addEventListener("change", async () => {
      const v = sel.value || "";
      if (!v) {
        _srcOverlay = null;
        if (typeof drawSprite === "function") drawSprite();
        if (typeof applyShiny === "function") applyShiny();
        if (typeof drawDebug === "function") drawDebug();
        if (typeof drawDebug === "function") drawDebug();
        return;
      }
      const [k, iStr] = v.split("|");
      const idx = parseInt(iStr || "0", 10);
      const pack = currentFolder ? folders.get(currentFolder) : null;
      const f =
        k === "T" && pack && pack.textures && pack.textures[idx]
          ? pack.textures[idx]
          : k === "S" && pack && pack.sprites && pack.sprites[idx]
          ? pack.sprites[idx]
          : null;
      if (!f) {
        _srcOverlay = null;
        if (typeof drawSprite === "function") drawSprite();
        if (typeof applyShiny === "function") applyShiny();
        if (typeof drawDebug === "function") drawDebug();
        if (typeof drawDebug === "function") drawDebug();
        return;
      }
      await setSourceFromFile(f);
      if (typeof drawSprite === "function") drawSprite();
      drawSourceOverlay();
      if (typeof applyShiny === "function") applyShiny();
      if (typeof drawDebug === "function") drawDebug();
      if (typeof drawDebug === "function") drawDebug();
    });
  }
})();

// --- helper: pick a sensible default for the source dropdown and draw it ---
function pickDefaultSourceForCurrentFolder() {
  const sel = document.getElementById("sourceSel");
  if (!sel || !currentFolder) return;
  const pack = folders.get(currentFolder);
  if (!pack) return;
  function findIndex(arr, rx) {
    if (!arr) return -1;
    for (let i = 0; i < arr.length; i++) {
      if (rx.test(arr[i].name)) return i;
    }
    return -1;
  }
  let idx = findIndex(pack.textures, /_home_col_rare\.png$/i);
  if (idx >= 0) {
    sel.value = "T|" + idx;
  } else if ((idx = findIndex(pack.textures, /_home_col\.png$/i)) >= 0) {
    sel.value = "T|" + idx;
  } else if (pack.textures && pack.textures.length) {
    sel.value = "T|0";
  } else if (pack.extras && pack.extras.length) {
    sel.value = "E|0";
  } else if (pack.sprites && pack.sprites.length) {
    sel.value = "S|0";
  } else {
    return;
  }
  (async () => {
    const v = sel.value || "";
    const [k, iStr] = v.split("|");
    const idx = parseInt(iStr || "0", 10);
    let f = null;
    if (k === "T" && pack.textures) f = pack.textures[idx];
    else if (k === "E" && pack.extras) f = pack.extras[idx];
    else if (k === "S" && pack.sprites) f = pack.sprites[idx];
    if (f) {
      await setSourceFromFile(f);
      if (typeof drawSprite === "function") drawSprite();
      drawSourceOverlay();
      if (typeof applyShiny === "function") applyShiny();
      if (typeof drawDebug === "function") drawDebug();
    }
  })();
}
/* ===== debug overlay ===== */
function getRegionOutlinePixels(regionId, width, height) {
  if (!regionIds || regionId < 0 || !regions[regionId]) return [];

  const outlinePixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (regionIds[p] !== regionId) continue;

      // Check if this pixel is on the edge (only check 4-connected neighbors for performance)
      let isEdge = false;

      // Check left
      if (x === 0 || regionIds[p - 1] !== regionId) isEdge = true;
      // Check right
      else if (x === width - 1 || regionIds[p + 1] !== regionId) isEdge = true;
      // Check up
      else if (y === 0 || regionIds[p - width] !== regionId) isEdge = true;
      // Check down
      else if (y === height - 1 || regionIds[p + width] !== regionId)
        isEdge = true;

      if (isEdge) {
        outlinePixels.push(p);
      }
    }
  }
  return outlinePixels;
}

function drawDebug() {
  const showProtected = $("#showDebug").checked;
  const showOutline = showRegionOutline;
  const c0 = $("#c0"),
    c1 = $("#c1"),
    d0 = $("#dbg0"),
    d1 = $("#dbg1");

  // Show overlay if either debug mode is enabled
  const shouldShow =
    (showProtected && pixMask) ||
    (showOutline && regionIds && selectedRegion >= 0);
  d0.style.display = d1.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) return;

  const w = c0.width,
    h = c0.height;
  [d0, d1].forEach((c) => {
    c.width = w;
    c.height = h;
  });

  // Position debug overlays to match the main canvas position
  const c0Rect = c0.getBoundingClientRect();
  const c1Rect = c1.getBoundingClientRect();
  const d0Parent = d0.parentElement.getBoundingClientRect();
  const d1Parent = d1.parentElement.getBoundingClientRect();

  // Calculate offset from parent container to canvas
  const d0OffsetLeft = c0Rect.left - d0Parent.left;
  const d0OffsetTop = c0Rect.top - d0Parent.top;
  const d1OffsetLeft = c1Rect.left - d1Parent.left;
  const d1OffsetTop = c1Rect.top - d1Parent.top;

  // Apply positioning
  d0.style.left = d0OffsetLeft + "px";
  d0.style.top = d0OffsetTop + "px";
  d0.style.width = c0Rect.width + "px";
  d0.style.height = c0Rect.height + "px";

  d1.style.left = d1OffsetLeft + "px";
  d1.style.top = d1OffsetTop + "px";
  d1.style.width = c1Rect.width + "px";
  d1.style.height = c1Rect.height + "px";
  const ctx0 = d0.getContext("2d"),
    ctx1 = d1.getContext("2d");
  const img0 = ctx0.createImageData(w, h),
    img1 = ctx1.createImageData(w, h);
  const A0 = img0.data,
    A1 = img1.data;

  // Clear the image data
  A0.fill(0);
  A1.fill(0);

  const activeRid = selectedRegion >= 0 ? selectedRegion : -1;

  // Draw protected pixels overlay
  if (showProtected && pixMask) {
    for (let p = 0, i = 0; p < pixMask.length; p++, i += 4) {
      if (pixMask[p] !== 2) continue;
      const editable =
        $("#editProtected").checked && regionIds && regionIds[p] === activeRid;
      const R = editable ? 60 : 220,
        G = editable ? 220 : 60,
        B = 60,
        AA = 110;
      A0[i] = R;
      A0[i + 1] = G;
      A0[i + 2] = B;
      A0[i + 3] = AA;
      A1[i] = R;
      A1[i + 1] = G;
      A1[i + 2] = B;
      A1[i + 3] = AA;
    }
  }

  // Draw selected region outline
  if (showOutline && regionIds && activeRid >= 0) {
    const outlinePixels = getRegionOutlinePixels(activeRid, w, h);
    for (const p of outlinePixels) {
      const i = p * 4;
      // Use bright magenta for the outline to be highly visible
      A0[i] = 255; // R
      A0[i + 1] = 0; // G
      A0[i + 2] = 255; // B
      A0[i + 3] = 220; // A
      A1[i] = 255; // R
      A1[i + 1] = 0; // G
      A1[i + 2] = 255; // B
      A1[i + 3] = 220; // A
    }
  }

  ctx0.putImageData(img0, 0, 0);
  ctx1.putImageData(img1, 0, 0);
}

/* ===== recolor + smoothing + contrast ===== */
function applyShiny() {
  if (!pixLabs || !assignFam || !regions.length) {
    st("Ready");
    return;
  }
  const c1 = $("#c1"),
    ctx = c1.getContext("2d"),
    id = ctx.createImageData(width, height),
    D = id.data;
  const activeRid = selectedRegion >= 0 ? selectedRegion : -1;
  for (let p = 0, i = 0; p < pixLabs.length; p++, i += 4) {
    if (pixMask[p] === 0) {
      D[i + 3] = 0;
      continue;
    }
    const r = pixRGB[i],
      g = pixRGB[i + 1],
      b = pixRGB[i + 2],
      a = pixRGB[i + 3];
    const rid = regionIds ? regionIds[p] : -1;
    const allow = $("#editProtected").checked && rid === activeRid;
    if (pixMask[p] === 2 && !allow) {
      D[i] = r;
      D[i + 1] = g;
      D[i + 2] = b;
      D[i + 3] = a;
      continue;
    }

    const fam = assignFam[p];
    if (fam < 0) {
      D[i] = r;
      D[i + 1] = g;
      D[i + 2] = b;
      D[i + 3] = a;
      continue;
    }
    const R = regions[rid];
    if (!R || R.deleted) {
      D[i] = r;
      D[i + 1] = g;
      D[i + 2] = b;
      D[i + 3] = a;
      continue;
    }
    if (R.keep) {
      D[i] = r;
      D[i + 1] = g;
      D[i + 2] = b;
      D[i + 3] = a;
      continue;
    }

    const base = R.linked || !R.lab ? famShinyLab[fam] : R.lab;

    // Lightness remap (preserve relative shading) + per-region ΔL + global contrast
    let Lp =
      base[0] + (pixLabs[p][0] - famCenters[fam][0]) + (regionDark[rid] || 0);
    Lp = 50 + (Lp - 50) * contrastFactor; // contrast about mid-gray
    if (Lp < 0) Lp = 0;
    if (Lp > 100) Lp = 100;

    const c = labToRgb(Lp, base[1], base[2]);
    D[i] = c[0];
    D[i + 1] = c[1];
    D[i + 2] = c[2];
    D[i + 3] = a;
  }
  ctx.putImageData(id, 0, 0);

  const px = +$("#smoothPx").value,
    blend = +$("#smoothAmt").value / 100;
  if (px > 0 || blend > 0) {
    const radius = Math.max(0, px | 0);
    const amt = 0.25 + 0.75 * blend; // mix amount 0.25..1.0
    const sigmaR = 6.0 + 14.0 * blend; // allow more cross-region blending (except outlines)
    const sigmaS = 1.1 + 0.2 * radius;
    jointBilateralLab(
      "#c1",
      "#cGuide",
      radius,
      sigmaS,
      sigmaR,
      amt,
      0.65,
      0.45
    );
    const featherAmt = 0.2 + 0.6 * blend; // 0.2..0.8
    featherOutline("#c1", "#cGuide", 1, featherAmt);
  }
  st("Done");
  drawDebug();
}
function jointBilateralLab(
  outSel,
  guideSel,
  radius = 1,
  sigmaS = 1.1,
  sigmaR = 6.0,
  amt = 0.4,
  mixL = 0.75,
  mixC = 0.3
) {
  const outC = $(outSel),
    w = outC.width,
    h = outC.height,
    guideC = $(guideSel);
  const octx = outC.getContext("2d", { willReadFrequently: true }),
    gctx = guideC.getContext("2d", { willReadFrequently: true });
  const out = octx.getImageData(0, 0, w, h),
    guide = gctx.getImageData(0, 0, w, h),
    D = out.data,
    G = guide.data;
  const r = radius | 0,
    ks = [];
  for (let j = -r; j <= r; j++)
    for (let i = -r; i <= r; i++)
      ks.push(Math.exp(-(i * i + j * j) / (2 * sigmaS * sigmaS)));
  const idx = (x, y) => (y * w + x) << 2,
    clamp = (x, y) => [
      Math.max(0, Math.min(w - 1, x)),
      Math.max(0, Math.min(h - 1, y)),
    ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = idx(x, y);
      if (D[o + 3] === 0) continue;
      const L0 = rgbToLab(D[o], D[o + 1], D[o + 2]);
      const Lg0 = rgbToLab(G[o], G[o + 1], G[o + 2])[0];
      let wL = 0,
        aL = 0,
        wA = 0,
        aA = 0,
        wB = 0,
        aB = 0,
        k = 0;
      for (let j = -r; j <= r; j++)
        for (let i = -r; i <= r; i++, k++) {
          const xy = clamp(x + i, y + j),
            n = idx(xy[0], xy[1]);
          if (D[n + 3] === 0) continue;
          const Ln = rgbToLab(D[n], D[n + 1], D[n + 2]);
          const Lg = rgbToLab(G[n], G[n + 1], G[n + 2])[0];
          const wS = ks[k],
            dL = Lg - Lg0,
            wR = Math.exp(-(dL * dL) / (2 * sigmaR * sigmaR)),
            w = wS * wR;
          aL += Ln[0] * w;
          wL += w;
          aA += Ln[1] * w;
          wA += w;
          aB += Ln[2] * w;
          wB += w;
        }
      const Lf = wL ? aL / wL : L0[0],
        Af = wA ? aA / wA : L0[1],
        Bf = wB ? (wB ? aB / wB : L0[2]) : L0[2];
      const Lmix = L0[0] * (1 - amt * mixL) + Lf * (amt * mixL);
      const Amix = L0[1] * (1 - amt * mixC) + Af * (amt * mixC);
      const Bmix = L0[2] * (1 - amt * mixC) + Bf * (amt * mixC);
      const rgb = labToRgb(Lmix, Amix, Bmix);
      D[o] = rgb[0];
      D[o + 1] = rgb[1];
      D[o + 2] = rgb[2];
    }
  octx.putImageData(out, 0, 0);
}
function featherOutline(outSel, guideSel, radius = 1, feather = 0.3) {
  const cOut = $(outSel),
    w = cOut.width,
    h = cOut.height,
    cG = $(guideSel);
  const ctxO = cOut.getContext("2d", { willReadFrequently: true }),
    ctxG = cG.getContext("2d", { willReadFrequently: true });
  const O = ctxO.getImageData(0, 0, w, h),
    D = O.data,
    G = ctxG.getImageData(0, 0, w, h).data;
  const ink = new Uint8Array(w * h);
  for (let p = 0, i = 0; i < G.length; i += 4, p++)
    if (
      G[i + 3] > 0 &&
      Math.max(G[i], G[i + 1], G[i + 2]) <= PROTECT_NEAR_BLACK
    )
      ink[p] = 1;
  const near = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (ink[p]) {
        near[p] = 2;
        continue;
      }
      if (
        (x > 0 && ink[p - 1]) ||
        (x < w - 1 && ink[p + 1]) ||
        (y > 0 && ink[p - w]) ||
        (y < h - 1 && ink[p + w])
      )
        near[p] = 1;
    }
  for (let p = 0, i = 0; i < D.length; i += 4, p++) {
    if (D[i + 3] === 0) continue;
    const wgt = near[p] === 2 ? feather : near[p] === 1 ? feather * 0.5 : 0;
    if (!wgt) continue;
    D[i] = Math.round(D[i] * (1 - wgt) + G[i] * wgt);
    D[i + 1] = Math.round(D[i + 1] * (1 - wgt) + G[i + 1] * wgt);
    D[i + 2] = Math.round(D[i + 2] * (1 - wgt) + G[i + 2] * wgt);
  }
  ctxO.putImageData(O, 0, 0);
}

/* ===== hotkeys ===== */
const HK_DEFAULT = {
  open: "?",
  load: "l",
  save: "s",
  recluster: "r",
  debug: "d",
  editProt: "e",
  outline: "o",
  pickPrev: "p",
  pickTex: "t",
  pickApply: "a",
  prevReg: "[",
  nextReg: "]",
  keep: "k",
  prevPokemon: ",",
  nextPokemon: ".",
  zoom: "z",
};
function loadHK() {
  try {
    const j = localStorage.getItem("bdsp_hotkeys");
    if (j) return JSON.parse(j);
  } catch {}
  return { ...HK_DEFAULT };
}
function saveHK(h) {
  localStorage.setItem("bdsp_hotkeys", JSON.stringify(h));
}
let HK = loadHK();
function keyCaptureInput(el, keyName) {
  el.value = (HK[keyName] || "").toUpperCase();
  el.addEventListener("keydown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    let k = e.key;
    if (k === " ") k = "Space";
    if (k.length === 1) k = k.toLowerCase();
    HK[keyName] = k;
    el.value = k.toUpperCase();
  });
}
function applyHKBindings() {
  document.onkeydown = (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const typing =
      /INPUT|TEXTAREA|SELECT/.test(tag) &&
      e.target.type !== "checkbox" &&
      e.target.id.indexOf("sheet") !== 0;
    if (typing) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === HK.open) {
      e.preventDefault();
      openHotkeyModal();
      return;
    }
    if (k === HK.load) {
      e.preventDefault();
      $("#loadBtn").click();
      return;
    }
    if (k === HK.save) {
      e.preventDefault();
      $("#saveBtn").click();
      return;
    }
    if (k === HK.recluster) {
      e.preventDefault();
      $("#recluster").click();
      return;
    }
    if (k === HK.debug) {
      e.preventDefault();
      $("#showDebug").checked = !$("#showDebug").checked;
      drawDebug();
      return;
    }
    if (k === HK.outline) {
      e.preventDefault();
      $("#showRegionOutline").checked = !$("#showRegionOutline").checked;
      showRegionOutline = $("#showRegionOutline").checked;
      drawDebug();
      return;
    }
    if (k === HK.editProt) {
      e.preventDefault();
      $("#editProtected").checked = !$("#editProtected").checked;
      applyShiny();
      drawDebug();
      return;
    }
    if (k === HK.pickPrev) {
      e.preventDefault();
      pickMode = "preview";
      st("Tap shiny preview to pick");
      return;
    }
    if (k === HK.pickTex) {
      e.preventDefault();
      document.getElementById("pickFromTexture").click();
      return;
    }
    if (k === HK.pickApply) {
      e.preventDefault();
      document.getElementById("colorPickAndApply").click();
      return;
    }
    if (k === HK.prevReg) {
      e.preventDefault();
      stepRegion(-1);
      return;
    }
    if (k === HK.nextReg) {
      e.preventDefault();
      stepRegion(+1);
      return;
    }
    if (k === HK.keep) {
      e.preventDefault();
      const R = regions[selectedRegion];
      if (R) {
        R.keep = !R.keep;
        applyShiny();
        renderPanel();
      }
    }
    if (k === HK.prevPokemon) {
      e.preventDefault();
      navigatePokemon(-1);
      return;
    }
    if (k === HK.nextPokemon) {
      e.preventDefault();
      navigatePokemon(1);
      return;
    }
    if (k === HK.zoom) {
      e.preventDefault();
      toggleZoomMode();
      return;
    }
    if (k === "ArrowLeft") {
      e.preventDefault();
      bumpDark(-1);
      return;
    }
    if (k === "ArrowRight") {
      e.preventDefault();
      bumpDark(+1);
      return;
    }
    if (k === "ArrowUp") {
      e.preventDefault();
      bumpDark(+5);
      return;
    }
    if (k === "ArrowDown") {
      e.preventDefault();
      bumpDark(-5);
      return;
    }
  };
}
function bumpDark(delta) {
  if (selectedRegion < 0) return;
  regionDark[selectedRegion] = (regionDark[selectedRegion] || 0) + delta;
  if (regionDark[selectedRegion] > 40) regionDark[selectedRegion] = 40;
  if (regionDark[selectedRegion] < -40) regionDark[selectedRegion] = -40;
  $("#sheetDark").value = regionDark[selectedRegion];
  $("#sheetDarkVal").textContent = String(regionDark[selectedRegion]);
  applyShiny();
  renderPanel();
}
function openHotkeyModal() {
  keyCaptureInput($("#hkOpen"), "open");
  keyCaptureInput($("#hkLoad"), "load");
  keyCaptureInput($("#hkSave"), "save");
  keyCaptureInput($("#hkRecluster"), "recluster");
  keyCaptureInput($("#hkDebug"), "debug");
  keyCaptureInput($("#hkOutline"), "outline");
  keyCaptureInput($("#hkEditProt"), "editProt");
  keyCaptureInput($("#hkPickPrev"), "pickPrev");
  keyCaptureInput($("#hkPickTex"), "pickTex");
  keyCaptureInput($("#hkPickApply"), "pickApply");
  keyCaptureInput($("#hkPrevReg"), "prevReg");
  keyCaptureInput($("#hkNextReg"), "nextReg");
  keyCaptureInput($("#hkKeep"), "keep");
  keyCaptureInput($("#hkPrevPokemon"), "prevPokemon");
  keyCaptureInput($("#hkNextPokemon"), "nextPokemon");
  keyCaptureInput($("#hkZoom"), "zoom");
  $("#hotkeyModal").style.display = "flex";
}
$("#saveHotkeys").onclick = () => {
  saveHK(HK);
  applyHKBindings();
  $("#hotkeyModal").style.display = "none";
  toast("Hotkeys saved");
};
$("#closeHotkeyModal").onclick = () =>
  ($("#hotkeyModal").style.display = "none");
$("#hotkeyBtn").onclick = () => openHotkeyModal();

// Close modal when clicking outside the content
$("#hotkeyModal").onclick = (e) => {
  if (e.target === $("#hotkeyModal")) {
    $("#hotkeyModal").style.display = "none";
  }
};
applyHKBindings();
function stepRegion(dir) {
  if (!regions.length) return;
  if (selectedRegion < 0) selectedRegion = regions[0].id;
  const order = regions.map((r) => r.id).sort((a, b) => a - b);
  let i = order.indexOf(selectedRegion);
  if (i < 0) i = 0;
  i = (i + dir + order.length) % order.length;
  selectedRegion = order[i];
  renderPanel();
  openSheet(selectedRegion);
}

// === Patch: make folder dropdown actually load selection ===
function fillSpriteDropdownForCurrentFolder() {
  const sel = document.getElementById("spriteSel");
  if (!sel) {
    return;
  }
  sel.innerHTML = '<option value="">(icon/*.png)</option>';
  if (!currentFolder) {
    return;
  }
  const pack = folders.get(currentFolder);
  if (!(pack && pack.sprites && pack.sprites.length)) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < pack.sprites.length; i++) {
    const f = pack.sprites[i];
    const opt = document.createElement("option");
    opt.value = String(i);
    // show trimmed name if helper exists
    try {
      const nm =
        f && f.name ? f.name.replace(/^.*\//, "") : "sprite " + (i + 1);
      opt.textContent = nm;
    } catch (_) {
      opt.textContent = "sprite " + (i + 1);
    }
    frag.appendChild(opt);
  }
  sel.appendChild(frag);
}

(function attachFolderSelHandler() {
  const sel = document.getElementById("folderSel");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const key = sel.value;
    if (!key) {
      currentFolder = null;
      document.getElementById("texList").innerHTML = "";
      const ss = document.getElementById("sourceSel");
      if (ss)
        ss.innerHTML =
          '<option value="">(choose source image: textures & sprites)</option>';
      fillSpriteDropdownForCurrentFolder();
      loadHomeTexturePreview(); // Clear home texture preview
      return;
    }
    currentFolder = key;
    // refresh texture checkboxes & mapping
    if (typeof renderTextureList === "function") renderTextureList();
    if (typeof updateSelectedTextures === "function") updateSelectedTextures();
    // fill source dropdown (textures + sprites)
    if (typeof fillSourceDropdown === "function") fillSourceDropdown();
    if (typeof pickDefaultSourceForCurrentFolder === "function")
      pickDefaultSourceForCurrentFolder();
    // fill sprites and select first
    fillSpriteDropdownForCurrentFolder();
    const sprSel = document.getElementById("spriteSel");
    if (sprSel && sprSel.options.length > 1) {
      sprSel.selectedIndex = 1; // skip placeholder
    }
    // Update home texture preview
    loadHomeTexturePreview();
    // fire load using the existing click handler
    const btn = document.getElementById("loadBtn");
    if (btn && typeof btn.click === "function") btn.click();
  });

  // Auto-trigger on first render if options exist
  if (sel.options && sel.options.length > 1 && sel.selectedIndex <= 0) {
    sel.selectedIndex = 1; // skip placeholder
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    if (typeof fillSourceDropdown === "function") fillSourceDropdown();
    if (typeof pickDefaultSourceForCurrentFolder === "function")
      pickDefaultSourceForCurrentFolder();
  }
})();

// === Patch: when form/sprite selection changes, auto-load and choose default source ===
(function attachSpriteSelHandler() {
  const sprSel = document.getElementById("spriteSel");
  if (!sprSel) return;
  sprSel.addEventListener("change", () => {
    const btn = document.getElementById("loadBtn");
    if (btn && typeof btn.click === "function") btn.click();
    if (typeof fillSourceDropdown === "function") fillSourceDropdown();
    if (typeof pickDefaultSourceForCurrentFolder === "function")
      pickDefaultSourceForCurrentFolder();
  });
})();
