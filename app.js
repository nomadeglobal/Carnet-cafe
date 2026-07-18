/* ============================================================
   Carnet Café — logique de l'application
   Stockage 100 % local via IndexedDB (photos incluses).
   ============================================================ */
"use strict";

/* ---------- IndexedDB ---------- */
const DB_NAME = "carnet-cafe";
const STORE = "coffees";
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
  });
}

function dbAll() {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/* ---------- État ---------- */
let coffees = [];
let currentPhotoBlob = null;     // photo en cours d'édition dans le formulaire
let editingHadPhoto = false;
let activeFilters = { pays: new Set(), traitement: new Set(), torrefacteur: new Set(), type: new Set() };
const photoURLs = new Map();     // id -> objectURL (cache d'affichage)

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function photoURL(c) {
  if (!c.photo) return null;
  if (!photoURLs.has(c.id)) photoURLs.set(c.id, URL.createObjectURL(c.photo));
  return photoURLs.get(c.id);
}

function beans(note) {
  let h = "";
  for (let i = 1; i <= 5; i++) {
    h += `<span class="${i <= note ? "bean-on" : "bean-off"}">☕</span>`;
  }
  return h;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- Navigation entre vues ---------- */
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${name === "form" ? "form" : name}`).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name));
  window.scrollTo({ top: 0 });
  if (name === "dashboard") renderDashboard();
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.view === "form") resetForm();
    showView(btn.dataset.view);
  });
});
$("#btn-empty-add").addEventListener("click", () => { resetForm(); showView("form"); });

/* ============================================================
   CATALOGUE : recherche, tri, filtres, cartes
   ============================================================ */
function parseAltitude(v) {
  const m = String(v || "").replace(/[\s.,]/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

function getVisibleCoffees() {
  const q = $("#search-input").value.trim().toLowerCase();
  let list = coffees.filter((c) => {
    if (q) {
      const hay = [c.nom, c.pays, c.type, c.provenance, c.traitement,
        c.torrefacteur, c.altitude, c.remarques, c.infosWeb, ...(c.aromes || [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const key of ["pays", "traitement", "torrefacteur", "type"]) {
      if (activeFilters[key].size && !activeFilters[key].has(c[key] || "")) return false;
    }
    return true;
  });

  const [field, dir] = $("#sort-select").value.split("-");
  const mult = dir === "asc" ? 1 : -1;
  list.sort((a, b) => {
    let va = a[field], vb = b[field];
    if (field === "note" || field === "createdAt") {
      return ((va || 0) - (vb || 0)) * mult;
    }
    if (field === "altitude") {
      // « 1900–2100 m » → 1900 ; les cafés sans altitude vont à la fin
      const na = parseAltitude(va), nb = parseAltitude(vb);
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return (na - nb) * mult;
    }
    // tri texte : les valeurs vides vont à la fin
    va = (va || "").toLowerCase(); vb = (vb || "").toLowerCase();
    if (!va && !vb) return 0;
    if (!va) return 1;
    if (!vb) return -1;
    return va.localeCompare(vb, "fr") * mult;
  });
  return list;
}

function renderCatalogue() {
  const list = getVisibleCoffees();
  const grid = $("#card-grid");
  const hasAny = coffees.length > 0;

  $("#empty-state").hidden = hasAny;
  $("#result-count").textContent = hasAny
    ? `${list.length} café${list.length > 1 ? "s" : ""} ${list.length !== coffees.length ? `(sur ${coffees.length})` : "dans votre carnet"}`
    : "";

  grid.innerHTML = list.map((c) => {
    const url = photoURL(c);
    const aromes = (c.aromes || []).slice(0, 3);
    return `
    <article class="coffee-card" data-id="${c.id}">
      <div class="card-photo">
        ${url ? `<img src="${url}" alt="Paquet de ${esc(c.nom)}" loading="lazy">` : `<span class="no-photo">☕</span>`}
      </div>
      <div class="card-body">
        ${c.traitement ? `<span class="process-pill">${esc(c.traitement)}</span>` : ""}
        <h3 class="card-name">${esc(c.nom)}</h3>
        <div class="card-meta">
          ${c.pays ? `<span>📍 ${esc(c.pays)}</span>` : ""}
          ${c.torrefacteur ? `<span class="dot">${esc(c.torrefacteur)}</span>` : ""}
        </div>
        ${aromes.length ? `<div class="card-tags">${aromes.map((a) => `<span class="mini-tag">${esc(a)}</span>`).join("")}</div>` : ""}
        ${c.note ? `<div class="card-rating">${beans(c.note)}</div>` : ""}
      </div>
    </article>`;
  }).join("");

  grid.querySelectorAll(".coffee-card").forEach((card) =>
    card.addEventListener("click", () => openDetail(Number(card.dataset.id))));
}

/* Filtres dynamiques (générés depuis les données) */
function renderFilterChips() {
  const groups = { pays: "#filter-pays", traitement: "#filter-traitement", torrefacteur: "#filter-torrefacteur", type: "#filter-type" };
  for (const [key, sel] of Object.entries(groups)) {
    const values = [...new Set(coffees.map((c) => c[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
    const box = $(sel);
    box.innerHTML = values.length
      ? values.map((v) => `<button class="chip ${activeFilters[key].has(v) ? "on" : ""}" data-key="${key}" data-val="${esc(v)}">${esc(v)}</button>`).join("")
      : `<span class="hint">Aucune valeur pour l'instant.</span>`;
  }
  document.querySelectorAll(".chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const { key, val } = chip.dataset;
      activeFilters[key].has(val) ? activeFilters[key].delete(val) : activeFilters[key].add(val);
      chip.classList.toggle("on");
      updateFilterBadge();
      renderCatalogue();
    });
  });
}

function updateFilterBadge() {
  const n = Object.values(activeFilters).reduce((s, set) => s + set.size, 0);
  const badge = $("#filter-count");
  badge.hidden = n === 0;
  badge.textContent = n;
}

