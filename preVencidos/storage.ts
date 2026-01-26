import type { DbPVSession } from '../supabaseService';

const LOCAL_PV_SESSION_PREFIX = 'PV_SESSION_';

const buildLocalSessionKey = (email: string) => {
  return `${LOCAL_PV_SESSION_PREFIX}${email.trim().toLowerCase()}`;
};

const deleteOtherSessions = (currentKey: string) => {
  const allKeys = Object.keys(window.localStorage);
  allKeys.forEach(key => {
    if (key.startsWith(LOCAL_PV_SESSION_PREFIX) && key !== currentKey) {
      window.localStorage.removeItem(key);
    }
  });
};

const deleteAllSessions = () => {
  const allKeys = Object.keys(window.localStorage);
  allKeys.forEach(key => {
    if (key.startsWith(LOCAL_PV_SESSION_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  });
};

const attemptSave = (storageKey: string, session: DbPVSession) => {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  } catch (error) {
    console.error('Erro ao salvar sessao PV local:', error);
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      deleteAllSessions();
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(session));
        console.info('Sessao PV salva depois de limpar o armazenamento.');
      } catch (retryError) {
        console.error('Falha persistindo sessao PV apos limpar o armazenamento:', retryError);
      }
    }
  }
};

export const loadLocalPVSession = (email: string): DbPVSession | null => {
  if (typeof window === 'undefined' || !email) return null;
  try {
    const key = buildLocalSessionKey(email);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('Erro ao carregar sessao PV local:', error);
    return null;
  }
};

export const saveLocalPVSession = (email: string, session: DbPVSession) => {
  if (typeof window === 'undefined' || !email) return;
  try {
    const key = buildLocalSessionKey(email);
    deleteOtherSessions(key);
    attemptSave(key, session);
  } catch (error) {
    console.error('Erro ao preparar armazenamento PV local:', error);
  }
};

export const clearLocalPVSession = (email: string) => {
  if (typeof window === 'undefined' || !email) return;
  try {
    window.localStorage.removeItem(buildLocalSessionKey(email));
  } catch (error) {
    console.error('Erro ao limpar sessao PV local:', error);
  }
};
