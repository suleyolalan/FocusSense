// js/app.js
// =====================================================
// Imports
// =====================================================
import { database } from "./firebaseConfig.js";
import { MQTT_CONFIG } from "./mqttConfig.js";

import {
  ref,
  push,
  onValue,
  set,
  update,
  get,
  query,
  orderByChild,
  equalTo,
  limitToLast
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-database.js";

// =====================================================
// Small helper: get element or warn
// =====================================================
function getElOrWarn(id) {
  const el = document.getElementById(id);
  if (!el) console.warn(`[FocusSense] Missing element id="${id}"`);
  return el
}

// =====================================================
// DOM Elements
// =====================================================
// Topbar + side menu
const menuBtn = getElOrWarn("menuBtn");
const closeMenuBtn = getElOrWarn("closeMenuBtn");
const sideMenu = getElOrWarn("sideMenu");
const overlay = getElOrWarn("overlay");

// Session UI (side menu)
const sessionNameInput = getElOrWarn("sessionName");
const startSessionBtn = getElOrWarn("startSessionBtn");
const stopSessionBtn = getElOrWarn("stopSessionBtn");
const activeSessionLabel = getElOrWarn("activeSessionLabel");

// Dashboard UI
const distanceSpan = getElOrWarn("distanceValue");
const statusBadge = getElOrWarn("statusBadge");
const lastUpdate = getElOrWarn("lastUpdate");
const debugLog = getElOrWarn("debugLog");
const simulateBtn = getElOrWarn("simulateBtn");

// Phone UI
const phoneStatusText = getElOrWarn("phoneStatusText");
const phonePickupCountSpan = getElOrWarn("phonePickupCount");
const phoneUsageTimeSpan = getElOrWarn("phoneUsageTime");

// Focus score UI
const focusScoreText = getElOrWarn("focusScoreText");
const focusScoreCanvas = getElOrWarn("focusScoreChart");

// Charts canvases
const distanceCanvas = getElOrWarn("distanceChart");
const phoneCanvas = getElOrWarn("phoneUsageChart");

// =====================================================
// REPORTS (Weekly / Monthly) 
// =====================================================

const weeklyReportBox = getElOrWarn("weeklyReportBox");
const monthlyReportBox = getElOrWarn("monthlyReportBox");

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function isInLastDays(ts, days) {
  const now = Date.now();
  const from = now - days * 24 * 60 * 60 * 1000;
  return ts >= from && ts <= now;
}

function isInCurrentMonth(ts) {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

function summarizeSessions(sessionsObj, filterFn) {
  const summary = {
    sessionCount: 0,
    total_s: 0,
    focus_s: 0,
    away_s: 0,
    away_count: 0,
    phone_pickups: 0,
    phone_use_s: 0
  };

  if (!sessionsObj) return summary;

  for (const [id, s] of Object.entries(sessionsObj)) {
    const startTs = Number(s?.start_ts || 0);
    if (!startTs || !filterFn(startTs)) continue;

    const stats = s?.stats || {};
    summary.sessionCount += 1;
    summary.total_s += Number(stats.total_s || 0);
    summary.focus_s += Number(stats.focus_s || 0);
    summary.away_s += Number(stats.away_s || 0);
    summary.away_count += Number(stats.away_count || 0);
    summary.phone_pickups += Number(stats.phone_pickups || 0);
    summary.phone_use_s += Number(stats.phone_use_s || 0);
  }

  return summary;
}

function renderSummaryToBox(boxEl, title, summary) {
  if (!boxEl) return;

  if (summary.sessionCount === 0) {
    boxEl.textContent = "Bu aralıkta kayıtlı oturum yok.";
    return;
  }

  boxEl.textContent =
    `Toplam Oturum: ${summary.sessionCount}\n` +
    `Toplam Süre: ${formatDuration(summary.total_s)}\n` +
    `Odak Süresi: ${formatDuration(summary.focus_s)}\n` +
    `Uzak Kalma: ${summary.away_count} kez, ${formatDuration(summary.away_s)}\n` +
    `Telefon Alma: ${summary.phone_pickups} kez\n` +
    `Telefon Süresi: ${formatDuration(summary.phone_use_s)}`;
}

async function refreshReports() {
  try {
    if (!weeklyReportBox || !monthlyReportBox) return;

    weeklyReportBox.textContent = "Yükleniyor...";
    monthlyReportBox.textContent = "Yükleniyor...";

    const snap = await get(sessionsRootRef());
    const sessionsObj = snap.exists() ? snap.val() : null;

    const weekly = summarizeSessions(sessionsObj, (ts) => isInLastDays(ts, 7));
    const monthly = summarizeSessions(sessionsObj, (ts) => isInCurrentMonth(ts));

    renderSummaryToBox(weeklyReportBox, "Haftalık", weekly);
    renderSummaryToBox(monthlyReportBox, "Aylık", monthly);
  } catch (e) {
    console.error(e);
    if (weeklyReportBox) weeklyReportBox.textContent = "Rapor yüklenemedi.";
    if (monthlyReportBox) monthlyReportBox.textContent = "Rapor yüklenemedi.";
  }
}



// =====================================================
// Debug log helper
// =====================================================
function log(msg) {
  const now = new Date().toLocaleTimeString();
  const line = `[${now}] ${msg}`;

  if (debugLog) {
    debugLog.textContent = line + "\n" + debugLog.textContent;
  } else {
    console.log(line);
  }
}

// =====================================================
// Owner / Device (Login yokken deviceId)
// =====================================================
function getOwnerId() {
  let id = localStorage.getItem("fs_ownerId");
  if (!id) {
    id = "dev_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
    localStorage.setItem("fs_ownerId", id);
  }
  return id;
}
const ownerId = getOwnerId();

// =====================================================
// Session State (DB ile senkron)
// =====================================================
let sessionRunning = false;
let activeSessionId = null;
let activeSessionName = null;

// Session counters (DB'den yüklenir, devam eder)
let sessionTotalTime = 0;
let sessionFocusTime = 0;
let sessionDistractionCount = 0;

let sessionAwaySeconds = 0;
let sessionAwayCount = 0;

let sessionPhonePickupCount = 0;
let sessionPhoneUsageSeconds = 0;

// Live sensor state (oturumdan bağımsız)
let lastDistanceState = null; // 'focus' | 'warning' | 'away'
let isAway = false;
let awayStartTs = null;

let isPhoneInHand = false;
let phonePickupStartTime = null;
let lastReedState = null;

// Tick + persist
let tickIntervalId = null;
let lastPersistMs = 0;
const PERSIST_EVERY_MS = 5000;

// =====================================================
// Firebase Refs
// =====================================================
function sessionsRootRef() {
  return ref(database, `sessions/${ownerId}`);
}
function sessionRef(sessionId) {
  return ref(database, `sessions/${ownerId}/${sessionId}`);
}
function eventsRootRef(sessionId) {
  return ref(database, `events/${ownerId}/${sessionId}`);
}

// =====================================================
// Event Log (sadece session varsa)
// =====================================================
function logEvent(type, payload = {}) {
  if (!activeSessionId) return;
  return push(eventsRootRef(activeSessionId), {
    ts: Date.now(),
    type,
    ...payload
  });
}

// =====================================================
// UI helpers
// =====================================================
function updateSessionUI() {
  if (activeSessionLabel) {
    activeSessionLabel.textContent = activeSessionName ? activeSessionName : "Yok";
  }

  // Session running → Start disable, Stop enable
  if (startSessionBtn) startSessionBtn.disabled = sessionRunning;
  if (stopSessionBtn) stopSessionBtn.disabled = !sessionRunning;
}

function formatPhoneUsageTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function isValidDistance(distance) {
  return Number.isFinite(distance) && distance >= 0 && distance <= 400;
}

function getStatus(distance) {
  if (distance < 20) return { text: "Sağlık için tehlikeli", class: "status-warning" };
  if (distance < 60) return { text: "Odakta", class: "status-focus" };
  if (distance < 100) return { text: "Kararsız", class: "status-warning" };
  return { text: "Masadan Uzak", class: "status-away" };
}

// =====================================================
// Charts
// =====================================================
let distanceChart = null;
let phoneUsageChart = null;
let focusScoreChart = null;

const distanceChartData = {
  labels: [],
  datasets: [
    {
      label: "Mesafe (cm)",
      data: [],
      borderColor: "#10b981",
      backgroundColor: "rgba(16, 185, 129, 0.1)",
      borderWidth: 2,
      tension: 0.2
    }
  ]
};

const phoneChartData = {
  labels: [],
  datasets: [
    {
      label: "Telefon Durumu",
      data: [],
      borderColor: "#ef4444",
      backgroundColor: "rgba(239, 68, 68, 0.1)",
      borderWidth: 2,
      tension: 0.2,
      stepped: true
    }
  ]
};

function initCharts() {
  // Distance
  if (distanceCanvas) {
    const ctx = distanceCanvas.getContext("2d");
    distanceChart = new Chart(ctx, {
      type: "line",
      data: distanceChartData,
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: "#e5e7eb" } } },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
          y: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } }
        }
      }
    });
  }

  // Phone
  if (phoneCanvas) {
    const ctx = phoneCanvas.getContext("2d");
    phoneUsageChart = new Chart(ctx, {
      type: "line",
      data: phoneChartData,
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: "#e5e7eb" } } },
        scales: {
          x: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" } },
          y: {
            ticks: {
              color: "#9ca3af",
              callback: (v) => (v === 1 ? "Elde" : "Tutucuda")
            },
            grid: { color: "#1f2937" },
            min: -0.2,
            max: 1.2
          }
        }
      }
    });
  }

  // Focus score - DÜZELTME: backgroundColor eklendi
  if (focusScoreCanvas) {
    const ctx = focusScoreCanvas.getContext("2d");
    focusScoreChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Score"],
        datasets: [
          {
            data: [0, 100],
            backgroundColor: ["#10b981", "#1f2937"], // EKLEME
            borderWidth: 0
          }
        ]
      },
      options: {
        cutout: "70%",
        plugins: { legend: { display: false } }
      }
    });
  }
}

