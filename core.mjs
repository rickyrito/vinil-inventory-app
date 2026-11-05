export const emptyState = () => ({ discos: [], fila: [], atualizado: '' });
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function visibleRecords(state) {
  const records = new Map(state.discos.map(d => [d.id, { ...d }]));
  for (const op of state.fila) records.set(op.id, { ...records.get(op.id), ...op.disco, id: op.id, pendente: true, erroSync: op.erro || '' });
  return [...records.values()];
}
export function filterRecords(records, { tab = 'Coleção', search = '', genre = '', condition = '', sort = 'artist' } = {}) {
  const query = normalize(search);
  return records.filter(d => (tab === 'Empréstimos' ? !!d.emprestado : tab === 'Conflitos' ? d.situacao === 'Conflito' : d.lista === tab)
    && (!query || normalize([d.artista, d.titulo, d.ano, d.editora, d.catno, d.barcode, d.notas].join(' ')).includes(query))
    && (!genre || String(d.generos || '').split(',').map(s => s.trim()).includes(genre))
    && (!condition || d.estadoDisco === condition))
    .sort((a, b) => sort === 'year' ? Number(b.ano || 0) - Number(a.ano || 0)
      : sort === 'title' ? String(a.titulo || '').localeCompare(b.titulo || '', 'pt')
      : String(a.artista || '').localeCompare(b.artista || '', 'pt') || String(a.titulo || '').localeCompare(b.titulo || '', 'pt'));
}
export function enqueue(state, op) {
  if (state.fila.some(item => item.id === op.id)) throw new Error('Este disco tem alterações pendentes. Sincronize antes de voltar a editar.');
  return { ...state, fila: [...state.fila, op] };
}
export function acknowledge(state, op, response) {
  if (!response.ok) return { ...state, fila: state.fila.map(item => item.operacao === op.operacao
    ? { ...item, erro: 'O disco foi alterado noutro dispositivo.', servidor: response.disco || null } : item) };
  return { ...state, discos: [...state.discos.filter(d => d.id !== op.id), response.disco],
    fila: state.fila.filter(item => item.operacao !== op.operacao) };
}
export function resolveConflict(state, operation, useLocal) {
  const op = state.fila.find(item => item.operacao === operation);
  if (!op) return state;
  let next = { ...state, discos: state.discos.filter(d => d.id !== op.id), fila: state.fila.filter(item => item !== op) };
  if (op.servidor) next.discos.push(op.servidor);
  if (useLocal) next.fila.push({ ...op, operacao: crypto.randomUUID(), versao: op.servidor?.versao || '', erro: '', servidor: undefined });
  return next;
}
