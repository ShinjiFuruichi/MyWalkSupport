// 現在地取得関数（モックと実際の切り替え）
let useMockLocation = false;
let mockIndex = 0;

const statusBox = document.getElementById("status");

const TAGS = {
  "場所": ["CP", "エイド", "ストア", "私設", "その他"],
  "内容": ["休憩", "トイレ", "補給", "治療", "寝る"]
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
let currentRecord = null; // 記録中

let plannedDurationMs = 22 * 60 * 60 * 1000; // 22時間
let startTime = null;
let goalTime = null;
let endTime = null;
let currentIndex = 0;
let timer = null;

let lastPosition = null;
let lastTime = null;
let restStartTime = null;

const totalDurationHours = 22; // 例
const totalDurationMs = totalDurationHours * 3600 * 1000;

// ページ読み込み時にスタート時間を削除（デバッグ用）
localStorage.removeItem("startTime");

// GPX読み込み
fetch("course.gpx")
  .then(res => res.text())
  .then(gpxText => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "text/xml");
    const trkpts = xml.getElementsByTagName("trkpt");

    latlngs = [];
    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute("lat"));
      const lon = parseFloat(trkpts[i].getAttribute("lon"));
      latlngs.push([lat, lon]);
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

    //
    const distancePoints = generateDistancePoints(latlngs, 10);
    waypoints = waypoints.concat(distancePoints);

    const trkNameTag = xml.getElementsByTagName("trk")[0]
                      ?.getElementsByTagName("name")[0];

    const courseName = trkNameTag
      ? trkNameTag.textContent
      : "NO NAME";

    console.log("コース名:", courseName);

    document.getElementById("courseName").textContent = courseName;

    const polyline = L.polyline(latlngs, { color: "blue" }).addTo(map);
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

      
      //.bindPopup(`${wp.name}<br>${wp.type}`);
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

    // 👇ここで呼ぶだけ
    updateCurrentPosition(latlngs);

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
      
      console.log("復元スタート:", startTime);

      timer = setInterval(() => {
        updateCurrentPosition(latlngs);
      }, 3000);

    } else {
      // 初期状態
      document.getElementById("startBtn").classList.remove("hidden");
      document.getElementById("updateBtn").classList.add("hidden");
      document.getElementById("endBtn").classList.add("hidden");
    }
    // ===== 地図に復元表示 =====
    const saved = localStorage.getItem("records");

    if (saved) {
      records = JSON.parse(saved);
    }

    records.forEach(r => {
      L.circleMarker([r.lat, r.lon], {
        radius: 6,
        color: "purple"
      })
      .addTo(map)
      .bindPopup(`
        ${r.tags.join(" / ")}<br>
        ${formatClock(new Date(r.startTime))} -
        ${formatClock(new Date(r.endTime))}
      `);
    });
  })
  
  .catch(err => {
    statusBox.textContent = "GPX読込エラー: " + err.message;
  });

  // ===== 保存データ読み込み =====
  const saved = localStorage.getItem("records");

  if (saved) {
    records = JSON.parse(saved);
    console.log("復元:", records);
  }

function getCurrentLocation(callback) {
  if (useMockLocation) {
    const point = latlngs[mockIndex];

    callback(point);

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

    const nearestPoint = latlngs[result.index];

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

//let currentIndex = 0;

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
    const dist = getDistanceMeters(current, latlngs[i]);

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
    total += getDistanceMeters(latlngs[i], latlngs[i + 1]);
  }

  return total; // メートル
}

function getTotalDistance(latlngs) {
  let total = 0;

  for (let i = 0; i < latlngs.length - 1; i++) {
    total += getDistanceMeters(latlngs[i], latlngs[i + 1]);
  }

  return total;
}

function getTraveledDistance(index, latlngs) {
  let total = 0;

  for (let i = 0; i < index; i++) {
    total += getDistanceMeters(latlngs[i], latlngs[i + 1]);
  }

  return total;
}
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

// スタートボタン
document.getElementById("startBtn").onclick = () => {
  startTime = new Date();
  goalTime = new Date(startTime.getTime() + plannedDurationMs);

  // ローカルストレージにスタート時間を保存
  localStorage.setItem("startTime", startTime.toISOString());
  localStorage.setItem("goalTime", goalTime.toISOString());

  document.getElementById("startBtn").classList.add("hidden");
  document.getElementById("updateBtn").classList.remove("hidden");
  document.getElementById("endBtn").classList.remove("hidden");
  document.getElementById("tagBtn").classList.remove("hidden");

  updateCurrentPosition(latlngs);

  // 3秒ごとに位置自動更新
  timer = setInterval(() => {
    updateCurrentPosition(latlngs);
  }, 3000);
};