$("#btn-filters").addEventListener("click", () => {
  const panel = $("#filters-panel");
  const open = panel.hidden;
  panel.hidden = !open;
  $("#btn-filters").setAttribute("aria-expanded", String(open));
});

$("#btn-clear-filters").addEventListener("click", () => {
  Object.values(activeFilters).forEach((s) => s.clear());
  renderFilterChips();
  updateFilterBadge();
  renderCatalogue();
});

$("#search-input").addEventListener("input", renderCatalogue);
$("#sort-select").addEventListener("change", renderCatalogue);

/* ============================================================
   FORMULAIRE : ajout / édition
   ============================================================ */
const AROME_TAGS = [];

function resetForm() {
  $("#coffee-form").reset();
  $("#f-id").value = "";
  $("#f-note").value = "0";
  $("#form-title").textContent = "Nouveau café";
  currentPhotoBlob = null;
  editingHadPhoto = false;
  AROME_TAGS.length = 0;
  renderAromeTags();
  renderRating(0);
  setPhotoPreview(null);
  refreshTorrefacteurSuggestions();
}

function fillForm(c) {
  $("#f-id").value = c.id;
  $("#f-nom").value = c.nom || "";
  $("#f-pays").value = c.pays || "";
  $("#f-type").value = c.type || "";
  $("#f-provenance").value = c.provenance || "";
  $("#f-traitement").value = c.traitement || "";
  $("#f-torrefacteur").value = c.torrefacteur || "";
  $("#f-altitude").value = c.altitude || "";
  $("#f-dateTorrefaction").value = c.dateTorrefaction || "";
  $("#f-dateAchat").value = c.dateAchat || "";
  $("#f-remarques").value = c.remarques || "";
  $("#f-siteUrl").value = c.siteUrl || "";
  $("#f-infosWeb").value = c.infosWeb || "";
  $("#f-note").value = c.note || 0;
  $("#form-title").textContent = "Modifier le café";
  AROME_TAGS.length = 0;
  AROME_TAGS.push(...(c.aromes || []));
  renderAromeTags();
  renderRating(c.note || 0);
  currentPhotoBlob = c.photo || null;
  editingHadPhoto = !!c.photo;
  setPhotoPreview(c.photo ? URL.createObjectURL(c.photo) : null);
  refreshTorrefacteurSuggestions();
}

function refreshTorrefacteurSuggestions() {
  const values = [...new Set(coffees.map((c) => c.torrefacteur).filter(Boolean))].sort();
  $("#dl-torrefacteur").innerHTML = values.map((v) => `<option>${esc(v)}</option>`).join("");
}

/* Photo : capture + redimensionnement (max 1280 px, JPEG) */
function setPhotoPreview(url) {
  const box = $("#photo-preview");
  box.innerHTML = url
    ? `<img src="${url}" alt="Aperçu de la photo">`
    : `<span class="photo-placeholder">📷<br>Photo du paquet</span>`;
  $("#btn-remove-photo").hidden = !url;
}

async function handlePhotoFile(file) {
  if (!file || !file.type.startsWith("image/")) return;
  try {
    const bmp = await createImageBitmap(file);
    const MAX = 1280;
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    currentPhotoBlob = blob || file;
  } catch {
    currentPhotoBlob = file; // si le redimensionnement échoue, on garde l'original
  }
  setPhotoPreview(URL.createObjectURL(currentPhotoBlob));
}

$("#f-photo-camera").addEventListener("change", (e) => handlePhotoFile(e.target.files[0]));
$("#f-photo-gallery").addEventListener("change", (e) => handlePhotoFile(e.target.files[0]));
$("#btn-remove-photo").addEventListener("click", () => {
  currentPhotoBlob = null;
  editingHadPhoto = false;
  $("#f-photo-camera").value = "";
  $("#f-photo-gallery").value = "";
  setPhotoPreview(null);
});

/* Arômes en tags */
function renderAromeTags() {
  $("#aromes-tags").innerHTML = AROME_TAGS.map((a, i) =>
    `<span class="tag">${esc(a)}<button type="button" data-i="${i}" aria-label="Retirer ${esc(a)}">✕</button></span>`).join("");
  $("#aromes-tags").querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => { AROME_TAGS.splice(Number(b.dataset.i), 1); renderAromeTags(); }));
}

function commitAromeInput() {
  const input = $("#f-aromes-input");
  const val = input.value.replace(/,/g, "").trim();
  if (val && !AROME_TAGS.some((a) => a.toLowerCase() === val.toLowerCase())) {
    AROME_TAGS.push(val);
    renderAromeTags();
  }
  input.value = "";
}

$("#f-aromes-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitAromeInput(); }
  else if (e.key === "Backspace" && !e.target.value && AROME_TAGS.length) {
    AROME_TAGS.pop(); renderAromeTags();
  }
});
$("#f-aromes-input").addEventListener("change", commitAromeInput); // sélection datalist
$("#f-aromes-input").addEventListener("blur", commitAromeInput);

/* Note en grains */
function renderRating(v) {
  $("#f-note").value = v;
  document.querySelectorAll("#rating-input button").forEach((b) =>
    b.classList.toggle("on", Number(b.dataset.v) <= v));
}
document.querySelectorAll("#rating-input button").forEach((b) =>
  b.addEventListener("click", () => {
    const v = Number(b.dataset.v);
    renderRating(v === Number($("#f-note").value) ? 0 : v); // re-cliquer = annuler
  }));