function addDistanceToChart(distance) {
  if (!distanceChart) return;

  const nowLabel = new Date().toLocaleTimeString();
  distanceChartData.labels.push(nowLabel);
  distanceChartData.datasets[0].data.push(distance);

  if (distanceChartData.labels.length > 20) {
    distanceChartData.labels.shift();
    distanceChartData.datasets[0].data.shift();
  }

  distanceChart.update();
}

function addPhoneEventToChart(value01) {
  if (!phoneUsageChart) return;

  const nowLabel = new Date().toLocaleTimeString();
  phoneChartData.labels.push(nowLabel);
  phoneChartData.datasets[0].data.push(value01);

  if (phoneChartData.labels.length > 30) {
    phoneChartData.labels.shift();
    phoneChartData.datasets[0].data.shift();
  }

  phoneUsageChart.update();
}

// =====================================================
// Focus Score
// =====================================================
function calculateFocusScore() {
  if (sessionTotalTime <= 0) return 0;

  const focusRatio = sessionFocusTime / sessionTotalTime;
  const distractionPenalty = Math.max(0, 1 - sessionDistractionCount / 15);

  const phoneUsageRatio = sessionPhoneUsageSeconds / sessionTotalTime;
  const phoneUsagePenalty = Math.max(0, 1 - phoneUsageRatio * 2);

  const breakQuality = 0.8;

  const score =
    focusRatio * 50 +
    distractionPenalty * 15 +
    phoneUsagePenalty * 25 +
    breakQuality * 10;

  return Math.round(score);
}

