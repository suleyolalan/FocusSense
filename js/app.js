// js/app.js
// =====================================================
// Imports (Config + Firebase SDK funcs)
// =====================================================
import { database } from "./firebaseConfig.js";
import { MQTT_CONFIG } from "./mqttConfig.js";

import {
  ref,
  push,
  onValue
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// =====================
// EVENT LOG FONKSİYONU
// =====================
function logEvent(type, payload = {}) {
  const eventsRef = ref(database, "events/desk1");
  return push(eventsRef, {
    ts: Date.now(),
    type,
    ...payload
  });
}

// =====================================================
// State (Focus Score + Phone Tracking)
// =====================================================
let totalTime = 0;
let focusTime = 0;
let distractionCount = 0;
let lastDistanceState = null; // 'focus', 'warning', 'away'

// Away tracking (distance-based)
let isAway = false;
let awayStartTs = null;

// Phone tracking (reed-based)
let phonePickupCount = 0;
let phoneUsageSeconds = 0;
let isPhoneInHand = false;
let phonePickupStartTime = null;
let lastReedState = null;
let phoneUsageHistory = []; // (opsiyonel) raporlamak için

// =====================================================
// DOM Elements
// =====================================================
const distanceSpan = document.getElementById("distanceValue");
const statusBadge = document.getElementById("statusBadge");
const lastUpdate = document.getElementById("lastUpdate");
const debugLog = document.getElementById("debugLog");
const simulateBtn = document.getElementById("simulateBtn");

// Phone DOM
const phoneStatusText = document.getElementById("phoneStatusText");
const phonePickupCountSpan = document.getElementById("phonePickupCount");
const phoneUsageTimeSpan = document.getElementById("phoneUsageTime");

// =====================================================
// Helpers
// =====================================================
function log(msg) {
  const now = new Date().toLocaleTimeString();
  if (debugLog) {
    debugLog.textContent = `[${now}] ${msg}\n` + debugLog.textContent;
  } else {
    console.log(`[${now}] ${msg}`);
  }
}

function getStatus(distance) {
  if (distance < 20) return { text: "Sağlık için tehlikeli", class: "status-warning" };
  if (distance < 60) return { text: "Odakta", class: "status-focus" };
  if (distance < 100) return { text: "Kararsız", class: "status-warning" };
  return { text: "Masadan Uzak", class: "status-away" };
}

function formatPhoneUsageTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// Basit geçersiz mesafe filtresi (sensör -1 vb. gönderirse log/score bozulmasın)
function isValidDistance(distance) {
  return Number.isFinite(distance) && distance >= 0 && distance <= 400; // HC-SR04 tipik aralık
}

// =====================================================
// Charts (Distance + Phone Usage + Focus Score)
// =====================================================
let distanceChart;
let phoneUsageChart;
let focusScoreChart;

const chartData = {
  labels: [],
  datasets: [
    {
      label: "Mesafe (cm)",
      data: [],
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
  // Distance chart
  const distanceCanvas = document.getElementById("distanceChart");
  if (distanceCanvas) {
    const ctx = distanceCanvas.getContext("2d");
    distanceChart = new Chart(ctx, {
      type: "line",
      data: chartData,
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

  // Phone usage chart
  const phoneCanvas = document.getElementById("phoneUsageChart");
  if (phoneCanvas) {
    const phoneCtx = phoneCanvas.getContext("2d");
    phoneUsageChart = new Chart(phoneCtx, {
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
              callback: function (value) {
                return value === 1 ? "Elde" : "Tutucuda";
              }
            },
            grid: { color: "#1f2937" },
            min: -0.2,
            max: 1.2
          }
        }
      }
    });
  }

  // Focus score chart
  const fsCanvas = document.getElementById("focusScoreChart");
  if (fsCanvas) {
    const fsCtx = fsCanvas.getContext("2d");
    focusScoreChart = new Chart(fsCtx, {
      type: "doughnut",
      data: {
        labels: ["Score"],
        datasets: [
          {
            data: [0, 100],
            backgroundColor: ["#10b981", "#1f2937"],
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

// =====================================================
// Chart Update Functions
// =====================================================
function addDistanceToChart(distance) {
  if (!distanceChart) return;

  const nowLabel = new Date().toLocaleTimeString();
  chartData.labels.push(nowLabel);
  chartData.datasets[0].data.push(distance);

  if (chartData.labels.length > 20) {
    chartData.labels.shift();
    chartData.datasets[0].data.shift();
  }

  distanceChart.update();
}

function addPhoneEventToChart(event) {
  if (!phoneUsageChart) return;

  const nowLabel = new Date().toLocaleTimeString();
  const value = event === "Alındı" ? 1 : 0;

  phoneChartData.labels.push(nowLabel);
  phoneChartData.datasets[0].data.push(value);

  if (phoneChartData.labels.length > 30) {
    phoneChartData.labels.shift();
    phoneChartData.datasets[0].data.shift();
  }

  phoneUsageChart.update();
}

// =====================================================
// Core UI Update Functions
// =====================================================
function handleNewDistance(distance) {
  if (!isValidDistance(distance)) {
    // İstersen burada log basabilirsin:
    // log("Geçersiz mesafe verisi: " + distance);
    return;
  }

  if (distanceSpan) distanceSpan.textContent = distance.toFixed(1);

  const statusInfo = getStatus(distance);

  if (statusBadge) {
    statusBadge.textContent = statusInfo.text;
    statusBadge.classList.remove(
      "status-unknown",
      "status-focus",
      "status-warning",
      "status-away"
    );
    statusBadge.classList.add(statusInfo.class);
  }

  if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString();

  addDistanceToChart(distance);

  // 1) Yeni state'i hesapla
  const newState =
    statusInfo.class === "status-focus"
      ? "focus"
      : statusInfo.class === "status-warning"
        ? "warning"
        : "away";

  // 2) State değiştiyse event logla
  if (newState !== lastDistanceState) {
    // away başladı
    if (newState === "away" && !isAway) {
      isAway = true;
      awayStartTs = Date.now();
      logEvent("AWAY_START", { distance_cm: distance });
    }

    // away bitti
    if (lastDistanceState === "away" && isAway && newState !== "away") {
      isAway = false;

      const duration_s = awayStartTs
        ? Math.floor((Date.now() - awayStartTs) / 1000)
        : 0;

      awayStartTs = null;

      // gürültü filtresi: 5 sn altını sayma
      if (duration_s >= 5) {
        logEvent("AWAY_END", { duration_s });
      }
    }

    // 3) Son state'i güncelle
    lastDistanceState = newState;
  }
}

function updatePhoneStatus(reedValue) {
  // Varsayım: 1 = telefon tutucuda, 0 = telefon elde

  if (lastReedState === null) {
    lastReedState = reedValue;

    if (reedValue === 0) {
      isPhoneInHand = true;
      phonePickupStartTime = Date.now();

      if (phoneStatusText) {
        phoneStatusText.textContent = "📵 Elde";
        phoneStatusText.style.color = "#ef4444";
      }

      // İlk veriyle başladıysa event spam olmasın diye burada event atmayabilirsin.
      // Eğer ilk okuma anında eldeyse ve bunu da kaydetmek istersen aç:
      // logEvent("PHONE_PICKUP");

      log("📱 Telefon elde - sayım başladı");
    } else {
      isPhoneInHand = false;
      if (phoneStatusText) {
        phoneStatusText.textContent = "✅ Tutucuda";
        phoneStatusText.style.color = "#10b981";
      }
      log("✅ Telefon tutucuda");
    }

    return;
  }

  // only on change
  if (reedValue !== lastReedState) {
    if (reedValue === 0 && lastReedState === 1) {
      // picked up
      phonePickupCount++;
      isPhoneInHand = true;
      phonePickupStartTime = Date.now();

      if (phoneStatusText) {
        phoneStatusText.textContent = "📵 Elde";
        phoneStatusText.style.color = "#ef4444";
      }
      if (phonePickupCountSpan) phonePickupCountSpan.textContent = phonePickupCount;

      log(`📱 Telefon alındı! Toplam: ${phonePickupCount} kez`);
      addPhoneEventToChart("Alındı");

      // ✅ EVENT LOG
      logEvent("PHONE_PICKUP");
    } else if (reedValue === 1 && lastReedState === 0) {
      // put back
      isPhoneInHand = false;

      if (phonePickupStartTime) {
        const usageDuration = Math.floor((Date.now() - phonePickupStartTime) / 1000);
        phoneUsageSeconds += usageDuration;

        phoneUsageHistory.push({
          timestamp: new Date().toLocaleTimeString(),
          duration: usageDuration
        });

        log(`✅ Telefon bırakıldı - ${usageDuration} saniye kullanıldı`);
        addPhoneEventToChart("Bırakıldı");

        // ✅ EVENT LOG (gürültü filtresi: 3 sn altını sayma)
        if (usageDuration >= 3) {
          logEvent("PHONE_PUTBACK", { duration_s: usageDuration });
        }
      }

      if (phoneStatusText) {
        phoneStatusText.textContent = "✅ Tutucuda";
        phoneStatusText.style.color = "#10b981";
      }
      phonePickupStartTime = null;
    }

    lastReedState = reedValue;
  }
}

// =====================================================
// Focus Score
// =====================================================
function calculateFocusScore() {
  if (totalTime === 0) return 0;

  const focusRatio = focusTime / totalTime;
  const distractionPenalty = Math.max(0, 1 - distractionCount / 15);

  // phone penalty
  const phoneUsageRatio = phoneUsageSeconds / totalTime;
  const phoneUsagePenalty = Math.max(0, 1 - phoneUsageRatio * 2); // %50 phone => 0

  const breakQuality = 0.8;

  const score =
    focusRatio * 50 +
    distractionPenalty * 15 +
    phoneUsagePenalty * 25 +
    breakQuality * 10;

  return Math.round(score);
}

function updateFocusScoreUI() {
  if (!focusScoreChart) return;

  const score = calculateFocusScore();
  const remaining = 100 - score;

  focusScoreChart.data.datasets[0].data = [score, remaining];

  if (score > 80) focusScoreChart.data.datasets[0].backgroundColor[0] = "#22c55e";
  else if (score > 65) focusScoreChart.data.datasets[0].backgroundColor[0] = "#eab308";
  else focusScoreChart.data.datasets[0].backgroundColor[0] = "#ef4444";

  focusScoreChart.update();

  const text = document.getElementById("focusScoreText");
  if (!text) return;

  if (score > 80) text.textContent = `${score} – Harika Odak!`;
  else if (score > 65) text.textContent = `${score} – İyi Gün`;
  else if (score > 50) text.textContent = `${score} – Orta Seviye`;
  else text.textContent = `${score} – Dikkatin Çok Dağılıyor`;
}

// =====================================================
// Firebase Listener (Realtime Database)
// =====================================================
function startFirebaseListener() {
  try {
    log("Firebase dinleyici başlatılıyor...");

    const sensorsRef = ref(database, "sensors");

    onValue(
      sensorsRef,
      (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        if (data.distance_cm != null) {
          handleNewDistance(Number(data.distance_cm));
        }

        if (data.reed != null) {
          updatePhoneStatus(Number(data.reed));
        }
      },
      (error) => {
        log("Firebase veri okuma hatası: " + error.message);
      }
    );

    log("Firebase dinleyici aktif (sensors).");
  } catch (err) {
    log("Firebase başlatma/dinleme hatası: " + err.message);
    log("MQTT ile devam edilecek...");
  }
}

// =====================================================
// MQTT Listener
// =====================================================
function startMqttListener() {
  const brokerUrl = MQTT_CONFIG?.BROKER_URL;
  const topicDistance = MQTT_CONFIG?.TOPIC_DISTANCE;

  if (!brokerUrl || !topicDistance) {
    log("MQTT_CONFIG eksik: BROKER_URL veya TOPIC_DISTANCE bulunamadı.");
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
    log(`Gelen MQTT mesajı [${topic}]: ${payload}`);

    const distance = parseFloat(payload);
    if (!isNaN(distance)) {
      handleNewDistance(distance);
    } else {
      log("Geçersiz MQTT veri: " + payload);
    }
  });

  client.on("error", (err) => log("MQTT hata: " + err.message));
  client.on("close", () => log("MQTT bağlantısı kapandı."));
}

// =====================================================
// Simulation Button
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
// Main Timer Tick (1s)
// =====================================================
function startMainTick() {
  setInterval(() => {
    totalTime++;

    if (lastDistanceState === "focus") {
      focusTime++;
    } else if (lastDistanceState === "away") {
      distractionCount++;
    }

    // phone usage UI (live)
    if (phoneUsageTimeSpan) {
      if (isPhoneInHand && phonePickupStartTime) {
        const currentUsage = Math.floor((Date.now() - phonePickupStartTime) / 1000);
        phoneUsageTimeSpan.textContent = formatPhoneUsageTime(phoneUsageSeconds + currentUsage);
      } else {
        phoneUsageTimeSpan.textContent = formatPhoneUsageTime(phoneUsageSeconds);
      }
    }

    updateFocusScoreUI();
  }, 1000);
}

// =====================================================
// Boot
// =====================================================
function boot() {
  initCharts();
  setupSimulation();

  // Data sources
  startFirebaseListener();
  startMqttListener();

  // periodic logic
  startMainTick();

  log("Uygulama başlatıldı.");
}

boot();