/* Enregistrement */
$("#coffee-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  commitAromeInput();
  const nom = $("#f-nom").value.trim();
  if (!nom) { $("#f-nom").focus(); toast("Donnez un nom à ce café ☕"); return; }

  const id = $("#f-id").value ? Number($("#f-id").value) : null;
  const existing = id ? coffees.find((c) => c.id === id) : null;

  const record = {
    nom,
    pays: $("#f-pays").value.trim(),
    type: $("#f-type").value.trim(),
    provenance: $("#f-provenance").value.trim(),
    traitement: $("#f-traitement").value.trim(),
    torrefacteur: $("#f-torrefacteur").value.trim(),
    altitude: $("#f-altitude").value.trim(),
    dateTorrefaction: $("#f-dateTorrefaction").value,
    aromes: [...AROME_TAGS],
    dateAchat: $("#f-dateAchat").value,
    remarques: $("#f-remarques").value.trim(),
    siteUrl: $("#f-siteUrl").value.trim(),
    infosWeb: $("#f-infosWeb").value.trim(),
    note: Number($("#f-note").value) || 0,
    photo: currentPhotoBlob,
    createdAt: existing ? existing.createdAt : Date.now(),
  };
  if (id) record.id = id;

  const savedId = await dbPut(record);
  if (photoURLs.has(savedId)) { URL.revokeObjectURL(photoURLs.get(savedId)); photoURLs.delete(savedId); }
  await reload();
  showView("catalogue");
  toast(id ? "Café mis à jour ✔" : "Café ajouté à votre carnet ✔");
});

$("#btn-cancel-form").addEventListener("click", () => showView("catalogue"));

/* ============================================================
   IMPORT DEPUIS LE SITE DU TORRÉFACTEUR
   La page est récupérée via des proxys publics (contournement
   CORS), puis analysée : JSON-LD produit, balises meta, et
   libellés « Origine / Variété / Process / Notes… » FR + EN.
   ============================================================ */
/* Noms de pays producteurs en français, anglais, finnois et suédois
   (clés sans accents, en minuscules — voir stripAccents). */
const COUNTRY_MAP = {
  "ethiopie": "Éthiopie", "ethiopia": "Éthiopie", "etiopia": "Éthiopie", "etiopien": "Éthiopie",
  "colombie": "Colombie", "colombia": "Colombie", "kolumbia": "Colombie",
  "bresil": "Brésil", "brazil": "Brésil", "brasil": "Brésil", "brasilia": "Brésil", "brasilien": "Brésil",
  "kenya": "Kenya", "kenia": "Kenya",
  "guatemala": "Guatemala", "costa rica": "Costa Rica", "honduras": "Honduras",
  "panama": "Panama", "perou": "Pérou", "peru": "Pérou",
  "rwanda": "Rwanda", "ruanda": "Rwanda", "burundi": "Burundi",
  "indonesie": "Indonésie", "indonesia": "Indonésie", "indonesien": "Indonésie",
  "inde": "Inde", "india": "Inde", "intia": "Inde", "indien": "Inde",
  "yemen": "Yémen", "jemen": "Yémen", "el salvador": "Salvador", "salvador": "Salvador",
  "nicaragua": "Nicaragua", "mexique": "Mexique", "mexico": "Mexique", "meksiko": "Mexique", "mexiko": "Mexique",
  "bolivie": "Bolivie", "bolivia": "Bolivie",
  "tanzanie": "Tanzanie", "tanzania": "Tanzanie", "tansania": "Tanzanie",
  "ouganda": "Ouganda", "uganda": "Ouganda",
  "equateur": "Équateur", "ecuador": "Équateur",
  "vietnam": "Vietnam", "laos": "Laos", "myanmar": "Myanmar",
  "chine": "Chine", "china": "Chine", "kiina": "Chine", "kina": "Chine",
  "papouasie": "Papouasie-Nouvelle-Guinée", "papua": "Papouasie-Nouvelle-Guinée",
  "jamaique": "Jamaïque", "jamaica": "Jamaïque", "hawai": "Hawaï", "hawaii": "Hawaï",
};
/* Traitements — mots-clés FR / EN / FI / SV, du plus spécifique au plus général. */
const PROCESS_MAP = [
  [/co[- ]?ferment/i, "Co-fermenté"],
  [/macération carbonique|carbonic macerat|hiilihappomaserointi|kolsyremaceration/i, "Macération carbonique"],
  [/anaerob|ana[ée]robi/i, "Anaérobie"],
  [/honey (?:rouge|red)|red honey/i, "Honey rouge"],
  [/honey (?:noir|black)|black honey/i, "Honey noir"],
  [/honey|miel[ée]|hunaja(?!mainen)/i, "Honey"],
  [/wet[- ]?hulled|giling basah/i, "Wet-hulled (Giling Basah)"],
  [/lav[ée]|washed|pesty|tv[äa]ttad/i, "Lavé"],
  [/naturel?|natural|dry process|kuivaprosessoitu|luonnollinen|soltorkad|naturlig/i, "Naturel"],
  [/d[ée]caf|kofeiiniton|koffeinfri/i, "Décaféiné"],
];
const VARIETIES = ["Geisha", "Gesha", "Bourbon", "Typica", "Caturra", "Catuaí", "Catuai",
  "SL28", "SL34", "Pacamara", "Heirloom", "Castillo", "Mundo Novo", "Maragogype",
  "Pink Bourbon", "Sidra", "Wush Wush", "Pacas", "Catimor", "Ruiru 11", "Batian", "Java"];

const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Sources de lecture, essayées tour à tour : accès direct, deux relais
   CORS, puis r.jina.ai (rendu JavaScript). Chaque réponse est analysée
   et NOTÉE — un relais peut renvoyer une page d'erreur « 200 OK » vide,
   la notation évite de s'arrêter sur ce faux contenu. */
const PAGE_SOURCES = [
  (u) => fetch(u),
  (u) => fetch("https://api.allorigins.win/raw?url=" + encodeURIComponent(u)),
  (u) => fetch("https://corsproxy.io/?url=" + encodeURIComponent(u)),
  (u) => fetch("https://r.jina.ai/" + u),
];

function scoreFound(f) {
  if (!f) return -1;
  return ["pays", "type", "provenance", "traitement", "altitude"].filter((k) => f[k]).length
    + (f.aromes && f.aromes.length ? 1 : 0);
}

