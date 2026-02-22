import localforage from 'localforage';
import * as SupabaseService from '../../supabaseService';
import type { DbGlobalBaseFile } from '../../supabaseService';

// Configura o banco de dados IndexedDB via localforage
localforage.config({
  name: 'ChecklistFarma',
  storeName: 'cadastros_base', // Name of the object store
  description: 'Cache local para arquivos base globais pesados'
});

// Cache em memória para acesso ultrarrápido durante a sessão
const inMemoryCache = new Map<string, DbGlobalBaseFile>();

async function attachParsedFile(data: DbGlobalBaseFile & { _blob?: Blob, _parsedFile?: File }): Promise<DbGlobalBaseFile> {
  if (data._parsedFile) return data as DbGlobalBaseFile;

  try {
    let blob = data._blob;
    if (!blob && data.file_data_base64) {
      // Decode base64 to blob reliably (fetch with huge data URIs hangs on some browsers)
      const raw = data.file_data_base64;
      let mimeType = data.mime_type || 'application/octet-stream';
      let base64 = raw;
      if (raw.startsWith('data:')) {
        const parts = raw.split(',');
        base64 = parts[1];
        mimeType = parts[0].split(':')[1].split(';')[0];
      }

      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      blob = new Blob([bytes], { type: mimeType });
      data._blob = blob;
    }

    if (blob) {
      data._parsedFile = new File([blob], data.file_name, { type: data.mime_type || 'application/octet-stream' });
    }
  } catch (err) {
    console.error('Erro ao fazer parse assíncrono do arquivo:', err);
  }
  return data as DbGlobalBaseFile;
}

