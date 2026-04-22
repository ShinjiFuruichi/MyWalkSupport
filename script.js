//
// ===== 初期化 =====
//

// 現在地取得関数（モックと実際の切り替え）
let useMockLocation = false; // スマホ実地モード
//let useMockLocation = true; // PCモックモード

let settings = {
  mode: "time", // "time" or "pace"
  targetHour: 20,
  targetMin: 0,
  startPlannedTime: null,
  restMinutes: 20,
  cpRest: {},
  contourInterval: 100,
  decayPoints: [
    { km: 100, rate: 0.10 },
    { km: 200, rate: 0.30 }
  ]
};

let plannedBaseTime = null;  // 予定基準時間（スタート予定時刻 or 実際のスタート時間）
let plannedBaseSpeed = null;
let startTime = null; // スタート時間
let goalTime = null;  // ゴール予定時間
let decayA = 0;
let decayB = 0;

loadSettings();
if (!plannedBaseTime && settings.startPlannedTime) {
  plannedBaseTime = getPlannedStartDate();
}

initDecayParams(); 

const statusBox = document.getElementById("status");

const TAGS = {
  "場所": ["CP", "エイド", "ストア", "私設", "その他"],
  "内容": ["休憩", "トイレ", "補給", "治療", "寝る", "支援"]
};

const REST_TYPES = ["CHECKPOINT", "REST AREA"];

// 地図初期化
const map = L.map('map').setView([35.0, 135.0], 13);
function refreshMapSize() {
  if (!map) return;

  setTimeout(() => {
    map.invalidateSize();
  }, 100);
}

// ★イベント登録
window.addEventListener("resize", refreshMapSize);
window.addEventListener("orientationchange", refreshMapSize);

// 地図タイル
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// グローバル変数
let latlngs = []; // GPXの配列をグローバル化
let waypoints = []; // ウェイポイントの配列をグローバル化
let records = [];      // 保存済み記録
let currentRecord = null; // 現在記録中のもの

let plannedDurationMs = (settings.targetHour + settings.targetMin / 60) * 3600 * 1000;
let endTime = null;   // 終了時間
let currentIndex = 0; // 現在のインデックス
let timer = null;     // 位置自動更新用タイマー

let lastPosition = null; // 最後の位置
let lastTime = null;     // 最後の時間
let restStartTime = null; // 休憩開始時間

let mockIndex = 0; // モック位置のインデックス

let isFinished = false; // 終了フラグ

let selectedIndex = null;

//
// ===== データ読み込み、解析、復元 =====
//

// ページ読み込み時にスタート時間を削除（デバッグ用）
if (useMockLocation) {
  localStorage.removeItem("startTime");
  localStorage.removeItem("goalTime");
}

// ★追加：起動時にGPX復元
const savedGPX = localStorage.getItem("gpxData");

const savedSettings = localStorage.getItem("settings");
const savedDuration = localStorage.getItem("plannedDurationMs");

if (savedSettings) {
  settings = JSON.parse(savedSettings);
}

if (savedDuration) {
  plannedDurationMs = Number(savedDuration);
}

const savedStart = localStorage.getItem("startTime");
const savedGoal = localStorage.getItem("goalTime");
const savedPlanned = localStorage.getItem("plannedBaseTime");

if (savedStart) {
  startTime = new Date(savedStart);

  if (savedPlanned) {
    plannedBaseTime = new Date(savedPlanned);
  } else {
    plannedBaseTime = startTime;
  }

  if (savedGoal) {
    goalTime = new Date(savedGoal);
  } else {
    goalTime = new Date(startTime.getTime() + plannedDurationMs);
  }
}

// GPXがない場合はファイル選択UIを表示
if (!savedGPX) {
  updateUIState("noGPX");
}

if (savedGPX) {
  loadGPX(savedGPX);

  initDecayParams();
  updatePlannedBaseSpeed();

  applySettingsToUI();

  if (!startTime) {
    updateUIState("beforeStart");
  }
}

// ファイル選択イベント
document.getElementById("gpxFileInput").addEventListener("change", (e) => {

  // 既存データ・レイヤーをリセット
  resetAllState();

  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (event) => {
    const gpxText = event.target.result;

    // GPX保存
    localStorage.setItem("gpxData", gpxText);

    loadGPX(gpxText);
    applySettingsToUI();
    renderCpRestInputs();
    
    updateUIState("beforeStart");
    document.getElementById("setupPanel").style.display = "flex";
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  };

  reader.readAsText(file);
});

// 設定保存イベント
document.getElementById("startSetupBtn").onclick = () => {

  // =========================
  // 入力取得
  // =========================
  const hour = Number(document.getElementById("targetHourInput").value) || 0;
  const min  = Number(document.getElementById("targetMinInput").value) || 0;

  const paceMin = Number(document.getElementById("paceMinInput")?.value) || 0;
  const paceSec = Number(document.getElementById("paceSecInput")?.value) || 0;

  const restMin = Number(document.getElementById("restInput").value) || 20;
  const contour = Number(document.getElementById("contourInput").value) || 100;

  const decayKm1   = Number(document.getElementById("decayKm1").value) || 100;
  const decayRate1 = Number(document.getElementById("decayRate1").value) || 10;

  const decayKm2   = Number(document.getElementById("decayKm2").value) || 200;
  const decayRate2 = Number(document.getElementById("decayRate2").value) || 30;

  // =========================
  // バリデーション
  // =========================
  if (hour < 0 || min < 0) {
    alert("正しい時間を入力してね");
    return;
  }

  // =========================
  // 共通設定反映
  // =========================
  settings.restMinutes = restMin;
  settings.contourInterval = contour;

  settings.decayPoints = [
    { km: decayKm1, rate: decayRate1 / 100 },
    { km: decayKm2, rate: decayRate2 / 100 }
  ];

  // =========================
  // スタート予定時刻
  // =========================
  const startPlannedInput = document.getElementById("startPlannedInput");

  settings.startPlannedTime = startPlannedInput?.value || null;

  if (settings.startPlannedTime) {
    const [hh, mm] = settings.startPlannedTime.split(":").map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    plannedBaseTime = d;
  } else {
    plannedBaseTime = null;
  }


  // =========================
  // ★ここが今回の本体（分岐）
  // =========================

  const totalKm = getTotalDistance(latlngs) / 1000;
  const restHour = calcTotalRestTime() / 60;

  let totalHour = 0;

  // ===== ペース入力優先 =====
  const isPaceMode = settings.mode === "pace";

  if (isPaceMode) {

    const pace = paceMin + paceSec / 60;

    if (paceMin === 0 && paceSec === 0) {
      alert("ペースを入力してね");
      return;
    }

    plannedBaseSpeed = 60 / pace;
    const movingHour = calcTimeWithDecay(
      0,
      totalKm,
      plannedBaseSpeed
    ) / 3600;

    totalHour = movingHour + restHour;

    settings.targetHour = Math.floor(totalHour);
    settings.targetMin = Math.round((totalHour % 1) * 60);

    plannedDurationMs = totalHour * 3600 * 1000;

    applySettingsToUI();

  } else {

    totalHour = hour + (min / 60);

    settings.targetHour = hour;
    settings.targetMin = min;

    plannedDurationMs = totalHour * 3600 * 1000;

  }

  // =========================
  // 減衰・速度再計算
  // =========================
  initDecayParams();
  
  if (!isPaceMode) {
    if (settings.mode === "time") {
      updatePlannedBaseSpeed();
    }
  }

  // =========================
  // CP休憩保存
  // =========================
  document.querySelectorAll("#cpRestContainer input").forEach(input => {
    const cpName = input.dataset.cpName;
    settings.cpRest[cpName] = Number(input.value) ?? 0;
  });

  // =========================
  // 保存
  // =========================
  saveSettings();

  // =========================
  // UI閉じる
  // =========================
  document.getElementById("setupPanel").style.display = "none";
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  console.log("設定保存:", settings);

  updateUIState("beforeStart");
  updateAllUI();

  localStorage.setItem("settings", JSON.stringify(settings));
  localStorage.setItem("plannedDurationMs", plannedDurationMs);
};