function mergeFound(base, extra) {
  if (!base) return extra;
  for (const k of Object.keys(extra)) {
    if (k === "aromes") continue;
    if (!base[k] || (k === "infosWeb" && extra[k] && extra[k].length > base[k].length)) base[k] = extra[k];
  }
  const seen = new Set((base.aromes || []).map((a) => a.toLowerCase()));
  base.aromes = [...(base.aromes || []),
    ...(extra.aromes || []).filter((a) => !seen.has(a.toLowerCase()))].slice(0, 8);
  return base;
}

async function analyzeUrl(url, onProgress) {
  const parses = [];
  for (let i = 0; i < PAGE_SOURCES.length; i++) {
    if (onProgress) onProgress(i + 1, PAGE_SOURCES.length);
    try {
      const resp = await PAGE_SOURCES[i](url);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text || text.length < 200) continue;
      const found = parseRoasterPage(text, url);
      found._score = scoreFound(found);
      parses.push(found);
      if (found._score >= 4) break; // fiche suffisamment complète
    } catch { /* source suivante */ }
  }
  if (!parses.length) return null;
  // Fusion : les valeurs des lectures les mieux notées ont priorité
  parses.sort((a, b) => b._score - a._score);
  let merged = null;
  for (const p of parses) merged = mergeFound(merged, p);
  delete merged._score;
  return merged;
}

/* Tous les libellés reconnus — sert à rejeter une « valeur » qui serait
   en réalité le libellé suivant (mises en page en tableau). */
const ANY_LABEL_RE = /^(?:origine?|origin|pays|country|alkuper[aä]|alkuper[aä]maa|maa|ursprung|ursprungsland|land|r[ée]gion|region|provenance|zone|alue|seutu|omr[aå]de|ferme|farm|finca|fazenda|hacienda|producteur|producer|station|coop[ée]rative|cooperative|tila|tuottaja|viljelij[aä]|g[aå]rd|producent|odlare|kooperativ|vari[ée]t[ée]s?|variet(?:y|al|ies)|cultivar|lajike|kahvilajike|sort|varietet|process(?:ing)?|proc[ée]d[ée]|traitement|m[ée]thode|method|fermentation|(?:kahvin\s+)?prosessointi|k[aä]sittely(?:tapa)?|prosessi|menetelm[aä]|bearbetning|beredning|metod|altitude|elevation|korkeus|kasvukorkeus|h[oö]jd|paahtoaste|rostningsgrad|torr[ée]facteur|roaster|roastery|paahtimo|rosteri|notes?|ar[ôo]mes?|profil|maku|aromit|smak|toner)\s*[:：]?\s*$/i;

function labelValue(text, labelRe) {
  const val = "([^\\n\\r|•]{2,90})";
  const patterns = [
    // « Libellé : valeur » sur la même ligne (séparateur : ： ou tiret entouré d'espaces)
    new RegExp("(?:^|[\\n\\r•·*|>-])\\s*(?:" + labelRe + ")\\s*(?:[:：]|\\s[–—-]\\s)\\s*" + val, "i"),
    // Libellé seul sur sa ligne, valeur sur la ligne suivante (tableaux de caractéristiques)
    new RegExp("(?:^|[\\n\\r])\\s*(?:" + labelRe + ")\\s*[:：]?\\s*[\\n\\r]+\\s*" + val, "i"),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const v = m[1].trim().replace(/\s{2,}/g, " ").replace(/[.…;]+$/, "");
    if (v && !ANY_LABEL_RE.test(v)) return v;
  }
  return "";
}

