/* ============================================================
   RTM (Rvkie Trading Matix) — Otak aplikasi
   Tahap 2: grafik candlestick realtime (Coinbase -> Binance -> simulasi)
   Tahap 3: saldo virtual + tombol Naik/Turun manual
   Tahap 4: robot otomatis ON/OFF dengan persilangan moving average
   ------------------------------------------------------------
   Untuk pemula:
   - "Candle" = satu batang grafik (harga buka/tinggi/rendah/tutup
     dalam satu periode).
   - "Moving average (MA)" = garis rata-rata harga sejumlah candle
     terakhir. MA cepat (9 candle) lebih reaktif; MA lambat (21
     candle) mewakili tren besar.
   - Strategi robot: MA cepat memotong ke ATAS garis lambat ->
     pasang NAIK; memotong ke BAWAH -> pasang TURUN.
   - Robot punya rem pengaman: batas rugi harian dan batas jumlah
     transaksi. Kalau tercapai, robot berhenti sendiri.
   - Mode demo penuh: saldo hanyalah angka di layar, bukan uang.
   ============================================================ */


/* ================= PENGATURAN DASAR ================= */

var CONFIG = {
  jumlahCandle: 200,        // berapa candle terakhir yang diambil
  intervalAmbilMs: 3000,    // jarak pembaruan harga (3 detik)
  timeframe: 60,            // 60 = 1 menit, 300 = 5 menit (detik)

  saldoAwal: 10000,         // saldo demo awal
  persenMenang: 0.8,        // menang = +80% dari nominal

  maCepat: 9,               // panjang garis rata-rata cepat (candle)
  maLambat: 21,             // panjang garis rata-rata lambat (candle)
  durasiRobot: 60           // durasi transaksi robot (detik)
};

// Daftar sumber data, dicoba berurutan sampai ada yang berhasil
var SUMBER = [
  {
    nama: "Coinbase",
    urlCandle: function (tf) {
      return "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=" + tf;
    },
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
    urlCandle: function (tf) {
      var kode = tf === 300 ? "5m" : "1m";
      return "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=" + kode + "&limit=" + CONFIG.jumlahCandle;
    },
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

var candles = [];
var hargaTerakhir = null;
var sumberAktif = null;
var modeSimulasi = false;
var hargaSimulasi = 81000;
var pewaktu = null;

var saldo = CONFIG.saldoAwal;
var nominal = 50;
var durasi = 60;
var transaksiJalan = null;      // satu transaksi aktif (manual atau robot)
var pewaktuHitungMundur = null;

// Keadaan robot
var robotHidup = false;
var robotNominal = 50;
var robotBatasRugi = 500;       // total rugi maksimal dalam satu hari
var robotBatasTransaksi = 10;   // jumlah transaksi maksimal robot
var robotRugiHariIni = 0;       // akumulasi rugi hari ini
var robotTransaksiHariIni = 0;  // jumlah transaksi robot hari ini
var robotTanggal = tanggalHariIni(); // penanda tanggal, untuk reset harian
var sinyalTerakhir = null;      // "naik" / "turun" / null


/* ================= ALAT BANTU ================= */

function el(id) {
  return document.getElementById(id);
}

function formatHarga(angka) {
  return angka.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatSaldo(angka) {
  return angka.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function setStatus(teks, kelas) {
  var s = el("status-koneksi");
  s.textContent = teks;
  s.className = "status " + kelas;
}

function tanggalHariIni() {
  var d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}


/* ================= MENGAMBIL DATA HARGA ================= */

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
      daftar.sort(function (a, b) { return a.waktu - b.waktu; });
      candles = daftar;
      sumberAktif = sumber;
      modeSimulasi = false;
      hargaTerakhir = daftar[daftar.length - 1].tutup;
      setStatus(sumber.nama + " • live", "status-live");
      sinyalTerakhir = null;          // hitung ulang sinyal dari awal
      gambarGrafik();
      mulaiPembaruan();
    })
    .catch(function () {
      setStatus("mencoba sumber lain…", "status-muat");
      ambilCandleAwal(nomorSumber + 1);
    });
}

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
      robotPikir();
    })
    .catch(function () {
      setStatus("koneksi terganggu", "status-gagal");
    });
}