export const CadastrosBaseService = {
  /**
   * Obtém um arquivo base global do cache em memória, do cache local (se atualizado), 
   * ou baixa do Supabase (e salva nos caches).
   */
  async getGlobalBaseFileCached(companyId: string, moduleKey: string): Promise<DbGlobalBaseFile | null> {
    const cacheKey = `global_base_${companyId}_${moduleKey}`;
    console.log(`[CadastrosBaseService] Início de getGlobalBaseFileCached para ${moduleKey}`);
    const startTime = performance.now();

    try {
      // 0. Verifica cache em memória primeiro (Instantâneo)
      if (inMemoryCache.has(cacheKey)) {
        console.log(`[CadastrosBaseService] Memória HIT para ${moduleKey}`);
        const memData = inMemoryCache.get(cacheKey)!;

        // Em background, checa se tem atualização no supabase silenciosamente
        SupabaseService.fetchGlobalBaseFileMeta(companyId, moduleKey).then(async (remoteMeta) => {
          if (remoteMeta) {
            const remoteUpdated = remoteMeta.updated_at || remoteMeta.uploaded_at || '';
            const localUpdated = memData.updated_at || memData.uploaded_at || '';
            if (remoteUpdated !== localUpdated) {
              console.log(`[Background Update] Nova versão detectada para ${moduleKey}, baixando em segundo plano...`);
              const fullRemoteData = await SupabaseService.fetchGlobalBaseFileFull(companyId, moduleKey);
              if (fullRemoteData) {
                const preparedData = await attachParsedFile(fullRemoteData);
                // Salvar sem o base64 gigante para economizar espaço e tempo de leitura no IndexedDB
                const dataToSave = { ...preparedData, file_data_base64: null };
                await localforage.setItem(cacheKey, dataToSave);
                inMemoryCache.set(cacheKey, preparedData);
              }
            }
          }
        }).catch(err => console.error('Erro no update em background', err));

        return memData;
      }

      // 1. Pega os metadados (leves) do Supabase para verificar se há atualização
      const metaStart = performance.now();
      const remoteMeta = await SupabaseService.fetchGlobalBaseFileMeta(companyId, moduleKey);
      const metaEnd = performance.now();
      console.log(`[CadastrosBaseService] Etapa 1 - Fetch Meta Supabase (${moduleKey}): ${(metaEnd - metaStart).toFixed(2)}ms`);

      // 2. Verifica se temos algo em cache
      const cacheStart = performance.now();
      const cachedData: any = await localforage.getItem(cacheKey);
      const cacheEnd = performance.now();
      console.log(`[CadastrosBaseService] Etapa 2 - Leitura do IndexedDB (${moduleKey}): ${(cacheEnd - cacheStart).toFixed(2)}ms`);

      // Se temos metadados remotos, vamos comparar com o cache
      if (remoteMeta) {
        const remoteUpdated = remoteMeta.updated_at || remoteMeta.uploaded_at || '';
        const localUpdated = cachedData ? (cachedData.updated_at || cachedData.uploaded_at || '') : '';

        // O cache está atualizado!
        if (cachedData && remoteUpdated === localUpdated && (cachedData.file_data_base64 || cachedData._blob || cachedData._parsedFile)) {
          console.log(`[Cache OK] Usando arquivo local para: ${moduleKey}`);
          const preparedCachedData = await attachParsedFile(cachedData);
          inMemoryCache.set(cacheKey, preparedCachedData); // Registra em memória
          const totalTime = performance.now() - startTime;
          console.log(`[CadastrosBaseService] Tempo Total (CACHE HIT) para ${moduleKey}: ${totalTime.toFixed(2)}ms`);
          return preparedCachedData;
        }

        console.log(`[Cache Outdated/Missing] Baixando arquivo atualizado para: ${moduleKey}`);
        // Precisamos baixar o arquivo completo
        const downloadStart = performance.now();
        const fullRemoteData = await SupabaseService.fetchGlobalBaseFileFull(companyId, moduleKey);
        const downloadEnd = performance.now();
        console.log(`[CadastrosBaseService] Etapa 3 - Download Completo do Supabase (${moduleKey}): ${(downloadEnd - downloadStart).toFixed(2)}ms`);

        if (fullRemoteData) {
          // Salvar/Atualizar no cache
          const saveStart = performance.now();
          const preparedData = await attachParsedFile(fullRemoteData);

          // Salvar no IndexedDB tirando o Base64 pesado, já que temos o blob nativo
          const dataToSave = { ...preparedData, file_data_base64: null };
          await localforage.setItem(cacheKey, dataToSave);

          inMemoryCache.set(cacheKey, preparedData); // Registra em memória
          const saveEnd = performance.now();
          console.log(`[CadastrosBaseService] Etapa 4 - Salvando no IndexedDB (${moduleKey}): ${(saveEnd - saveStart).toFixed(2)}ms`);

          const totalTime = performance.now() - startTime;
          console.log(`[CadastrosBaseService] Tempo Total (DOWNLOAD E CACHE BUILD) para ${moduleKey}: ${totalTime.toFixed(2)}ms`);
          return preparedData;
        }
      }

      // Se falhou ao buscar do Supabase (offline, erro), tenta usar o cache
      if (cachedData) {
        console.warn(`[Supabase Offline/Erro] Usando cache antigo de fallback para: ${moduleKey}`);
        const preparedFallback = await attachParsedFile(cachedData);
        inMemoryCache.set(cacheKey, preparedFallback);
        return preparedFallback;
      }

      return null;
    } catch (error) {
      console.error('Erro na rotina de cache do CadastrosBase:', error);

      // Fallback estrito para offline
      try {
        const fallbackData = await localforage.getItem<DbGlobalBaseFile>(cacheKey);
        if (fallbackData) {
          console.log(`[Fallback] Retornando cache offline para: ${moduleKey}`);
          return fallbackData;
        }
      } catch (e) {
        console.error('Erro ao ler do cache offline:', e);
      }

      return null;
    }
  },

  /**
   * Limpa todo o cache (útil para logout ou reset)
   */
  async clearCache() {
    try {
      inMemoryCache.clear();
      await localforage.clear();
      console.log('Cache de Cadastros Base limpado.');
    } catch (error) {
      console.error('Erro ao limpar cache:', error);
    }
  }
};
