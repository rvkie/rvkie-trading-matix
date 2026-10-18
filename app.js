/* ============================================================
   RTM (Rvkie Trading Matix) — Otak aplikasi
   Tahap 2: grafik candlestick realtime, harga asli BTC-USD
   Sumber utama: Coinbase  -> cadangan: Binance -> simulasi
   ------------------------------------------------------------
   Cara kerja singkat (untuk dibaca pemula):
   - "Candle" = satu batang grafik berisi harga pembukaan,
     tertinggi, terendah, dan penutupan dalam satu periode.
   - Aplikasi mengambil ratusan candle terakhir dari internet,
     menggambarnya di kanvas, lalu memperbarui candle yang
     sedang berjalan setiap 3 detik.
   - Mode demo penuh: tidak ada uang asli yang dipakai.
   ============================================================ */


/* ================= PENGATURAN DASAR ================= */

var CONFIG = {
  jumlahCandle: 200,        // berapa candle terakhir yang diambil
  intervalAmbilMs: 3000,    // jarak pembaruan harga (3 detik)
  timeframe: 60             // 60 = 1 menit, 300 = 5 menit (detik)
};

// Daftar sumber data, dicoba berurutan sampai ada yang berhasil
var SUMBER = [
  {
    nama: "Coinbase",
    pasangan: "BTC-USD",
    urlCandle: function (tf) {
      return "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=" + tf;
    },
    // Jawaban Coinbase: [waktu, terendah, tertinggi, buka, tutup, volume]
    uraikanCandle: function (mentah) {
      return mentah.map(function (b) {
        return { waktu: b[0], buka: b[3], tinggi: b[2], rendah: b[1], tutup: b[4] };
      });
    },
    urlHarga: function () {
      return "https://api.exchange.coinbase.com/products/BTC-USD/ticker";
    },
    uraikanHarga: function (mentah) {
      return parseFloat(mentah.price);
    }
  },
  {
    nama: "Binance",
    pasangan: "BTCUSDT",
    urlCandle: function (tf) {
      var kode = tf === 300 ? "5m" : "1m";
      return "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=" + kode + "&limit=" + CONFIG.jumlahCandle;
    },
    // Jawaban Binance: [waktu(ms), buka, tinggi, rendah, tutup, ...]
    uraikanCandle: function (mentah) {
      return mentah.map(function (b) {
        return {
          waktu: Math.floor(b[0] / 1000),
          buka: parseFloat(b[1]),
          tinggi: parseFloat(b[2]),
          rendah: parseFloat(b[3]),
          tutup: parseFloat(b[4])
        };
      });
    },
    urlHarga: function () {
      return "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT";
    },
    uraikanHarga: function (mentah) {
      return parseFloat(mentah.price);
    }
  }
];


/* ================= KEADAAN APLIKASI ================= */

var candles = [];            // daftar candle yang ditampilkan
var hargaTerakhir = null;    // harga pasar terbaru
var sumberAktif = null;      // objek sumber yang sedang dipakai
var modeSimulasi = false;    // true jika semua sumber gagal
var hargaSimulasi = 81000;   // titik awal harga simulasi
var pewaktu = null;          // penanda interval pembaruan


/* ================= ALAT BANTU ================= */

function el(id) {
  return document.getElementById(id);
}