function tanamHargaKeCandle(harga) {
  if (candles.length === 0) { return; }

  var tf = CONFIG.timeframe;
  var waktuSekarang = Math.floor(Date.now() / 1000 / tf) * tf;
  var candleTerakhir = candles[candles.length - 1];

  if (candleTerakhir.waktu < waktuSekarang) {
    candles.push({
      waktu: waktuSekarang,
      buka: candleTerakhir.tutup,
      tinggi: harga,
      rendah: harga,
      tutup: harga
    });
    if (candles.length > CONFIG.jumlahCandle) {
      candles.shift();
    }
  } else {
    candleTerakhir.tutup = harga;
    if (harga > candleTerakhir.tinggi) { candleTerakhir.tinggi = harga; }
    if (harga < candleTerakhir.rendah) { candleTerakhir.rendah = harga; }
  }
}


/* ================= MODE SIMULASI ================= */

function mulaiSimulasi() {
  modeSimulasi = true;
  sumberAktif = null;
  setStatus("mode simulasi (offline)", "status-muat");

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
  sinyalTerakhir = null;
  gambarGrafik();
  mulaiPembaruan();
}

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
  robotPikir();
}


/* ================= LOGIKA TRANSAKSI ================= */

// asal = "manual" atau "robot"
function mulaiTransaksi(arah, asal) {
  if (transaksiJalan !== null) { return; }
  if (hargaTerakhir === null) { return; }

  var jumlah = asal === "robot" ? robotNominal : nominal;
  if (saldo < jumlah) {
    if (asal === "robot") {
      hentikanRobot("Saldo tidak cukup untuk nominal robot.");
    }
    return;
  }

  saldo = saldo - jumlah;
  gambarSaldo();

  transaksiJalan = {
    arah: arah,
    nominal: jumlah,
    asal: asal,
    hargaAwal: hargaTerakhir,
    waktuSelesai: Date.now() + (asal === "robot" ? CONFIG.durasiRobot : durasi) * 1000
  };

  kunciTombol(true);
  el("kotak-jalan").className = "kotak-jalan";
  perbaruiInfoJalan();

  pewaktuHitungMundur = setInterval(detikBerlalu, 1000);
}

function perbaruiInfoJalan() {
  var t = transaksiJalan;
  el("info-jalan").textContent =
    (t.asal === "robot" ? "[ROBOT] " : "") +
    (t.arah === "naik" ? "▲ NAIK" : "▼ TURUN") +
    " · " + t.nominal +
    " · mulai " + formatHarga(t.hargaAwal);
}

function detikBerlalu() {
  var sisa = Math.ceil((transaksiJalan.waktuSelesai - Date.now()) / 1000);

  if (sisa > 0) {
    el("hitung-mundur").textContent = sisa + "d";
    return;
  }

  clearInterval(pewaktuHitungMundur);
  pewaktuHitungMundur = null;
  tutupTransaksi();
}

function tutupTransaksi() {
  var t = transaksiJalan;
  var hargaAkhir = hargaTerakhir;
  var hasil;

  if (hargaAkhir > t.hargaAwal) {
    hasil = t.arah === "naik" ? "menang" : "kalah";
  } else if (hargaAkhir < t.hargaAwal) {
    hasil = t.arah === "turun" ? "menang" : "kalah";
  } else {
    hasil = "seri";
  }

  var untung = 0;
  if (hasil === "menang") {
    untung = t.nominal * CONFIG.persenMenang;
    saldo = saldo + t.nominal + untung;
  } else if (hasil === "seri") {
    saldo = saldo + t.nominal;
  } else {
    untung = -t.nominal;
  }
  gambarSaldo();

  // Catat untuk robot (akumulasi harian)
  if (t.asal === "robot") {
    robotTransaksiHariIni++;
    if (untung < 0) { robotRugiHariIni = robotRugiHariIni + Math.abs(untung); }
    perbaruiInfoRobot();
  }

  el("info-jalan").textContent =
    (t.asal === "robot" ? "[ROBOT] " : "") +
    (t.arah === "naik" ? "▲ NAIK" : "▼ TURUN") +
    " · " + t.nominal +
    " · awal " + formatHarga(t.hargaAwal) +
    " · akhir " + formatHarga(hargaAkhir) +
    " · " + (hasil === "menang" ? "MENANG +" + (t.nominal * CONFIG.persenMenang)
            : hasil === "kalah" ? "KALAH -" + t.nominal
            : "SERI");
  el("hitung-mundur").textContent = hasil === "menang" ? "✔" : hasil === "kalah" ? "✖" : "=";

  transaksiJalan = null;
  kunciTombol(false);

  // Setelah transaksi robot selesai, cek rem pengaman
  if (t.asal === "robot") {
    cekRemPengaman();
  }
}

