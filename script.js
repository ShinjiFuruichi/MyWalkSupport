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

    // ルート描画
    const polyline = L.polyline(latlngs, { color: "blue" }).addTo(map);

    // 表示範囲調整
    map.fitBounds(polyline.getBounds());
  });