function updateFocusScoreUI() {
  const score = calculateFocusScore();
  const remaining = 100 - score;

  if (focusScoreChart) {
    focusScoreChart.data.datasets[0].data = [score, remaining];
    
    // DÜZELTME: Renk güncellemesi eklendi
    if (score > 80) {
      focusScoreChart.data.datasets[0].backgroundColor[0] = "#22c55e";
    } else if (score > 65) {
      focusScoreChart.data.datasets[0].backgroundColor[0] = "#eab308";
    } else {
      focusScoreChart.data.datasets[0].backgroundColor[0] = "#ef4444";
    }
    
    focusScoreChart.update();
  }

  if (focusScoreText) {
    if (score > 80) focusScoreText.textContent = `${score} – Harika Odak!`;
    else if (score > 65) focusScoreText.textContent = `${score} – İyi Gün`;
    else if (score > 50) focusScoreText.textContent = `${score} – Orta Seviye`;
    else focusScoreText.textContent = `${score} – Dikkatin Çok Dağılıyor`;
  }
}

// =====================================================
// Persist stats to DB (every 5s, and on stop)
// =====================================================
async function persistSessionStats(force = false) {
  if (!activeSessionId) return;

  const now = Date.now();
  if (!force && now - lastPersistMs < PERSIST_EVERY_MS) return;
  lastPersistMs = now;

  await update(sessionRef(activeSessionId), {
    updated_ts: now,
    stats: {
      total_s: sessionTotalTime,
      focus_s: sessionFocusTime,
      distraction_count: sessionDistractionCount,
      away_s: sessionAwaySeconds,
      away_count: sessionAwayCount,
      phone_pickups: sessionPhonePickupCount,
      phone_use_s: sessionPhoneUsageSeconds
    }
  });
}