function kunciTombol(sedangJalan) {
  var habis = saldo < nominalTerkecil();
  el("tombol-naik").disabled = sedangJalan || habis;
  el("tombol-turun").disabled = sedangJalan || habis;
}

function nominalTerkecil() {
  var tombolNominal = el("grup-nominal").getElementsByTagName("button");
  var terkecil = Infinity;
  for (var i = 0; i < tombolNominal.length; i++) {
    var nilai = parseInt(tombolNominal[i].getAttribute("data-nilai"), 10);
    if (nilai < terkecil) { terkecil = nilai; }
  }
  return terkecil;
}

function gambarSaldo() {
  el("saldo").textContent = formatSaldo(saldo);
}


/* ================= PILIHAN NOMINAL & DURASI (MANUAL) ================= */

function pasangGrupPilih(idGrup, aksi) {
  var grup = el(idGrup);
  var tombolSemua = grup.getElementsByTagName("button");

  var pasang = function (i) {
    tombolSemua[i].addEventListener("click", function () {
      for (var j = 0; j < tombolSemua.length; j++) {
        tombolSemua[j].className = "tombol-pilih";
      }
      tombolSemua[i].className = "tombol-pilih aktif";
      aksi(parseInt(tombolSemua[i].getAttribute("data-nilai"), 10));
    });
  };

  for (var i = 0; i < tombolSemua.length; i++) {
    pasang(i);
  }
}


/* ================= ROBOT: PERSILANGAN MOVING AVERAGE ================= */

// Hitung rata-rata harga tutup sejumlah candle terakhir
function hitungMA(jumlahCandleMA) {
  if (candles.length < jumlahCandleMA) { return null; }
  var total = 0;
  for (var i = candles.length - jumlahCandleMA; i < candles.length; i++) {
    total += candles[i].tutup;
  }
  return total / jumlahCandleMA;
}

// Tentukan posisi garis cepat terhadap garis lambat
function sinyalSekarang() {
  var cepat = hitungMA(CONFIG.maCepat);
  var lambat = hitungMA(CONFIG.maLambat);
  if (cepat === null || lambat === null) { return null; }
  return cepat > lambat ? "naik" : cepat < lambat ? "turun" : null;
}

// "Otak" robot, dipanggil setiap ada harga baru
function robotPikir() {
  if (!robotHidup) { return; }
  if (transaksiJalan !== null) { return; }   // tunggu transaksi sebelumnya selesai

  resetHarianBilaPerlu();

  var sinyal = sinyalSekarang();
  if (sinyal === null) { return; }

  // Hanya bertindak saat terjadi PERSILANGAN (posisi garis berubah)
  if (sinyalTerakhir !== null && sinyal !== sinyalTerakhir) {
    mulaiTransaksi(sinyal, "robot");
  }
  sinyalTerakhir = sinyal;
}

// Rem pengaman: berhenti bila batas tercapai
function cekRemPengaman() {
  if (!robotHidup) { return; }

  if (robotRugiHariIni >= robotBatasRugi) {
    hentikanRobot("Batas rugi harian tercapai (" + robotRugiHariIni + "). Robot berhenti.");
  } else if (robotTransaksiHariIni >= robotBatasTransaksi) {
    hentikanRobot("Batas jumlah transaksi tercapai (" + robotTransaksiHariIni + "x). Robot berhenti.");
  }
}

// Reset penghitung harian kalau ganti tanggal
function resetHarianBilaPerlu() {
  var hariIni = tanggalHariIni();
  if (hariIni !== robotTanggal) {
    robotTanggal = hariIni;
    robotRugiHariIni = 0;
    robotTransaksiHariIni = 0;
  }
}

