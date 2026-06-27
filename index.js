import cron from 'node-cron';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import express from 'express';
import cors from 'cors';
// Kullanıcının belirttiği dataset ID'leri
const DATASETS = [
  { id: 'e2a87342-d39a-4742-ae25-165e10d2bc72', name: 'gtfs' },
  { id: '19542b74-a211-44a4-b732-f7f4245fe976', name: 'tramvay_saatleri' },
  { id: '21cd230d-125b-44ba-b1d7-fb261ee06675', name: 'taksi_duraklari' },
  { id: 'a9604fe2-c723-41fd-bf74-6cea8af16a54', name: 'akilli_durak_bilgileri' },
  { id: 'c7b7c933-7913-4483-937d-4760f7e5e29b', name: 'akilli_durak_ekran_bilgileri' },
  { id: 'c1008a5f-f54d-4978-8f14-c7ceea9d3586', name: 'kobis_park_yerleri' },
  { id: '88602516-ed14-4d61-bf53-5c3022439b6b', name: 'taksi_durak_listesi' },
  { id: '09079315-1e63-42c5-8dc6-c7e4b2f96f40', name: 'aus_tum_saha_unsurlari' },
  { id: '18479bd4-c5d6-4ba8-ba91-bc925078be81', name: 'tramvay_istasyon_noktalari' },
  { id: 'fb48309a-cb09-4188-b872-f66b8f8b6395', name: 'ucretsiz_otoparklar' },
  { id: '54501978-1424-40c0-9613-e618bc37a2db', name: 'acik_otopark' }
];

// Kocaeli Açık Veri Portalı Yeni API Adresi
const getApiUrl = (datasetId) => `https://kavisacikveri.kocaeli.bel.tr/api/public/OpenDataPublic/${datasetId}`;

const DURUM_FILE = path.resolve('durum.json');
const DOWNLOAD_DIR = path.resolve('downloads');

let isProcessing = false;

/**
 * Dosya indirme yardımcı fonksiyonu
 */
async function downloadFile(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Dosya indirilemedi: ${url} - Status: ${response.status}`);
  }
  
  const fileStream = createWriteStream(destPath);
  
  if (response.body.pipe) {
    await pipeline(response.body, fileStream);
  } else {
    await pipeline(Readable.fromWeb(response.body), fileStream);
  }
}

/**
 * Yerel durum dosyasını okur
 */
async function getLocalStatus() {
  try {
    const data = await fs.readFile(DURUM_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    return {};
  }
}

/**
 * Yerel durum dosyasını günceller
 */
async function saveLocalStatus(statusObj) {
  try {
    await fs.writeFile(DURUM_FILE, JSON.stringify(statusObj, null, 2), 'utf-8');
  } catch (error) {
    console.error('Durum dosyası yazılamadı:', error.message);
  }
}

/**
 * Her bir veriseti için kontrol ve indirme işlemi
 */
async function processDataset(dataset, localStatus) {
  console.log(`\n--- [${dataset.name}] Kontrol Ediliyor ---`);
  
  try {
    const apiUrl = getApiUrl(dataset.id);
    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`API İsteği başarısız: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Yeni API yapısına göre son güncellenme tarihi
    const remoteDate = data.updatedAt || data.createdAt;

    if (!remoteDate) {
      console.warn(`[${dataset.name}] Tarih alanı bulunamadı, atlanıyor.`);
      return localStatus;
    }

    const localDate = localStatus[dataset.id];

    if (localDate === remoteDate) {
      console.log(`[${dataset.name}] Sistem güncel, indirme atlanıyor. (Tarih: ${remoteDate})`);
      return localStatus;
    }

    console.log(`[${dataset.name}] Yeni veri tespit edildi! (Eski: ${localDate || 'Yok'} -> Yeni: ${remoteDate})`);
    
    const datasetDir = path.join(DOWNLOAD_DIR, dataset.name);
    await fs.mkdir(datasetDir, { recursive: true });

    // Yeni API yapısında dosyalar "attachments" array'i içinde tutuluyor
    const resources = data.attachments || [];
    if (resources.length === 0) {
      console.log(`[${dataset.name}] API yanıtında indirilecek dosya (attachments) bulunamadı.`);
    }

    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      // Yeni indirme URL'i formatı
      const fileUrl = `https://kavisacikveri.kocaeli.bel.tr/api/public/OpenDataPublic/attachments/${resource.id}/download`;
      
      let fileName = resource.originalFileName || resource.fileName || `file_${i}_${Date.now()}.tmp`;

      if (fileUrl) {
        console.log(`  -> İndiriliyor: ${fileName}...`);
        const destPath = path.join(datasetDir, fileName);
        await downloadFile(fileUrl, destPath);
        console.log(`  -> Başarılı: ${fileName}`);
      }
    }

    localStatus[dataset.id] = remoteDate;

  } catch (error) {
    console.error(`[${dataset.name}] Hata yakalandı:`, error.message);
  }

  return localStatus;
}

/**
 * Tüm API'leri sırayla tarayıp senkronize eder
 */
async function runJob() {
  if (isProcessing) {
    console.log(`[${new Date().toLocaleString()}] Önceki görev henüz tamamlanmadı, yeni görev atlanıyor.`);
    return;
  }
  
  isProcessing = true;
  console.log(`\n======================================================`);
  console.log(`[${new Date().toLocaleString()}] Senkronizasyon Görevi Başladı`);
  
  try {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  } catch (err) {
    console.error('Ana "downloads" klasörü oluşturulamadı:', err.message);
    isProcessing = false;
    return;
  }

  let localStatus = await getLocalStatus();

  for (const dataset of DATASETS) {
    localStatus = await processDataset(dataset, localStatus);
  }

  await saveLocalStatus(localStatus);

  // Frontend için api_index.json oluştur
  try {
    const apiIndex = [];
    for (const dataset of DATASETS) {
      const datasetDir = path.join(DOWNLOAD_DIR, dataset.name);
      let files = [];
      try {
        files = await fs.readdir(datasetDir);
      } catch (e) {
        // klasör yoksa atla
      }
      apiIndex.push({
        id: dataset.id,
        name: dataset.name,
        lastUpdated: localStatus[dataset.id] || null,
        files: files
      });
    }
    await fs.writeFile(path.resolve('api_index.json'), JSON.stringify(apiIndex, null, 2), 'utf-8');
  } catch (err) {
    console.error('api_index.json oluşturulamadı:', err.message);
  }

  console.log(`\n[${new Date().toLocaleString()}] Senkronizasyon Görevi Tamamlandı`);
  console.log(`======================================================\n`);
  isProcessing = false;
}
// İlk açılışta veya GitHub Actions tetiklediğinde bir kez çalıştır
runJob();
