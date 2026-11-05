import { emptyState } from './core.mjs';
let database;
export async function openStore(account) {
  database?.close();
  database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('vinil-' + account, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('data');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const current = database;
  current.onversionchange = () => current.close();
  const owner = account.split('-api-')[0], key = 'vinil-databases-' + owner;
  const known = JSON.parse(localStorage.getItem(key) || '[]');
  localStorage.setItem(key, JSON.stringify([...new Set([...known, database.name])]));
}
export async function clearAccountStores(owner) {
  database?.close(); database = null;
  const key = 'vinil-databases-' + owner, names = JSON.parse(localStorage.getItem(key) || '[]');
  for (const name of names.filter(n => n.startsWith('vinil-' + owner + '-api-'))) await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = resolve; request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Fecha os outros separadores da aplicação para remover todas as cópias locais.'));
  });
  localStorage.removeItem(key);
}
export function closeStore() { database?.close(); database = null; }
export function get(key) {
  return new Promise((resolve, reject) => {
    if (!database) return resolve(undefined);
    const request = database.transaction('data').objectStore('data').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function set(key, value) {
  return new Promise((resolve, reject) => {
    if (!database) return reject(new Error('Entre na sua conta antes de guardar.'));
    const tx = database.transaction('data', 'readwrite');
    tx.objectStore('data').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Não foi possível guardar no dispositivo.'));
  });
}
export async function readState() { return await get('state') || emptyState(); }
export async function clearStore() {
  if (!database) return;
  await new Promise((resolve, reject) => {
    const tx = database.transaction('data', 'readwrite');
    tx.objectStore('data').clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  database.close(); database = null;
}
export function locked(fn) {
  return navigator.locks ? navigator.locks.request('vinil-storage', fn) : fn();
}