function hidupkanRobot() {
  // Baca pengaturan dari kotak isian
  var n = parseInt(el("atur-nominal").value, 10);
  var r = parseInt(el("atur-rugi").value, 10);
  var t = parseInt(el("atur-transaksi").value, 10);

  robotNominal = (isNaN(n) || n < 10) ? 50 : n;
  robotBatasRugi = (isNaN(r) || r < 50) ? 500 : r;
  robotBatasTransaksi = (isNaN(t) || t < 1) ? 10 : t;

  resetHarianBilaPerlu();
  robotHidup = true;
  sinyalTerakhir = sinyalSekarang(); // catat posisi awal, tunggu persilangan

  el("status-robot").textContent = "ON";
  el("status-robot").className = "status-robot hidup";
  el("tombol-robot").textContent = "MATIKAN";
  el("tombol-robot").className = "tombol-robot matikan";
  kunciKotakAtur(true);
  perbaruiInfoRobot();
}

function hentikanRobot(alasan) {
  robotHidup = false;

  el("status-robot").textContent = "OFF";
  el("status-robot").className = "status-robot mati";
  el("tombol-robot").textContent = "HIDUPKAN";
  el("tombol-robot").className = "tombol-robot";
  kunciKotakAtur(false);

  var info = el("info-robot");
  info.textContent = "Robot mati. " + (alasan || "");
  info.className = "info-robot";
}

function perbaruiInfoRobot() {
  var info = el("info-robot");
  info.textContent =
    "Robot hidup · nominal " + robotNominal +
    " · rugi hari ini " + robotRugiHariIni + "/" + robotBatasRugi +
    " · transaksi " + robotTransaksiHariIni + "/" + robotBatasTransaksi +
    " · menunggu persilangan garis rata-rata…";
  info.className = "info-robot";
}

function kunciKotakAtur(terkunci) {
  el("atur-nominal").disabled = terkunci;
  el("atur-rugi").disabled = terkunci;
  el("atur-transaksi").disabled = terkunci;
}


/* ================= MENGGAMBAR GRAFIK ================= */

function gambarGrafik() {
  var kanvas = el("grafik");
  var kotak = kanvas.parentElement;
  var lebar = kotak.clientWidth;
  var tinggi = kotak.clientHeight;

  var skala = window.devicePixelRatio || 1;
  kanvas.width = lebar * skala;
  kanvas.height = tinggi * skala;

  var ctx = kanvas.getContext("2d");
  ctx.setTransform(skala, 0, 0, skala, 0, 0);

  ctx.fillStyle = "#131927";
  ctx.fillRect(0, 0, lebar, tinggi);

  if (candles.length === 0) { return; }

  var padAtas = 14;
  var padBawah = 24;
  var padKanan = 62;
  var lebarArea = lebar - padKanan;
  var tinggiArea = tinggi - padAtas - padBawah;

  var jumlah = candles.length;
  var slot = lebarArea / jumlah;
  var lebarBadan = Math.max(2, Math.floor(slot * 0.6));

  var min = Infinity;
  var max = -Infinity;
  for (var i = 0; i < jumlah; i++) {
    if (candles[i].rendah < min) { min = candles[i].rendah; }
    if (candles[i].tinggi > max) { max = candles[i].tinggi; }
  }
  if (transaksiJalan !== null) {
    if (transaksiJalan.hargaAwal < min) { min = transaksiJalan.hargaAwal; }
    if (transaksiJalan.hargaAwal > max) { max = transaksiJalan.hargaAwal; }
  }
  var rentang = (max - min) || 1;
  min -= rentang * 0.05;
  max += rentang * 0.05;
  rentang = max - min;

  function yDariHarga(harga) {
    return padAtas + (1 - (harga - min) / rentang) * tinggiArea;
  }

  // Kisi + label harga
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

  // Candle
  for (var c = 0; c < jumlah; c++) {
    var cd = candles[c];
    var x = Math.floor(c * slot + slot / 2);
    var naik = cd.tutup >= cd.buka;
    var warna = naik ? "#2ebd85" : "#f6465d";

    ctx.strokeStyle = warna;
    ctx.beginPath();
    ctx.moveTo(x, yDariHarga(cd.tinggi));
    ctx.lineTo(x, yDariHarga(cd.rendah));
    ctx.stroke();

    var yBuka = yDariHarga(cd.buka);
    var yTutup = yDariHarga(cd.tutup);
    var yAtas = Math.min(yBuka, yTutup);
    var tinggiBadan = Math.max(1, Math.abs(yTutup - yBuka));

    ctx.fillStyle = warna;
    ctx.fillRect(x - lebarBadan / 2, yAtas, lebarBadan, tinggiBadan);
  }

  // Gambar dua garis moving average (supaya persilangan terlihat)
  gambarGarisMA(ctx, CONFIG.maCepat, "#f0b35e", yDariHarga, slot, lebarArea);  // emas = cepat
  gambarGarisMA(ctx, CONFIG.maLambat, "#4da3ff", yDariHarga, slot, lebarArea); // biru = lambat

  // Label jam
  ctx.fillStyle = "#9aa4b8";
  ctx.textAlign = "center";
  var loncat = Math.ceil(jumlah / 6);
  for (var t = 0; t < jumlah; t += loncat) {
    var tanggal = new Date(candles[t].waktu * 1000);
    var jam = ("0" + tanggal.getHours()).slice(-2);
    var menit = ("0" + tanggal.getMinutes()).slice(-2);
    ctx.fillText(jam + ":" + menit, t * slot + slot / 2, tinggi - 10);
  }

  // Garis harga terakhir (emas putus-putus)
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

  // Garis harga awal transaksi (biru muda)
  if (transaksiJalan !== null) {
    var yAwal = yDariHarga(transaksiJalan.hargaAwal);
    if (yAwal >= padAtas && yAwal <= padAtas + tinggiArea) {
      ctx.strokeStyle = "#4da3ff";
      ctx.beginPath();
      ctx.moveTo(0, yAwal);
      ctx.lineTo(lebarArea, yAwal);
      ctx.stroke();
    }
  }

  // Teks harga di kepala
  var teksHarga = el("harga-sekarang");
  if (candles.length > 0 && hargaTerakhir !== null) {
    var pembuka = candles[candles.length - 1].buka;
    teksHarga.textContent = formatHarga(hargaTerakhir);
    teksHarga.className = "aset-harga " + (hargaTerakhir >= pembuka ? "naik" : "turun");
  }
}

