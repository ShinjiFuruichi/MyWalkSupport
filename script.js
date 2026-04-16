//
// ===== 初期化 =====
//

// 現在地取得関数（モックと実際の切り替え）
//let useMockLocation = false; // スマホ実地モード
let useMockLocation = true; // PCモックモード
let TargetHour = 22; // 目標時間（例: 22時間）
let targetMin = 0;   // 目標分（例: 0分）
let ContourInterval = 100

const statusBox = document.getElementById("status");

const TAGS = {
  "場所": ["CP", "エイド", "ストア", "私設", "その他"],
  "内容": ["休憩", "トイレ", "補給", "治療", "寝る", "支援"]
};

// 地図初期化
const map = L.map('map').setView([35.0, 135.0], 13);

// 地図タイル
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// グローバル変数
let latlngs = []; // GPXの配列をグローバル化
let waypoints = []; // ウェイポイントの配列をグローバル化
let records = [];      // 保存済み記録
let currentRecord = null; // 現在記録中のもの

let plannedDurationMs = TargetHour * 60 * 60 * 1000; // 予定時間（例: 22時間）
let startTime = null; // スタート時間
let goalTime = null;  // ゴール予定時間
let endTime = null;   // 終了時間
let currentIndex = 0; // 現在のインデックス
let timer = null;     // 位置自動更新用タイマー

let lastPosition = null; // 最後の位置
let lastTime = null;     // 最後の時間
let restStartTime = null; // 休憩開始時間

let mockIndex = 0; // モック位置のインデックス

const totalDurationHours = TargetHour; // 例
const totalDurationMs = totalDurationHours * 3600 * 1000;


//
// ===== データ読み込み、解析、復元 =====
//

// ページ読み込み時にスタート時間を削除（デバッグ用）
if (useMockLocation) {
  localStorage.removeItem("startTime");
  localStorage.removeItem("goalTime");
}

const savedHour = localStorage.getItem("targetHour");
const savedMin = localStorage.getItem("targetMin");


if (savedHour) {
  document.getElementById("targetHourInput").value = savedHour;
}
if (savedMin) {
  document.getElementById("targetMinInput").value = savedMin;
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

    loadGPX(gpxText);
    document.getElementById("fileSelector").style.display = "none";
    document.getElementById("setupPanel").style.display = "flex";
  };

  reader.readAsText(file);
});

//
document.getElementById("startSetupBtn").onclick = () => {
  const hour = Number(document.getElementById("targetHourInput").value)|| 0;
  const min = Number(document.getElementById("targetMinInput").value)|| 0;

  if (hour < 0 || min < 0) {
    alert("正しい時間を入力してね");
    return;
  }

  const totalHour = hour + (min / 60);

  plannedDurationMs = totalHour * 60 * 60 * 1000;

  // 表示
  document.getElementById("targetDisplay").textContent =
    `設定：${hour}時間 ${min}分`;
  document.getElementById("targetDisplay").classList.remove("hidden");

  // 保存
  localStorage.setItem("targetHour", hour);
  localStorage.setItem("targetMin", min);

  document.getElementById("setupPanel").style.display = "none";
};

// ===== 保存データ読み込み =====
loadRecords();
document.getElementById("setupPanel").style.display = "none";

//
// ===== イベント =====
//

// スタートボタン
document.getElementById("startBtn").onclick = () => {
  startTime = new Date();
  goalTime = new Date(startTime.getTime() + plannedDurationMs);

  // ローカルストレージにスタート時間を保存
  localStorage.setItem("startTime", startTime.toISOString());
  localStorage.setItem("goalTime", goalTime.toISOString())
  
  document.getElementById("startBtn").classList.add("hidden");
  document.getElementById("saveBtn").classList.remove("hidden");
  document.getElementById("updateBtn").classList.remove("hidden");
  document.getElementById("endBtn").classList.remove("hidden");
  document.getElementById("tagBtn").classList.remove("hidden");
  document.getElementById("quickBtn").classList.remove("hidden");
  document.getElementById("listBtn").classList.remove("hidden");

  updateCurrentPosition(latlngs);

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

  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // ローカルストレージからスタート時間を削除
  localStorage.removeItem("startTime");

  const totalTimeMs = endTime - startTime;
  const traveled = getTraveledDistance(currentIndex, latlngs);

  document.getElementById("result").textContent =
    `総時間: ${formatTime(totalTimeMs)} / 総距離: ${(traveled/1000).toFixed(2)} km`;
  
  if (records.length > 0) {
    downloadJSON(true);
  }


  console.log("終了:", endTime);
};

// 更新ボタン
document.getElementById("updateBtn").onclick = () => {
  const panel = document.getElementById("infoPanel");

  panel.classList.remove("hidden");

  // 情報更新
  refreshPositionAndUI();
};