// Ubah angka jadi teks rapi: 81164.5 -> "81,164.50"
function formatHarga(angka) {
  return angka.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Atur lencana status di pojok kanan atas
function setStatus(teks, kelas) {
  var s = el("status-koneksi");
  s.textContent = teks;
  s.className = "status " + kelas;
}


/* ================= MENGAMBIL DATA ================= */

// Ambil candle awal dari sumber nomor urut (0 = Coinbase, 1 = Binance)
function ambilCandleAwal(nomorSumber) {
  if (nomorSumber >= SUMBER.length) {
    mulaiSimulasi();
    return;
  }

  var sumber = SUMBER[nomorSumber];

  fetch(sumber.urlCandle(CONFIG.timeframe))
    .then(function (jawaban) {
      if (!jawaban.ok) { throw new Error("HTTP " + jawaban.status); }
      return jawaban.json();
    })
    .then(function (mentah) {
      var daftar = sumber.uraikanCandle(mentah);
      daftar.sort(function (a, b) { return a.waktu - b.waktu; }); // urut lama -> baru
      candles = daftar;
      sumberAktif = sumber;
      modeSimulasi = false;
      hargaTerakhir = daftar[daftar.length - 1].tutup;
      setStatus(sumber.nama + " • live", "status-live");
      gambarGrafik();
      mulaiPembaruan();
    })
    .catch(function () {
      // Sumber ini gagal, coba sumber berikutnya
      setStatus("mencoba sumber lain…", "status-muat");
      ambilCandleAwal(nomorSumber + 1);
    });
}

// Ambil harga terbaru dan perbarui candle yang sedang berjalan
function perbaruiHarga() {
  if (modeSimulasi) {
    perbaruiHargaSimulasi();
    return;
  }

  fetch(sumberAktif.urlHarga())
    .then(function (jawaban) {
      if (!jawaban.ok) { throw new Error("HTTP " + jawaban.status); }
      return jawaban.json();
    })
    .then(function (mentah) {
      hargaTerakhir = sumberAktif.uraikanHarga(mentah);
      setStatus(sumberAktif.nama + " • live", "status-live");
      tanamHargaKeCandle(hargaTerakhir);
      gambarGrafik();
    })
    .catch(function () {
      setStatus("koneksi terganggu", "status-gagal");
    });
}

// Masukkan harga terbaru ke candle periode sekarang
function tanamHargaKeCandle(harga) {
  if (candles.length === 0) { return; }

  var tf = CONFIG.timeframe;
  var waktuSekarang = Math.floor(Date.now() / 1000 / tf) * tf; // awal periode
  var candleTerakhir = candles[candles.length - 1];

  if (candleTerakhir.waktu < waktuSekarang) {
    // Periode baru dimulai -> buat candle baru
    candles.push({
      waktu: waktuSekarang,
      buka: candleTerakhir.tutup,
      tinggi: harga,
      rendah: harga,
      tutup: harga
    });
    if (candles.length > CONFIG.jumlahCandle) {
      candles.shift(); // buang candle paling tua
    }
  } else {
    // Masih periode yang sama -> perbarui candle berjalan
    candleTerakhir.tutup = harga;
    if (harga > candleTerakhir.tinggi) { candleTerakhir.tinggi = harga; }
    if (harga < candleTerakhir.rendah) { candleTerakhir.rendah = harga; }
  }
}


/* ================= MODE SIMULASI (CADANGAN TERAKHIR) ================= */

function mulaiSimulasi() {
  modeSimulasi = true;
  sumberAktif = null;
  setStatus("mode simulasi (offline)", "status-muat");

  // Bangun riwayat candle palsu yang tetap terlihat wajar
  candles = [];
  var tf = CONFIG.timeframe;
  var waktuSekarang = Math.floor(Date.now() / 1000 / tf) * tf;

  for (var i = CONFIG.jumlahCandle; i >= 1; i--) {
    var buka = hargaSimulasi;
    gerakkanHargaSimulasi();
    candles.push({
      waktu: waktuSekarang - i * tf,
      buka: buka,
      tinggi: Math.max(buka, hargaSimulasi) + Math.random() * 20,
      rendah: Math.min(buka, hargaSimulasi) - Math.random() * 20,
      tutup: hargaSimulasi
    });
  }
  hargaTerakhir = hargaSimulasi;
  gambarGrafik();
  mulaiPembaruan();
}

// Gerak acak kecil supaya grafik simulasi tampak hidup
function gerakkanHargaSimulasi() {
  var arah = Math.random() < 0.5 ? -1 : 1;
  var besar = Math.random() * 40;
  hargaSimulasi = Math.max(1000, hargaSimulasi + arah * besar);
}

function perbaruiHargaSimulasi() {
  gerakkanHargaSimulasi();
  hargaTerakhir = hargaSimulasi;
  tanamHargaKeCandle(hargaTerakhir);
  gambarGrafik();
}


/* ================= MENGGAMBAR GRAFIK ================= */

function gambarGrafik() {
  var kanvas = el("grafik");
  var kotak = kanvas.parentElement;
  var lebar = kotak.clientWidth;
  var tinggi = kotak.clientHeight;

  // Sesuaikan ketajaman dengan layar (HP layar tajam butuh skala)
  var skala = window.devicePixelRatio || 1;
  kanvas.width = lebar * skala;
  kanvas.height = tinggi * skala;

  var ctx = kanvas.getContext("2d");
  ctx.setTransform(skala, 0, 0, skala, 0, 0);

  // Latar
  ctx.fillStyle = "#131927";
  ctx.fillRect(0, 0, lebar, tinggi);

  if (candles.length === 0) { return; }

  var padAtas = 14;
  var padBawah = 24;   // ruang untuk label jam
  var padKanan = 62;   // ruang untuk label harga
  var lebarArea = lebar - padKanan;
  var tinggiArea = tinggi - padAtas - padBawah;

  var jumlah = candles.length;
  var slot = lebarArea / jumlah;                 // ruang per candle
  var lebarBadan = Math.max(2, Math.floor(slot * 0.6));

  // Cari harga tertinggi & terendah yang terlihat
  var min = Infinity;
  var max = -Infinity;
  for (var i = 0; i < jumlah; i++) {
    if (candles[i].rendah < min) { min = candles[i].rendah; }
    if (candles[i].tinggi > max) { max = candles[i].tinggi; }
  }
  var rentang = (max - min) || 1;
  min -= rentang * 0.05;   // beri napas atas-bawah
  max += rentang * 0.05;
  rentang = max - min;

  // Ubah harga menjadi posisi vertikal (semakin mahal, semakin ke atas)
  function yDariHarga(harga) {
    return padAtas + (1 - (harga - min) / rentang) * tinggiArea;
  }

  // Garis-garis kisi mendatar + label harga di kanan
  ctx.font = "11px Arial";
  ctx.textBaseline = "middle";
  var jumlahGaris = 5;
  for (var g = 0; g <= jumlahGaris; g++) {
    var hargaGaris = min + (rentang * g / jumlahGaris);
    var yGaris = yDariHarga(hargaGaris);

    ctx.strokeStyle = "#242e45";
    ctx.beginPath();
    ctx.moveTo(0, yGaris);
    ctx.lineTo(lebarArea, yGaris);
    ctx.stroke();

    ctx.fillStyle = "#9aa4b8";
    ctx.textAlign = "left";
    ctx.fillText(formatHarga(hargaGaris), lebarArea + 6, yGaris);
  }

  // Gambar tiap candle
  for (var c = 0; c < jumlah; c++) {
    var cd = candles[c];
    var x = Math.floor(c * slot + slot / 2);
    var naik = cd.tutup >= cd.buka;
    var warna = naik ? "#2ebd85" : "#f6465d";

    // Sumbu (garis tipis tertinggi-terendah)
    ctx.strokeStyle = warna;
    ctx.beginPath();
    ctx.moveTo(x, yDariHarga(cd.tinggi));
    ctx.lineTo(x, yDariHarga(cd.rendah));
    ctx.stroke();

    // Badan (kotak buka-tutup)
    var yBuka = yDariHarga(cd.buka);
    var yTutup = yDariHarga(cd.tutup);
    var yAtas = Math.min(yBuka, yTutup);
    var tinggiBadan = Math.max(1, Math.abs(yTutup - yBuka));

    ctx.fillStyle = warna;
    ctx.fillRect(x - lebarBadan / 2, yAtas, lebarBadan, tinggiBadan);
  }

  // Label jam untuk beberapa candle di bagian bawah
  ctx.fillStyle = "#9aa4b8";
  ctx.textAlign = "center";
  var loncat = Math.ceil(jumlah / 6);
  for (var t = 0; t < jumlah; t += loncat) {
    var tanggal = new Date(candles[t].waktu * 1000);
    var jam = ("0" + tanggal.getHours()).slice(-2);
    var menit = ("0" + tanggal.getMinutes()).slice(-2);
    ctx.fillText(jam + ":" + menit, t * slot + slot / 2, tinggi - 10);
  }

  // Garis putus-putus pada harga terakhir
  if (hargaTerakhir !== null) {
    var yTerakhir = yDariHarga(hargaTerakhir);
    if (yTerakhir >= padAtas && yTerakhir <= padAtas + tinggiArea) {
      ctx.strokeStyle = "#f0b35e";
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(0, yTerakhir);
      ctx.lineTo(lebarArea, yTerakhir);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Perbarui teks harga di kepala aplikasi
  var teksHarga = el("harga-sekarang");
  if (candles.length > 0 && hargaTerakhir !== null) {
    var pembuka = candles[candles.length - 1].buka;
    teksHarga.textContent = formatHarga(hargaTerakhir);
    teksHarga.className = "aset-harga " + (hargaTerakhir >= pembuka ? "naik" : "turun");
  }
}


/* ================= TOMBOL TIMEFRAME ================= */

function gantiTimeframe(detik, idTombol) {
  CONFIG.timeframe = detik;

  // Tandai tombol yang aktif
  el("tf-1m").className = "tombol-tf" + (detik === 60 ? " aktif" : "");
  el("tf-5m").className = "tombol-tf" + (detik === 300 ? " aktif" : "");

  // Hentikan pembaruan lama, ambil ulang data sesuai timeframe baru
  if (pewaktu !== null) {
    clearInterval(pewaktu);
    pewaktu = null;
  }
  candles = [];
  hargaTerakhir = null;
  modeSimulasi = false;
  hargaSimulasi = 81000;
  setStatus("memuat…", "status-muat");
  gambarGrafik();
  ambilCandleAwal(0);
}


/* ================= MESIN WAKTU ================= */

function mulaiPembaruan() {
  if (pewaktu !== null) { clearInterval(pewaktu); }
  pewaktu = setInterval(perbaruiHarga, CONFIG.intervalAmbilMs);
}


/* ================= SAAT HALAMAN DIBUKA ================= */

el("tf-1m").addEventListener("click", function () { gantiTimeframe(60, "tf-1m"); });
el("tf-5m").addEventListener("click", function () { gantiTimeframe(300, "tf-5m"); });

window.addEventListener("resize", gambarGrafik);

ambilCandleAwal(0);