// Gambar satu garis rata-rata bergerak
function gambarGarisMA(ctx, panjangMA, warna, yDariHarga, slot, lebarArea) {
  if (candles.length < panjangMA) { return; }

  ctx.strokeStyle = warna;
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  var pertama = true;
  for (var i = panjangMA - 1; i < candles.length; i++) {
    var total = 0;
    for (var j = i - panjangMA + 1; j <= i; j++) {
      total += candles[j].tutup;
    }
    var nilaiMA = total / panjangMA;
    var x = i * slot + slot / 2;
    var y = yDariHarga(nilaiMA);

    if (x > lebarArea) { break; }
    if (pertama) {
      ctx.moveTo(x, y);
      pertama = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}


/* ================= TOMBOL TIMEFRAME ================= */

function gantiTimeframe(detik) {
  CONFIG.timeframe = detik;

  el("tf-1m").className = "tombol-tf" + (detik === 60 ? " aktif" : "");
  el("tf-5m").className = "tombol-tf" + (detik === 300 ? " aktif" : "");

  if (pewaktu !== null) {
    clearInterval(pewaktu);
    pewaktu = null;
  }
  candles = [];
  hargaTerakhir = null;
  modeSimulasi = false;
  hargaSimulasi = 81000;
  sinyalTerakhir = null;
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

el("tf-1m").addEventListener("click", function () { gantiTimeframe(60); });
el("tf-5m").addEventListener("click", function () { gantiTimeframe(300); });

el("tombol-naik").addEventListener("click", function () { mulaiTransaksi("naik", "manual"); });
el("tombol-turun").addEventListener("click", function () { mulaiTransaksi("turun", "manual"); });

el("tombol-robot").addEventListener("click", function () {
  if (robotHidup) {
    hentikanRobot("Dimatikan oleh pengguna.");
  } else {
    hidupkanRobot();
  }
});

pasangGrupPilih("grup-nominal", function (nilai) { nominal = nilai; });
pasangGrupPilih("grup-durasi", function (nilai) { durasi = nilai; });

window.addEventListener("resize", gambarGrafik);

gambarSaldo();
ambilCandleAwal(0);
