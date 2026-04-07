const statusBox = document.getElementById("status");

// 地図初期化
const map = L.map('map').setView([35.0, 135.0], 13);

// 地図タイル
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// GPX読み込み
fetch("course.gpx")
  .then(res => res.text())
  .then(gpxText => {
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "text/xml");
    const trkpts = xml.getElementsByTagName("trkpt");

    let latlngs = [];
    for (let i = 0; i < trkpts.length; i++) {
      const lat = parseFloat(trkpts[i].getAttribute("lat"));
      const lon = parseFloat(trkpts[i].getAttribute("lon"));
      latlngs.push([lat, lon]);
    }

    const polyline = L.polyline(latlngs, { color: "blue" }).addTo(map);
    map.fitBounds(polyline.getBounds());
  })
  .catch(err => {
    statusBox.textContent = "GPX読込エラー: " + err.message;
  });

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