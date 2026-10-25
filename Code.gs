// Configurações Globais (Substitua pelos seus IDs reais)
const SPREADSHEET_ID = '1UFa3f_TAUBabWQC6A0rsl00PgJedAswXH-NVhUN2poA';
const DRIVE_FOLDER_ID = '1n4EKyMt3A_gYAIaKklMFNmyNRnkk8dPd';
const DISCOGS_TOKEN = 'pcjcLtNMtsuexdmDfGsKiDIHPlQiHMjJwEiUnUpx';

// Serve a PWA/Interface HTML
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Inventário de Vinis')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

// Função invocada pela PWA para registar o vinil
function registarVinil(dadosInput) {
  try {
    const { barcode, estadoDisco, estadoCapa, fotoBase64 } = dadosInput;
    
    // 1. Obter metadados do Discogs
    const discogsData = procurarNoDiscogs(barcode);
    
    // 2. Guardar foto no Google Drive (se fornecida)
    let fotoUrl = '';
    if (fotoBase64) {
      fotoUrl = guardarFotoNoDrive(fotoBase64, barcode || 'vinil');
    }

    // 3. Registar na folha do Google Sheets
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getActiveSheet();
    sheet.appendRow([
      new Date(),
      fotoUrl,
      discogsData.artist,
      discogsData.title,
      discogsData.year,
      discogsData.label,
      discogsData.catno,
      barcode,
      estadoDisco,
      estadoCapa
    ]);

    return { success: true, title: discogsData.title, artist: discogsData.artist };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// Auxiliar: Pesquisa no Discogs
function procurarNoDiscogs(barcode) {
  if (!barcode) return { artist: 'Desconhecido', title: 'Manual', year: '', label: '', catno: '' };
  
  const url = `https://api.discogs.com/database/search?q=${barcode}&token=${DISCOGS_TOKEN}`;
  const response = UrlFetchApp.fetch(url, { headers: { 'User-Agent': 'VinylInventoryApp/1.0' } });
  const json = JSON.parse(response.getContentText());

  if (json.results && json.results.length > 0) {
    const item = json.results[0];
    const parts = item.title.split(' - ');
    return {
      artist: parts[0] || 'Desconhecido',
      title: parts[1] || item.title,
      year: item.year || '',
      label: (item.label && item.label[0]) || '',
      catno: item.catno || ''
    };
  }
  return { artist: 'Não encontrado', title: 'Verificar Barcode', year: '', label: '', catno: '' };
}

// Auxiliar: Guardar Foto no Drive
function guardarFotoNoDrive(base64Data, filename) {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const contentType = base64Data.substring(5, base64Data.indexOf(';'));
  const bytes = Utilities.base64Decode(base64Data.substr(base64Data.indexOf(',') + 1));
  const blob = Utilities.newBlob(bytes, contentType, `${filename}_${Date.now()}.jpg`);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}