// 全CPに適用ボタン
document.getElementById("applyAllBtn").onclick = () => {
  const restMin = Number(document.getElementById("restInput").value) ?? 20;
  Object.keys(settings.cpRest).forEach(cp => {
    settings.cpRest[cp] = restMin;
  });
  renderCpRestInputs(); // UI更新
  updatePlannedBaseSpeed();
  console.log("全CPに適用:", restMin);
};

// ===== 目標時間の分 → 繰り上げ =====
const targetMinInput = document.getElementById("targetMinInput");
const targetHourInput = document.getElementById("targetHourInput");

targetMinInput.addEventListener("input", () => {

  let min = Number(targetMinInput.value) || 0;
  let hour = Number(targetHourInput.value) || 0;

  if (min >= 60) {
    hour += Math.floor(min / 60);
    min = min % 60;
  }

  // ★追加（マイナス方向）
  if (min < 0) {
    const borrow = Math.ceil(Math.abs(min) / 60);
    hour -= borrow;
    min = (min % 60 + 60) % 60;
  }

  targetHourInput.value = hour;
  targetMinInput.value = min;
});

// ===== ペース秒 → 分繰り上げ =====
const paceSecInput = document.getElementById("paceSecInput");
const paceMinInput = document.getElementById("paceMinInput");

paceSecInput.addEventListener("input", () => {

  let sec = Number(paceSecInput.value) || 0;
  let min = Number(paceMinInput.value) || 0;

  if (sec >= 60) {
    min += Math.floor(sec / 60);
    sec = sec % 60;
  }

  // ★追加（マイナス方向）
  if (sec < 0) {
    const borrow = Math.ceil(Math.abs(sec) / 60);
    min -= borrow;
    sec = (sec % 60 + 60) % 60;
  }

  paceMinInput.value = min;
  paceSecInput.value = sec;
});


// ===== 保存データ読み込み =====
loadRecords();
document.getElementById("setupPanel").style.display = "none";
setTimeout(() => {
  map.invalidateSize();
}, 100);

//
// ===== イベント =====
//

// モード切替
document.querySelectorAll("input[name='mode']").forEach(r => {
  r.onchange = () => {
    settings.mode = r.value;
    updateModeUI(true);
  };
});

// スタートボタン
document.getElementById("startBtn").onclick = () => {
  startTime = new Date();
  plannedBaseTime = startTime;
  goalTime = new Date(startTime.getTime() + plannedDurationMs);

  // ローカルストレージにスタート時間を保存
  localStorage.setItem("startTime", startTime.toISOString());
  localStorage.setItem("goalTime", goalTime.toISOString());
  localStorage.setItem("plannedBaseTime", plannedBaseTime.toISOString());
  
  updateUIState("started");

  getSafePosition((current) => {
    updateCurrentPosition(current, latlngs);
  });

  // 3秒ごとに位置自動更新
  if (useMockLocation) {
    timer = setInterval(() => {
      refreshPositionAndUI();
    }, 3000);
  }
};

// 終了ボタン
document.getElementById("endBtn").onclick = () => {
  endTime = new Date();
  isFinished = true;

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // ローカルストレージからスタート時間を削除
  localStorage.removeItem("startTime");
  localStorage.removeItem("goalTime");

  const totalTimeMs = endTime - startTime;
  const traveled = getTraveledDistance(currentIndex, latlngs);

  document.getElementById("result").textContent =
    `総時間: ${formatTime(totalTimeMs)} / 総距離: ${(traveled/1000).toFixed(2)} km`;

  updateUIState("finished");

  console.log("終了:", endTime);
};

// 更新ボタン
document.getElementById("updateBtn").onclick = () => {

  getSafePosition((current) => {

    updateCurrentPosition(current, latlngs);

    const panel = document.getElementById("infoPanel");
    panel.classList.remove("hidden");
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  });
};

// クイック記録ボタン
document.getElementById("quickBtn").onclick = () => {

  getSafePosition((current) => {

    const record = buildRecord([]);
    if (!record) return;

    record.id = Date.now();
    records.push(record);

    localStorage.setItem("records", JSON.stringify(records));

    updateCurrentPosition(current, latlngs);

    showStatus("✔ 記録");

    if (!document.getElementById("recordPanel").classList.contains("hidden")) {
      renderRecordList();
    }

  });
};

// タグ追加ボタン
document.getElementById("tagBtn").onclick = () => {

  getSafePosition((current) => {

    currentRecord = {
      tags: []
    };

    updateCurrentPosition(current, latlngs);

    document.getElementById("infoPanel").classList.add("hidden");
    document.getElementById("tagPanel").classList.remove("hidden");

  });
};

// 保存ボタン
document.getElementById("saveBtn").onclick = () => {

  // 途中 or 最終で分岐
  if (isFinished) {
    downloadJSON(true);  // ←最終版（タイムスタンプ付き）
  } else {
    downloadJSON(false); // ←途中保存（履歴）
  }

  const statusEl = document.getElementById("status");
  statusEl.textContent = isFinished 
    ? "📦 最終保存しました" 
    : "💾 途中保存しました";
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 2000);

  // 終了してたらリセット
  if (isFinished) {
    if (confirm("保存してリセットしますか？")) {
      resetAllState();
      updateUIState("noGPX");
    }
  }
};

// 標高グラフ表示トグル
document.getElementById("elevationBtn").onclick = () => {
  document.getElementById("elevationContainer")
    .classList.toggle("hidden");

  const elevations = getElevations(latlngs);
  drawElevation(elevations, currentIndex);
};

// タグパネルを閉じるボタン
document.getElementById("closeTag").onclick = () => {

  if (!currentRecord || currentRecord.tags.length === 0) {
    document.getElementById("tagPanel").classList.add("hidden");
    currentRecord = null;

    const statusEl = document.getElementById("status");
    statusEl.textContent = "キャンセル";
    statusEl.style.opacity = 1;

    setTimeout(() => {
      statusEl.style.opacity = 0;
    }, 1500);

    return;
  }

  const record = buildRecord(currentRecord.tags);
  if (!record) return;
  record.id = Date.now();
  records.push(record);

  localStorage.setItem("records", JSON.stringify(records));

  document.getElementById("tagPanel").classList.add("hidden");

  resetTagUI();
  currentRecord = null;

  const statusEl = document.getElementById("status");
  statusEl.textContent = "✔ タグ記録";
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 1500);

  const recordPanel = document.getElementById("recordPanel");
  if (!recordPanel.classList.contains("hidden")) {
    renderRecordList();
  }

};

createTagUI();

// タグパネルの背景をクリックしても閉じる
document.getElementById("tagPanel").onclick = (e) => {

  e.stopPropagation();

  // ボタン押しただけなら何もしない
  if (e.target.tagName === "BUTTON") return;

  if (!currentRecord || currentRecord.tags.length === 0) {
    document.getElementById("tagPanel").classList.add("hidden");
    currentRecord = null;
    return;
  }

  const record = buildRecord(currentRecord.tags);
  if (!record) return;

  record.id = Date.now();
  records.push(record);

  localStorage.setItem("records", JSON.stringify(records));

  document.getElementById("tagPanel").classList.add("hidden");

  resetTagUI();
  currentRecord = null;

  const statusEl = document.getElementById("status");
  statusEl.textContent = "✔ タグ記録";
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 1500);

  const recordPanel = document.getElementById("recordPanel");
  if (!recordPanel.classList.contains("hidden")) {
    renderRecordList();
  }
};

