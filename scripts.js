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
  const statusEl = $("#status");
  statusEl.textContent = t;

  // Add loading class for status messages containing "…" or ending with "..."
  if (t.includes("…") || t.endsWith("...")) {
    document.body.classList.add("loading");
  } else {
    document.body.classList.remove("loading");
  }
};
window.addEventListener("error", (e) => {
  const errorMsg = e.message || "An unexpected error occurred";
  toast(`Error: ${errorMsg}`);
  st(`Error: ${errorMsg}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const errorMsg =
    (e.reason && e.reason.message) || "An unexpected error occurred";
  toast(`Error: ${errorMsg}`);
  st(`Error: ${errorMsg}`);
});

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
    // Handle both simple seeds and extended seed format
    if (typeof seed === "string" && seed.includes("-")) {
      // This is an extended seed, extract just the seed part
      const parsed = parseExtendedSeed(seed);
      currentSeed = parsed.seed;
    } else {
      // Parse the provided seed
      currentSeed = parseInt(seed);
      if (isNaN(currentSeed)) {
        currentSeed = hashString(seed.toString());
      }
    }
  }

  // Ensure seed is a valid 32-bit integer and not zero
  currentSeed = Math.abs(currentSeed) || 1;
  rngState = currentSeed;

  // Save extended seed to localStorage for persistence
  try {
    const extendedSeed = createExtendedSeed();
    localStorage.setItem("bdsp_extended_seed", extendedSeed);
  } catch (e) {}

  // Update the UI to show current seed
  updateSeedDisplay();

  return currentSeed;
}

// Initialize seed from localStorage or generate new one
function initializeSeed() {
  try {
    // First try to load extended seed
    const savedExtendedSeed = localStorage.getItem("bdsp_extended_seed");
    if (savedExtendedSeed) {
      const parsed = parseExtendedSeed(savedExtendedSeed);
      if (parsed.seed > 0) {
        currentSeed = parsed.seed;
        rngState = currentSeed;

        // Apply saved settings if they exist
        if (parsed.settings) {
          applySettings(parsed.settings);
        }

        updateSeedDisplay();
        return;
      }
    }

    // Fallback to old seed format
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
    const extendedSeed = createExtendedSeed();
    seedElement.textContent = extendedSeed || "-";

    // Add click handler to copy seed to clipboard
    seedElement.onclick = () => {
      if (extendedSeed) {
        navigator.clipboard
          .writeText(extendedSeed)
          .then(() => {
            toast("Extended seed copied to clipboard!");
          })
          .catch(() => {
            // Fallback for older browsers
            const textArea = document.createElement("textarea");
            textArea.value = extendedSeed;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            toast("Extended seed copied to clipboard!");
          });
      }
    };
  }
}

// Create extended seed containing all current settings
function createExtendedSeed() {
  if (!currentSeed) return null;

  const smoothPx = +$("#smoothPx").value;
  const smoothAmt = +$("#smoothAmt").value;
  const contrast = Math.round(contrastFactor * 100);
  const spatialWeightPercent = Math.round(spatialWeight * 100);
  const colorTolerancePercent = Math.round(colorTolerance * 100);

  return `${currentSeed}-${kFamilies}-${PROTECT_NEAR_BLACK}-${smoothPx}-${smoothAmt}-${contrast}-${colorConsensusCount}-${spatialWeightPercent}-${colorTolerancePercent}`;
}

// Parse extended seed and apply all settings
function parseExtendedSeed(seedStr) {
  if (!seedStr || typeof seedStr !== "string") return null;

  const parts = seedStr.split("-");

  // If it's just a number (old format), use it as seed with current settings
  if (parts.length === 1) {
    return {
      seed: parseInt(parts[0]) || hashString(seedStr),
      settings: null, // No settings to apply
    };
  }

  // Extended format: seed-kFamilies-PROTECT_NEAR_BLACK-smoothPx-smoothAmt-contrast-colorConsensusCount-spatialWeight-colorTolerance
  if (parts.length === 9) {
    const [
      seedPart,
      kFam,
      protectOutline,
      smoothPx,
      smoothAmt,
      contrast,
      consensus,
      spatialWeightPart,
      colorTolerancePart,
    ] = parts;

    const seed = parseInt(seedPart) || hashString(seedPart);
    const settings = {
      kFamilies: Math.max(5, Math.min(48, parseInt(kFam) || 32)),
      PROTECT_NEAR_BLACK: Math.max(
        0,
        Math.min(50, parseInt(protectOutline) || 8)
      ),
      smoothPx: Math.max(0, Math.min(5, parseInt(smoothPx) || 1)),
      smoothAmt: Math.max(0, Math.min(100, parseInt(smoothAmt) || 45)),
      contrast: Math.max(50, Math.min(170, parseInt(contrast) || 110)),
      colorConsensusCount: Math.max(1, Math.min(10, parseInt(consensus) || 1)),
      spatialWeight: Math.max(
        0,
        Math.min(100, parseInt(spatialWeightPart) || 0)
      ),
      colorTolerance: Math.max(
        0,
        Math.min(100, parseInt(colorTolerancePart) || 0)
      ),
    };

    return { seed, settings };
  }

  // Legacy format (7 parts): seed-kFamilies-PROTECT_NEAR_BLACK-smoothPx-smoothAmt-contrast-colorConsensusCount
  if (parts.length === 7) {
    const [
      seedPart,
      kFam,
      protectOutline,
      smoothPx,
      smoothAmt,
      contrast,
      consensus,
    ] = parts;

    const seed = parseInt(seedPart) || hashString(seedPart);
    const settings = {
      kFamilies: Math.max(5, Math.min(48, parseInt(kFam) || 32)),
      PROTECT_NEAR_BLACK: Math.max(
        0,
        Math.min(50, parseInt(protectOutline) || 8)
      ),
      smoothPx: Math.max(0, Math.min(5, parseInt(smoothPx) || 1)),
      smoothAmt: Math.max(0, Math.min(100, parseInt(smoothAmt) || 45)),
      contrast: Math.max(50, Math.min(170, parseInt(contrast) || 110)),
      colorConsensusCount: Math.max(1, Math.min(10, parseInt(consensus) || 1)),
      spatialWeight: 0, // Default values for legacy seeds
      colorTolerance: 0,
    };

    return { seed, settings };
  }

  // Invalid format, treat as string seed
  return {
    seed: hashString(seedStr),
    settings: null,
  };
}

// Apply settings to UI and variables
function applySettings(settings) {
  if (!settings) return;

  // Update variables
  kFamilies = settings.kFamilies;
  PROTECT_NEAR_BLACK = settings.PROTECT_NEAR_BLACK;
  contrastFactor = settings.contrast / 100;
  colorConsensusCount = settings.colorConsensusCount;
  spatialWeight = settings.spatialWeight / 100;
  colorTolerance = settings.colorTolerance / 100;

  // Update UI controls
  $("#k").value = kFamilies;
  $("#kVal").textContent = kFamilies;

  $("#ink").value = PROTECT_NEAR_BLACK;
  $("#inkVal").textContent = PROTECT_NEAR_BLACK;

  $("#smoothPx").value = settings.smoothPx;
  $("#smoothPxVal").textContent = settings.smoothPx;

  $("#smoothAmt").value = settings.smoothAmt;
  $("#smoothAmtVal").textContent = settings.smoothAmt + "%";

  $("#contrast").value = settings.contrast;
  $("#contrastVal").textContent = settings.contrast + "%";

  $("#colorConsensus").value = colorConsensusCount;
  $("#colorConsensusVal").textContent = colorConsensusCount;

  $("#spatialWeight").value = settings.spatialWeight;
  $("#spatialWeightVal").textContent = settings.spatialWeight + "%";

  $("#colorTolerance").value = settings.colorTolerance;
  $("#colorToleranceVal").textContent = settings.colorTolerance + "%";

  // Auto-expand experimental section if any experimental settings are non-default
  const hasExperimentalSettings =
    settings.colorConsensusCount > 1 ||
    settings.spatialWeight > 0 ||
    settings.colorTolerance > 0;

  if (hasExperimentalSettings && !experimentalExpanded) {
    $("#experimentalToggle").click(); // This will trigger the toggle and save state
  }

  // Update the extended seed display
  updateSeedDisplay();
}

/* ===== folder ingest ===== */
let pickedFiles = [];
let folders = new Map();
let currentFolder = null;
let currentTextures = [];
let currentSpriteFile = null;
let folderJustChanged = false; // Flag to track folder changes

$("#pickRoot").addEventListener("change", (e) => {
  st("Loading folder structure...");
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
  currentFolder = null;
  currentTextures = [];
  currentSpriteFile = null;

  // Clear loaded shiny sprite data when clearing folders
  loadedShinySprite = null;
  originalSpriteData = null;
  loadedShinyRegions = null;

  st(`Found ${folders.size} folders`);

  // Enable Load Shiny button when folders are available
  const loadShinyInput = $("#loadShiny");
  const loadShinyLabel = $("#loadShinyLabel");
  if (folders.size > 0) {
    loadShinyInput.disabled = false;
    loadShinyLabel.style.opacity = "1";
    loadShinyLabel.title = "Load an existing shiny sprite for editing.";

    // Auto-select the first Pokémon in the list
    const sel = $("#folderSel");
    if (sel.options && sel.options.length > 1) {
      sel.selectedIndex = 1; // skip the "(choose)" placeholder
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else {
    loadShinyInput.disabled = true;
    loadShinyLabel.style.opacity = "0.5";
    loadShinyLabel.title = "Please select a root folder first.";
  }
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
  const sortedForms = [...forms.keys()].sort();
  for (const form of sortedForms) {
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
  // If no sprite is loaded but textures are selected, auto-load the sprite
  // If folder just changed, always do a full reload
  try {
    if (currentFolder && currentTextures.length > 0) {
      if (currentSpriteFile && !folderJustChanged) {
        // Sprite already loaded and folder didn't change, just update textures
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
          st("Textures loaded successfully");
        })();
      } else {
        // No sprite loaded OR folder just changed, do full reload
        folderJustChanged = false; // Reset the flag
        autoLoadSelected();
      }
    }
  } catch (e) {
    console.warn("updateSelectedTextures auto-apply failed", e);
  }
}

function renderSpriteList() {
  // No longer needed since we auto-select the first sprite
  if (!currentFolder) return;
  const pack = folders.get(currentFolder);
  // Auto-select the first sprite if available
  if (pack?.sprites && pack.sprites.length > 0) {
    currentSpriteFile = pack.sprites[0];
  }
}

/* ===== auto load when textures are selected ===== */
async function autoLoadSelected() {
  if (!currentFolder) {
    toast("Pick a folder");
    return;
  }
  const pack = folders.get(currentFolder);
  if (!(pack && pack.sprites && pack.sprites[0])) {
    toast("No sprite found in icon/ folder");
    return;
  }

  // Show loading indicators
  showAllLoadingIndicators("Loading Pokémon...");

  currentSpriteFile = pack.sprites[0];
  if (currentTextures.length === 0) {
    hideAllLoadingIndicators();
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
      computeFamiliesAndRegions(false); // Don't show loading indicator during initial load
      applyShiny();
      hideAllLoadingIndicators(); // Hide loading indicators when done
    });
  };
  sprite.src = sprC.toDataURL();
  if (typeof fillSourceDropdown === "function") fillSourceDropdown();
  if (typeof pickDefaultSourceForCurrentFolder === "function")
    pickDefaultSourceForCurrentFolder();

  // Load home texture preview
  loadHomeTexturePreview();
}

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
    const newOption = folderSel.options[newIndex];
    folderSel.selectedIndex = newIndex;
    folderSel.dispatchEvent(new Event("change", { bubbles: true }));

    // Get Pokémon name from the option text
    const optionText = newOption.textContent;
    const pokemonName = optionText.includes(".")
      ? optionText.split(". ")[1].split(" (")[0]
      : optionText;
    st(`Switched to ${pokemonName}`);
  } else {
    const action = direction > 0 ? "next" : "previous";
    st(`No ${action} Pokémon available`);
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

// Spatial awareness functions for position-based color matching
function calculateRegionCenter(regionId) {
  if (!regionIds || regionId < 0 || regionId >= regions.length) return null;

  let sumX = 0,
    sumY = 0,
    count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (regionIds[p] === regionId) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }

  if (count === 0) return null;
  return {
    x: sumX / count / width, // Normalized 0-1
    y: sumY / count / height, // Normalized 0-1
  };
}

function calculateSpatialDistance(x1, y1, x2, y2) {
  // Euclidean distance in normalized space (0-1)
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// Fallback strategies for distant colors
function applyShinyHeuristics(centerLab) {
  const [L, a, b] = centerLab;

  // Common shiny transformations based on heuristics
  const hue = labToHue(centerLab);
  const chroma = labToChroma(centerLab);

  // Strategy 1: Shift hue by common amounts (gold, pink, blue shifts)
  const hueShifts = [60, 120, 180, 240, 300]; // Common shiny hue shifts
  const bestShift = hueShifts[Math.floor(seededRandom() * hueShifts.length)];
  const newHue = (hue + bestShift) % 360;

  // Convert back to LAB
  const newA = chroma * Math.cos((newHue * Math.PI) / 180);
  const newB = chroma * Math.sin((newHue * Math.PI) / 180);

  // Strategy 2: Adjust lightness (darker or lighter variants)
  const lightnessShift = (seededRandom() - 0.5) * 40; // ±20 lightness units
  const newL = Math.max(0, Math.min(100, L + lightnessShift));

  return [newL, newA, newB];
}

const hex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
const unhex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/* ===== loading indicators ===== */
function showLoadingIndicator(type, message = "Loading...") {
  const indicator = document.getElementById(`loading${type}`);
  if (indicator) {
    const textSpan = indicator.querySelector("span");
    if (textSpan) textSpan.textContent = message;
    indicator.classList.add("show");
  }
}

function hideLoadingIndicator(type) {
  const indicator = document.getElementById(`loading${type}`);
  if (indicator) {
    indicator.classList.remove("show");
  }
}

function showAllLoadingIndicators(message = "Loading...") {
  showLoadingIndicator("Original", message);
  showLoadingIndicator("Shiny", message);
}

function hideAllLoadingIndicators() {
  hideLoadingIndicator("Original");
  hideLoadingIndicator("Shiny");
}

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
let regionDark = {},
  pickMode = null,
  pickedColorForApply = null; // New state for pick & apply mode

// Track loaded shiny sprite state
let loadedShinySprite = null;
let originalSpriteData = null; // Store original sprite image data for "keep original"
let loadedShinyRegions = null; // Store original family colors for revert
let currentFolderSelection = null; // Track current folder selection
let contrastFactor = 1.1; // 110%
let colorConsensusCount = 1; // Number of candidates to consider for consensus
let spatialWeight = 0; // 0-1, weight for spatial similarity in color matching
let colorTolerance = 0; // 0-1, tolerance for adaptive color thresholds
let zoomMode = false; // Zoom feature state
let showRegionOutline = false; // Show selected family outline
let showAllFamilies = false; // Show all families outline

/* ===== sliders/toggles ===== */
$("#k").oninput = (e) => {
  kFamilies = +e.target.value;
  $("#kVal").textContent = kFamilies;
  updateSeedDisplay();
};
(() => {
  const el = $("#spw");
  if (el) {
    el.oninput = (e) => {
      spatialW = +e.target.value / 100;
      const v = $("#spwVal");
      if (v) v.textContent = spatialW.toFixed(2);
      updateSeedDisplay();
    };
  }
})();
$("#ink").oninput = (e) => {
  PROTECT_NEAR_BLACK = +e.target.value;
  $("#inkVal").textContent = PROTECT_NEAR_BLACK;
  updateSeedDisplay();
  if (sprite) {
    drawSprite();
    applyShiny();
  }
};
$("#smoothPx").oninput = (e) => {
  $("#smoothPxVal").textContent = e.target.value;
  updateSeedDisplay();
  sprite && applyShiny();
};
$("#smoothAmt").oninput = (e) => {
  $("#smoothAmtVal").textContent = e.target.value + "%";
  updateSeedDisplay();
  sprite && applyShiny();
};
$("#contrast").oninput = (e) => {
  contrastFactor = +e.target.value / 100;
  $("#contrastVal").textContent = Math.round(contrastFactor * 100) + "%";
  updateSeedDisplay();
  sprite && applyShiny();
};
$("#colorConsensus").oninput = (e) => {
  colorConsensusCount = +e.target.value;
  $("#colorConsensusVal").textContent = colorConsensusCount;
  updateSeedDisplay();
  // Trigger recomputation if we have a sprite loaded
  if (sprite && pixLabs) {
    computeFamiliesAndRegions();
  }
};
$("#spatialWeight").oninput = (e) => {
  spatialWeight = +e.target.value / 100;
  $("#spatialWeightVal").textContent = Math.round(spatialWeight * 100) + "%";
  updateSeedDisplay();
  // Trigger recomputation if we have a sprite loaded
  if (sprite && pixLabs) {
    computeFamiliesAndRegions();
  }
};
$("#colorTolerance").oninput = (e) => {
  colorTolerance = +e.target.value / 100;
  $("#colorToleranceVal").textContent = Math.round(colorTolerance * 100) + "%";
  updateSeedDisplay();
  // Trigger recomputation if we have a sprite loaded
  if (sprite && pixLabs) {
    computeFamiliesAndRegions();
  }
};
$("#showDebug").onchange = (e) => {
  drawDebug();
  st(e.target.checked ? "Debug overlay enabled" : "Debug overlay disabled");
};
$("#showRegionOutline").onchange = (e) => {
  showRegionOutline = e.target.checked;
  drawDebug();
  st(e.target.checked ? "Family outline enabled" : "Family outline disabled");
};
$("#showAllFamilies").onchange = (e) => {
  showAllFamilies = e.target.checked;
  drawDebug();
  st(
    e.target.checked
      ? "All families outline enabled"
      : "All families outline disabled"
  );
};

// Initialize the state based on checkbox
showRegionOutline = $("#showRegionOutline").checked;
showAllFamilies = $("#showAllFamilies").checked;

// Experimental section toggle functionality
let experimentalExpanded = false;
$("#experimentalToggle").onclick = () => {
  experimentalExpanded = !experimentalExpanded;
  const content = $("#experimentalContent");
  const arrow = $("#experimentalArrow");

  if (experimentalExpanded) {
    content.style.display = "block";
    arrow.textContent = "▼";
  } else {
    content.style.display = "none";
    arrow.textContent = "▶";
  }

  // Save the state to localStorage
  try {
    localStorage.setItem(
      "bdsp_experimental_expanded",
      experimentalExpanded.toString()
    );
  } catch (e) {}
};

// Initialize experimental section state from localStorage
try {
  const savedState = localStorage.getItem("bdsp_experimental_expanded");
  if (savedState === "true") {
    experimentalExpanded = true;
    $("#experimentalContent").style.display = "block";
    $("#experimentalArrow").textContent = "▼";
  }
} catch (e) {}

// Debug toggle functionality
let debugExpanded = false;
$("#debugToggle").onclick = () => {
  debugExpanded = !debugExpanded;
  const content = $("#debugContent");
  const arrow = $("#debugArrow");

  if (debugExpanded) {
    content.style.display = "block";
    arrow.textContent = "▼";
  } else {
    content.style.display = "none";
    arrow.textContent = "▶";
  }

  // Save the state to localStorage
  try {
    localStorage.setItem("bdsp_debug_expanded", debugExpanded.toString());
  } catch (e) {}
};

// Initialize debug section state from localStorage
try {
  const savedState = localStorage.getItem("bdsp_debug_expanded");
  if (savedState === "true") {
    debugExpanded = true;
    $("#debugContent").style.display = "block";
    $("#debugArrow").textContent = "▼";
  }
} catch (e) {}

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

// Initialize the seed when the page loads (after variables are declared)
initializeSeed();

$("#recluster").onclick = () => {
  if (!sprite) return;

  st("Reclustering families...");

  // Check if we're in multi-seed preview mode
  const isMultiSeedMode = $("#multiSeedPreview").checked;

  if (isMultiSeedMode) {
    generateMultiSeedPreview();
  } else {
    // Normal single seed mode
    // Check if there's a seed in the input field
    const seedInput = $("#seedInput");
    const inputSeed = seedInput.value.trim();

    if (inputSeed) {
      // Parse extended seed format
      const parsed = parseExtendedSeed(inputSeed);

      // Set the seed
      setSeed(parsed.seed);

      // Apply settings if they exist
      if (parsed.settings) {
        applySettings(parsed.settings);
      }

      seedInput.value = "";
    } else {
      // Generate new random seed
      setSeed(null);
    }

    computeFamiliesAndRegions();
    applyShiny();
  }
};

// Multi-seed preview functionality
let previewSeeds = [];

function generateMultiSeedPreview() {
  console.log("Generating multi-seed preview...");

  // Generate 4 different random seeds
  previewSeeds = [];
  for (let i = 0; i < 4; i++) {
    previewSeeds.push(Math.floor(Math.random() * 2147483647));
  }

  console.log("Preview seeds:", previewSeeds);

  // Show multi-seed mode
  $("#singleCanvasMode").style.display = "none";
  $("#multiSeedMode").style.display = "block";

  // Generate previews for each seed
  for (let i = 0; i < 4; i++) {
    console.log(`Generating preview ${i + 1} with seed ${previewSeeds[i]}`);
    generatePreviewForSeed(i + 1, previewSeeds[i]);
  }

  console.log("Multi-seed preview generation complete");
}

function generatePreviewForSeed(previewIndex, seed) {
  // Save current state
  const originalSeed = currentSeed;
  const originalRngState = rngState;
  const originalFamCenters = famCenters ? [...famCenters] : [];
  const originalFamShinyLab = famShinyLab ? [...famShinyLab] : [];
  const originalAssignFam = assignFam ? [...assignFam] : null;
  const originalRegions = regions ? regions.map((r) => ({ ...r })) : [];
  const originalRegionIds = regionIds ? [...regionIds] : null;

  try {
    // Set the preview seed
    setSeed(seed);

    // Compute families and regions with this seed
    computeFamiliesAndRegions();

    // Get the preview canvas and set its dimensions
    const previewCanvas = $(`#c1_preview${previewIndex}`);
    const originalCanvas = $("#c1");

    if (!previewCanvas || !originalCanvas) return;

    previewCanvas.width = originalCanvas.width || width;
    previewCanvas.height = originalCanvas.height || height;

    // Apply shiny effect to preview canvas
    applyShinyToCanvas(previewCanvas);

    // Update seed display
    $(`#seed${previewIndex}`).textContent = seed;
  } catch (error) {
    console.error(`Error generating preview ${previewIndex}:`, error);
    // Clear the canvas on error
    const previewCanvas = $(`#c1_preview${previewIndex}`);
    if (previewCanvas) {
      const ctx = previewCanvas.getContext("2d");
      ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    $(`#seed${previewIndex}`).textContent = "Error";
  } finally {
    // Restore original state
    currentSeed = originalSeed;
    rngState = originalRngState;
    if (originalFamCenters.length) famCenters = originalFamCenters;
    if (originalFamShinyLab.length) famShinyLab = originalFamShinyLab;
    if (originalAssignFam) assignFam = originalAssignFam;
    if (originalRegions.length) regions = originalRegions;
    if (originalRegionIds) regionIds = originalRegionIds;
  }
}

function applyShinyToCanvas(targetCanvas) {
  // Apply the shiny effect to a specific canvas (used for multi-seed preview)
  if (!pixLabs || !assignFam || !regions.length || !targetCanvas) {
    return;
  }

  const ctx = targetCanvas.getContext("2d");
  const id = ctx.createImageData(width, height);
  const D = id.data;

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
    if (pixMask[p] === 2) {
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
      if (loadedShinySprite && originalSpriteData) {
        const originalIndex = p * 4;
        D[i] = originalSpriteData.data[originalIndex];
        D[i + 1] = originalSpriteData.data[originalIndex + 1];
        D[i + 2] = originalSpriteData.data[originalIndex + 2];
        D[i + 3] = originalSpriteData.data[originalIndex + 3];
      } else {
        D[i] = r;
        D[i + 1] = g;
        D[i + 2] = b;
        D[i + 3] = a;
      }
      continue;
    }

    const base = R.linked || !R.lab ? famShinyLab[fam] : R.lab;

    // Apply color transformation similar to main applyShiny function
    let Lp =
      base[0] + (pixLabs[p][0] - famCenters[fam][0]) + (regionDark[rid] || 0);
    Lp = 50 + (Lp - 50) * contrastFactor;
    if (Lp < 0) Lp = 0;
    if (Lp > 100) Lp = 100;

    const c = labToRgb(Lp, base[1], base[2]);
    D[i] = c[0];
    D[i + 1] = c[1];
    D[i + 2] = c[2];
    D[i + 3] = a;
  }

  ctx.putImageData(id, 0, 0);

  // Apply smoothing if enabled (simplified for preview)
  const px = +$("#smoothPx").value;
  const blend = +$("#smoothAmt").value / 100;
  if (px > 0 && blend > 0) {
    // For preview canvases, we'll skip the advanced smoothing to keep it simple
    // The user can see the full effect when they select a preview
  }
}

// Handle multi-seed preview mode toggle
$("#multiSeedPreview").onchange = (e) => {
  if (e.target.checked) {
    // Entering multi-seed mode
    if (sprite) {
      generateMultiSeedPreview();
    }
  } else {
    // Exiting multi-seed mode
    $("#singleCanvasMode").style.display = "block";
    $("#multiSeedMode").style.display = "none";

    // Re-render the current sprite
    if (sprite) {
      applyShiny();
    }
  }
};

// Add click handlers for preview canvas selection
function setupPreviewClickHandlers() {
  for (let i = 1; i <= 4; i++) {
    const canvas = $(`#c1_preview${i}`);
    if (canvas) {
      canvas.onclick = () => {
        selectPreviewSeed(i);
      };
    }
  }
}

// Call setup after a small delay to ensure DOM is ready
setTimeout(setupPreviewClickHandlers, 100);

function selectPreviewSeed(previewIndex) {
  const selectedSeed = previewSeeds[previewIndex - 1];

  // Set the selected seed as current
  setSeed(selectedSeed);

  // Exit multi-seed preview mode
  $("#multiSeedPreview").checked = false;
  $("#singleCanvasMode").style.display = "block";
  $("#multiSeedMode").style.display = "none";

  // Apply the selected seed
  computeFamiliesAndRegions();
  applyShiny();

  toast(`Selected seed: ${selectedSeed}`);
}

// Restore all settings to default values
$("#restoreDefaults").onclick = () => {
  st("Restoring default settings...");

  const defaultSettings = {
    kFamilies: 32,
    PROTECT_NEAR_BLACK: 8,
    smoothPx: 1,
    smoothAmt: 45,
    contrast: 110,
    colorConsensusCount: 1,
    spatialWeight: 0,
    colorTolerance: 0,
  };

  applySettings(defaultSettings);

  // If there's a sprite loaded, recluster with new settings
  if (sprite) {
    computeFamiliesAndRegions();
    applyShiny();
  }

  toast("Settings restored to defaults");
  st("Default settings applied");
};

// Allow pressing Enter in the seed input to trigger recluster
$("#seedInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    $("#recluster").click();
  }
});
$("#saveBtn").onclick = () => {
  if (!sprite) return;

  st("Preparing download...");

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

  st(`Saved as ${outName}`);
};

