//alert("JS読み込まれた！");
//仮の現在地
const fixedCurrent = [33.01889, 129.94164];
//const fixedCurrent = [32.8297, 130.16996];

const statusBox = document.getElementById("status");

// 地図初期化
const map = L.map('map').setView([35.0, 135.0], 13);

// 地図タイル
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// GPX読み込み
let latlngs = []; // GPXの配列をグローバル化
let waypoints = []; // ウェイポイントの配列をグローバル化

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

      waypoints.push({
        lat,
        lon,
        type,
        name
      });
    }

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

      L.circleMarker([wp.lat, wp.lon], {
        radius: 6,
        color: color
      })
      .addTo(map)
      .bindPopup(`${wp.name}<br>${wp.type}`);
    });

    // 1秒ごとに進む
    //setInterval(simulatePosition, 1000);
    // 👇ここで呼ぶだけ
    updateCurrentPosition(latlngs);

  })
  .catch(err => {
    statusBox.textContent = "GPX読込エラー: " + err.message;
  });

/*
// 現在地表示
if (!navigator.geolocation) {
  statusBox.textContent = "このブラウザは位置情報非対応";
} else {
  statusBox.textContent = "位置情報を取得中...";

  navigator.geolocation.watchPosition(
    position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      const currentLatLng = [lat, lon];

      statusBox.textContent = `現在地OK: ${lat.toFixed(5)}, ${lon.toFixed(5)}`;

      if (window.currentMarker) {
        window.currentMarker.setLatLng(currentLatLng);
      } else {
        window.currentMarker = L.circleMarker(currentLatLng, {
          radius: 8,
          color: "red"
        }).addTo(map);
      }

      map.setView(currentLatLng, 15);
    },
    error => {
      statusBox.textContent =
        `位置情報エラー: code=${error.code} message=${error.message}`;
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}
*/
// 現在地取得関数（モックと実際の切り替え）
let useMockLocation = true;

function getCurrentLocation(callback) {
  if (useMockLocation) {
    callback([33.01889, 129.94164]);
  } else {
    navigator.geolocation.getCurrentPosition(pos => {
      callback([
        pos.coords.latitude,
        pos.coords.longitude
      ]);
    });
  }
}

function updateCurrentPosition(latlngs) {
  getCurrentLocation(current => {
    // 最寄り点を先に取得
    const result = findNearestIndex(current, latlngs);

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
    console.log("進捗(%):", percent.toFixed(1));

    console.log("残距離(km):", (remaining / 1000).toFixed(2));
    console.log("進んだ距離(km):", (traveled / 1000).toFixed(2));

    const nextWP = findNextWaypoint(result.index, latlngs, waypoints);

    if (nextWP) {
      const dist = getRemainingDistance(result.index, latlngs)
                - getRemainingDistance(nextWP.routeIndex, latlngs);

      console.log(`次の目的地: ${nextWP.name} (${nextWP.type})`);
      console.log(`距離: ${(dist / 1000).toFixed(2)} km`);
    }

    document.getElementById("progress").textContent =
      `進捗: ${percent.toFixed(1)}%`;

    document.getElementById("remaining").textContent =
      `残り: ${(remaining / 1000).toFixed(2)} km`;

    if (nextWP) {
      const dist = getRemainingDistance(result.index, latlngs)
                - getRemainingDistance(nextWP.routeIndex, latlngs);

      document.getElementById("next").textContent =
        `次: ${nextWP.name} (${nextWP.type}) / ${(dist / 1000).toFixed(2)} km`;
    }
    
    const speedKmh = 5; // 仮

    const distToNext = getRemainingDistance(result.index, latlngs)
                    - getRemainingDistance(nextWP.routeIndex, latlngs);

    const hoursToNext = (distToNext / 1000) / speedKmh;

    const now = new Date();
    const arrivalNext = new Date(now.getTime() + hoursToNext * 3600 * 1000);

    document.getElementById("next").textContent =
      `次: ${nextWP.name} / ${(distToNext / 1000).toFixed(2)} km / 到着: ${arrivalNext.toLocaleTimeString()}`;
  
  });
}

let currentIndex = 0;

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