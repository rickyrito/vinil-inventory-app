// O browser só fala com o backend da mesma origem. Tokens Google ficam no servidor.
let settings = { configured: false, account: null, collectionId: '', collections: [] };
const routes = { list: '/api/records/list', save: '/api/records/save', photo: '/api/records/photo',
  search: '/api/discogs/search', identify: '/api/covers/identify', jobs: '/api/jobs/status',
  collections: '/api/collections/list', createCollection: '/api/collections/create', importLegacy: '/api/collections/import-legacy',
  members: '/api/collections/members', share: '/api/collections/share', revoke: '/api/collections/revoke' };
export const configured = () => settings.configured;
export const authenticated = () => !!settings.account;
export const collectionId = () => settings.collectionId;
export const previewMode = () => settings.preview === true;
export const availableCollections = () => settings.collections || [];
export const selectedCollection = () => availableCollections().find(c => c.id === settings.collectionId);
export const canImportLegacy = () => settings.canImportLegacy === true;
export function selectCollection(id) {
  if (!availableCollections().some(c => c.id === id && c.status === 'ready')) throw new Error('Coleção indisponível.');
  settings.collectionId = id;
}
export function forgetSession() { settings.account = null; }
async function logoutRequest() {
  const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Vinil-Request': '1' }, cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível terminar a sessão no servidor.');
  localStorage.removeItem('vinil-logout-pending');
}
export async function bootstrap() {
  const hostingResponse = await fetch(new URL('./hosting.json', import.meta.url), { cache: 'no-store' });
  if (!hostingResponse.ok) throw new Error('Não foi possível verificar a configuração da publicação.');
  const hosting = await hostingResponse.json();
  if (hosting.mode === 'static-preview') {
    settings = { configured: false, account: null, collectionId: '', collections: [], preview: true };
    return settings;
  }
  if (localStorage.getItem('vinil-logout-pending')) await logoutRequest();
  const response = await fetch('/api/session', { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new Error('Não foi possível verificar a ligação ao servidor.');
  const previous = settings.collectionId;
  settings = await response.json();
  let remembered; try { remembered = JSON.parse(localStorage.getItem('vinil-account') || 'null'); } catch { /* Sem preferência. */ }
  const preferred = remembered?.id === settings.account?.id ? remembered.collectionId : '';
  const ready = (settings.collections || []).filter(c => c.status === 'ready');
  settings.collectionId = ready.find(c => c.id === previous)?.id || ready.find(c => c.id === preferred)?.id || ready[0]?.id || '';
  return settings;
}
export async function signIn() {
  if (localStorage.getItem('vinil-logout-pending')) await logoutRequest();
  if (!configured()) throw new Error('A ligação Google ainda precisa de ser configurada no servidor.');
  window.location.assign('/auth/login');
  return new Promise(() => {});
}
export async function signOut() {
  settings.account = null;
  localStorage.setItem('vinil-logout-pending', '1');
  // Offline: a cópia local é removida já; a sessão remota termina antes do próximo acesso.
  try { if (navigator.onLine) await logoutRequest(); } catch { /* Repetir na próxima abertura/ligação. */ }
}
export async function api(name, payload) {
  if (!navigator.onLine) throw new Error('Esta função precisa de internet. A coleção guardada continua disponível.');
  if (!authenticated()) throw new Error('Entre novamente com Google para sincronizar.');
  if (!routes[name]) throw new Error('Operação desconhecida.');
  const response = await fetch(routes[name], { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Vinil-Request': '1', 'X-Vinil-Account': settings.account.id, 'X-Vinil-Collection': settings.collectionId || '' }, body: JSON.stringify(payload ?? {}) });
  const result = await response.json();
  if (response.status === 401) settings.account = null;
  if (!response.ok) throw new Error(result.error || 'Não foi possível concluir o pedido.');
  return result;
}