//
document.getElementById("saveBtn").onclick = () => {
  downloadJSON(false);

  const statusEl = document.getElementById("status");
  statusEl.textContent = "💾 保存しました";
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 2000);
};

// 標高グラフ表示トグル
document.getElementById("elevationBtn").onclick = () => {
  document.getElementById("elevationContainer")
    .classList.toggle("hidden");

  const elevations = getElevations(latlngs);
  drawElevation(elevations, currentIndex);
};

// タグ追加ボタン
document.getElementById("tagBtn").onclick = () => {

  refreshPositionAndUI();

  if (!lastPosition) {
    alert("位置取得中");
    return;
  }

  // タグ初期化
  currentRecord = {
    tags: []
  };

  document.getElementById("infoPanel").classList.add("hidden");
  document.getElementById("tagPanel").classList.remove("hidden");
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

// クイック記録ボタン
document.getElementById("quickBtn").onclick = () => {

  refreshPositionAndUI();

  if (!lastPosition) {
    alert("位置取得中");
    return;
  }

  const record = buildRecord([]);
  if (!record) return;
  record.id = Date.now();
  records.push(record);

  localStorage.setItem("records", JSON.stringify(records));

  const statusEl = document.getElementById("status");
  statusEl.textContent = "✔ 記録";
  statusEl.style.opacity = 1;

  setTimeout(() => {
    statusEl.style.opacity = 0;
  }, 1500);

  const recordPanel = document.getElementById("recordPanel");
  if (!recordPanel.classList.contains("hidden")) {
    renderRecordList();
  }

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
  records = [];
  localStorage.removeItem("records");

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

      if (!startTime) return `${wp.name}`;

      const now = new Date();

      // 予定
      const distFromStart = getTraveledDistance(wp.routeIndex, latlngs);
      const totalDistance = getTotalDistance(latlngs);
      const plannedSpeed = totalDistance / (plannedDurationMs / 1000);

      const plannedArrival = new Date(
        startTime.getTime() + (distFromStart / plannedSpeed) * 1000
      );

      // 予測
      const traveled = getTraveledDistance(currentIndex, latlngs);
      const elapsedSec = (now - startTime) / 1000;

      let predictedArrival = null;
      let diffText = "-";
      let color = "black";

      if (elapsedSec > 0 && traveled > 0) {
        const currentSpeed = traveled / elapsedSec;

        const distToPoint =
          getRemainingDistance(currentIndex, latlngs) -
          getRemainingDistance(wp.routeIndex, latlngs);

        predictedArrival = new Date(
          now.getTime() + (distToPoint / currentSpeed) * 1000
        );

        const diffMs = predictedArrival - plannedArrival;
        color = diffMs > 0 ? "red" : "blue";
        diffText = formatDiff(diffMs);
      }

      return `
        ${wp.name}（${(distFromStart / 1000).toFixed(1)} km）<br>
        予測：${predictedArrival ? formatClock(predictedArrival) : "--"}<br>
        差分：<span style="color:${color}">${diffText}</span>
      `;
    });

  });

  // 最初の位置とUI更新
  updateCurrentPosition(latlngs);
  document.getElementById("startBtn").classList.remove("hidden");
  document.getElementById("elevationBtn").classList.remove("hidden");

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

    const slope = getSlopePercent(safeIndex, latlngs);
    const ele = latlngs[safeIndex].ele;
    showSlopePopup(e.clientX, e.clientY, slope, ele);
  });

  // 標高グラフ描画
  const elevations = getElevations(latlngs);
  drawElevation(elevations, 0);

  // ページ読み込み時にスタート時間が保存されていれば復元
  const savedStart = localStorage.getItem("startTime");

  if (savedStart) {
    startTime = new Date(savedStart);

    // スタートは隠す
    document.getElementById("startBtn").classList.add("hidden");

    // 更新・終了は表示
    document.getElementById("updateBtn").classList.remove("hidden");
    document.getElementById("endBtn").classList.remove("hidden");
    document.getElementById("tagBtn").classList.remove("hidden");
    document.getElementById("quickBtn").classList.remove("hidden");
    document.getElementById("saveBtn").classList.remove("hidden");
    document.getElementById("listBtn").classList.remove("hidden");

    console.log("復元スタート:", startTime);

    if (useMockLocation) {
      timer = setInterval(() => {
        refreshPositionAndUI();
      }, 3000);
    }

  } else {
    // 初期状態
    document.getElementById("updateBtn").classList.add("hidden");
    document.getElementById("endBtn").classList.add("hidden");
  }

}

