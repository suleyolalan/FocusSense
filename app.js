/*MQTT bağlantısı ve canlı veri mantığı buraya eklenecek*/
// MQTT broker ayarları
// Şimdilik HiveMQ'nun public broker'ını kullanıyoruz

/* MQTT bağlantısı ve canlı veri mantığı */

// ---- Focus Score değişkenleri ----
let totalTime = 0;           
let focusTime = 0;           
let distractionCount = 0;    
let lastDistanceState = null; // 'focus', 'warning', 'away'

// ---- MQTT Ayarları ----
const MQTT_BROKER_URL = "wss://broker.hivemq.com:8884/mqtt";
const MQTT_TOPIC = "focusSense/desk1/distance";

// ---- DOM Elemanları ----
const distanceSpan = document.getElementById("distanceValue");
const statusBadge = document.getElementById("statusBadge");
const lastUpdate = document.getElementById("lastUpdate");
const debugLog = document.getElementById("debugLog");
const simulateBtn = document.getElementById("simulateBtn");

// ---- Log Fonksiyonu ----
function log(msg) {
  const now = new Date().toLocaleTimeString();
  debugLog.textContent = `[${now}] ${msg}\n` + debugLog.textContent;
}

// ---- Durum Fonksiyonu ----
function getStatus(distance) {
  if (distance < 60) return { text: "Odakta", class: "status-focus" };
  if (distance < 120) return { text: "Kararsız", class: "status-warning" };
  return { text: "Masadan Uzak", class: "status-away" };
}

// ---- Distance Chart ----
const ctx = document.getElementById("distanceChart").getContext("2d");
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

const distanceChart = new Chart(ctx, {
  type: "line",
  data: chartData,
  options: {
    responsive: true,
    plugins: {
      legend: { labels: { color: "#e5e7eb" } }
    },
    scales: {
      x: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" }},
      y: { ticks: { color: "#9ca3af" }, grid: { color: "#1f2937" }}
    }
  }
});

// ---- Grafiğe veri ekleme ----
function addDistanceToChart(distance) {
  const nowLabel = new Date().toLocaleTimeString();

  chartData.labels.push(nowLabel);
  chartData.datasets[0].data.push(distance);

  if (chartData.labels.length > 20) {
    chartData.labels.shift();
    chartData.datasets[0].data.shift();
  }

  distanceChart.update();
}

// ---- Yeni Mesafe Geldiğinde ----
function handleNewDistance(distance) {
  distanceSpan.textContent = distance.toFixed(1);

  const statusInfo = getStatus(distance);
  statusBadge.textContent = statusInfo.text;

  statusBadge.classList.remove("status-unknown", "status-focus", "status-warning", "status-away");
  statusBadge.classList.add(statusInfo.class);

  lastUpdate.textContent = new Date().toLocaleTimeString();
  addDistanceToChart(distance);

  // ---- Focus Score mantığı için state güncelleme ----
  lastDistanceState =
    statusInfo.class === "status-focus" ? "focus" :
    statusInfo.class === "status-warning" ? "warning" :
    "away";
}

// ---- MQTT Bağlantısı ----
log("MQTT broker'a bağlanılıyor: " + MQTT_BROKER_URL);
const client = mqtt.connect(MQTT_BROKER_URL);

client.on("connect", () => {
  log("MQTT bağlandı.");
  client.subscribe(MQTT_TOPIC, (err) => {
    if (err) log("Subscribe hatası: " + err.message);
    else log("Topic'e subscribe olundu: " + MQTT_TOPIC);
  });
});

// ---- MQTT Mesajları ----
client.on("message", (topic, message) => {
  const payload = message.toString();
  log(`Gelen mesaj [${topic}]: ${payload}`);

  let distance = parseFloat(payload);

  if (!isNaN(distance)) {
    handleNewDistance(distance);
  } else {
    log("Geçersiz veri: " + payload);
    return;
  }
});

// ---- MQTT Hataları ----
client.on("error", (err) => log("MQTT hata: " + err.message));
client.on("close", () => log("MQTT bağlantısı kapandı."));

// ---- Simülasyon Butonu ----
simulateBtn.addEventListener("click", () => {
  const fakeDistance = Math.random() * 150;
  log("Simülasyon mesafesi: " + fakeDistance.toFixed(1) + " cm");
  handleNewDistance(fakeDistance);
});

// ----------------------
// ---- Focus Score ----
// ----------------------

function calculateFocusScore() {
  if (totalTime === 0) return 0;

  const focusRatio = focusTime / totalTime;
  const distractionPenalty = Math.max(0, 1 - (distractionCount / 15));
  const breakQuality = 0.8;

  const score =
    (focusRatio * 70) +
    (distractionPenalty * 20) +
    (breakQuality * 10);

  return Math.round(score);
}

// ---- Focus Score Chart ----
const fsCtx = document.getElementById("focusScoreChart").getContext("2d");
const focusScoreChart = new Chart(fsCtx, {
  type: "doughnut",
  data: {
    labels: ["Score"],
    datasets: [{
      data: [0, 100],
      backgroundColor: ["#10b981", "#1f2937"],
      borderWidth: 0
    }]
  },
  options: {
    cutout: "70%",
    plugins: { legend: { display: false } }
  }
});

// ---- Focus Score Güncelleme ----
function updateFocusScore() {
  const score = calculateFocusScore();
  const remaining = 100 - score;

  focusScoreChart.data.datasets[0].data = [score, remaining];

  if (score > 80) focusScoreChart.data.datasets[0].backgroundColor[0] = "#22c55e";
  else if (score > 65) focusScoreChart.data.datasets[0].backgroundColor[0] = "#eab308";
  else focusScoreChart.data.datasets[0].backgroundColor[0] = "#ef4444";

  focusScoreChart.update();

  const text = document.getElementById("focusScoreText");

  if (score > 80) text.textContent = `${score} – Harika Odak!`;
  else if (score > 65) text.textContent = `${score} – İyi Gün`;
  else if (score > 50) text.textContent = `${score} – Orta Seviye`;
  else text.textContent = `${score} – Dikkatin Çok Dağılıyor`;
}

// ---- Her saniye güncelle ----
setInterval(() => {
  totalTime++;

  if (lastDistanceState === "focus") {
    focusTime++;
  } else if (lastDistanceState === "away") {
    distractionCount++;
  }

  updateFocusScore();
}, 1000);