// 終了ボタン
document.getElementById("endBtn").onclick = () => {
  endTime = new Date();

  clearInterval(timer);

  // ローカルストレージからスタート時間を削除
  localStorage.removeItem("startTime");

  const totalTimeMs = endTime - startTime;
  const traveled = getTraveledDistance(currentIndex, latlngs);

  document.getElementById("result").textContent =
    `総時間: ${formatTime(totalTimeMs)} / 総距離: ${(traveled/1000).toFixed(2)} km`;

  console.log("終了:", endTime);
};

// 更新ボタン
document.getElementById("updateBtn").onclick = () => {
  const panel = document.getElementById("infoPanel");

  // 常に開く
  panel.classList.remove("hidden");

  // 情報更新
  updateCurrentPosition(latlngs);
};

// タグ追加ボタン
document.getElementById("tagBtn").onclick = () => {

  const now = new Date();

  // ▶ 記録開始
  if (!currentRecord) {

    if (!lastPosition) {
      alert("位置取得中");
      return;
    }

    currentRecord = {
      lat: lastPosition[0],
      lon: lastPosition[1],
      startTime: now.toISOString(),
      endTime: null,
      tags: []
    };

    // UI
    const statusEl = document.getElementById("status");
    statusEl.textContent = "● 停止中";
    statusEl.style.opacity = 1;
    
    //document.getElementById("infoPanel").classList.remove("hidden");
    document.getElementById("tagPanel").classList.remove("hidden");

    console.log("記録開始:", currentRecord);

  }

  // ▶ 記録終了
  else {

    currentRecord.endTime = now.toISOString();

    records.push(currentRecord);
    localStorage.setItem("records", JSON.stringify(records));
    downloadJSON();

    console.log("記録保存:", currentRecord);

    // 地図にマーカー（開始位置）
    L.circleMarker([currentRecord.lat, currentRecord.lon], {
      radius: 6,
      color: "purple"
    })
    .addTo(map)
    .bindPopup(`
      ${currentRecord.tags.join(",")}<br>
      ${formatClock(new Date(currentRecord.startTime))} - 
      ${formatClock(new Date(currentRecord.endTime))}
    `);
    resetTagUI();

    // リセット
    currentRecord = null;

    // UI
    const statusEl = document.getElementById("status");
    statusEl.textContent = "✔ 記録保存";
    statusEl.style.opacity = 1;

    setTimeout(() => {
      statusEl.style.opacity = 0;
    }, 2000);
  }
};

function resetTagUI() {
  document.querySelectorAll("#tagPanel button")
    .forEach(btn => btn.classList.remove("selected"));

  document.getElementById("tagPanel").classList.add("hidden");
}

/*
// タグ選択（複数選べるバージョン）
document.querySelectorAll("#tagPanel button").forEach(btn => {
  btn.onclick = () => {

    if (!currentRecord) return;

    const label = btn.dataset.type;

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

    console.log("タグ:", currentRecord.tags);
  };
});
*/

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

document.getElementById("closeTag").onclick = () => {
  document.getElementById("tagPanel").classList.add("hidden");
};

// データ保存（JSONダウンロード）
//document.getElementById("saveBtn").onclick = downloadJSON;
//
document.getElementById("clearBtn").onclick = clearRecords;

createTagUI();

document.getElementById("infoPanel").onclick = () => {
  document.getElementById("infoPanel").classList.add("hidden");

  // ここで保存処理（必要なら）
};
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
    const d = getDistanceMeters(latlngs[i], latlngs[i + 1]);

    if (accumulated + d >= nextTarget) {
      points.push({
        lat: latlngs[i][0],
        lon: latlngs[i][1],
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
function downloadJSON() {
  if (records.length === 0) return;

  const data = JSON.stringify(records, null, 2);

  const blob = new Blob([data], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;

  // 👇 固定ファイル名（上書き狙い）
  a.download = "walk_record.json";

  a.click();

  URL.revokeObjectURL(url);
}

function clearRecords() {
  if (!confirm("記録をすべて削除しますか？")) return;

  localStorage.removeItem("records");
  location.reload();
}

//デバッグ用リセットボタン
function resetApp() {
  localStorage.removeItem("startTime");
  location.reload();
}