// 現在地取得関数
function getCurrentLocation(callback) {
  if (useMockLocation) {
    const point = latlngs[mockIndex];

    callback([point.lat, point.lon]);

    mockIndex += 5; // ←スピード調整

    if (mockIndex >= latlngs.length) {
      mockIndex = latlngs.length - 1;
    }

  } else {
    navigator.geolocation.getCurrentPosition(
      pos => {
        callback([
          pos.coords.latitude,
          pos.coords.longitude
        ]);
      },
      err => {
        console.error("位置情報エラー:", err);
      }
    );
  }
}

// 位置とUIを更新する関数
function updateCurrentPosition(latlngs) {
  getCurrentLocation(current => {
    const now = new Date();

    let speedKmh = 0;

    if (lastPosition && lastTime) {
      const dist = getDistanceMeters(lastPosition, current); // m
      const dt = (now - lastTime) / 1000; // 秒

      if (dt > 0) {
        const speedMs = dist / dt;
        speedKmh = speedMs * 3.6;
      }
    }

    // 更新
    lastPosition = current;
    lastTime = now;

    console.log("速度(km/h):", speedKmh.toFixed(2));

    console.log("現在地:", current);
    // 最寄り点を先に取得
    const result = findNearestIndex(current, latlngs);
    currentIndex = result.index;

    const nearestPoint = [
      latlngs[result.index].lat,
      latlngs[result.index].lon
    ];

    // 標高グラフ更新
    const elevations = getElevations(latlngs);
    drawElevation(elevations, currentIndex);

    // 緑（現在地）
    if (window.currentMarker) {
      window.currentMarker.setLatLng(current);
    } else {
      window.currentMarker = L.circleMarker(current, {
        radius: 8,
        color: "green"
      }).addTo(map);
    }

    map.setView(current, 15);

    // 黄（最寄り点）
    if (window.nearestMarker) {
      window.nearestMarker.setLatLng(nearestPoint);
    } else {
      window.nearestMarker = L.circleMarker(nearestPoint, {
        radius: 6,
        color: "yellow"
      }).addTo(map);
    }

    // 線（ズレ）
    if (window.snapLine) {
      window.snapLine.setLatLngs([current, nearestPoint]);
    } else {
      window.snapLine = L.polyline([current, nearestPoint], {
        color: "orange",
        dashArray: "5,5"
      }).addTo(map);
    }

    console.log("ズレ(m):", result.distance);
    console.log("最寄りindex:", result.index);
  
        // 残距離
    const remaining = getRemainingDistance(result.index, latlngs);
    console.log("残距離(m):", remaining);

    const total = getTotalDistance(latlngs);
    const traveled = getTraveledDistance(result.index, latlngs);
    const percent = (traveled / total) * 100;

    // 表示更新
    document.getElementById("progress").textContent =
      `進捗：${(traveled / 1000).toFixed(2)} km（${percent.toFixed(1)}%）`;
    document.getElementById("remaining").textContent =
      `残り：${(remaining / 1000).toFixed(2)} km`;

    console.log("進捗(%):", percent.toFixed(1));
    console.log("残距離(km):", (remaining / 1000).toFixed(2));
    console.log("進んだ距離(km):", (traveled / 1000).toFixed(2));

    // 次のチェックポイントと途中の目的地を取得
    const { nextStop, nextCP } = getNextTargets(
      result.index,
      latlngs,
      waypoints
    );
    //
    const nextDistancePoint = findNextDistancePoint(result.index, waypoints);

    // 表示用テキスト
    let text = "";

    // 🔵 途中の目的地あり
    if (nextStop) {
      const distStop =
        getRemainingDistance(result.index, latlngs) -
        getRemainingDistance(nextStop.routeIndex, latlngs);
      const distFromStart = getTraveledDistance(nextStop.routeIndex, latlngs);

      text += `<span class="next-stop">次：${nextStop.name}
      （${(distFromStart / 1000).toFixed(1)} km）</span><br>`;
      text += `距離：${(distStop / 1000).toFixed(2)} km<br>`;

      // 予測
      const pred = calcPrediction(nextStop.routeIndex, result.index, latlngs, startTime, plannedDurationMs);
      text += `予測：${pred.predicted}（<span style="color:${pred.color}">${pred.diffText}</span>）<br>`;
    }

    // 🔴 次のCP
    if (nextCP) {
      const distCP =
        getRemainingDistance(result.index, latlngs) -
        getRemainingDistance(nextCP.routeIndex, latlngs);
      const distFromStart = getTraveledDistance(nextCP.routeIndex, latlngs);

      text += `<span class="next-cp">次CP：${nextCP.name}
      （${(distFromStart / 1000).toFixed(1)} km）</span><br>`;
      text += `距離：${(distCP / 1000).toFixed(2)} km<br>`;

      // 予測
      const pred = calcPrediction(nextCP.routeIndex, result.index, latlngs, startTime, plannedDurationMs);
      text += `予測：${pred.predicted}（<span style="color:${pred.color}">${pred.diffText}</span>）<br>`;
    }

    if (nextDistancePoint) {
      const dist =
        getRemainingDistance(result.index, latlngs) -
        getRemainingDistance(nextDistancePoint.routeIndex, latlngs);

      text += `<span class="next-kp">キロP：${nextDistancePoint.name}</span><br>`;
      text += `距離：${(dist / 1000).toFixed(2)} km<br>`;

      // 予測
      const pred = calcPrediction(nextDistancePoint.routeIndex, result.index, latlngs, startTime, plannedDurationMs);
      text += `予測：${pred.predicted}（<span style="color:${pred.color}">${pred.diffText}</span>）<br>`;
    }

    // 表示
    document.getElementById("next").innerHTML = text;

    if (startTime) {
      const now = new Date();

      // =========================
      // ⏱ 時間表示
      // =========================
      const elapsedMs = now - startTime;

      const nowText = formatClock(now);
      const startText = formatClock(startTime);

      document.getElementById("timeInfo").innerHTML =
        `現在：${nowText}（開始：${startText}）<br>
        経過：${formatDuration(elapsedMs)}`;

      // =========================
      // 📊 ゴール（予定・予測・差分）
      // =========================
      const traveled = getTraveledDistance(result.index, latlngs);
      const elapsedSec = elapsedMs / 1000;

      if (elapsedSec > 0 && traveled > 0) {

        // 🟩 予測（現在ペース）
        const currentSpeed = traveled / elapsedSec;
        const remaining = getRemainingDistance(result.index, latlngs);

        const secToGoal = remaining / currentSpeed;
        const predictedArrival = new Date(now.getTime() + secToGoal * 1000);

        // 🟦 予定（固定）
        const plannedArrival = goalTime;

        // 🟥 差分
        const diffMs = predictedArrival - plannedArrival;
        const color = diffMs > 0 ? "red" : "blue";

        document.getElementById("result").innerHTML =
          `ゴール<br>
          予測：${formatClock(predictedArrival)}
          （<span style="color:${color}">${formatDiff(diffMs)}</span>）`;
      }
    }

  });
}