// 情報パネルを閉じるボタン
document.getElementById("infoPanel").onclick = () => {
  document.getElementById("infoPanel").classList.add("hidden");
};

// 記録リスト表示ボタン
document.getElementById("listBtn").onclick = () => {
  const panel = document.getElementById("recordPanel");

  if (panel.classList.contains("hidden")) {
    renderRecordList();
    panel.classList.remove("hidden");
  } else {
    panel.classList.add("hidden");
  }
};

// 設定ボタン
document.getElementById("configBtn").onclick = () => {
  applySettingsToUI();
  renderCpRestInputs();
  document.getElementById("setupPanel").style.display = "flex";
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  console.log("state beforeStart");
  console.log(document.getElementById("startBtn").className);
};

document.getElementById("cpListBtn").onclick = () => {

  const panel = document.getElementById("cpListPanel");

  if (panel.classList.contains("hidden")) {
    renderCheckpointList();
    panel.classList.remove("hidden");
  } else {
    panel.classList.add("hidden");
  }
};

// 記録パネルをタップで閉じる
document.getElementById("recordPanel").onclick = (e) => {
  e.stopPropagation(); // ←他への影響防止
  document.getElementById("recordPanel").classList.add("hidden");
};

// CP一覧パネルをタップで閉じる
document.getElementById("cpListPanel").onclick = (e) => {
  e.stopPropagation();
  document.getElementById("cpListPanel").classList.add("hidden");
};

//
// ===== データ保存・復元関数 =====
//

//
function loadRecords() {
  const saved = localStorage.getItem("records");
  if (saved) {
    records = JSON.parse(saved);
    console.log("復元:", records);
  }
}

//
// ===== GPX処理 =====
//

// GPX読み込み関数
function loadGPX(gpxText) {

  // ===== 既存レイヤー削除（現在地などは残す）=====
  map.eachLayer(layer => {
    if (
      layer instanceof L.Polyline ||
      layer instanceof L.CircleMarker
    ) {
      if (
        layer !== window.currentMarker &&
        layer !== window.nearestMarker &&
        layer !== window.snapLine
      ) {
        map.removeLayer(layer);
      }
    }
  });

  const parser = new DOMParser();
  const xml = parser.parseFromString(gpxText, "text/xml");
  const trkpts = xml.getElementsByTagName("trkpt");

  latlngs = [];
  for (let i = 0; i < trkpts.length; i++) {
    const lat = parseFloat(trkpts[i].getAttribute("lat"));
    const lon = parseFloat(trkpts[i].getAttribute("lon"));
    const eleTag = trkpts[i].getElementsByTagName("ele")[0];
    const ele = eleTag ? parseFloat(eleTag.textContent) : 0;

    latlngs.push({
      lat: lat,
      lon: lon,
      ele: ele
    });
  }

  waypoints = [];

  const wpts = xml.getElementsByTagName("wpt");

  for (let i = 0; i < wpts.length; i++) {
    const lat = parseFloat(wpts[i].getAttribute("lat"));
    const lon = parseFloat(wpts[i].getAttribute("lon"));

    const typeTag = wpts[i].getElementsByTagName("type")[0];
    const nameTag = wpts[i].getElementsByTagName("name")[0];

    const type = typeTag ? typeTag.textContent : "UNKNOWN";
    const name = nameTag ? nameTag.textContent : "NO NAME";

    const res = findNearestIndex([lat, lon], latlngs);

    waypoints.push({
      lat,
      lon,
      type,
      name,
      routeIndex: res.index
    });
  }

  // 距離ポイントを生成してwaypointsに追加
  const distancePoints = generateDistancePoints(latlngs, 10);
  waypoints = waypoints.concat(distancePoints);

  // チェックポイント休憩時間の初期化
  if (!settings.cpRest) settings.cpRest = {};
  waypoints.forEach(wp => {
    if (REST_TYPES.includes(wp.type)) {
      if (settings.cpRest[wp.name] == null) {
        settings.cpRest[wp.name] = settings.restMinutes;
      }
    }
  });

  const trkNameTag = xml.getElementsByTagName("trk")[0]
                    ?.getElementsByTagName("name")[0];

  const courseName = trkNameTag
    ? trkNameTag.textContent
    : "NO NAME";

  console.log("コース名:", courseName);

  document.getElementById("courseName").textContent = courseName;

  const polyline = L.polyline(
    latlngs.map(p => [p.lat, p.lon]),
    { color: "blue" }
  ).addTo(map);
  map.fitBounds(polyline.getBounds());

  waypoints.forEach(wp => {
    let color = "blue";

    if (wp.type === "CHECKPOINT") color = "red";
    if (wp.type === "REST AREA") color = "green";
    if (wp.type === "DISTANCE") color = "purple";

    L.circleMarker([wp.lat, wp.lon], {
      radius: 6,
      color: color
    })
    .addTo(map)

    // ポップアップ内容を動的にするため関数化
    .bindPopup(() => {

      const distFromStart = getTraveledDistance(wp.routeIndex, latlngs);
      const planned = calcPlannedArrival(wp.routeIndex);

      if (!startTime) {
        return `
          ${wp.name}（${(distFromStart / 1000).toFixed(1)} km）<br>
          予定：${planned}
        `;
      }

      const pred = calcPrediction(
        wp.routeIndex,
        currentIndex,
        latlngs,
        startTime,
        plannedDurationMs
      );

      return `
        ${wp.name}（${(distFromStart / 1000).toFixed(1)} km）<br>
        予定：${planned}<br>
        予測：${pred.predicted}<br>
        差分：<span style="color:${pred.color}">${pred.diffText}</span>
      `;

    });

  });

  updateUIState("beforeStart");
  //document.getElementById("elevationBtn").classList.remove("hidden");

  // 標高グラフクリックで斜度表示
  const canvas = document.getElementById("elevationChart");

  canvas.addEventListener("click", (e) => {
    console.log("クリックOK");
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    const index = Math.floor(
      (x / rect.width) * latlngs.length
    );

    const safeIndex = Math.max(1, Math.min(latlngs.length - 2, index));

    selectedIndex = safeIndex;

    const elevations = getElevations(latlngs);
    drawElevation(elevations, currentIndex);

    const slope = getSlopePercent(safeIndex, latlngs);
    const ele = latlngs[safeIndex].ele;
    showSlopePopup(e.clientX, e.clientY, slope, ele);
  });

  // 標高グラフ描画
  const elevations = getElevations(latlngs);
  drawElevation(elevations, 0);

  if (startTime) {
    updateUIState("started");

    console.log("復元スタート:", startTime);

    getSafePosition((current) => {
      updateCurrentPosition(current, latlngs);
    });

    if (useMockLocation) {
      timer = setInterval(() => {
        refreshPositionAndUI();
      }, 3000);
    }
  }

  initDecayParams();
  showStartPosition(latlngs);

}

// 現在地取得関数
function getCurrentLocation(callback) {

  // ===== モックモード =====
  if (useMockLocation) {
    const point = latlngs[mockIndex];

    callback([point.lat, point.lon]);

    mockIndex += 5;

    if (mockIndex >= latlngs.length) {
      mockIndex = latlngs.length - 1;
    }

    return;
  }

  // ===== 実GPSモード =====
  let responded = false;

  navigator.geolocation.getCurrentPosition(

    // 成功
    pos => {
      responded = true;

      callback([
        pos.coords.latitude,
        pos.coords.longitude
      ]);
    },

    // 失敗
    err => {
      console.warn("GPS失敗:", err);

      // fallback：前回位置があれば使う
      if (lastPosition) {
        responded = true;
        console.log("fallback使用:", lastPosition);
        callback(lastPosition);
        return;
      }

      // fallbackできない場合
      showStatus("❌ 位置取得失敗");
    },

    // オプション（かなり重要）
    {
      enableHighAccuracy: true, // 高精度
      timeout: 5000,            // 5秒で諦める
      maximumAge: 0             // キャッシュ使わない
    }
  );

  // ===== タイムアウト保険 =====
  setTimeout(() => {
    if (!responded && lastPosition) {
      responded = true;
      console.log("タイムアウト fallback:", lastPosition);
      callback(lastPosition);
    }
  }, 6000);
}