function parseRoasterPage(raw, url) {
  const found = {};
  let doc = null, text = raw, title = "", siteName = "", description = "";

  if (/<(html|body|head|div|meta)[\s>]/i.test(raw)) {
    // Conserve les retours à la ligne des blocs HTML pour l'analyse par libellés
    const withBreaks = raw.replace(/<(br|\/p|\/li|\/h[1-6]|\/tr|\/td|\/div)[^>]*>/gi, "$&\n");
    doc = new DOMParser().parseFromString(withBreaks, "text/html");
    doc.querySelectorAll("script:not([type='application/ld+json']),style,noscript").forEach((n) => n.remove());

    // 1) Données structurées JSON-LD (souvent les plus fiables)
    for (const s of doc.querySelectorAll("script[type='application/ld+json']")) {
      try {
        const data = JSON.parse(s.textContent);
        const items = [].concat(data["@graph"] || data);
        for (const item of items) {
          if (item && /Product/i.test(item["@type"] || "")) {
            found.nom = found.nom || item.name;
            description = description || item.description || "";
            siteName = siteName || (item.brand && (item.brand.name || item.brand)) || "";
          }
        }
      } catch { /* JSON-LD invalide, on ignore */ }
    }

    // 2) Balises meta / titre
    const meta = (n) => doc.querySelector(`meta[property='${n}'],meta[name='${n}']`)?.content || "";
    title = meta("og:title") || (doc.querySelector("title")?.textContent || "");
    siteName = siteName || meta("og:site_name");
    description = description || meta("og:description") || meta("description");
    found.nom = found.nom || (doc.querySelector("h1")?.textContent || "").trim() || title;
    text = (doc.body ? doc.body.textContent : "") + "\n" + description;
  } else {
    // Texte / markdown (proxy r.jina.ai)
    title = (raw.match(/^Title:\s*(.+)$/m) || [])[1] || "";
    found.nom = title;
    text = raw;
  }

  // Nettoyage du nom : on retire le suffixe « | Nom du site »
  if (found.nom) found.nom = found.nom.split(/\s*(?:[|–—•]|\s-\s)\s*/)[0].trim().slice(0, 80);

  // 3) Libellés explicites — français, anglais, finnois, suédois
  const region = labelValue(text, "r[ée]gion|region|provenance|zone|alue|seutu|omr[aå]de");
  const ferme = labelValue(text, "ferme|farm|finca|fazenda|hacienda|producteur|producer|washing station|station|coop[ée]rative|cooperative|tila|tuottaja|viljelij[aä]|g[aå]rd|producent|odlare|kooperativ");
  const altitude = labelValue(text, "altitude|elevation|korkeus|kasvukorkeus|odlingsh[oö]jd|h[oö]jd(?:\\s*[oö]ver havet)?");
  const paysLabel = labelValue(text, "origine|origin|pays|country|alkuper[aä]maa|alkuper[aä]|maa|ursprungsland|ursprung|land");
  const varieteLabel = labelValue(text, "vari[ée]t[ée]s?|variet(?:y|al|ies)|cultivar|lajike|kahvilajike|varietet|sort");
  const processLabel = labelValue(text, "process(?:ing)?(?:\\s*method)?|proc[ée]d[ée]|traitement|m[ée]thode|method|fermentation|(?:kahvin\\s+)?prosessointi|k[aä]sittely(?:tapa)?|prosessi|menetelm[aä]|bearbetning|beredning|metod");
  let notesLabel = labelValue(text, "notes? de d[ée]gustation|notes? aromatiques|tasting notes?|cup notes?|flavou?r notes?|cupping notes?|ar[ôo]mes?|profil aromatique|makuprofiili|aromit|makuja|maku|smaknoter|smakprofil|smak|toner|aromer|notes?|profil");
  // Arômes exprimés en phrase : « notes of chocolate », « toner av choklad », « maistuu suklaalta »
  if (!notesLabel) {
    const m = text.match(/(?:notes? of|toner av|smak av|aromer av|maistuu|makuja kuten)\s+([^\n.!]{3,90})/i);
    if (m) notesLabel = m[1].trim();
  }

  // Pays : libellé d'abord, sinon recherche dans titre + description, sinon page entière
  for (const zone of [paysLabel, title + " " + description, text]) {
    if (found.pays || !zone) continue;
    const norm = stripAccents(zone);
    for (const [key, fr] of Object.entries(COUNTRY_MAP)) {
      if (new RegExp("\\b" + key + "\\b").test(norm)) { found.pays = fr; break; }
    }
  }

  // Traitement
  for (const zone of [processLabel, title + " " + description, text]) {
    if (found.traitement || !zone) continue;
    for (const [re, val] of PROCESS_MAP) {
      if (re.test(zone)) { found.traitement = val; break; }
    }
  }

  // Variété
  if (varieteLabel) found.type = varieteLabel.slice(0, 60);
  else {
    const normText = stripAccents(title + " " + description + " " + text.slice(0, 4000));
    const hit = VARIETIES.find((v) => normText.includes(stripAccents(v)));
    if (hit) found.type = hit === "Gesha" ? "Geisha" : hit;
  }

  // Provenance : région + ferme
  found.provenance = [region, ferme].filter(Boolean).join(", ").slice(0, 120);

  // Altitude (MASL)
  if (altitude) found.altitude = altitude.slice(0, 40);

  // Arômes — séparateurs FR/EN/FI/SV (virgule, « et », « and », « ja », « och »…)
  if (notesLabel) {
    found.aromes = notesLabel
      .split(/[,;•·/+]|\s+et\s+|\s+and\s+|\s+ja\s+|\s+och\s+|\s*&\s*/i)
      .map((a) => cap(a.trim().replace(/[.…]+$/, "")))
      .filter((a) => a.length >= 2 && a.length <= 32)
      .slice(0, 8);
  }

  // Torréfacteur : nom du site, sinon domaine principal (en ignorant les
  // sous-domaines boutique : kauppa.cafesolo.fi → Cafesolo, pas « Kauppa »)
  found.torrefacteur = (siteName || "").trim().slice(0, 60);
  if (!found.torrefacteur) {
    try {
      const parts = new URL(url).hostname.replace(/^www\./, "").split(".");
      let label = parts.length > 1 ? parts[parts.length - 2] : parts[0];
      if (/^(co|com|net|org)$/i.test(label) && parts.length > 2) label = parts[parts.length - 3];
      found.torrefacteur = cap(label.replace(/[-_]/g, " "));
    } catch { /* URL invalide */ }
  }

  // Fiche texte : libellés trouvés + description
  const lignes = [
    paysLabel && `Origine : ${paysLabel}`, region && `Région : ${region}`,
    ferme && `Ferme / producteur : ${ferme}`, altitude && `Altitude : ${altitude}`,
    varieteLabel && `Variété : ${varieteLabel}`, processLabel && `Process : ${processLabel}`,
    notesLabel && `Notes : ${notesLabel}`,
  ].filter(Boolean);
  const desc = description.trim().replace(/\s{2,}/g, " ").slice(0, 700);
  found.infosWeb = [lignes.join("\n"), desc].filter(Boolean).join("\n\n").slice(0, 1500);

  return found;
}

function flashField(el) {
  el.classList.remove("flash");
  void el.offsetWidth; // relance l'animation
  el.classList.add("flash");
}