/* ===== Load shiny sprite functionality ===== */
$("#loadShiny").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    st("Loading shiny sprite…");
    showAllLoadingIndicators("Loading shiny sprite...");

    // Store current folder selection
    const folderSel = $("#folderSel");
    currentFolderSelection = folderSel.selectedIndex;

    // Validate filename pattern matches current Pokémon
    const currentFolder = folderSel.value;
    if (!currentFolder) {
      toast("Please select a Pokémon folder first");
      st("Error: No Pokémon selected");
      e.target.value = ""; // Clear file input
      return;
    }

    // Extract Pokémon ID from current folder (pm####_##_##)
    const folderMatch = currentFolder.match(/^pm(\d{4})_(\d{2})_(\d{2})$/);
    if (!folderMatch) {
      toast("Invalid folder format");
      st("Error: Invalid folder format");
      e.target.value = "";
      return;
    }

    // Check if uploaded file matches expected shiny naming pattern
    // Convert pm####_##_##0 to pm####_##_##1 (replace last digit with 1)
    const thirdPart = folderMatch[3]; // e.g., "00"
    const shinyThirdPart = thirdPart.slice(0, -1) + "1"; // e.g., "00" -> "01"
    const expectedShinyName = `pm${folderMatch[1]}_${folderMatch[2]}_${shinyThirdPart}.png`;
    if (file.name !== expectedShinyName) {
      toast(
        `File must be named "${expectedShinyName}" to match selected Pokémon`
      );
      st(`Error: Expected ${expectedShinyName}, got ${file.name}`);
      e.target.value = "";
      return;
    }

    // Load the shiny sprite file as Image
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

    // Store the loaded shiny sprite and get the current normal sprite for "keep original"
    loadedShinySprite = img;

    // Find and load the normal sprite data for "keep original" functionality
    const currentFolderData = folders.get(currentFolder);
    if (currentFolderData && currentFolderData.sprites.length > 0) {
      const normalSpriteFile = currentFolderData.sprites[0]; // The normal sprite file
      try {
        const normalCanvas = await fileToCanvas(normalSpriteFile);
        const normalCtx = normalCanvas.getContext("2d");
        originalSpriteData = normalCtx.getImageData(
          0,
          0,
          normalCanvas.width,
          normalCanvas.height
        );
      } catch (error) {
        console.warn(
          "Could not load normal sprite for 'keep original' functionality:",
          error
        );
        originalSpriteData = null;
      }
    } else {
      originalSpriteData = null;
    }

    // Set as current sprite
    sprite = img;
    currentSpriteFile = file;

    // Use the same logic as drawSprite() to properly initialize the sprite
    drawSprite();

    // Compute families and regions for the loaded sprite
    requestAnimationFrame(() => {
      computeFamiliesAndRegions(false); // Don't show loading indicator during shiny load

      // For loaded shiny sprites, extract actual colors from each region
      // and make them independent to prevent cross-region color changes
      if (loadedShinySprite) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(loadedShinySprite, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        regions.forEach((region, regionIndex) => {
          if (region && !region.deleted) {
            // Extract the actual average color for this region from the loaded sprite
            let totalR = 0,
              totalG = 0,
              totalB = 0,
              count = 0;

            for (let p = 0; p < regionIds.length; p++) {
              if (regionIds[p] === regionIndex) {
                const i = p * 4;
                if (data[i + 3] > 0) {
                  // Only count non-transparent pixels
                  totalR += data[i];
                  totalG += data[i + 1];
                  totalB += data[i + 2];
                  count++;
                }
              }
            }

            if (count > 0) {
              const avgR = Math.round(totalR / count);
              const avgG = Math.round(totalG / count);
              const avgB = Math.round(totalB / count);
              region.lab = rgbToLab(avgR, avgG, avgB);
              region.linked = false; // Make regions independent
            } else {
              region.linked = false; // Still make it independent even if no pixels found
            }
          }
        });
      }

      // Store the original shiny region colors for revert functionality
      loadedShinyRegions = regions.map((r) =>
        r
          ? {
              lab: r.lab ? r.lab.slice() : null,
              linked: r.linked,
              keep: r.keep,
              fam: r.fam,
            }
          : null
      );

      // Since this is already a completed shiny, just copy it to the shiny canvas
      const c1 = $("#c1");
      const x1 = c1.getContext("2d");
      x1.imageSmoothingEnabled = false;
      x1.drawImage(sprite, 0, 0);
    });

    // DON'T clear texture pairs - keep them for reference
    // texPairs = {};
    // mapIndex = [];
    // shinyTextureKeys = [];

    // RESTORE the folder selection instead of resetting it
    setTimeout(() => {
      if (currentFolderSelection !== null) {
        folderSel.selectedIndex = currentFolderSelection;
      }
    }, 100);

    // Update UI elements
    fillTexDropdown();
    if (typeof fillSourceDropdown === "function") fillSourceDropdown();

    hideAllLoadingIndicators(); // Hide loading indicators when done
    toast(
      "Shiny sprite loaded successfully! You can now edit it by selecting regions."
    );
  } catch (error) {
    console.error("Error loading shiny sprite:", error);
    hideAllLoadingIndicators(); // Hide loading indicators on error
    st("Error loading shiny sprite");
    toast("Failed to load shiny sprite");
    e.target.value = ""; // Clear file input on error
  }
});

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

  // Simple positioning: small offset from cursor
  const overlaySize = 100; // Still needed for zoom calculations
  overlay.style.left = mouseX - 350 + "px";
  overlay.style.top = mouseY - 125 + "px";
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
    const push = (code, nLab, sLab, textureX, textureY) => {
      let t = buckets.get(code);
      if (!t) {
        t = { nL: 0, na: 0, nb: 0, L: 0, a: 0, b: 0, c: 0, sumX: 0, sumY: 0 }; // Add spatial tracking
        buckets.set(code, t);
      }
      t.nL += nLab[0];
      t.na += nLab[1];
      t.nb += nLab[2];
      t.L += sLab[0];
      t.a += sLab[1];
      t.b += sLab[2];
      t.sumX += textureX;
      t.sumY += textureY;
      t.c++;
    };
    const pairs = Math.min(P.N.length, P.S.length);
    for (let k = 0; k < pairs; k++) {
      const A = P.N[k].img.data,
        B = P.S[k].img.data,
        len = Math.min(A.length, B.length);
      const textureWidth = P.N[k].img.width;
      const textureHeight = P.N[k].img.height;

      for (let i = 0; i < len; i += 4) {
        if (A[i + 3] < 16 || B[i + 3] < 16) continue;
        const code =
          ((A[i] >> 4) << 8) | ((A[i + 1] >> 4) << 4) | (A[i + 2] >> 4);

        // Calculate normalized position for spatial awareness
        const pixelIndex = i / 4;
        const textureX = (pixelIndex % textureWidth) / textureWidth; // Normalized 0-1
        const textureY = Math.floor(pixelIndex / textureWidth) / textureHeight; // Normalized 0-1

        push(
          code,
          rgbToLab(A[i], A[i + 1], A[i + 2]),
          rgbToLab(B[i], B[i + 1], B[i + 2]),
          textureX,
          textureY
        );
      }
    }
    for (const t of buckets.values())
      mapIndex.push({
        nLab: [t.nL / t.c, t.na / t.c, t.nb / t.c],
        sLab: [t.L / t.c, t.a / t.c, t.b / t.c],
        weight: t.c, // Frequency weight for consensus
        textureKey: key, // Track which texture this came from
        textureX: t.sumX / t.c, // Average position X
        textureY: t.sumY / t.c, // Average position Y
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
  // Check if sprite is loaded before trying to draw it
  if (!sprite || !sprite.naturalWidth) {
    return;
  }

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
function suggest(centerLab, regionCenter = null) {
  if (!mapIndex.length) return centerLab.slice();

  // If no new features are enabled, use original algorithm for efficiency
  if (
    colorConsensusCount === 1 &&
    spatialWeight === 0 &&
    colorTolerance === 0
  ) {
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

  // Enhanced algorithm with spatial awareness and adaptive thresholds
  const candidates = [];

  // Base max distance, increased by color tolerance
  let MAX_DISTANCE = 20 + colorConsensusCount * 5; // 25-70 range
  if (colorTolerance > 0) {
    MAX_DISTANCE += colorTolerance * 50; // Add up to 50 more units for tolerance
  }

  for (let i = 0; i < mapIndex.length; i++) {
    const m = mapIndex[i];
    const colorDistance = dE(centerLab, m.nLab);

    // Calculate combined distance with spatial weighting
    let combinedDistance = colorDistance;

    if (
      spatialWeight > 0 &&
      regionCenter &&
      m.textureX !== undefined &&
      m.textureY !== undefined
    ) {
      const spatialDistance = calculateSpatialDistance(
        regionCenter.x,
        regionCenter.y,
        m.textureX,
        m.textureY
      );
      // Spatial distance is 0-1.4 (diagonal), scale it to be comparable to color distance
      const scaledSpatialDistance = spatialDistance * 100; // Scale to color distance range
      combinedDistance =
        colorDistance * (1 - spatialWeight) +
        scaledSpatialDistance * spatialWeight;
    }

    if (combinedDistance <= MAX_DISTANCE) {
      candidates.push({
        mapping: m,
        distance: combinedDistance,
        colorDistance: colorDistance,
        score: calculateConsensusScore(m, combinedDistance, centerLab),
      });
    }
  }

  if (candidates.length === 0) {
    // Enhanced fallback strategies based on color tolerance
    if (colorTolerance > 0) {
      // Try adaptive fallback strategies
      return applyShinyHeuristics(centerLab);
    } else {
      // Original fallback behavior - find closest match regardless of distance
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
  }

  // Debug logging (uncomment for development)
  // console.log(`Color consensus for [${centerLab.map(x => x.toFixed(1)).join(', ')}]: ${candidates.length} candidates, using top ${Math.min(colorConsensusCount, candidates.length)}`);

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
function computeFamiliesAndRegions(showLoading = true) {
  if (!pixLabs) {
    st("No sprite");
    return;
  }

  // Show loading indicator for reclustering, but only if not already loading
  if (showLoading) {
    showLoadingIndicator("Shiny", "Reclustering...");
  }

  const pts = [],
    idxs = [];
  for (let p = 0; p < pixLabs.length; p++) {
    if (pixMask[p] === 1) {
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
    if (showLoading) hideLoadingIndicator("Shiny");
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
      if (pixMask[p] !== 1) continue;
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
          if (pixMask[np] !== 1) continue;
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
        lab: null,
      });
      famToRegions[fam].push(rid);
      regionDark[rid] = 0;
      rid++;
    }

  // If spatial awareness is enabled, recompute family colors with region centers
  if (spatialWeight > 0) {
    recomputeFamilyColorsWithSpatialAwareness();
  }

  renderPanel();
  st(`Clustering done — ${regions.length} families`);
  if (showLoading) hideLoadingIndicator("Shiny"); // Hide loading indicator when clustering is complete
}

function recomputeFamilyColorsWithSpatialAwareness() {
  // Calculate the representative region for each family (largest region)
  const familyRepresentativeRegions = new Array(famCenters.length).fill(-1);

  for (let fam = 0; fam < famCenters.length; fam++) {
    const familyRegions = famToRegions[fam];
    let largestRegion = -1;
    let largestSize = 0;

    for (const rid of familyRegions) {
      // Count pixels in this region
      let size = 0;
      for (let p = 0; p < regionIds.length; p++) {
        if (regionIds[p] === rid) size++;
      }

      if (size > largestSize) {
        largestSize = size;
        largestRegion = rid;
      }
    }

    if (largestRegion >= 0) {
      familyRepresentativeRegions[fam] = largestRegion;
    }
  }

  // Recompute family colors using spatial information from representative regions
  for (let fam = 0; fam < famCenters.length; fam++) {
    const repRegion = familyRepresentativeRegions[fam];
    if (repRegion >= 0) {
      const regionCenter = calculateRegionCenter(repRegion);
      if (regionCenter) {
        famShinyLab[fam] = suggest(famCenters[fam], regionCenter);
        famAutoLab[fam] = famShinyLab[fam].slice();
      }
    }
  }
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
    // No family selected or invalid selection
    $("#sheetTitle").textContent = "No family selected";
    $("#pickedSwatch").style.background = "#000";
    drawDebug(); // Update debug overlay to hide family outline
  }
}
function openSheet(rid) {
  selectedRegion = rid;
  const R = regions[rid],
    fam = R.fam;
  $("#sheetTitle").textContent = `Family #${fam + 1} (Area #${rid + 1})`;
  $("#sheetLink").checked = R.linked;
  $("#sheetKeep").checked = R.keep;
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
  applyShiny();
  renderPanel();
  st(`Applied custom color to region ${rid + 1}`);
};
$("#sheetRevert").onclick = () => {
  const R = regions[selectedRegion];
  if (!R || R.deleted || R.keep) return;

  // For loaded shiny sprites, revert to original loaded shiny colors
  if (
    loadedShinySprite &&
    loadedShinyRegions &&
    loadedShinyRegions[selectedRegion]
  ) {
    const originalRegion = loadedShinyRegions[selectedRegion];
    if (originalRegion.lab) {
      R.lab = originalRegion.lab.slice(); // Copy the original LAB values
      R.linked = false; // Make sure it's not linked to avoid affecting other regions
    } else {
      R.lab = null;
      R.linked = true;
    }
  } else {
    // Normal revert behavior for texture-based sprites
    if (R.linked) {
      // For normal sprites, we can modify the family color since it's expected behavior
      famShinyLab[R.fam] = famAutoLab[R.fam].slice();
    } else {
      R.lab = null;
      R.linked = true;
    }
  }

  const c = labToHex(R.linked || !R.lab ? famShinyLab[R.fam] : R.lab);
  $("#sheetColor").value = c;
  $("#pickedSwatch").style.background = c;

  // Reset brightness/darkness to 0
  regionDark[selectedRegion] = 0;
  $("#sheetDark").value = 0;
  $("#sheetDarkVal").textContent = "0";

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
    if (R && !R.keep) {
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
      if (R && !R.keep) {
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
    document.getElementById("pixelLevelModeLabel").style.display = "none";
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
    document.getElementById("pixelLevelModeLabel").style.display =
      "inline-flex";
    renderPanel(); // Update UI to reflect no family selected
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
    if (R && !R.keep) {
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
  let idx = -1;

  // Priority order: sprites (icon folder) first, then home textures, then other textures
  if (pack.sprites && pack.sprites.length) {
    sel.value = "S|0";
  } else if ((idx = findIndex(pack.textures, /_home_col_rare\.png$/i)) >= 0) {
    sel.value = "T|" + idx;
  } else if ((idx = findIndex(pack.textures, /_home_col\.png$/i)) >= 0) {
    sel.value = "T|" + idx;
  } else if (pack.textures && pack.textures.length) {
    sel.value = "T|0";
  } else if (pack.extras && pack.extras.length) {
    sel.value = "E|0";
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

function getAllFamiliesOutlinePixels(width, height) {
  if (!assignFam) return [];

  const outlinePixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const fam = assignFam[p];
      if (fam < 0) continue; // Skip unassigned pixels

      // Check if this pixel is on the edge of its family
      let isEdge = false;

      // Check left
      if (x === 0 || assignFam[p - 1] !== fam) isEdge = true;
      // Check right
      else if (x === width - 1 || assignFam[p + 1] !== fam) isEdge = true;
      // Check up
      else if (y === 0 || assignFam[p - width] !== fam) isEdge = true;
      // Check down
      else if (y === height - 1 || assignFam[p + width] !== fam) isEdge = true;

      if (isEdge) {
        outlinePixels.push({ pixel: p, family: fam });
      }
    }
  }
  return outlinePixels;
}

function drawDebug() {
  const showProtected = $("#showDebug").checked;
  const showOutline = showRegionOutline;
  const showAllOutlines = showAllFamilies;
  const c0 = $("#c0"),
    c1 = $("#c1"),
    d0 = $("#dbg0"),
    d1 = $("#dbg1");

  // Show overlay if any debug mode is enabled
  const shouldShow =
    (showProtected && pixMask) ||
    (showOutline && regionIds && selectedRegion >= 0) ||
    (showAllOutlines && assignFam);
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
      const R = 220,
        G = 60,
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

  // Draw all families outline
  if (showAllOutlines && assignFam) {
    const allOutlinePixels = getAllFamiliesOutlinePixels(w, h);
    // Generate distinct colors for each family
    const familyColors = [];
    const maxFamilies = Math.max(...assignFam.filter((f) => f >= 0)) + 1;

    for (let f = 0; f < maxFamilies; f++) {
      const hue = ((f * 360) / maxFamilies) % 360;
      const saturation = 100;
      const lightness = 50;

      // Convert HSL to RGB for better color distribution
      const hueNorm = hue / 60;
      const c = ((1 - Math.abs((2 * lightness) / 100 - 1)) * saturation) / 100;
      const x = c * (1 - Math.abs((hueNorm % 2) - 1));
      const m = lightness / 100 - c / 2;

      let r, g, b;
      if (hueNorm < 1) {
        r = c;
        g = x;
        b = 0;
      } else if (hueNorm < 2) {
        r = x;
        g = c;
        b = 0;
      } else if (hueNorm < 3) {
        r = 0;
        g = c;
        b = x;
      } else if (hueNorm < 4) {
        r = 0;
        g = x;
        b = c;
      } else if (hueNorm < 5) {
        r = x;
        g = 0;
        b = c;
      } else {
        r = c;
        g = 0;
        b = x;
      }

      familyColors[f] = {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255),
      };
    }

    for (const outline of allOutlinePixels) {
      const i = outline.pixel * 4;
      const color = familyColors[outline.family] || { r: 255, g: 255, b: 255 };

      A0[i] = color.r;
      A0[i + 1] = color.g;
      A0[i + 2] = color.b;
      A0[i + 3] = 180; // Slightly less opaque than selected outline
      A1[i] = color.r;
      A1[i + 1] = color.g;
      A1[i + 2] = color.b;
      A1[i + 3] = 180;
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
    if (pixMask[p] === 2) {
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
      // For loaded shiny sprites, use original normal sprite colors when "keep original" is enabled
      if (loadedShinySprite && originalSpriteData) {
        const originalIndex = p * 4;
        D[i] = originalSpriteData.data[originalIndex];
        D[i + 1] = originalSpriteData.data[originalIndex + 1];
        D[i + 2] = originalSpriteData.data[originalIndex + 2];
        D[i + 3] = originalSpriteData.data[originalIndex + 3];
      } else {
        // Normal behavior for texture-based sprites
        D[i] = r;
        D[i + 1] = g;
        D[i + 2] = b;
        D[i + 3] = a;
      }
      continue;
    }

    const base = R.linked || !R.lab ? famShinyLab[fam] : R.lab;

    // For loaded shiny sprites, if the region color hasn't been modified from original
    // AND all transformation settings are at default values, use exact original pixel
    if (loadedShinySprite && loadedShinyRegions && loadedShinyRegions[rid]) {
      const originalRegion = loadedShinyRegions[rid];
      const contrastAtDefault = Math.abs(contrastFactor - 1.1) < 0.01; // Default contrast is 110%
      const regionDarkAtDefault = !regionDark[rid] || regionDark[rid] === 0;
      const smoothingAtDefault =
        +$("#smoothPx").value === 1 && +$("#smoothAmt").value === 45;

      if (
        originalRegion.lab &&
        R.lab &&
        Math.abs(R.lab[0] - originalRegion.lab[0]) < 0.01 &&
        Math.abs(R.lab[1] - originalRegion.lab[1]) < 0.01 &&
        Math.abs(R.lab[2] - originalRegion.lab[2]) < 0.01 &&
        contrastAtDefault &&
        regionDarkAtDefault &&
        smoothingAtDefault
      ) {
        // Color and settings unchanged from original, use exact original pixel
        D[i] = r;
        D[i + 1] = g;
        D[i + 2] = b;
        D[i + 3] = a;
        continue;
      }
    }

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
  tutorial: "h",
  load: "l",
  save: "s",
  recluster: "r",
  debug: "d",
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
    if (k === HK.tutorial) {
      e.preventDefault();
      openTutorialModal();
      return;
    }
    if (k === HK.load) {
      e.preventDefault();
      autoLoadSelected();
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
  keyCaptureInput($("#hkTutorial"), "tutorial");
  keyCaptureInput($("#hkLoad"), "load");
  keyCaptureInput($("#hkSave"), "save");
  keyCaptureInput($("#hkRecluster"), "recluster");
  keyCaptureInput($("#hkDebug"), "debug");
  keyCaptureInput($("#hkOutline"), "outline");
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

// Tutorial Modal Functions
async function openTutorialModal() {
  try {
    // Load tutorial content if not already loaded
    const tutorialContent = $("#tutorialContent");
    if (
      !tutorialContent.innerHTML.trim() ||
      tutorialContent.innerHTML.includes("will be loaded here")
    ) {
      const response = await fetch("./tutorial.html");
      if (!response.ok) throw new Error("Failed to load tutorial");
      const html = await response.text();
      tutorialContent.innerHTML = html;

      // Re-bind the close button after loading content
      $("#closeTutorialModal").onclick = () =>
        ($("#tutorialModal").style.display = "none");
    }
    $("#tutorialModal").style.display = "flex";
  } catch (error) {
    console.error("Error loading tutorial:", error);
    // Fallback: show a simple message
    $("#tutorialContent").innerHTML = `
      <div class="row">
        <h3>Tutorial - How to Use the Shiny Recolor Tool</h3>
        <button id="closeTutorialModal" class="btn gray">Close</button>
      </div>
      <p>Tutorial content could not be loaded. Please check that tutorial.html is available.</p>
    `;
    $("#closeTutorialModal").onclick = () =>
      ($("#tutorialModal").style.display = "none");
    $("#tutorialModal").style.display = "flex";
  }
}

$("#tutorialBtn").onclick = () => openTutorialModal();

// Close tutorial modal when clicking outside the content
$("#tutorialModal").onclick = (e) => {
  if (e.target === $("#tutorialModal")) {
    $("#tutorialModal").style.display = "none";
  }
};

// About Modal Functions
function openAboutModal() {
  $("#aboutModal").style.display = "flex";
}

$("#aboutBtn").onclick = () => openAboutModal();
$("#closeAboutModal").onclick = () => {
  $("#aboutModal").style.display = "none";
};

// Close about modal when clicking outside the content
$("#aboutModal").onclick = (e) => {
  if (e.target === $("#aboutModal")) {
    $("#aboutModal").style.display = "none";
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

// === Auto-select sprite when folder is selected ===
function autoSelectSpriteForCurrentFolder() {
  if (!currentFolder) return;
  const pack = folders.get(currentFolder);
  if (pack?.sprites && pack.sprites.length > 0) {
    currentSpriteFile = pack.sprites[0];
  }
}

(function attachFolderSelHandler() {
  const sel = document.getElementById("folderSel");
  if (!sel) return;
  sel.addEventListener("change", () => {
    const key = sel.value;
    if (!key) {
      currentFolder = null;

      // Clear loaded shiny sprite data when clearing folder selection
      loadedShinySprite = null;
      originalSpriteData = null;
      loadedShinyRegions = null;

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
    folderJustChanged = true; // Mark that folder just changed

    // Clear loaded shiny sprite data when changing folders to prevent
    // "keep original" from using data from previous Pokémon
    loadedShinySprite = null;
    originalSpriteData = null;
    loadedShinyRegions = null;

    // refresh texture checkboxes & mapping
    if (typeof renderTextureList === "function") renderTextureList();
    if (typeof updateSelectedTextures === "function") updateSelectedTextures();
    // fill source dropdown (textures + sprites)
    if (typeof fillSourceDropdown === "function") fillSourceDropdown();
    if (typeof pickDefaultSourceForCurrentFolder === "function")
      pickDefaultSourceForCurrentFolder();
    // Auto-select sprite for the current folder
    autoSelectSpriteForCurrentFolder();
    // Update home texture preview
    loadHomeTexturePreview();
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

// Auto-load selected items when textures change
// This is handled in the updateCurrentTextures function above