// 安全に位置を取得してからコールバックする関数
function getSafePosition(callback) {

  showStatus("📍 位置取得中...");

  getCurrentLocation(current => {

    // ① 位置確定
    lastPosition = current;

    // ② ルート上インデックス
    const result = findNearestIndex(current, latlngs);
    currentIndex = result.index;

    // ③ 成功表示
    showStatus("✔ 取得");

    callback(current, result.index);
  });
}

// 位置とUIを更新する関数
function updateCurrentPosition(current, latlngs) {

  if (!latlngs || latlngs.length === 0) return;

  // =========================
  // ① 基本データ
  // =========================
  lastPosition = current;

  const now = new Date();

  const result = findNearestIndex(current, latlngs);
  currentIndex = result.index;

  const nearestPoint = [
    latlngs[result.index].lat,
    latlngs[result.index].lon
  ];

  // =========================
  // ② 地図更新
  // =========================

  // 現在地（緑）
  if (window.currentMarker) {
    window.currentMarker.setLatLng(current);
  } else {
    window.currentMarker = L.circleMarker(current, {
      radius: 8,
      color: "green"
    }).addTo(map);
  }

  // 最寄り点（黄）
  if (window.nearestMarker) {
    window.nearestMarker.setLatLng(nearestPoint);
  } else {
    window.nearestMarker = L.circleMarker(nearestPoint, {
      radius: 6,
      color: "yellow"
    }).addTo(map);
  }

  // ズレ線
  if (window.snapLine) {
    window.snapLine.setLatLngs([current, nearestPoint]);
  } else {
    window.snapLine = L.polyline([current, nearestPoint], {
      color: "orange",
      dashArray: "5,5"
    }).addTo(map);
  }

  map.setView(current, 15);

  // =========================
  // ③ 距離・進捗
  // =========================
  const total = getTotalDistance(latlngs);
  const traveled = getTraveledDistance(currentIndex, latlngs);
  const remaining = getRemainingDistance(currentIndex, latlngs);

  const percent = (traveled / total) * 100;

  document.getElementById("progress").textContent =
    `進捗：${(traveled / 1000).toFixed(2)} km（${percent.toFixed(1)}%）`;

  document.getElementById("remaining").textContent =
    `残り：${(remaining / 1000).toFixed(2)} km`;

  // =========================
  // ④ ペース計算
  // =========================
  //const pace = calcRequiredPace();
  //const restTotal = calcTotalRestTime();
  //let paceText = "--";
  //if (pace) {
  //  paceText = `${pace.speed}km/h（${pace.pace}）`;
  //}
  //const targetText = `${settings.targetHour}時間${settings.targetMin}分`;

  // =========================
  // ⑤ 時間表示
  // =========================
  if (startTime) {

    const elapsedMs = now - startTime;

    document.getElementById("timeInfo").innerHTML =
      `現在：${formatClock(now)}（開始：${formatClock(startTime)}）<br>
       経過：${formatDuration(elapsedMs)}`;

  } else {

    const plannedStart = settings.startPlannedTime ?? "--";

    document.getElementById("timeInfo").innerHTML =
      `開始予定：${plannedStart}`;
  }

  // =========================
  // ⑥ ゴール表示
  // =========================
  const goalIndex = latlngs.length - 1;
  const planned = calcPlannedArrival(goalIndex);

  let predText = "";

  if (startTime) {
    const pred = calcPrediction(
      goalIndex,
      currentIndex,
      latlngs,
      startTime,
      plannedDurationMs
    );

    predText = `<br>予測：${pred.predicted}
      （<span style="color:${pred.color}">${pred.diffText}</span>）`;
  }

  document.getElementById("result").innerHTML =
    `ゴール<br>
     予定：${planned}
     ${predText}`;

  // =========================
  // ⑦ 次の目的地
  // =========================
  const { nextStop, nextCP } = getNextTargets(
    currentIndex,
    latlngs,
    waypoints
  );

  let text = "";

  // ===== 次の休憩ポイント =====
  if (nextStop) {
    const dist = getTraveledDistance(nextStop.routeIndex, latlngs);

    const planned = calcPlannedArrival(nextStop.routeIndex);

    let predText = "";
    let diffText = "";
    let color = "black";

    if (startTime) {
      const pred = calcPrediction(
        nextStop.routeIndex,
        currentIndex,
        latlngs,
        startTime,
        plannedDurationMs
      );

      predText = pred.predicted;
      diffText = pred.diffText;
      color = pred.color;
    }

    text += `
      次：${nextStop.name}（${(dist/1000).toFixed(1)}km）<br>
      予定：${planned}
      ${startTime ? `<br>予測：${predText} <span style="color:${color}">${diffText}</span>` : ""}
      <br>
    `;
  }

  // ===== 次のCP =====
  if (nextCP) {
    const dist = getTraveledDistance(nextCP.routeIndex, latlngs);

    const planned = calcPlannedArrival(nextCP.routeIndex);

    let predText = "";
    let diffText = "";
    let color = "black";

    if (startTime) {
      const pred = calcPrediction(
        nextCP.routeIndex,
        currentIndex,
        latlngs,
        startTime,
        plannedDurationMs
      );

      predText = pred.predicted;
      diffText = pred.diffText;
      color = pred.color;
    }

    text += `
      次CP：${nextCP.name}（${(dist/1000).toFixed(1)}km）<br>
      予定：${planned}
      ${startTime ? `<br>予測：${predText} <span style="color:${color}">${diffText}</span>` : ""}
    `;
  }

  document.getElementById("next").innerHTML = text;
}

// 位置とUIを更新する関数
function refreshPositionAndUI() {
  getSafePosition((current) => {
    updateCurrentPosition(current, latlngs);
  });
}

// スタート位置表示関数
function showStartPosition(latlngs) {

  if (!latlngs || latlngs.length === 0) return;

  const start = [latlngs[0].lat, latlngs[0].lon];

  currentIndex = 0;
  lastPosition = start;

  // マーカー
  if (window.currentMarker) {
    window.currentMarker.setLatLng(start);
  } else {
    window.currentMarker = L.circleMarker(start, {
      radius: 8,
      color: "blue"   // ←スタートは青にするとわかりやすい
    }).addTo(map);
  }

  map.setView(start, 15);
}

// モック位置更新関数
function simulatePosition() {
  if (latlngs.length === 0) return;

  const point = latlngs[currentIndex];

  if (window.currentMarker) {
    window.currentMarker.setLatLng(point);
  } else {
    window.currentMarker = L.circleMarker(point, {
      radius: 8,
      color: "red"
    }).addTo(map);
  }

  map.setView(point, 15);

  currentIndex += 5;  

  if (currentIndex >= latlngs.length) {
    currentIndex = 0;
  }

  const remaining = getRemainingDistance(currentIndex, latlngs);
  console.log("残距離(m):", remaining);
}

// 距離関数
function getDistanceMeters(a, b) {
  const R = 6371000; // 地球半径(m)

  const lat1 = a[0] * Math.PI / 180;
  const lat2 = b[0] * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b[1] - a[1]) * Math.PI / 180;

  const x = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// 最寄り点検索関数
