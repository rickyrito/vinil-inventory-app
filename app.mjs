import { emptyState, visibleRecords, filterRecords, enqueue, acknowledge, resolveConflict } from './core.mjs';
import * as storage from './storage.mjs';
import { api, signIn, signOut, bootstrap, configured, authenticated, previewMode } from './google.mjs';

const $ = id => document.getElementById(id);
const form = $('record-form');
const grades = ['', 'Mint (M)', 'Near Mint (NM)', 'Very Good Plus (VG+)', 'Very Good (VG)', 'Good Plus (G+)', 'Good (G)', 'Fair (F)', 'Poor (P)'];
let state = emptyState(), tab = 'Coleção', account = null, syncing = false, editing = null, photo = '', chosenCover = '';
let conflictOperation = '', discovering = false, accountChanging = false;
const money = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n);
const date = value => value ? new Date(value).toLocaleDateString('pt-PT') : '—';
const error = e => e?.message || String(e);
function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function button(text, action, className = 'secondary') {
  const b = node('button', text, className); b.type = 'button'; b.onclick = action; return b;
}
function message(text) { $('message').textContent = text; $('message').hidden = !text; }
const safeImage = src => /^https:\/\//.test(src || '') || /^data:image\/(jpeg|png|webp);base64,/.test(src || '');
function photoKey(d) { return 'cover:' + d.id + ':' + (d.foto || d.capa || ''); }
const coverJobs = new Map();
let imageJobs = Promise.resolve();
async function loadCover(img, d) {
  const owner = account?.id;
  const key = photoKey(d);
  try {
    if (d.fotoBase64) { img.src = d.fotoBase64; return; }
    const cached = await storage.get(key);
    if (cached) { img.src = cached; return; }
    if (safeImage(d.capa)) img.src = d.capa;
    if (!navigator.onLine || !authenticated() || accountChanging) return;
    if (!coverJobs.has(key)) {
      // Serializar pedidos de imagens para respeitar os limites da API Google.
      const job = imageJobs.then(async () => {
        if (!authenticated() || account?.id !== owner || accountChanging) return '';
        if (d.foto) return api('photo', d.id);
        if (!safeImage(d.capa)) return '';
        const r = await fetch(d.capa, { credentials: 'omit' });
        if (!r.ok || !r.headers.get('Content-Type')?.startsWith('image/')) return '';
        const blob = await r.blob();
        if (blob.size > 3500000) return '';
        return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
      }).then(async data => {
        if (data && safeImage(data) && account?.id === owner && !accountChanging) await storage.set(key, data);
        return data;
      }).catch(() => '');
      coverJobs.set(key, job);
      imageJobs = job;
    }
    const data = await coverJobs.get(key);
    if (data && img.isConnected && account?.id === owner) img.src = data;
  } catch { /* Uma capa indisponível não impede a consulta do disco. */ }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    observer.unobserve(entry.target); loadCover(entry.target, entry.target.record);
  }
}, { rootMargin: '180px' });
function cover(d, className = '') {
  const wrapper = node('div', undefined, 'cover ' + className);
  const placeholder = node('span', '◎', 'cover-placeholder'); placeholder.setAttribute('aria-hidden', 'true');
  const img = document.createElement('img'); img.alt = 'Capa de ' + (d.titulo || 'vinil'); img.loading = 'lazy'; img.hidden = true;
  img.onload = () => { img.hidden = false; placeholder.hidden = true; };
  img.onerror = () => { img.hidden = true; placeholder.hidden = false; };
  img.record = d; wrapper.append(placeholder, img); observer.observe(img);
  return wrapper;
}
function options(id, values, label) {
  const select = $(id), previous = select.value;
  select.replaceChildren(new Option(label, ''));
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')).forEach(value => select.add(new Option(value, value)));
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function render() {
  const records = visibleRecords(state);
  const collection = records.filter(d => d.lista === 'Coleção'), wishes = records.filter(d => d.lista === 'Wishlist');
  const loans = records.filter(d => d.emprestado), conflicts = records.filter(d => d.situacao === 'Conflito');
  $('count-collection').textContent = $('stat-total').textContent = collection.length;
  $('count-wishlist').textContent = $('stat-wish').textContent = wishes.length;
  $('count-loans').textContent = $('stat-loans').textContent = loans.length;
  $('count-conflicts').textContent = conflicts.length;
  const prices = collection.map(d => Number(d.preco)).filter(n => Number.isFinite(n) && n > 0);
  $('stat-value').textContent = prices.length ? money(prices.reduce((a, b) => a + b, 0)) : '—';
  $('account').textContent = authenticated() ? account?.email : account ? 'Retomar ligação Google ↗' : 'Entrar com Google ↗';
  $('account-detail').textContent = account ? account.email : 'Ainda sem uma conta ligada.';
  $('logout').hidden = !account;
  $('config-status').textContent = previewMode() ? 'Esta publicação permite conhecer a interface. A entrada Google e o acesso à coleção ficam disponíveis quando o serviço de dados estiver ligado.' : configured() ? 'Ligação Google configurada no servidor. Entra com a tua conta para abrir a coleção.' : 'A ligação Google ainda precisa de ser configurada no servidor.';
  for (const id of ['account', 'connect', 'empty-connect', 'add']) $(id).disabled = previewMode();
  if (previewMode()) message('Pré-visualização no GitHub Pages. A autenticação Google, a coleção real e a gravação no Drive ainda não estão disponíveis nesta publicação.');
  $('network').textContent = navigator.onLine ? authenticated() ? 'Ligado ao Google' : 'Sem sessão Google' : 'Sem internet';
  $('network-dot').classList.toggle('offline', !navigator.onLine);
  $('sync').disabled = syncing || !account;
  $('sync-label').textContent = syncing ? 'A sincronizar…' : state.fila.length ? state.fila.length + ' pendente(s)' : state.atualizado ? 'Atualizado ' + date(state.atualizado) : 'Ainda sem sincronização';
  $('library').hidden = tab === 'Ligação'; $('settings').hidden = tab !== 'Ligação';
  $('breadcrumb').textContent = tab.toUpperCase();
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  $('page-title').textContent = ({ 'Coleção': 'A tua coleção.', 'Wishlist': 'Os próximos discos.', 'Empréstimos': 'A música circula.', 'Conflitos': 'Rever duplicados.' })[tab] || 'A tua coleção.';
  $('subtitle').textContent = ({ 'Coleção': 'Um lugar para todos os teus discos.', 'Wishlist': 'Aqueles que ainda queres ouvir em casa.', 'Empréstimos': 'Sabe com quem está cada disco.', 'Conflitos': 'A mesma edição encontrada em mais de um registo.' })[tab] || '';
  options('genre', records.flatMap(d => String(d.generos || '').split(',').map(s => s.trim())), 'Todos os géneros');
  options('condition', records.map(d => d.estadoDisco), 'Todos os estados');
  const filtered = filterRecords(records, { tab, search: $('search').value, genre: $('genre').value, condition: $('condition').value, sort: $('sort').value });
  $('results-count').textContent = filtered.length + (filtered.length === 1 ? ' disco' : ' discos');
  observer.disconnect(); $('grid').replaceChildren();
  for (const d of filtered) {
    const card = button('', () => showDetail(d), 'record');
    const art = cover(d);
    if (d.pendente) art.append(node('span', 'Por sincronizar', 'badge warn'));
    else if (d.emprestado) art.append(node('span', 'Emprestado', 'badge'));
    else if (d.situacao === 'Conflito') art.append(node('span', 'Duplicado', 'badge warn'));
    card.append(art, node('h3', d.titulo || 'Sem título'), node('p', d.artista || 'Artista por identificar', 'artist'), node('div', [d.ano, d.editora].filter(Boolean).join(' · '), 'meta'));
    $('grid').append(card);
  }
  $('empty').hidden = !!filtered.length;
  $('empty-text').textContent = previewMode() ? 'A tua coleção real será apresentada depois de a ligação Google estar disponível.' : !account ? 'Liga a tua conta Google para abrir a coleção existente.' : !records.length ? 'Sincroniza a coleção ou adiciona o primeiro vinil.' : 'Não há discos para estes filtros. Experimenta outra pesquisa ou adiciona um vinil.';
  $('empty-connect').hidden = !!account || previewMode();
  $('pending').hidden = !state.fila.length; $('pending-list').replaceChildren();
  for (const op of state.fila) {
    const row = node('article');
    row.append(node('span', op.disco.titulo + ' · ' + (op.erro || 'À espera de sincronização')));
    if (op.erro && Object.hasOwn(op, 'servidor')) row.append(button('Rever', () => showConflict(op)));
    else row.append(button('Remover alteração local', () => discardPending(op), 'subtle'));
    $('pending-list').append(row);
  }
}
async function connect() {
  if (syncing || accountChanging) return message('Aguarda que a operação atual termine.');
  try {
    accountChanging = true;
    await signIn(); // A entrada redireciona a página e regressa por /auth/callback.
  } catch (e) { message(error(e)); if (!configured()) { tab = 'Ligação'; render(); } }
  finally { accountChanging = false; }
}
async function sync() {
  if (syncing || !account) return;
  if (!authenticated()) return message('Entra com Google para sincronizar. A cópia local continua disponível.');
  syncing = true; render();
  try {
    await storage.locked(async () => {
      state = await storage.readState();
      for (const op of [...state.fila]) {
        if (op.erro && Object.hasOwn(op, 'servidor')) continue;
        const response = await api('save', op);
        state = acknowledge(state, op, response);
        await storage.set('state', state);
      }
      const snapshot = await api('list');
      state = { ...state, discos: snapshot.discos, atualizado: snapshot.atualizado };
      await storage.set('state', state);
    });
    message(state.fila.length ? 'Há alterações para rever antes de concluir a sincronização.' : 'Coleção sincronizada com o Google Sheets e o Drive.');
  } catch (e) { message(error(e) + (state.fila.length ? ' As alterações continuam guardadas neste dispositivo.' : '')); }
  finally { syncing = false; render(); }
}
function openEditor(d = null) {
  if (!account) { message('Liga primeiro a tua conta Google para abrir ou adicionar discos.'); return; }
  if (d?.pendente) { message('Sincroniza as alterações deste disco antes de o voltares a editar.'); return; }
  editing = d; photo = ''; chosenCover = d?.capa || ''; discovering = false;
  form.reset();
  for (const input of form.elements) if (input.name) {
    const value = d?.[input.name] ?? (input.name === 'lista' ? tab === 'Wishlist' ? 'Wishlist' : 'Coleção' : '');
    input.value = input.type === 'date' ? String(value).slice(0, 10) : value;
  }
  $('editor-title').textContent = d ? 'Editar vinil' : 'Adicionar vinil';
  $('discogs-results').replaceChildren(); $('discovery-status').textContent = ''; $('form-status').textContent = '';
  $('photo-preview').hidden = true; $('remove-photo').hidden = true;
  $('edit-warning').hidden = !d?.conflito;
  $('edit-warning').textContent = d?.conflito || '';
  $('editor').showModal();
}
function showDetail(d) {
  const root = $('detail-content'); root.replaceChildren();
  const top = node('div', undefined, 'dialog-heading'); top.append(node('p', d.lista === 'Wishlist' ? 'LISTA DE DESEJOS' : 'A MINHA COLEÇÃO', 'eyebrow'), button('×', () => $('detail').close(), 'close'));
  top.lastChild.setAttribute('aria-label', 'Fechar');
  const header = node('div', undefined, 'detail-header'), art = cover(d); art.style.width = '150px'; art.style.flexShrink = '0';
  const title = node('div'); title.append(node('h2', d.titulo), node('p', d.artista || 'Artista por identificar'));
  if (d.pendente) title.append(node('span', 'Por sincronizar', 'badge warn'));
  header.append(art, title); root.append(top, header);
  if (d.conflito) root.append(node('p', d.conflito, 'notice'));
  const dl = node('dl', undefined, 'detail-data');
  for (const [label, value] of [['Ano', d.ano], ['Editora', d.editora], ['N.º de catálogo', d.catno], ['Formato', d.formato], ['País', d.pais], ['Código de barras', d.barcode], ['Disco', d.estadoDisco], ['Capa', d.estadoCapa], ['Géneros', d.generos], ['Estilos', d.estilos], ['Mínimo Discogs', d.preco !== '' && d.preco != null ? money(Number(d.preco)) : ''], ['Emprestado a', d.emprestado], ['Data do empréstimo', d.dataEmprestimo ? date(d.dataEmprestimo) : ''], ['Devolver até', d.devolver ? date(d.devolver) : '']]) {
    if (!value) continue;
    const block = node('div'); block.append(node('dt', label), node('dd', String(value))); dl.append(block);
  }
  root.append(dl);
  if (d.notas) root.append(node('h3', 'Notas'), node('p', d.notas, 'prewrap'));
  if (d.faixas) root.append(node('h3', 'Faixas'), node('p', d.faixas, 'prewrap'));
  const actions = node('div', undefined, 'actions');
  actions.append(button('Editar / gerir empréstimo', () => { $('detail').close(); openEditor(d); }, 'primary'));
  if (/^https:\/\/www\.discogs\.com\/release\/\d+$/.test(d.url)) {
    const a = node('a', 'Abrir Discogs ↗', 'secondary'); a.href = d.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a);
  }
  root.append(actions); $('detail').showModal();
}
async function save(event) {
  event.preventDefault(); if (syncing || discovering) return;
  const disco = Object.fromEntries(new FormData(form));
  disco.capa = chosenCover;
  if (photo) disco.fotoBase64 = photo;
  if (!disco.emprestado) { disco.dataEmprestimo = ''; disco.devolver = ''; }
  if (disco.emprestado && disco.lista !== 'Coleção') { $('form-status').textContent = 'Só podes emprestar discos da coleção.'; return; }
  if (disco.emprestado && !disco.dataEmprestimo) { $('form-status').textContent = 'Indica a data do empréstimo.'; return; }
  if (disco.devolver && disco.dataEmprestimo && disco.devolver < disco.dataEmprestimo) { $('form-status').textContent = 'A devolução não pode ser anterior ao empréstimo.'; return; }
  $('save').disabled = true;
  try {
    const op = { id: editing?.id || crypto.randomUUID(), operacao: crypto.randomUUID(), versao: editing?.versao || '',
      discogsAnterior: editing?.url || '', disco };
    await storage.locked(async () => { state = enqueue(await storage.readState(), op); await storage.set('state', state); });
    $('editor').close(); render();
    message('Alteração guardada neste dispositivo. A aguardar confirmação no Google.');
    if (navigator.onLine && authenticated()) await sync();
  } catch (e) { $('form-status').textContent = error(e); }
  finally { $('save').disabled = false; }
}
async function imageCanvas(file, size = 1600) {
  if (file.size > 30000000) throw new Error('Escolhe uma fotografia com menos de 30 MB.');
  const img = await new Promise((resolve, reject) => {
    const i = new Image(), url = URL.createObjectURL(file);
    i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a fotografia. Usa uma imagem JPEG ou PNG.')); };
    i.src = url;
  });
  const ratio = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height); return canvas;
}
function setPhoto(data) { photo = data; $('photo-preview').src = data; $('photo-preview').hidden = false; $('remove-photo').hidden = false; }
async function readBarcode(canvas) {
  if ('BarcodeDetector' in window) {
    try { const found = await new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] }).detect(canvas); if (found.length) return found[0].rawValue; } catch { /* Usar ZXing no iPhone. */ }
  }
  const z = window.ZXing;
  const hints = new Map([[z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E]], [z.DecodeHintType.TRY_HARDER, true]]);
  try { return (await new z.BrowserMultiFormatReader(hints).decodeFromImageUrl(canvas.toDataURL('image/jpeg', .92))).getText(); }
  catch { throw new Error('Não consegui ler o código. Aproxima a câmara, evita reflexos ou escreve o código.'); }
}
function results(response) {
  $('discogs-results').replaceChildren();
  if (response.barcode) form.elements.barcode.value = response.barcode;
  $('discovery-status').textContent = response.resultados.length ? 'Confirma a edição: ano, país e número de catálogo.' : 'Sem resultados. Podes preencher os dados manualmente.';
  if (response.duplicado) $('discovery-status').textContent += ' Este código já existe no inventário.';
  for (const result of response.resultados) {
    const b = button('', () => {
      for (const key of ['artista', 'titulo', 'ano', 'editora', 'catno', 'formato', 'pais', 'url']) form.elements[key].value = result[key] || '';
      chosenCover = result.capa || ''; $('discogs-results').replaceChildren(); $('discovery-status').textContent = 'Edição selecionada. Revê os dados e guarda o vinil.';
    }, 'discogs-result');
    if (safeImage(result.capa)) { const img = document.createElement('img'); img.src = result.capa; img.alt = ''; img.loading = 'lazy'; b.append(img); }
    const text = node('div'); text.append(node('strong', [result.artista, result.titulo].filter(Boolean).join(' — ')), node('small', [result.ano, result.editora, result.catno, result.pais, result.formato, result.jaExiste ? 'Já no inventário' : ''].filter(Boolean).join(' · ')));
    b.append(text); $('discogs-results').append(b);
  }
}
async function discover(fn) {
  if (discovering) return;
  discovering = true; $('save').disabled = true; $('discogs-search').disabled = true;
  $('discovery-status').textContent = 'A procurar…';
  try { await fn(); } catch (e) { $('discovery-status').textContent = error(e); }
  finally { discovering = false; $('save').disabled = false; $('discogs-search').disabled = false; }
}
function searchDiscogs(query) {
  const raw = query.trim();
  if (!raw) throw new Error('Escreve o artista, título ou código de barras.');
  return api('search', /^\d{8,14}$/.test(raw) ? { barcode: raw } : { texto: raw }).then(results);
}
function showConflict(op) {
  conflictOperation = op.operacao; const root = $('conflict-content'); root.replaceChildren();
  const grid = node('div', undefined, 'conflict-grid');
  for (const [label, data] of [['As tuas alterações', op.disco], ['Versão Google', op.servidor]]) {
    const block = node('article'); block.append(node('h3', label));
    if (!data) block.append(node('p', 'O disco já não existe no Google.'));
    else {
      const dl = node('dl');
      for (const key of Object.keys(op.disco).filter(k => !['fotoBase64', 'capa'].includes(k))) {
        dl.append(node('dt', ({ artista: 'Artista', titulo: 'Título', emprestado: 'Emprestado a', dataEmprestimo: 'Empréstimo', devolver: 'Devolver até' })[key] || key), node('dd', String(data[key] || '—')));
      }
      if (data.fotoBase64) block.append(node('p', 'Inclui uma nova fotografia.'));
      block.append(dl);
    }
    grid.append(block);
  }
  root.append(grid); $('conflict').showModal();
}
async function chooseConflict(local) {
  try {
    await storage.locked(async () => { state = resolveConflict(await storage.readState(), conflictOperation, local); await storage.set('state', state); });
    $('conflict').close(); render(); if (local) await sync();
  } catch (e) { message(error(e)); }
}
async function discardPending(op) {
  if (syncing || accountChanging) return message('Aguarda que a operação atual termine.');
  if (!confirm('Remover esta alteração do dispositivo? Isto não desfaz uma gravação que já tenha chegado ao Google. Podes exportar a fila antes de continuar.')) return;
  try {
    await storage.locked(async () => {
      const current = await storage.readState();
      state = { ...current, fila: current.fila.filter(item => item.operacao !== op.operacao) };
      await storage.set('state', state);
    });
    render(); message('Alteração local removida. Sincroniza para confirmar a versão existente no Google.');
  } catch (e) { message(error(e)); }
}
async function logout() {
  if (syncing || accountChanging) return message('Aguarda que a sincronização termine antes de sair.');
  if (!confirm(state.fila.length ? 'Há alterações por sincronizar. Sair elimina esta cópia local e as alterações pendentes. Exporta-as primeiro se quiseres conservá-las. Continuar?' : 'Sair e remover a coleção guardada neste dispositivo?')) return;
  accountChanging = true;
  try {
    await imageJobs;
    await storage.locked(() => storage.clearStore());
    await signOut(); account = null; localStorage.removeItem('vinil-account'); state = emptyState(); coverJobs.clear();
    message('Sessão terminada e cópia local removida.'); render();
  } catch (e) { message(error(e)); }
  finally { accountChanging = false; }
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; $('search').value = ''; $('genre').value = ''; $('condition').value = ''; render(); });
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
  if (b.dataset.close === 'editor' && discovering) { $('discovery-status').textContent = 'Aguarda que a pesquisa termine antes de fechar.'; return; }
  $(b.dataset.close).close();
});
$('editor').addEventListener('cancel', event => { if (discovering) event.preventDefault(); });
document.querySelectorAll('.grades').forEach(s => grades.forEach(g => s.add(new Option(g || 'Não indicado', g))));
for (const id of ['search', 'genre', 'condition', 'sort']) $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
for (const id of ['account', 'connect', 'empty-connect']) $(id).onclick = connect;
$('logout').onclick = logout; $('sync').onclick = sync; $('add').onclick = () => openEditor();
form.onsubmit = save;
$('discogs-search').onclick = () => discover(() => searchDiscogs($('discogs-query').value));
$('discogs-query').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('discogs-search').click(); } };
$('record-photo').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try { setPhoto((await imageCanvas(file)).toDataURL('image/jpeg', .82)); } catch (err) { $('form-status').textContent = error(err); }
};
$('remove-photo').onclick = () => { photo = ''; $('photo-preview').hidden = true; $('remove-photo').hidden = true; };
$('barcode-photo').onchange = e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  discover(async () => {
    const code = await readBarcode(await imageCanvas(file, 2000)); form.elements.barcode.value = code; $('discogs-query').value = code;
    if (navigator.onLine && authenticated()) await searchDiscogs(code);
    else $('discovery-status').textContent = 'Código lido. A pesquisa Discogs fica disponível quando ligares à internet e ao Google.';
  });
};
$('identify-photo').onchange = e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  discover(async () => {
    setPhoto((await imageCanvas(file)).toDataURL('image/jpeg', .82));
    $('discovery-status').textContent = 'A identificar a capa…';
    const response = await api('identify', { fotoBase64: photo });
    if (response.capa) for (const key of ['artista', 'titulo']) if (response.capa[key]) form.elements[key].value = response.capa[key];
    results(response);
  });
};
$('use-local').onclick = () => chooseConflict(true); $('use-server').onclick = () => chooseConflict(false);
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.fila, null, 2)], { type: 'application/json' }));
  const a = node('a'); a.href = url; a.download = 'vinil-alteracoes-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
};
window.addEventListener('online', async () => {
  try { await refreshSession(); } catch { /* A rede pode ainda não ter regressado por completo. */ }
  render(); if (authenticated()) sync();
});
window.addEventListener('offline', render);
window.addEventListener('focus', async () => {
  if (syncing || accountChanging) return;
  try {
    if (navigator.onLine) await refreshSession();
    if (account) state = await storage.readState();
    render(); if (account && navigator.onLine && authenticated() && !$('editor').open) sync();
  } catch { /* Mantém a cópia local quando a ligação falha. */ }
});
async function refreshSession() {
  const session = await bootstrap();
  if (!session.account) return;
  if (account?.id === session.account.id && account.collectionId === session.collectionId) return;
  accountChanging = true;
  try {
    await imageJobs;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    account = { ...session.account, collectionId: session.collectionId };
    await storage.openStore(account.id + '-api-' + account.collectionId);
    state = await storage.readState(); coverJobs.clear();
    localStorage.setItem('vinil-account', JSON.stringify(account));
  } finally { accountChanging = false; }
}
try {
  account = JSON.parse(localStorage.getItem('vinil-account') || 'null');
  if (account?.id && account.collectionId && !localStorage.getItem('vinil-logout-pending')) {
    await storage.openStore(account.id + '-api-' + account.collectionId); state = await storage.readState();
  } else account = null;
  render();
  if (navigator.onLine) {
    try {
      await refreshSession(); render(); if (authenticated()) await sync();
    } catch { message('Sem ligação ao servidor. A cópia local continua disponível.'); }
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => message('Não foi possível preparar o modo offline. A app continua disponível com internet.'));
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
} catch (e) { render(); message('Não foi possível abrir a cópia local: ' + error(e)); }