// =====================================================
// Session DB helpers (find/load)
// =====================================================
async function findSessionIdByName(name) {
  const q = query(
    sessionsRootRef(),
    orderByChild("name"),
    equalTo(name),
    limitToLast(1)
  );

  const snap = await get(q);
  if (!snap.exists()) return null;

  const obj = snap.val();
  const ids = Object.keys(obj);
  return ids.length ? ids[0] : null;
}

async function loadSessionIntoMemory(sessionId) {
  const snap = await get(sessionRef(sessionId));
  if (!snap.exists()) return false;

  const s = snap.val();
  activeSessionId = sessionId;
  activeSessionName = s.name || "Focus";

  const stats = s.stats || {};
  sessionTotalTime = Number(stats.total_s || 0);
  sessionFocusTime = Number(stats.focus_s || 0);
  sessionDistractionCount = Number(stats.distraction_count || 0);

  sessionAwaySeconds = Number(stats.away_s || 0);
  sessionAwayCount = Number(stats.away_count || 0);

  sessionPhonePickupCount = Number(stats.phone_pickups || 0);
  sessionPhoneUsageSeconds = Number(stats.phone_use_s || 0);

  if (phonePickupCountSpan) phonePickupCountSpan.textContent = String(sessionPhonePickupCount);
  if (phoneUsageTimeSpan) phoneUsageTimeSpan.textContent = formatPhoneUsageTime(sessionPhoneUsageSeconds);

  localStorage.setItem("fs_activeSessionId", activeSessionId);
  localStorage.setItem("fs_activeSessionName", activeSessionName);

  updateFocusScoreUI();
  updateSessionUI();
  
  log(`Session yüklendi: ${activeSessionName} (${sessionId})`);
  return true;
}