function findNearestIndex(current, latlngs) {
  let minDist = Infinity;
  let nearestIndex = 0;

  for (let i = 0; i < latlngs.length; i++) {
    const dist = getDistanceMeters(
      current,
      [latlngs[i].lat, latlngs[i].lon]
    );
    if (dist < minDist) {
      minDist = dist;
      nearestIndex = i;
    }
  }

  return {
    index: nearestIndex,
    distance: minDist
  };
}

// 残距離計算関数
function getRemainingDistance(index, latlngs) {
  let total = 0;

  for (let i = index; i < latlngs.length - 1; i++) {
    total += getDistanceMeters(
      [latlngs[i].lat, latlngs[i].lon],
      [latlngs[i+1].lat, latlngs[i+1].lon]
    )
  }

  return total; // メートル
}

// 総距離計算関数
function getTotalDistance(latlngs) {
  let total = 0;

  for (let i = 0; i < latlngs.length - 1; i++) {
    total += getDistanceMeters(
      [latlngs[i].lat, latlngs[i].lon],
      [latlngs[i+1].lat, latlngs[i+1].lon]
    );
  }

  return total;
}

// 進んだ距離計算関数
function getTraveledDistance(index, latlngs) {
  let total = 0;

  for (let i = 0; i < index; i++) {
    total += getDistanceMeters(
      [latlngs[i].lat, latlngs[i].lon],
      [latlngs[i+1].lat, latlngs[i+1].lon]
    )
  }

  return total;
}

// 標高配列取得関数
function getElevations(latlngs) {
  return latlngs.map(p => p.ele);
}