$("#btn-analyze").addEventListener("click", async () => {
  let url = $("#f-siteUrl").value.trim();
  if (!url) { $("#f-siteUrl").focus(); toast("Collez d'abord le lien de la page"); return; }
  if (!/^https?:\/\//i.test(url)) { url = "https://" + url; $("#f-siteUrl").value = url; }

  const status = $("#analyze-status");
  const btn = $("#btn-analyze");
  btn.disabled = true;
  status.textContent = "Lecture de la page… (quelques secondes)";

  try {
    const found = await analyzeUrl(url, (i, n) => {
      status.textContent = `Lecture de la page… (source ${i}/${n})`;
    });
    if (!found) {
      status.textContent = "Impossible de lire cette page (site protégé ?). Copiez les infos à la main dans « Infos du site ».";
      return;
    }
    const filled = [];
    const apply = (sel, val, label) => {
      const el = $(sel);
      if (val && !el.value.trim()) { el.value = val; flashField(el); filled.push(label); }
    };
    apply("#f-nom", found.nom, "nom");
    apply("#f-pays", found.pays, "pays");
    apply("#f-type", found.type, "variété");
    apply("#f-provenance", found.provenance, "provenance");
    apply("#f-traitement", found.traitement, "traitement");
    apply("#f-torrefacteur", found.torrefacteur, "torréfacteur");
    apply("#f-altitude", found.altitude, "altitude");
    apply("#f-infosWeb", found.infosWeb, "infos du site");
    if (found.aromes && found.aromes.length) {
      let added = 0;
      for (const a of found.aromes) {
        if (!AROME_TAGS.some((t) => t.toLowerCase() === a.toLowerCase())) { AROME_TAGS.push(a); added++; }
      }
      if (added) { renderAromeTags(); filled.push("arômes"); }
    }
    status.textContent = filled.length
      ? `Champs remplis : ${filled.join(", ")} ✔ — vérifiez et complétez.`
      : "Page lue, mais aucune info reconnue — copiez les infos à la main.";
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   FICHE DÉTAIL
   ============================================================ */
function openDetail(id) {
  const c = coffees.find((x) => x.id === id);
  if (!c) return;
  const url = photoURL(c);
  const rows = [
    ["Pays d'origine", c.pays], ["Type / variété", c.type],
    ["Traitement", c.traitement], ["Torréfacteur", c.torrefacteur],
    ["Altitude (MASL)", c.altitude], ["Provenance", c.provenance],
    ["Torréfié le", fmtDate(c.dateTorrefaction)], ["Acheté le", fmtDate(c.dateAchat)],
  ];
  $("#detail-sheet").innerHTML = `
    <header class="detail-topbar">
      <button class="icon-btn" id="btn-close-detail" aria-label="Fermer">✕</button>
      <span class="spacer"></span>
      <button class="icon-btn" id="btn-edit-coffee" title="Modifier">✎</button>
      <button class="icon-btn" id="btn-delete-coffee" title="Supprimer">🗑</button>
    </header>
    <div class="detail-hero">
      ${url ? `<img src="${url}" alt="Paquet de ${esc(c.nom)}">` : `<span class="no-photo">☕</span>`}
    </div>
    <div class="detail-body">
      <h2>${esc(c.nom)}</h2>
      ${c.pays || c.provenance ? `<p class="detail-sub">📍 ${esc([c.pays, c.provenance].filter(Boolean).join(" — "))}</p>` : ""}
      ${c.note ? `<div class="detail-rating">${beans(c.note)} <small style="color:var(--cream-dim);font-size:13px;letter-spacing:0">${c.note}/5</small></div>` : ""}
      <div class="detail-grid">
        ${rows.filter(([, v]) => v).map(([k, v, wide]) =>
          `<div class="detail-item ${wide ? "wide" : ""}"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join("")}
        ${(c.aromes || []).length ? `
          <div class="detail-item wide"><div class="k">Arômes</div>
            <div class="detail-aromes">${c.aromes.map((a) => `<span class="mini-tag">${esc(a)}</span>`).join("")}</div>
          </div>` : ""}
      </div>
      ${c.remarques ? `<div class="detail-remarques">${esc(c.remarques)}</div>` : ""}
      ${c.infosWeb ? `
        <div class="detail-infosweb">
          <div class="k">Infos du torréfacteur</div>
          <div class="v">${esc(c.infosWeb)}</div>
        </div>` : ""}
      ${c.siteUrl ? `<a class="detail-link" href="${esc(c.siteUrl)}" target="_blank" rel="noopener">🔗 Voir sur le site du torréfacteur</a>` : ""}
    </div>`;
  $("#detail-overlay").hidden = false;
  document.body.style.overflow = "hidden";

  $("#btn-close-detail").addEventListener("click", closeDetail);
  $("#btn-edit-coffee").addEventListener("click", () => {
    closeDetail();
    fillForm(c);
    showView("form");
  });
  $("#btn-delete-coffee").addEventListener("click", async () => {
    if (!confirm(`Supprimer « ${c.nom} » de votre carnet ?`)) return;
    await dbDelete(c.id);
    if (photoURLs.has(c.id)) { URL.revokeObjectURL(photoURLs.get(c.id)); photoURLs.delete(c.id); }
    closeDetail();
    await reload();
    toast("Café supprimé");
  });
}

function closeDetail() {
  $("#detail-overlay").hidden = true;
  document.body.style.overflow = "";
}
$("#detail-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeDetail();
});

/* ============================================================
   TABLEAU DE BORD
   ============================================================ */
function chartColors() {
  const cs = getComputedStyle(document.documentElement);
  return Array.from({ length: 8 }, (_, i) => cs.getPropertyValue(`--chart-${i + 1}`).trim());
}

function groupCount(list, key) {
  const m = new Map();
  for (const c of list) {
    const v = c[key];
    if (!v) continue;
    if (!m.has(v)) m.set(v, { count: 0, noteSum: 0, noteCount: 0 });
    const g = m.get(v);
    g.count++;
    if (c.note) { g.noteSum += c.note; g.noteCount++; }
  }
  return [...m.entries()]
    .map(([label, g]) => ({ label, count: g.count, avg: g.noteCount ? g.noteSum / g.noteCount : 0 }))
    .sort((a, b) => b.count - a.count);
}

function hbars(data, { byAvg = false, max = 8 } = {}) {
  const rows = byAvg ? [...data].sort((a, b) => b.avg - a.avg) : data;
  const top = rows.slice(0, max);
  const maxVal = byAvg ? 5 : Math.max(...top.map((d) => d.count), 1);
  return top.map((d) => `
    <div class="hbar-row">
      <span class="hbar-label" data-filter="${esc(d.label)}" title="${esc(d.label)}">${esc(d.label)}</span>
      <div class="hbar-track"><div class="hbar-fill ${byAvg ? "alt" : ""}" style="width:${((byAvg ? d.avg : d.count) / maxVal) * 100}%"></div></div>
      <span class="hbar-val">${byAvg ? d.avg.toFixed(1) + " ★" : d.count}</span>
    </div>`).join("");
}

function donutSVG(data, colors) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!total) return "";
  let angle = -90;
  const cx = 70, cy = 70, r = 52;
  const arcs = data.map((d, i) => {
    const sweep = (d.count / total) * 360;
    const a0 = (angle * Math.PI) / 180;
    const a1 = ((angle + sweep) * Math.PI) / 180;
    angle += sweep;
    if (data.length === 1) {
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[0]}" stroke-width="22"/>`;
    }
    const large = sweep > 180 ? 1 : 0;
    return `<path d="M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)}
      A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}"
      fill="none" stroke="${colors[i % colors.length]}" stroke-width="22"/>`;
  }).join("");
  return `<svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="Répartition des traitements">
    ${arcs}
    <text x="70" y="66" text-anchor="middle" fill="var(--cream)" font-size="24" font-weight="700" font-family="Fraunces,serif">${total}</text>
    <text x="70" y="84" text-anchor="middle" fill="var(--cream-faint)" font-size="10">cafés</text>
  </svg>`;
}