// 位置とUIを更新する関数
function refreshPositionAndUI() {
  updateCurrentPosition(latlngs);

  // 必要ならここでパネル更新
  // updateInfoPanel();
}

//let currentIndex = 0;

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

  const step = ContourInterval; // 100mごと

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

  // 現在速度
  const speed = traveled / elapsedSec;

  // 残距離
  const distToTarget =
    getRemainingDistance(currentIndex, latlngs) -
    getRemainingDistance(targetRouteIndex, latlngs);

  // 予測到着
  const sec = distToTarget / speed;
  const arrival = new Date(now.getTime() + sec * 1000);

  // 予定到着
  const plannedDist = getTraveledDistance(targetRouteIndex, latlngs);
  const totalDist = getTotalDistance(latlngs);
  const plannedSpeed = totalDist / (plannedDurationMs / 1000);

  const plannedArrival = new Date(
    startTime.getTime() + (plannedDist / plannedSpeed) * 1000
  );

  // 差分
  const diffMs = arrival - plannedArrival;

  return {
    predicted: formatClock(arrival),
    diffText: formatDiff(diffMs),
    color: diffMs > 0 ? "red" : "blue"
  };
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

  records.forEach(r => {

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

// 記録クリア関数
function resetAllState() {

  // データ
  records = [];
  currentRecord = null;

  // 時間
  startTime = null;
  goalTime = null;
  endTime = null;

  // ローカルストレージ
  localStorage.removeItem("records");
  localStorage.removeItem("startTime");
  localStorage.removeItem("goalTime");

  // UI（ボタン状態）
  document.getElementById("startBtn").classList.remove("hidden");
  document.getElementById("updateBtn").classList.add("hidden");
  document.getElementById("endBtn").classList.add("hidden");
  document.getElementById("tagBtn").classList.add("hidden");
  document.getElementById("quickBtn").classList.add("hidden");
  document.getElementById("saveBtn").classList.add("hidden");
  document.getElementById("elevationBtn").classList.add("hidden");
  document.getElementById("targetDisplay").classList.add("hidden");
  document.getElementById("listBtn").classList.add("hidden");
  document.getElementById("recordPanel").classList.add("hidden");
  document.getElementById("recordPanel").innerHTML = "";

  console.log("状態リセット完了");
}

//デバッグ用リセットボタン
function resetApp() {
  localStorage.removeItem("startTime");
  location.reload();
}