// =====================================================
// Session Start/Stop (resume / pause)
// =====================================================
async function startSessionFlow() {
  if (sessionRunning) {
    log("Session zaten çalışıyor!");
    return;
  }

  const name = (sessionNameInput?.value || "").trim() || "";

  log(`Session başlatılıyor: "${name}"...`);

  // If same name exists => resume
  const existingId = await findSessionIdByName(name);

  if (existingId) {
    await loadSessionIntoMemory(existingId);

    await update(sessionRef(activeSessionId), {
      status: "active",
      resumed_ts: Date.now()
    });

    logEvent("SESSION_RESUME");
    log(`Mevcut session devam ettiriliyor: ${activeSessionName}`);
  } else {
    // Create new
    const newRef = push(sessionsRootRef());
    activeSessionId = newRef.key;
    activeSessionName = name;

    sessionTotalTime = 0;
    sessionFocusTime = 0;
    sessionDistractionCount = 0;
    sessionAwaySeconds = 0;
    sessionAwayCount = 0;
    sessionPhonePickupCount = 0;
    sessionPhoneUsageSeconds = 0;

    await set(newRef, {
      name,
      start_ts: Date.now(),
      status: "active",
      created_ts: Date.now(),
      updated_ts: Date.now(),
      stats: {
        total_s: 0,
        focus_s: 0,
        distraction_count: 0,
        away_s: 0,
        away_count: 0,
        phone_pickups: 0,
        phone_use_s: 0
      }
    });

    localStorage.setItem("fs_activeSessionId", activeSessionId);
    localStorage.setItem("fs_activeSessionName", activeSessionName);

    logEvent("SESSION_START", { name });

    if (phonePickupCountSpan) phonePickupCountSpan.textContent = "0";
    if (phoneUsageTimeSpan) phoneUsageTimeSpan.textContent = "0:00";
    updateFocusScoreUI();
    
    log(`Yeni session oluşturuldu: ${activeSessionName}`);
  }

  sessionRunning = true;
  clearSessionWarning();

  // phone in hand → start timer baseline
  if (isPhoneInHand) phonePickupStartTime = Date.now();

  startMainTick();
  updateSessionUI();

  log(`Session çalışıyor: ${activeSessionName} (${activeSessionId})`);
}

async function stopSessionFlow() {
  if (!sessionRunning) {
    log("Session zaten durmuş!");
    return;
  }
  if (!activeSessionId) return;

  log(`Session durduruluyor: ${activeSessionName}...`);

  // phone in hand → finalize current usage chunk
  if (isPhoneInHand && phonePickupStartTime) {
    const currentUsage = Math.floor((Date.now() - phonePickupStartTime) / 1000);
    sessionPhoneUsageSeconds += currentUsage;
    phonePickupStartTime = Date.now(); // Reset for next start
  }

  sessionRunning = false;

  // Stop tick
  if (tickIntervalId) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }

  await persistSessionStats(true);
  await update(sessionRef(activeSessionId), {
    status: "paused",
    paused_ts: Date.now()
  });

  logEvent("SESSION_PAUSE");
  updateSessionUI();
  showSessionWarning();
  await refreshReports();


  log(`⏸️ Session durduruldu: ${activeSessionName} (${activeSessionId})`);
}

// =====================================================
// Main Tick (1s)
// =====================================================
function startMainTick() {
  if (tickIntervalId) {
    log("⚠️ Tick zaten çalışıyor!");
    return;
  }

  log("⏱️ Tick başlatıldı (1s interval)");

  tickIntervalId = setInterval(() => {
    if (!sessionRunning) return;

    sessionTotalTime++;

    if (lastDistanceState === "focus") sessionFocusTime++;
    else if (lastDistanceState === "away") sessionDistractionCount++;

    // live phone usage (session)
    if (phoneUsageTimeSpan) {
      if (isPhoneInHand && phonePickupStartTime) {
        const currentUsage = Math.floor((Date.now() - phonePickupStartTime) / 1000);
        phoneUsageTimeSpan.textContent = formatPhoneUsageTime(sessionPhoneUsageSeconds + currentUsage);
      } else {
        phoneUsageTimeSpan.textContent = formatPhoneUsageTime(sessionPhoneUsageSeconds);
      }
    }

    updateFocusScoreUI();
    persistSessionStats().catch(() => {});
  }, 1000);
}