function renderDashboard() {
  const box = $("#dashboard-content");
  if (!coffees.length) {
    box.innerHTML = `<div class="dash-empty"><p style="font-size:42px;margin:0">📊</p>
      <p>Ajoutez quelques cafés pour découvrir le paysage de vos préférences.</p></div>`;
    return;
  }

  const palette = chartColors();
  const noted = coffees.filter((c) => c.note > 0);
  const avgNote = noted.length ? noted.reduce((s, c) => s + c.note, 0) / noted.length : 0;
  const nbPays = new Set(coffees.map((c) => c.pays).filter(Boolean)).size;
  const nbTorref = new Set(coffees.map((c) => c.torrefacteur).filter(Boolean)).size;

  const byPays = groupCount(coffees, "pays");
  const byTraitement = groupCount(coffees, "traitement");
  const byTorref = groupCount(coffees, "torrefacteur");

  const favoris = [...noted].sort((a, b) => b.note - a.note || b.createdAt - a.createdAt).slice(0, 3);

  const aromeFreq = new Map();
  coffees.forEach((c) => (c.aromes || []).forEach((a) => {
    const k = a.trim();
    aromeFreq.set(k, (aromeFreq.get(k) || 0) + 1);
  }));
  const aromes = [...aromeFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const maxAroma = aromes.length ? aromes[0][1] : 1;

  box.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="stat-value">${coffees.length}</div><div class="stat-label">cafés goûtés</div></div>
      <div class="stat-card"><div class="stat-value">${nbPays}</div><div class="stat-label">pays d'origine</div></div>
      <div class="stat-card"><div class="stat-value">${nbTorref}</div><div class="stat-label">torréfacteurs</div></div>
      <div class="stat-card"><div class="stat-value">${avgNote ? avgNote.toFixed(1) : "—"}</div><div class="stat-label">note moyenne</div></div>
    </div>

    ${favoris.length ? `
    <div class="dash-section">
      <h3>🏆 Mes cafés préférés</h3>
      <div class="podium">
        ${favoris.map((c, i) => {
          const url = photoURL(c);
          return `
          <div class="podium-item" data-id="${c.id}">
            <div class="podium-rank rank-${i + 1}">${i + 1}</div>
            ${url ? `<img class="podium-photo" src="${url}" alt="">` : `<div class="podium-photo">☕</div>`}
            <div class="podium-info">
              <div class="podium-name">${esc(c.nom)}</div>
              <div class="podium-sub">${esc([c.pays, c.torrefacteur].filter(Boolean).join(" · "))}</div>
              <div class="podium-note">${beans(c.note)}</div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>` : ""}

    ${byPays.length ? `
    <div class="dash-section">
      <h3>🌍 Paysage des origines</h3>
      ${hbars(byPays)}
    </div>
    <div class="dash-section">
      <h3>⭐ Note moyenne par pays</h3>
      ${hbars(byPays.filter((d) => d.avg > 0), { byAvg: true })}
    </div>` : ""}

    ${byTraitement.length ? `
    <div class="dash-section">
      <h3>⚗️ Traitements</h3>
      <div class="donut-wrap">
        ${donutSVG(byTraitement, palette)}
        <div class="donut-legend">
          ${byTraitement.map((d, i) => `
            <div class="legend-row" data-filter-traitement="${esc(d.label)}">
              <span class="legend-dot" style="background:${palette[i % palette.length]}"></span>
              <span>${esc(d.label)}</span>
              <span class="legend-val">${d.count}${d.avg ? ` · ${d.avg.toFixed(1)} ★` : ""}</span>
            </div>`).join("")}
        </div>
      </div>
    </div>` : ""}

    ${byTorref.length ? `
    <div class="dash-section">
      <h3>🔥 Torréfacteurs favoris</h3>
      ${hbars(byTorref, { byAvg: byTorref.some((d) => d.avg > 0) })}
    </div>` : ""}

    ${aromes.length ? `
    <div class="dash-section">
      <h3>👃 Mon profil aromatique</h3>
      <div class="aroma-cloud">
        ${aromes.map(([a, n]) => `
          <button class="aroma-chip" data-search="${esc(a)}"
            style="font-size:${(12 + (n / maxAroma) * 9).toFixed(1)}px">${esc(a)} <small style="opacity:.6">${n}</small></button>`).join("")}
      </div>
    </div>` : ""}`;

  // Interactions : cliquer sur un favori ouvre sa fiche, un arôme lance une recherche,
  // un pays / traitement filtre le catalogue.
  box.querySelectorAll(".podium-item").forEach((el) =>
    el.addEventListener("click", () => openDetail(Number(el.dataset.id))));
  box.querySelectorAll(".aroma-chip").forEach((el) =>
    el.addEventListener("click", () => {
      $("#search-input").value = el.dataset.search;
      showView("catalogue");
      renderCatalogue();
    }));
  box.querySelectorAll("[data-filter-traitement]").forEach((el) =>
    el.addEventListener("click", () => {
      Object.values(activeFilters).forEach((s) => s.clear());
      activeFilters.traitement.add(el.dataset.filterTraitement);
      renderFilterChips(); updateFilterBadge();
      showView("catalogue"); renderCatalogue();
    }));
}

/* ============================================================
   EXPORT / IMPORT (sauvegarde JSON, photos en base64)
   ============================================================ */
function blobToDataURL(blob) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL) {
  const resp = await fetch(dataURL);
  return resp.blob();
}

/* Thèmes : Moka (sombre chaud), Lagon (clair bleu), Matcha (clair vert) */
const THEME_BAR_COLORS = { moka: "#1c130d", lagon: "#e9f2f6", matcha: "#edf3e7" };

function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  localStorage.setItem("carnet-theme", name);
  document.querySelector("meta[name='theme-color']").content = THEME_BAR_COLORS[name] || "#1c130d";
  document.querySelectorAll(".theme-swatch").forEach((b) =>
    b.classList.toggle("on", b.dataset.theme === name));
  // Le tableau de bord embarque les couleurs du thème : on le redessine s'il est visible
  if ($("#view-dashboard").classList.contains("active")) renderDashboard();
}