// 標高グラフ描画関数
function drawElevation(elevations, currentIndex) {
  const canvas = document.getElementById("elevationChart");
  const ctx = canvas.getContext("2d");

  const w = canvas.width;
  const h = canvas.height;

  const max = Math.max(...elevations);
  const min = Math.min(...elevations);

  ctx.clearRect(0, 0, w, h);

  // ===== 横グリッド（100mごと） =====
  ctx.beginPath();

  const step = settings.contourInterval;

  // 最小・最大を100m単位に丸める
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;

  for (let ele = start; ele <= end; ele += step) {
    const y = h - ((ele - min) / (max - min)) * h;

    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }

  // 薄い線
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // ===== 山グラフ =====
  ctx.beginPath();

  elevations.forEach((ele, i) => {
    const x = (i / elevations.length) * w;
    const y = h - ((ele - min) / (max - min)) * h;

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();

  // グラデーション
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(34,139,34,0.4)");
  grad.addColorStop(1, "rgba(34,139,34,0.05)");

  ctx.fillStyle = grad;
  ctx.fill();

  // 輪郭
  ctx.strokeStyle = "rgb(20,100,20)";
  ctx.stroke();

  // ===== 現在地ライン =====
  const x = (currentIndex / elevations.length) * w;

  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);

  //ctx.strokeStyle = "red";
  ctx.strokeStyle = "rgba(255,0,0,0.8)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // ===== タップ位置ライン（青） =====
  if (selectedIndex !== null) {
    const xSel = (selectedIndex / elevations.length) * w;

    ctx.beginPath();
    ctx.moveTo(xSel, 0);
    ctx.lineTo(xSel, h);

    ctx.strokeStyle = "blue";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// 斜度計算関数
function getSlopePercent(index, latlngs) {
  if (index <= 0 || index >= latlngs.length - 1) return 0;

  const p1 = latlngs[index - 1];
  const p2 = latlngs[index + 1];

  const dist = getDistanceMeters(
    [p1.lat, p1.lon],
    [p2.lat, p2.lon]
  );

  const elevDiff = p2.ele - p1.ele;

  if (dist === 0) return 0;

  return (elevDiff / dist) * 100;
}

// スロープポップアップ表示関数
function showSlopePopup(x, y, slope, ele) {
  let popup = document.getElementById("slopePopup");

  if (!popup) {
    popup = document.createElement("div");
    popup.id = "slopePopup";
    document.body.appendChild(popup);

    popup.style.position = "absolute";
    popup.style.background = "white";
    popup.style.padding = "6px 10px";
    popup.style.borderRadius = "8px";
    popup.style.boxShadow = "0 2px 6px rgba(0,0,0,0.2)";
    popup.style.fontSize = "14px";
    popup.style.zIndex = 3000;
    popup.style.pointerEvents = "none";
  }

  popup.style.left = x + "px";
  popup.style.top = (y - 40) + "px";

  const type = slope >= 0 ? "登り" : "下り";

  popup.innerHTML = `
    ${type}<br>
    斜度：${slope.toFixed(1)}%<br>
    標高：${Math.round(ele)} m
  `;

  setTimeout(() => popup.remove(), 2000);
}

// 次のチェックポイントを探す関数
function findNextWaypoint(currentIndex, latlngs, waypoints) {
  let next = null;
  let minIndex = Infinity;

  waypoints.forEach(wp => {
    const res = findNearestIndex([wp.lat, wp.lon], latlngs);

    if (res.index >= currentIndex && res.index < minIndex) {
      minIndex = res.index;
      next = {
        ...wp,
        routeIndex: res.index
      };
    }
  });

  return next;
}
// 時間表示関数
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}時間${m}分`;
}

// 時間表示関数（短縮版）
function formatClock(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// 時間表示関数（経過・残り用）
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return `${h}時間${m.toString().padStart(2, '0')}分`;
}

// 時間表示関数（差分用）
function formatDiff(ms) {
  const sec = Math.floor(ms / 1000);
  const sign = sec >= 0 ? "+" : "-";
  const abs = Math.abs(sec);

  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);

  return `${sign}${h}時間${m.toString().padStart(2, '0')}分`;
}

// 記録用データ構築関数
function buildRecord(tags) {

  if (!startTime) {
    alert("スタートしてから記録してください");
    return null;
  }
  const now = new Date();

  const traveled = getTraveledDistance(currentIndex, latlngs);
  const elapsedSec = (now - startTime) / 1000;

  // 予定との差（簡易）
  let diffSec = 0;
  if (goalTime) {
    const plannedSec = plannedDurationMs / 1000;
    diffSec = elapsedSec - plannedSec * (traveled / getTotalDistance(latlngs));
  }

  return {
    lat: lastPosition[0],
    lon: lastPosition[1],
    ele: latlngs[currentIndex].ele,
    time: now.toISOString(),
    distance: traveled,
    elapsed: elapsedSec,
    diff: diffSec,
    tags: tags
  };
}

// タグUIリセット関数
function resetTagUI() {
  document.querySelectorAll("#tagPanel button")
    .forEach(btn => btn.classList.remove("selected"));

  document.getElementById("tagPanel").classList.add("hidden");
}

// タグUI生成関数
function createTagUI() {

  const container = document.getElementById("tagContainer");
  container.innerHTML = ""; // 初期化

  Object.entries(TAGS).forEach(([groupName, tags]) => {

    const groupDiv = document.createElement("div");
    groupDiv.className = "tag-group";

    // タイトル
    const title = document.createElement("div");
    title.textContent = groupName;
    groupDiv.appendChild(title);

    // ボタン
    tags.forEach(tag => {

      const btn = document.createElement("button");
      btn.textContent = tag;
      btn.dataset.type = tag;

      btn.onclick = () => toggleTag(btn, tag);

      groupDiv.appendChild(btn);
    });

    container.appendChild(groupDiv);
  });
}

// タグ選択トグル関数
function toggleTag(btn, label) {

  if (!currentRecord) return;

  if (currentRecord.tags.includes(label)) {
    currentRecord.tags =
      currentRecord.tags.filter(t => t !== label);

    btn.classList.remove("selected");
  } else {
    currentRecord.tags.push(label);
    btn.classList.add("selected");
  }

  document.getElementById("status").textContent =
    currentRecord.tags.join(" / ");
  }

// 次のチェックポイントを探す関数
function findNextCP(currentIndex, latlngs, waypoints) {
  let nextCP = null;
  let minIndex = Infinity;

  waypoints.forEach(wp => {
    if (wp.type !== "CHECKPOINT") return;

    const res = findNearestIndex([wp.lat, wp.lon], latlngs);

    if (res.index > currentIndex && res.index < minIndex) {
      minIndex = res.index;
      nextCP = {
        ...wp,
        routeIndex: res.index
      };
    }
  });

  return nextCP;
}

// 現在地と次のチェックポイントの間にあるウェイポイントを探す関数
function findIntermediateStops(currentIndex, nextCP, latlngs, waypoints) {
  let candidates = [];

  waypoints.forEach(wp => {
    if (wp.type === "CHECKPOINT" || wp.type === "DISTANCE") return;

    const res = findNearestIndex([wp.lat, wp.lon], latlngs);

    if (res.index > currentIndex && res.index < nextCP.routeIndex) {
      candidates.push({
        ...wp,
        routeIndex: res.index
      });
    }
  });

  return candidates;
}

// 候補の中から最もルートに近いものを選ぶ関数
function findNextStop(currentIndex, candidates) {
  if (candidates.length === 0) return null;

  let nearest = candidates[0];

  candidates.forEach(c => {
    if (c.routeIndex < nearest.routeIndex) {
      nearest = c;
    }
  });

  return nearest;
}

// メイン関数：現在地から次のチェックポイントとその間の休憩ポイントを取得
function getNextTargets(currentIndex, latlngs, waypoints) {

  const nextCP = findNextCP(currentIndex, latlngs, waypoints);

  if (!nextCP) {
    return {
      nextStop: null,
      nextCP: null
    };
  }

  const candidates = findIntermediateStops(
    currentIndex,
    nextCP,
    latlngs,
    waypoints
  );

  const nextStop = findNextStop(currentIndex, candidates);

  return {
    nextStop,
    nextCP
  };
}

// 追加機能：距離ポイントを生成する関数
function generateDistancePoints(latlngs, intervalKm = 10) {
  let points = [];
  let accumulated = 0;
  let nextTarget = intervalKm * 1000;

  for (let i = 0; i < latlngs.length - 1; i++) {
    const d = getDistanceMeters(
      [latlngs[i].lat, latlngs[i].lon],
      [latlngs[i+1].lat, latlngs[i+1].lon]
    )

    if (accumulated + d >= nextTarget) {
      points.push({
        lat: latlngs[i].lat,
        lon: latlngs[i].lon,
        name: `${nextTarget / 1000}km`,
        type: "DISTANCE",
        routeIndex: i
      });

      nextTarget += intervalKm * 1000;
    }

    accumulated += d;
  }

  return points;
}

// 次の距離ポイントを探す関数
function findNextDistancePoint(currentIndex, waypoints) {
  let next = null;
  let minIndex = Infinity;

  waypoints.forEach(wp => {
    if (wp.type !== "DISTANCE") return;

    if (wp.routeIndex > currentIndex && wp.routeIndex < minIndex) {
      minIndex = wp.routeIndex;
      next = wp;
    }
  });

  return next;
}

// 起動時に係数計算
function initDecayParams() {
  const x1 = settings.decayPoints[0].km;
  const r1 = settings.decayPoints[0].rate;
  const x2 = settings.decayPoints[1].km;
  const r2 = settings.decayPoints[1].rate;

  decayA = (r2 / x2 - r1 / x1) / (x2 - x1);
  decayB = r1 / x1 - decayA * x1;

  console.log("減衰係数:", decayA, decayB);
}

// 減衰を考慮した時間計算関数
function calcTimeWithDecay(fromKm, toKm, baseSpeedKmh) {
  let time = 0;
  const step = 0.5; // 0.5km単位

  for (let x = fromKm; x < toKm; x += step) {

    const r = decayA * x * x + decayB * x;
    const v = baseSpeedKmh * (1 - r);

    if (v <= 0) break;

    time += step / v; // 時間（h）
  }

  return time * 3600; // 秒で返す
}

// 休憩時間をルート上のインデックスまで計算する関数
function calcRestTimeToIndex(targetRouteIndex) {
  let totalSec = 0;

  waypoints.forEach(wp => {
    if (!REST_TYPES.includes(wp.type)) return;

    if (wp.routeIndex < targetRouteIndex) {
      totalSec += (settings.cpRest?.[wp.name] ?? 0) * 60;
    }
  });

  return totalSec;
}

// 休憩時間の総計を計算する関数
function calcTotalRestTime() {
  let totalMin = 0;

  waypoints.forEach(wp => {
    if (!REST_TYPES.includes(wp.type)) return;

    totalMin += (settings.cpRest?.[wp.name] ?? 0);
  });

  return totalMin; // 分で返す
}

// 予定到着時間計算関数
function calcPlannedArrival(targetRouteIndex) {

  const baseTime = plannedBaseTime ?? getPlannedStartDate();

  if (!baseTime) return "--";

  const plannedDist = getTraveledDistance(targetRouteIndex, latlngs);

  const moveSec = calcTimeWithDecay(
    0,
    plannedDist / 1000,
    plannedBaseSpeed
  );

  const restSec = calcRestTimeToIndex(targetRouteIndex);

  const plannedArrival = new Date(
    baseTime.getTime() + (moveSec + restSec) * 1000
  );

  return formatClock(plannedArrival);
}

// 予測計算関数
function calcPrediction(targetRouteIndex, currentIndex, latlngs, startTime, plannedDurationMs) {

  if (!startTime) {
    return {
      predicted: "--",
      diffText: "-",
      color: "black"
    };
  }

  const now = new Date();
  const elapsedSec = (now - startTime) / 1000;
  const traveled = getTraveledDistance(currentIndex, latlngs);

  if (elapsedSec <= 0 || traveled <= 0) {
    return {
      predicted: "--",
      diffText: "-",
      color: "black"
    };
  }

  // =========================
  // ① 実際の予測（今のペース）
  // =========================
  const currentSpeedMs = traveled / elapsedSec;

  const distToTarget =
    getRemainingDistance(currentIndex, latlngs) -
    getRemainingDistance(targetRouteIndex, latlngs);

  const predictedArrival = new Date(
    now.getTime() + (distToTarget / currentSpeedMs) * 1000
  );

  // =========================
  // ② 予定（疲労カーブ）
  // =========================
  const plannedDist = getTraveledDistance(targetRouteIndex, latlngs);

  const plannedSec = calcTimeWithDecay(
    0,
    plannedDist / 1000,
    plannedBaseSpeed
  );

  const restSec = calcRestTimeToIndex(targetRouteIndex);

  const baseTime = plannedBaseTime || startTime;

  const plannedArrival = new Date(
    baseTime.getTime() + (plannedSec + restSec) * 1000
  );

  // =========================
  // ③ 差分
  // =========================
  const diffMs = predictedArrival - plannedArrival;

  return {
    predicted: formatClock(predictedArrival),
    diffText: formatDiff(diffMs),
    color: diffMs > 0 ? "red" : "blue"
  };
}

// 必要ペース計算関数
function calcRequiredPace() {

  if (!plannedBaseSpeed) return null;

  const speed = plannedBaseSpeed;

  const paceMin = 60 / speed;
  const min = Math.floor(paceMin);
  const sec = Math.round((paceMin - min) * 60);

  return {
    speed: speed.toFixed(2),
    pace: `${min}分${sec}秒/km`
  };
}

// ゴールまでの必要時間をペースから計算する関数
function calcGoalTimeFromPace(paceMinPerKm) {

  const totalKm = getTotalDistance(latlngs) / 1000;

  const movingHour = (paceMinPerKm * totalKm) / 60;

  const restHour = calcTotalRestTime() / 60;

  const totalHour = movingHour + restHour;

  return totalHour;
}

// 目標時間から必要なペースを逆算する関数
function findBaseSpeed(totalKm, movingHour) {

  let low = 1;     // km/h
  let high = 15;   // km/h（適当な上限）

  for (let i = 0; i < 30; i++) {

    const mid = (low + high) / 2;

    const t = calcTimeWithDecay(0, totalKm, mid) / 3600;

    if (t > movingHour) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

// 初速更新関数（設定変更や休憩時間変化時に呼び出す）
function updatePlannedBaseSpeed() {
  const totalKm = getTotalDistance(latlngs) / 1000;
  const totalHour = plannedDurationMs / 3600000;
  const restHour = calcTotalRestTime() / 60;

  const movingHour = totalHour - restHour;

  plannedBaseSpeed = findBaseSpeed(totalKm, movingHour);

  console.log("初速更新:", plannedBaseSpeed);
}

function paceToSpeed(min, sec) {
  const paceMin = min + sec / 60;
  return 60 / paceMin;
}

// 計画開始日時取得関数
function getPlannedStartDate() {
  if (!settings.startPlannedTime) return null;

  const [hh, mm] = settings.startPlannedTime.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;

  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d;
}

// データダウンロード
function downloadJSON(withTimestamp = false) {

  if (records.length === 0) return;

  const courseName = document.getElementById("courseName").textContent || "course";

  const dataObj = {
    courseName: courseName,
    startTime: startTime ? startTime.toISOString() : null,
    endTime: endTime ? endTime.toISOString() : null,
    records: records
  };

  const data = JSON.stringify(dataObj, null, 2);

  const blob = new Blob([data], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;

  if (withTimestamp) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0,16).replace(/[:T]/g, "-");
    a.download = `${courseName}_${dateStr}.json`;
  } else {
    a.download = "walk_record.json";
  }

  a.click();
  URL.revokeObjectURL(url);
}

// 記録表示関数
function renderRecordList() {

  const panel = document.getElementById("recordPanel");
  panel.innerHTML = "";

  if (records.length === 0) {
    panel.innerHTML = "記録なし";
    return;
  }

  [...records].reverse().forEach(r => {

    const div = document.createElement("div");
    div.className = "record-item";

    // タグテキスト
    const tagText = r.tags.length > 0
      ? `【${r.tags.join("・")}】`
      : "";

    // 距離
    const dist = (r.distance / 1000).toFixed(1);

    // 時刻
    const time = new Date(r.time).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });

    // 経過時間
    const elapsed = formatDuration(r.elapsed * 1000);

    // 差分
    const diff = formatDiff(r.diff * 1000);

    div.innerHTML = `
      ${tagText}<br>
      ${dist}km ｜ ${time} ｜ ${elapsed} ｜ 
      <span style="color:${r.diff > 0 ? 'red' : 'blue'}">
        ${diff}
      </span>
    `;

    panel.appendChild(div);
  });
}

// 設定保存関数
function saveSettings() {
  localStorage.setItem("settings", JSON.stringify(settings));
}

// 設定読み込み関数
function loadSettings() {
  const saved = localStorage.getItem("settings");
  if (!saved) return;

  try {
    const parsed = JSON.parse(saved);

    // ===== 安全マージ =====
    settings = {
      ...settings,
      ...parsed,

      // ネストも個別に補正
      cpRest: {
        ...(settings.cpRest || {}),
        ...(parsed.cpRest || {})
      },

      decayPoints: Array.isArray(parsed.decayPoints)
        ? parsed.decayPoints.map(p => ({
            km: Number(p.km) || 0,
            rate: Number(p.rate) || 0
          }))
        : settings.decayPoints
    };

    // ===== 型補正 =====
    settings.targetHour = Number(settings.targetHour) || 0;
    settings.targetMin = Number(settings.targetMin) || 0;
    settings.restMinutes = Number(settings.restMinutes) || 20;
    settings.contourInterval = Number(settings.contourInterval) || 100;

    // startPlannedTimeは文字列 or null
    if (!settings.startPlannedTime) {
      settings.startPlannedTime = null;
    }

    console.log("設定復元:", settings);

  } catch (e) {
    console.error("settings復元失敗:", e);
  }
}

// 計画を計算する関数（初速や目標時間から必要なペースを算出）未使用
function calculatePlan() {

  const totalKm = getTotalDistance(latlngs) / 1000;
  const restHour = calcTotalRestTime() / 60;

  if (settings.mode === "pace") {

    const paceMin = Number(paceMinInput.value) || 0;
    const paceSec = Number(paceSecInput.value) || 0;

    const pace = paceMin + paceSec / 60;

    if (pace <= 0) {
      alert("初速を入れてね");
      return false;
    }

    plannedBaseSpeed = 60 / pace;

    const movingHour = pace * totalKm / 60;
    const totalHour = movingHour + restHour;

    settings.targetHour = Math.floor(totalHour);
    settings.targetMin = Math.round((totalHour % 1) * 60);

  } else {

    const hour = Number(targetHourInput.value) || 0;
    const min  = Number(targetMinInput.value) || 0;

    const totalHour = hour + min / 60;

    settings.targetHour = hour;
    settings.targetMin = min;

    const movingHour = totalHour - restHour;
    plannedBaseSpeed = findBaseSpeed(totalKm, movingHour);
  }

  plannedDurationMs =
    (settings.targetHour + settings.targetMin / 60) * 3600 * 1000;

  initDecayParams();

  return true;
}


// 設定をUIに反映する関数
function applySettingsToUI() {

  const startInput = document.getElementById("startPlannedInput");

  if (startInput) {
    startInput.value = settings.startPlannedTime ?? "";
  }

  const targetHourInput = document.getElementById("targetHourInput");
  const targetMinInput  = document.getElementById("targetMinInput");

  targetHourInput.value = settings.targetHour;
  targetMinInput.value = settings.targetMin;

  const modeRadio =
    document.querySelector(`input[name="mode"][value="${settings.mode}"]`);
  if (modeRadio) modeRadio.checked = true;

  if (settings.mode === "pace" && plannedBaseSpeed) {
  const paceMinValue = 60 / plannedBaseSpeed;
  let min = Math.floor(paceMinValue);
  let sec = Math.round((paceMinValue - min) * 60);

  if (sec === 60) {
    min += 1;
    sec = 0;
  }

  document.getElementById("paceMinInput").value = min;
  document.getElementById("paceSecInput").value = sec;
}

  updateModeUI();
}

// チェックポイントごとの休憩時間入力UIを生成する関数
function renderCpRestInputs() {
  const container = document.getElementById("cpRestContainer");
  if (!container) return;

  container.innerHTML = "";

  waypoints.forEach(wp => {
    if (!REST_TYPES.includes(wp.type)) return;

    const row = document.createElement("div");
    row.className = "cp-rest-row";

    row.innerHTML = `
      <span>${wp.name}</span>
      <input type="number"
             min="0"
             value="${settings.cpRest?.[wp.name] ?? settings.restMinutes}"
             data-cp-name="${wp.name}">
      <span>分</span>
    `;

    container.appendChild(row);

    const input = row.querySelector("input");

    input.addEventListener("input", () => {
      const cpName = input.dataset.cpName;

      settings.cpRest[cpName] = Number(input.value) || 0;

      updatePlannedBaseSpeed();
    });

  });
}

// チェックポイントリストを構築する関数
function buildCheckpointList() {

  const list = [];

  waypoints.forEach(wp => {

    if (!REST_TYPES.includes(wp.type)) return;

    const planned = calcPlannedArrival(wp.routeIndex);

    let predicted = "--";
    let diff = "--";
    let color = "black";

    if (startTime) {
      const pred = calcPrediction(
        wp.routeIndex,
        currentIndex,
        latlngs,
        startTime,
        plannedDurationMs
      );

      predicted = pred.predicted;
      diff = pred.diffText;
      color = pred.color;
    }

    list.push({
      name: wp.name,
      distance: getTraveledDistance(wp.routeIndex, latlngs),
      planned,
      predicted,
      diff,
      color
    });

  });

  return list;
}

// チェックポイントリストをUIに表示する関数
function renderCheckpointList() {

  const panel = document.getElementById("cpListPanel");
  panel.innerHTML = "";

  if (!waypoints || waypoints.length === 0) {
    panel.innerHTML = "データなし";
    return;
  }

  // =========================
  // ① 計画情報ヘッダー
  // =========================
  const header = document.createElement("div");
  header.className = "cp-header";

  // スタート予定 or 実スタート
  let startText = "--";

  if (startTime) {
    // 実際のスタート後
    startText = formatClock(startTime);
  } else if (settings.startPlannedTime) {
    // 設定したスタート予定
    startText = settings.startPlannedTime;
  }

  // 休憩
  const restTotal = calcTotalRestTime();

  // 初速
  const pace = calcRequiredPace();

  header.innerHTML = `
    <div><b>■ 計画</b></div>
    <div>スタート：${startText}</div>
    <div>目標：${settings.targetHour}時間${settings.targetMin}分</div>
    <div>休憩：${restTotal}分</div>
    <div>初速：${pace ? pace.speed + "km/h" : "--"}</div>
    <hr>
  `;

  panel.appendChild(header);

  // =========================
  // ② CP / 休憩所一覧
  // =========================
  const list = waypoints.filter(wp =>
    wp.type === "CHECKPOINT" || wp.type === "REST AREA"
  );

  list.forEach(wp => {

    const div = document.createElement("div");
    div.className = "cp-item";

    const dist = getTraveledDistance(wp.routeIndex, latlngs) / 1000;
    const planned = calcPlannedArrival(wp.routeIndex);

    let predText = "";
    let diffText = "";
    let color = "black";

    if (startTime) {
      const pred = calcPrediction(
        wp.routeIndex,
        currentIndex,
        latlngs,
        startTime,
        plannedDurationMs
      );

      predText = pred.predicted;
      diffText = pred.diffText;
      color = pred.color;
    }

    div.innerHTML = `
      <div class="cp-name">${wp.name}（${dist.toFixed(1)}km）</div>
      <div class="cp-time">
        予定：${planned}
        ${startTime ? `<br>予測：${predText} <span style="color:${color}">${diffText}</span>` : ""}
      </div>
    `;

    panel.appendChild(div);
  });

  // =========================
  // ③ ゴール追加
  // =========================
  const goalIndex = latlngs.length - 1;

  const planned = calcPlannedArrival(goalIndex);

  let predText = "";
  let diffText = "";
  let color = "black";

  if (startTime) {
    const pred = calcPrediction(
      goalIndex,
      currentIndex,
      latlngs,
      startTime,
      plannedDurationMs
    );

    predText = pred.predicted;
    diffText = pred.diffText;
    color = pred.color;
  }

  const goalDiv = document.createElement("div");
  goalDiv.className = "cp-item";

  // ゴールはちょい強調
  goalDiv.style.background = "#fff3cd";
  goalDiv.style.border = "2px solid orange";

  goalDiv.innerHTML = `
    <div class="cp-name">🏁 ゴール</div>
    <div class="cp-time">
      予定：${planned}
      ${startTime ? `<br>予測：${predText} <span style="color:${color}">${diffText}</span>` : ""}
    </div>
  `;

  panel.appendChild(goalDiv);
}

// 全UI更新関数
function updateAllUI() {
  applySettingsToUI();

  const cpListPanel = document.getElementById("cpListPanel");
  const infoPanel = document.getElementById("infoPanel");

  if (cpListPanel && !cpListPanel.classList.contains("hidden")) {
    renderCheckpointList();
  }

  if (
    infoPanel &&
    !infoPanel.classList.contains("hidden") &&
    lastPosition &&
    latlngs.length > 0
  ) {
    updateCurrentPosition(lastPosition, latlngs);
  }
}

// 計画再構築関数（設定変更や休憩時間変化時に呼び出す）
function rebuildPlan(options = {}) {

  // ① 基準時間
  if (settings.startPlannedTime) {
    plannedBaseTime = getPlannedStartDate();
  }

  // ② 速度計算
  if (options.keepSpeed !== true) {
    updatePlannedBaseSpeed();
  }

  // ③ 減衰再計算
  initDecayParams();

  console.log("計画再構築完了", {
    plannedBaseTime,
    plannedBaseSpeed,
    plannedDurationMs
  });
}


// モード切替UI更新関数
function updateModeUI(clear = false) {
  const isPaceMode = settings.mode === "pace";

  const targetHourInput = document.getElementById("targetHourInput");
  const targetMinInput = document.getElementById("targetMinInput");
  const paceMinInput = document.getElementById("paceMinInput");
  const paceSecInput = document.getElementById("paceSecInput");

  targetHourInput.disabled = isPaceMode;
  targetMinInput.disabled = isPaceMode;

  paceMinInput.disabled = !isPaceMode;
  paceSecInput.disabled = !isPaceMode;

  if (clear) {
    if (isPaceMode) {
      targetHourInput.value = "";
      targetMinInput.value = "";
    } else {
      paceMinInput.value = "";
      paceSecInput.value = "";
    }
  }
}

// UI状態更新関数
function updateUIState(state) {
  const show = (id) => document.getElementById(id).classList.remove("hidden");
  const hide = (id) => document.getElementById(id).classList.add("hidden");

  // ★全部隠す（fileSelectorも含める）
  [
    "fileSelector",
    "startBtn", "updateBtn", "endBtn",
    "tagBtn", "saveBtn", "quickBtn",
    "listBtn", "configBtn", "cpListBtn",
    "elevationBtn"
  ].forEach(hide);

  if (state === "noGPX") {
    show("fileSelector");  // ←これだけでOK
  }

  if (state === "beforeStart") {
    show("startBtn");
    show("configBtn");
    show("cpListBtn");
    show("elevationBtn");
  }

  if (state === "started") {
    show("updateBtn");
    show("endBtn");
    show("tagBtn");
    show("saveBtn");
    show("quickBtn");
    show("listBtn");
    show("configBtn");
    show("cpListBtn");
    show("elevationBtn");
  }

  if (state === "finished") {
    show("saveBtn");
  }
}

// ステータスメッセージ表示関数
function showStatus(msg) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = msg;
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 2000);
}

// 記録クリア関数
function resetAllState() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  records = [];
  currentRecord = null;

  latlngs = [];
  waypoints = [];
  currentIndex = 0;
  lastPosition = null;
  selectedIndex = null;

  startTime = null;
  goalTime = null;
  endTime = null;
  plannedBaseTime = null;
  plannedBaseSpeed = null;

  isFinished = false;

  localStorage.removeItem("records");
  localStorage.removeItem("startTime");
  localStorage.removeItem("goalTime");
  localStorage.removeItem("gpxData");
  localStorage.removeItem("plannedBaseTime");

  updateUIState("noGPX");

  document.getElementById("recordPanel").classList.add("hidden");
  document.getElementById("recordPanel").innerHTML = "";
  document.getElementById("cpListPanel").classList.add("hidden");
  document.getElementById("cpListPanel").innerHTML = "";

  console.log("状態リセット完了");
}

//デバッグ用リセットボタン
function resetApp() {
  localStorage.removeItem("startTime");
  localStorage.removeItem("gpxData");
  location.reload();
}