// =====================================================
// Sensor handlers
// =====================================================
function handleNewDistance(distance) {
  if (!isValidDistance(distance)) return;

  // DÜZELTME: Oturum yoksa sadece görsel güncelle, istatistik tutma
  if (distanceSpan) distanceSpan.textContent = distance.toFixed(1);

  const statusInfo = getStatus(distance);

  if (statusBadge) {
    statusBadge.textContent = statusInfo.text;
    statusBadge.classList.remove("status-unknown", "status-focus", "status-warning", "status-away");
    statusBadge.classList.add(statusInfo.class);
  }

  if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString();
  
  addDistanceToChart(distance);

  const newState =
    statusInfo.class === "status-focus"
      ? "focus"
      : statusInfo.class === "status-warning"
        ? "warning"
        : "away";

  // DÜZELTME: State değişikliği tracking sadece session aktifse
  if (sessionRunning && newState !== lastDistanceState) {
    // away start
    if (newState === "away" && !isAway) {
      isAway = true;
      awayStartTs = Date.now();
      sessionAwayCount++;
      logEvent("AWAY_START", { distance_cm: distance });
    }

    // away end
    if (lastDistanceState === "away" && isAway && newState !== "away") {
      isAway = false;
      const duration_s = awayStartTs ? Math.floor((Date.now() - awayStartTs) / 1000) : 0;
      awayStartTs = null;

      if (duration_s >= 5) {
        sessionAwaySeconds += duration_s;
        logEvent("AWAY_END", { duration_s });
      }
    }
  }

  lastDistanceState = newState;
}

function updatePhoneStatus(reedValue) {
  // 1 = tutucuda, 0 = elde varsayımı
  if (lastReedState === null) {
    lastReedState = reedValue;
    isPhoneInHand = reedValue === 0;
    if (isPhoneInHand && sessionRunning) phonePickupStartTime = Date.now();
    renderPhoneUI(isPhoneInHand);
    return;
  }

  if (reedValue === lastReedState) return;

  // 1 -> 0 (pickup)
  if (reedValue === 0 && lastReedState === 1) {
    isPhoneInHand = true;
    if (sessionRunning) phonePickupStartTime = Date.now();
    renderPhoneUI(true);
    addPhoneEventToChart(1);

    // DÜZELTME: Sadece session aktifse kaydet
    if (sessionRunning) {
      sessionPhonePickupCount++;
      if (phonePickupCountSpan) phonePickupCountSpan.textContent = String(sessionPhonePickupCount);
      logEvent("PHONE_PICKUP");
    }
  }

  // 0 -> 1 (put back)
  if (reedValue === 1 && lastReedState === 0) {
    isPhoneInHand = false;
    renderPhoneUI(false);
    addPhoneEventToChart(0);

    // DÜZELTME: Sadece session aktifse kaydet
    if (sessionRunning && phonePickupStartTime) {
      const usageDuration = Math.floor((Date.now() - phonePickupStartTime) / 1000);
      phonePickupStartTime = null;

      sessionPhoneUsageSeconds += usageDuration;
      if (usageDuration >= 3) logEvent("PHONE_PUTBACK", { duration_s: usageDuration });
    }
  }

  lastReedState = reedValue;
}

function renderPhoneUI(inHand) {
  if (!phoneStatusText) return;
  if (inHand) {
    phoneStatusText.textContent = "📵 Elde";
    phoneStatusText.style.color = "#ef4444";
  } else {
    phoneStatusText.textContent = "✅ Tutucuda";
    phoneStatusText.style.color = "#10b981";
  }
}

// =====================================================
// Data sources: Firebase + MQTT
// =====================================================
function startFirebaseListener() {
  log("Firebase dinleyici başlatılıyor...");

  const sensorsRef = ref(database, "sensors");

  onValue(
    sensorsRef,
    (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      if (data.distance_cm != null) handleNewDistance(Number(data.distance_cm));
      if (data.reed != null) updatePhoneStatus(Number(data.reed));
    },
    (error) => {
      log("Firebase veri okuma hatası: " + error.message);
    }
  );

  log("Firebase dinleyici aktif (sensors).");
}

function startMqttListener() {
  const brokerUrl = MQTT_CONFIG?.BROKER_URL;
  const topicDistance = MQTT_CONFIG?.TOPIC_DISTANCE;

  if (!brokerUrl || !topicDistance) {
    log("MQTT_CONFIG eksik: BROKER_URL veya TOPIC_DISTANCE yok.");
    return;
  }

  log("MQTT broker'a bağlanılıyor: " + brokerUrl);

  const client = mqtt.connect(brokerUrl);

  client.on("connect", () => {
    log("MQTT bağlandı.");
    client.subscribe(topicDistance, (err) => {
      if (err) log("Subscribe hatası: " + err.message);
      else log("Topic'e subscribe olundu: " + topicDistance);
    });
  });

  client.on("message", (topic, message) => {
    const payload = message.toString();
    const distance = parseFloat(payload);
    if (!isNaN(distance)) handleNewDistance(distance);
  });

  client.on("error", (err) => log("MQTT hata: " + err.message));
  client.on("close", () => log("MQTT bağlantısı kapandı."));
}