document.querySelectorAll(".theme-swatch").forEach((b) =>
  b.addEventListener("click", () => applyTheme(b.dataset.theme)));
applyTheme(localStorage.getItem("carnet-theme") || "moka");

$("#btn-settings").addEventListener("click", () => {
  $("#settings-overlay").hidden = false;
  updateStorageStatus();
});
$("#btn-close-settings").addEventListener("click", () => { $("#settings-overlay").hidden = true; });
$("#settings-overlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.hidden = true;
});

function markExported() {
  localStorage.setItem("carnet-last-export", String(Date.now()));
  $("#settings-status").textContent = `Sauvegarde exportée (${coffees.length} cafés).`;
  $("#backup-banner").hidden = true;
  toast("Sauvegarde enregistrée ✔ Gardez-la en lieu sûr (carte SD, Drive, mail…)");
}

/* Appelé par l'application Android après le sélecteur de fichiers natif. */
window.onBackupSaved = (ok) => {
  if (ok) markExported();
  else toast("Sauvegarde annulée");
};

async function exportCatalogue() {
  const out = [];
  for (const c of coffees) {
    const { photo, ...rest } = c;
    out.push({ ...rest, photoData: photo ? await blobToDataURL(photo) : null });
  }
  const json = JSON.stringify({ app: "carnet-cafe", version: 1, coffees: out });
  const filename = `carnet-cafe-${new Date().toISOString().slice(0, 10)}.json`;

  if (window.CarnetAndroid && window.CarnetAndroid.saveBackup) {
    // APK : sélecteur natif Android — mémoire interne, carte SD, Drive…
    // La suite (markExported) arrive via window.onBackupSaved.
    window.CarnetAndroid.saveBackup(json, filename);
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  markExported();
}

$("#btn-export").addEventListener("click", exportCatalogue);

/* ---------- Rappel de sauvegarde ---------- */
const EXPORT_REMINDER_DAYS = 14;

function checkBackupReminder() {
  const banner = $("#backup-banner");
  if (coffees.length < 3) { banner.hidden = true; return; }
  const last = Number(localStorage.getItem("carnet-last-export") || 0);
  const dismissed = Number(sessionStorage.getItem("carnet-banner-dismissed") || 0);
  const stale = Date.now() - last > EXPORT_REMINDER_DAYS * 24 * 3600 * 1000;
  banner.hidden = !stale || dismissed > 0;
  if (!banner.hidden) {
    $("#backup-banner-text").textContent = last
      ? `Dernière sauvegarde : ${new Date(last).toLocaleDateString("fr-FR")} — pensez à exporter.`
      : "Vos cafés ne sont stockés que sur cet appareil — exportez une sauvegarde.";
  }
}

$("#btn-banner-export").addEventListener("click", exportCatalogue);
$("#btn-banner-close").addEventListener("click", () => {
  sessionStorage.setItem("carnet-banner-dismissed", "1");
  $("#backup-banner").hidden = true;
});

/* ---------- État du stockage (panneau options) ---------- */
async function updateStorageStatus() {
  const el = $("#storage-status");
  try {
    const persisted = navigator.storage && navigator.storage.persisted
      ? await navigator.storage.persisted() : false;
    let usage = "";
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage != null) usage = ` · ${(est.usage / 1048576).toFixed(1)} Mo utilisés`;
    }
    const last = Number(localStorage.getItem("carnet-last-export") || 0);
    el.textContent = (persisted
      ? "🔒 Stockage protégé : le système ne purgera pas vos données automatiquement"
      : "⚠ Stockage non protégé : le système peut purger les données si l'espace manque — exportez régulièrement")
      + usage
      + (last ? ` · dernier export : ${new Date(last).toLocaleDateString("fr-FR")}` : " · aucun export effectué");
  } catch {
    el.textContent = "";
  }
}

$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "carnet-cafe" || !Array.isArray(data.coffees)) throw new Error("format");
    let n = 0;
    for (const item of data.coffees) {
      const { id, photoData, ...rest } = item; // nouvel id pour éviter d'écraser l'existant
      const record = { ...rest, photo: photoData ? await dataURLToBlob(photoData) : null };
      await dbPut(record);
      n++;
    }
    await reload();
    $("#settings-status").textContent = `${n} café${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""} ✔`;
    toast(`${n} café${n > 1 ? "s" : ""} importé${n > 1 ? "s" : ""} ✔`);
  } catch {
    $("#settings-status").textContent = "Fichier non reconnu — utilisez un export Carnet Café.";
  }
  e.target.value = "";
});

/* ============================================================
   DÉMARRAGE
   ============================================================ */
async function reload() {
  coffees = await dbAll();
  renderCatalogue();
  renderFilterChips();
  refreshTorrefacteurSuggestions();
  checkBackupReminder();
}

(async function init() {
  await openDB();
  await reload();
  checkBackupReminder();
  // Demande au navigateur de protéger le stockage contre la purge
  // automatique (Chrome l'accorde aux PWA installées / sites utilisés).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  // Dans l'APK Android (origine carnetcafe.app), les fichiers sont embarqués :
  // pas besoin de service worker.
  if ("serviceWorker" in navigator && location.hostname !== "carnetcafe.app") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