// =====================================================
// Side menu toggle
// =====================================================
function setupSideMenu() {
  if (!sideMenu || !overlay) return;

  function openMenu() {
    sideMenu.classList.add("open");
    overlay.classList.add("open");
    sideMenu.setAttribute("aria-hidden", "false");
  }

  function closeMenu() {
    sideMenu.classList.remove("open");
    overlay.classList.remove("open");
    sideMenu.setAttribute("aria-hidden", "true");
  }

  menuBtn?.addEventListener("click", () => {
    const isOpen = sideMenu.classList.contains("open");
    isOpen ? closeMenu() : openMenu();
  });

  closeMenuBtn?.addEventListener("click", closeMenu);
  overlay?.addEventListener("click", closeMenu);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  log("Side menu hazır.");
}

// =====================================================
// Simulation button
// =====================================================
function setupSimulation() {
  if (!simulateBtn) return;
  simulateBtn.addEventListener("click", () => {
    const fakeDistance = Math.random() * 150;
    log("Simülasyon mesafesi: " + fakeDistance.toFixed(1) + " cm");
    handleNewDistance(fakeDistance);
  });
}

// =====================================================
// Session controls (buttons)
// =====================================================
function setupSessionControls() {
  if (!startSessionBtn || !stopSessionBtn) {
    log("Session butonları bulunamadı (startSessionBtn/stopSessionBtn).");
    return;
  }

  // restore last loaded session name/id (but do NOT auto-run)
  const savedId = localStorage.getItem("fs_activeSessionId");
  if (savedId) {
    loadSessionIntoMemory(savedId).catch(() => {
      log("⚠️ Kaydedilmiş session yüklenemedi");
    });
  } else {
    const savedName = localStorage.getItem("fs_activeSessionName");
    if (savedName && sessionNameInput) {
      sessionNameInput.value = savedName;
    }
  }

  startSessionBtn.addEventListener("click", () => {
    startSessionFlow().catch((e) => {
      log(" Start error: " + e.message);
      console.error(e);
    });
  });

  stopSessionBtn.addEventListener("click", () => {
    stopSessionFlow().catch((e) => {
      log(" Stop error: " + e.message);
      console.error(e);
    });
  });

  updateSessionUI();
  log("Session kontrolleri hazır.");
}

// =====================================================
// Başlangıç Uyarısı - YENİ
// =====================================================
function showSessionWarning() {
  if (!sessionRunning) {
    log("UYARI: Oturum başlatılmadı! Lütfen menüden oturum başlatın.");
    
    // EKLEME: Görsel uyarı
    if (statusBadge) {
      statusBadge.textContent = "Oturum Başlatın!";
      statusBadge.classList.remove("status-unknown", "status-focus", "status-away");
      statusBadge.classList.add("status-warning");
    }
  }
}

function clearSessionWarning() {
  if (!statusBadge) return;

  // Uyarı metnini sabitlemişsek temizle
  if (statusBadge.textContent?.includes("Oturum Başlatın")) {
    statusBadge.textContent = "Bekleniyor...";
  }

  // Uyarı class'ını kaldır
  statusBadge.classList.remove("status-warning");
  // İstersen tekrar default hale getir
  statusBadge.classList.add("status-unknown");
}


// =====================================================
// Boot
// =====================================================
function boot() {
  log("Uygulama başlatılıyor...");

  initCharts();
  setupSideMenu();
  setupSessionControls();
  setupSimulation();

  startFirebaseListener();
  startMqttListener();

  refreshReports();

  log("Uygulama başlatıldı.");

}

boot();