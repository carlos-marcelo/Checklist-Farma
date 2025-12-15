import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload,
  FileText,
  Barcode,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Package,
  RotateCcw,
  Download,
  Search,
  Box,
  FileCode,
  FileSpreadsheet,
  ClipboardList,
  RefreshCw,
  Printer,
  ThumbsUp,
  TrendingUp,
  TrendingDown,
  Volume2,
  Tag,
  Ban,
  Eraser,
  Lock,
  Unlock,
  User,
  Building,
  PenTool,
  X,
  Pill
} from 'lucide-react';
import SignaturePad from './SignaturePad';
import * as SupabaseService from '../supabaseService';

const LOCAL_STOCK_SESSION_PREFIX = 'STOCK_SESSION_';
const buildLocalSessionKey = (email: string) => `${LOCAL_STOCK_SESSION_PREFIX}${email}`;

const loadLocalStockSession = (email: string): SupabaseService.DbStockConferenceSession | null => {
  if (typeof window === 'undefined' || !email) return null;
  try {
    const raw = window.localStorage.getItem(buildLocalSessionKey(email));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.error('Erro ao carregar sessão local de conferência:', error);
    return null;
  }
};

const saveLocalStockSession = (email: string, session: SupabaseService.DbStockConferenceSession) => {
  if (typeof window === 'undefined' || !email) return;
  try {
    // Limpar outras sessões antigas para liberar espaço
    const allKeys = Object.keys(window.localStorage);
    allKeys.forEach(key => {
      if (key.startsWith(LOCAL_STOCK_SESSION_PREFIX) && key !== buildLocalSessionKey(email)) {
        window.localStorage.removeItem(key);
      }
    });

    window.localStorage.setItem(buildLocalSessionKey(email), JSON.stringify(session));
  } catch (error) {
    console.error('❌ Erro ao salvar sessão local:', error);
    // Se falhar por quota, tentar limpar tudo e salvar novamente
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      try {
        // Limpar TODAS as sessões de estoque antigas
        const allKeys = Object.keys(window.localStorage);
        allKeys.forEach(key => {
          if (key.startsWith(LOCAL_STOCK_SESSION_PREFIX)) {
            window.localStorage.removeItem(key);
          }
        });
        // Tentar salvar novamente
        window.localStorage.setItem(buildLocalSessionKey(email), JSON.stringify(session));
        console.log('✅ Sessão salva após limpeza de espaço');
      } catch (retryError) {
        console.error('❌ Falha mesmo após limpeza:', retryError);
      }
    }
  }
};

const clearLocalStockSession = (email: string) => {
  if (typeof window === 'undefined' || !email) return;
  try {
    window.localStorage.removeItem(buildLocalSessionKey(email));
  } catch (error) {
    console.error('Erro ao limpar sessão local de conferência:', error);
  }
};

const getSessionTimestamp = (session?: SupabaseService.DbStockConferenceSession | null): number => {
  if (!session) return 0;
  const rawDate = session.updated_at || session.created_at || '';
  const parsed = Date.parse(rawDate);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const getSessionProgressScore = (session?: SupabaseService.DbStockConferenceSession | null): number => {
  if (!session || !Array.isArray(session.inventory)) return 0;
  return session.inventory.reduce((count, entry) => {
    if (!entry) return count;
    if (entry.last_updated) return count + 1;
    const qty = Number(entry.counted_qty ?? 0);
    if (!Number.isNaN(qty) && qty > 0) return count + 1;
    if (entry.status && entry.status !== 'pending') return count + 1;
    return count;
  }, 0);
};

// --- Types ---

interface Product {
  reducedCode: string;
  barcode: string;
  description: string;
}

interface StockItem {
  reducedCode: string;
  systemQty: number;
  countedQty: number;
  lastUpdated: Date | null;
  status: 'pending' | 'matched' | 'divergent';
}

type AppStep = 'setup' | 'conference' | 'divergence' | 'report';

interface StockConferenceProps {
  userEmail?: string;
  userName?: string;
  companies?: SupabaseService.DbCompany[];
}

interface CompanyAreaMatch {
  companyId: string;
  areaName: string;
}

const findCompanyAreaByBranch = (
  branchName: string,
  companies: SupabaseService.DbCompany[]
): CompanyAreaMatch | null => {
  if (!branchName) return null;
  const normalizedBranch = branchName.trim().toLowerCase();

  for (const company of companies) {
    if (!company || !company.areas) continue;
    for (const area of company.areas) {
      if (!area) continue;
      const branches = area.branches || [];
      for (const candidate of branches) {
        if (!candidate) continue;
        if (candidate.trim().toLowerCase() === normalizedBranch) {
          return {
            companyId: company.id || '',
            areaName: area.name || ''
          };
        }
      }
    }
  }

  return null;
};

// --- Audio Helper ---

const playSound = (type: 'success' | 'error') => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      // High pitch happy beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else {
      // Low pitch error buzz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

const playAccumulationBeep = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(640, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio play failed", e);
  }
};

// --- Parsers ---

// Simple CSV parser that tries to detect delimiter and headers
const parseCSV = (text: string): any[] => {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/"/g, ''));

  return lines.slice(1).map(line => {
    const values = line.split(delimiter).map(v => v.trim().replace(/"/g, ''));
    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = values[i];
    });
    return obj;
  });
};

// HTML Table parser
const parseHTML = (text: string): any[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];

  // Try to find headers in thead, otherwise use first row
  let headerRow = table.querySelector('thead tr');
  let dataRows: Element[] = [];

  if (headerRow) {
    // If thead exists, get rows from tbody
    dataRows = Array.from(table.querySelectorAll('tbody tr'));
    // If no tbody, just get rows after thead
    if (dataRows.length === 0) {
      const allRows = Array.from(table.querySelectorAll('tr'));
      const headerIndex = allRows.indexOf(headerRow as HTMLTableRowElement);
      dataRows = allRows.slice(headerIndex + 1);
    }
  } else {
    // No thead, assume first row is header
    const allRows = Array.from(table.querySelectorAll('tr'));
    if (allRows.length > 0) {
      headerRow = allRows[0];
      dataRows = allRows.slice(1);
    }
  }

  if (!headerRow) return [];

  const headers = Array.from(headerRow.querySelectorAll('th, td')).map(c => c.textContent?.trim().toLowerCase() || '');

  const results: any[] = [];
  dataRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    // Basic validation: row should have similar cell count or at least content
    if (cells.length === 0) return;

    const obj: any = {};
    cells.forEach((cell, i) => {
      if (headers[i]) {
        obj[headers[i]] = cell.textContent?.trim();
      }
    });
    // Only add if it has at least some data
    if (Object.keys(obj).length > 0) {
      results.push(obj);
    }
  });

  return results;
};

// Excel Parser using SheetJS
const parseExcel = async (file: File): Promise<any[]> => {
  const XLSX = (window as any).XLSX;
  if (!XLSX) {
    throw new Error("Biblioteca Excel não carregada. Verifique se o script foi carregado.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  if (!workbook.SheetNames.length) {
    throw new Error("Arquivo Excel vazio ou inválido.");
  }

  // Use first sheet
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Use header: "A" to get raw column letters (A, B, C...)
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: "A", defval: "" });
  return jsonData;
};

// More robust header normalization
const normalizeHeader = (h: any) => {
  if (!h) return '';
  const lower = String(h).toLowerCase().trim();

  // Reduced Code Variations
  if (lower === 'id' || lower === 'cod' || lower === 'código' || lower === 'codigo' || lower.includes('reduzido') || lower.includes('produto') && !lower.includes('desc')) return 'reducedCode';

  // Barcode Variations
  if (lower.includes('barra') || lower.includes('gtin') || lower.includes('ean')) return 'barcode';

  // Description Variations
  if (lower.includes('desc') || lower.includes('nome')) return 'description';

  // Quantity Variations
  if (lower.includes('qtd') || lower.includes('quant') || lower.includes('estoque') || lower.includes('saldo') || lower === 'q') return 'qty';

  return lower;
};

// Helper to safely parse numbers from various formats (1.000,00 or 1000.00)
const safeParseFloat = (value: any): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;

  let valStr = String(value).trim();
  if (!valStr) return 0;

  // Check for Brazilian format: contains comma, maybe dots for thousands
  // Pattern: digits with dots, ending with comma and digits: 1.234,56
  if (valStr.match(/^[0-9]{1,3}(\.[0-9]{3})*,\d+$/) || valStr.includes(',')) {
    // Remove dots (thousands separator)
    valStr = valStr.replace(/\./g, '');
    // Replace comma with dot (decimal separator)
    valStr = valStr.replace(',', '.');
  }

  const parsed = parseFloat(valStr);
  return isNaN(parsed) ? 0 : parsed;
};

// --- Main Component ---

export const StockConference = ({ userEmail, userName, companies = [] }: StockConferenceProps) => {
  const [step, setStep] = useState<AppStep>('setup');

  // Header Info State
  const [branch, setBranch] = useState('');
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [selectedAreaName, setSelectedAreaName] = useState('');
  const [pharmacist, setPharmacist] = useState('');
  const [manager, setManager] = useState('');

  // Data State
  const [masterProducts, setMasterProducts] = useState<Map<string, Product>>(new Map()); // Key: ReducedCode
  const [barcodeIndex, setBarcodeIndex] = useState<Map<string, string>>(new Map()); // Key: Barcode, Value: ReducedCode
  const [inventory, setInventory] = useState<Map<string, StockItem>>(new Map()); // Key: ReducedCode
  const [isControlledStock, setIsControlledStock] = useState(false); // New state for controlled products

  // Signatures State
  const [pharmSignature, setPharmSignature] = useState<string | null>(null);
  const [managerSignature, setManagerSignature] = useState<string | null>(null);

  // Recount State (Phase 2)
  const [recountTargets, setRecountTargets] = useState<Set<string>>(new Set());

  // UI State
  const [productFile, setProductFile] = useState<File | null>(null);
  const [stockFile, setStockFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Conference State
  const [scanInput, setScanInput] = useState('');
  const [activeItem, setActiveItem] = useState<Product | null>(null);
  const [countInput, setCountInput] = useState('');
  const [lastScanned, setLastScanned] = useState<{ item: StockItem, product: Product } | null>(null);
  const [accumulationMode, setAccumulationMode] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const [isSavingStockReport, setIsSavingStockReport] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const manualSessionStartedRef = useRef(false);

  // --- Effects ---

  useEffect(() => {
    // Re-initialize icons when component updates significantly
    if ((window as any).lucide) (window as any).lucide.createIcons();
  }, [step, activeItem]);

  // Auto-save session periodically during conference
  useEffect(() => {
    if (step !== 'conference' && step !== 'divergence') return;
    if (!userEmail) return;
    if (masterProducts.size === 0 || inventory.size === 0) return;

    // Save every 30 seconds
    const interval = setInterval(() => {
      console.log('⏰ Auto-saving session...');
      void persistSession();
    }, 30000);

    return () => clearInterval(interval);
  }, [step, userEmail, masterProducts.size, inventory.size]);

  // --- Calculations (Memoized for performance and Hook Stability) ---

  const stats = useMemo(() => {
    // Phase 2 Recount Logic: Calculate 0-100% based ONLY on recount targets
    if (recountTargets.size > 0) {
      let counted = 0;
      recountTargets.forEach(key => {
        const item = inventory.get(key);
        // We check lastUpdated to ensure we only count items processed in this session
        if (item && item.lastUpdated !== null) counted++;
      });
      return {
        total: recountTargets.size,
        counted,
        percent: recountTargets.size === 0 ? 0 : Math.round((counted / recountTargets.size) * 100),
        isRecount: true
      };
    }

    // Standard Logic
    let total = 0;
    let counted = 0;
    inventory.forEach((val) => {
      total++;
      if (val.lastUpdated !== null) counted++;
    });
    return {
      total,
      counted,
      percent: total === 0 ? 0 : Math.round((counted / total) * 100),
      isRecount: false
    };
  }, [inventory, recountTargets]);

  const recountPendingList = useMemo(() => {
    if (!stats.isRecount) return [];
    const list: { code: string, barcode: string, desc: string }[] = [];
    recountTargets.forEach(key => {
      const item = inventory.get(key);
      if (item && item.lastUpdated === null) {
        const prod = masterProducts.get(key);
        list.push({
          code: key,
          barcode: prod?.barcode || '-',
          desc: prod?.description || key
        });
      }
    });
    return list;
  }, [inventory, recountTargets, stats.isRecount, masterProducts]);

  const restoreSessionFromData = (session: SupabaseService.DbStockConferenceSession): boolean => {
    if (!session) return false;
    const prodMap = new Map<string, Product>();
    const barcodeMap = new Map<string, string>();
    (session.products || []).forEach(prod => {
      if (!prod || !prod.reduced_code) return;
      prodMap.set(prod.reduced_code, {
        reducedCode: prod.reduced_code,
        barcode: prod.barcode || '',
        description: prod.description || 'Sem descrição'
      });
      if (prod.barcode) {
        barcodeMap.set(prod.barcode, prod.reduced_code);
      }
    });

    const inventoryMap = new Map<string, StockItem>();
    (session.inventory || []).forEach(entry => {
      if (!entry || !entry.reduced_code) return;
      inventoryMap.set(entry.reduced_code, {
        reducedCode: entry.reduced_code,
        systemQty: entry.system_qty,
        countedQty: entry.counted_qty,
        status: entry.status,
        lastUpdated: entry.last_updated ? new Date(entry.last_updated) : null
      });
    });

    if (!prodMap.size || !inventoryMap.size) return false;

    setMasterProducts(prodMap);
    setBarcodeIndex(barcodeMap);
    setInventory(inventoryMap);
    const branchValue = session.branch || '';
    let resolvedCompanyId = session.company_id || '';
    let resolvedAreaName = session.area || '';

    if ((!resolvedCompanyId || !resolvedAreaName) && branchValue) {
      const match = findCompanyAreaByBranch(branchValue, companies || []);
      if (match) {
        if (!resolvedCompanyId) resolvedCompanyId = match.companyId;
        if (!resolvedAreaName) resolvedAreaName = match.areaName;
      }
    }

    setSelectedCompanyId(resolvedCompanyId);
    setBranch(branchValue);
    setSelectedAreaName(resolvedAreaName);
    setPharmacist(session.pharmacist || '');
    setManager(session.manager || '');
    setRecountTargets(new Set(session.recount_targets || []));
    const restoredStep = session.step && session.step !== 'report' ? session.step as AppStep : 'conference';
    setStep(restoredStep);
    setSessionId(session.id || null);
    manualSessionStartedRef.current = true;

    console.log('✅ Session restored from data:', { id: session.id, products: prodMap.size, inventory: inventoryMap.size });
    return true;
  };

  useEffect(() => {
    if (!userEmail) {
      console.log("⚠️ No userEmail, skipping session load");
      return;
    }

    let isMounted = true;
    const loadSession = async () => {
      console.log("🔍 Attempting to load session for:", userEmail, "manualStarted:", manualSessionStartedRef.current);

      if (manualSessionStartedRef.current) {
        console.log("ℹ️ Skipping load - manual session already started");
        return;
      }

      let supabaseSession: SupabaseService.DbStockConferenceSession | null = null;
      try {
        console.log("🔄 Fetching session from Supabase...");
        supabaseSession = await SupabaseService.fetchStockConferenceSession(userEmail);
        if (!isMounted) {
          console.log("⚠️ Component unmounted, aborting load");
          return;
        }
      } catch (error) {
        console.error("❌ Error loading session from Supabase:", error);
      }

      if (!isMounted) return;

      const localSession = loadLocalStockSession(userEmail);
      const supabaseTimestamp = getSessionTimestamp(supabaseSession);
      const localTimestamp = getSessionTimestamp(localSession);
      const supabaseScore = getSessionProgressScore(supabaseSession);
      const localScore = getSessionProgressScore(localSession);

      const supabaseCandidate = {
        session: supabaseSession,
        source: "supabase" as const,
        timestamp: supabaseTimestamp,
        score: supabaseScore
      };
      const localCandidate = {
        session: localSession,
        source: "local" as const,
        timestamp: localTimestamp,
        score: localScore
      };

      const orderedCandidates =
        localScore > supabaseScore || (localScore === supabaseScore && localTimestamp > supabaseTimestamp)
          ? [localCandidate, supabaseCandidate]
          : [supabaseCandidate, localCandidate];

      for (const candidate of orderedCandidates) {
        if (!candidate.session) continue;
        if (!isMounted) break;
        const restored = restoreSessionFromData(candidate.session);
        if (!restored) continue;
        console.log(`✅ Session restored from ${candidate.source === "local" ? "LocalStorage" : "Supabase"}`);
        if (candidate.source === "local") {
          console.log("🔁 Local session has priority, syncing it back to Supabase...");
          await persistSession();
        } else {
          saveLocalStockSession(userEmail, candidate.session);
        }
        return;
      }

      console.log("⚠️ No session found in Supabase or LocalStorage.");
    };

    loadSession();

    return () => {
      isMounted = false;
    };
  }, [userEmail, companies]);

  const persistSession = async (options?: {
    step?: AppStep;
    inventoryOverride?: Map<string, StockItem>;
    productOverride?: Map<string, Product>;
    recountOverride?: Set<string>;
  }) => {
    if (!userEmail) {
      console.error('❌ persistSession blocked: userEmail is missing.');
      return;
    }
    const productSource = options?.productOverride || masterProducts;
    const inventorySource = options?.inventoryOverride || inventory;

    // Allow saving empty session if step implies we are setting up, or prevent saving nothing?
    // If clearing, we might want to save an empty state. But here we check size > 0.
    if (productSource.size === 0 && inventorySource.size === 0) {
      console.warn('⚠️ persistSession ignored: No products or inventory to save.');
      return;
    }

    setIsSavingSession(true);
    const now = new Date().toISOString();
    const payload: SupabaseService.DbStockConferenceSession = {
      id: sessionId || undefined,
      user_email: userEmail,
      branch: branch || 'Filial não informada',
      area: selectedAreaName || null,
      company_id: selectedCompanyId || null,
      pharmacist: pharmacist || 'Farmacêutico não informado',
      manager: manager || 'Gestor não informado',
      products: Array.from(productSource.values()).map((prod: Product) => ({
        reduced_code: prod.reducedCode,
        barcode: prod.barcode || null,
        description: prod.description || null
      })),
      inventory: Array.from(inventorySource.values()).map((item: StockItem) => ({
        reduced_code: item.reducedCode,
        system_qty: item.systemQty,
        counted_qty: item.countedQty,
        status: item.status,
        last_updated: item.lastUpdated ? item.lastUpdated.toISOString() : null
      })),
      recount_targets: Array.from(options?.recountOverride || recountTargets),
      step: options?.step || step,
      updated_at: now
    };

    // Save to LocalStorage first (always works)
    saveLocalStockSession(userEmail, payload);
    console.log('💾 Session saved to LocalStorage');

    console.log('🔄 Persisting stock session to Supabase...', {
      email: userEmail,
      id: sessionId,
      products: payload.products.length,
      inventory: payload.inventory.length
    });

    try {
      const saved = await SupabaseService.upsertStockConferenceSession(payload);
      if (saved?.id) {
        setSessionId(saved.id);
        console.log('✅ Stock session saved to Supabase! ID:', saved.id);
      } else {
        console.error('❌ Supabase returned null - check error details');
      }
    } catch (error: any) {
      console.error('❌ Error persisting session to Supabase:', error);
      console.error('Error details:', {
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
    } finally {
      setIsSavingSession(false);
    }
  };

  const resetConferenceState = () => {
    setMasterProducts(new Map());
    setBarcodeIndex(new Map());
    setInventory(new Map());
    setRecountTargets(new Set());
    setActiveItem(null);
    setLastScanned(null);
    setAccumulationMode(false);
    setScanInput('');
    setCountInput('');
    setSessionId(null);
    setProductFile(null);
    setStockFile(null);
    setIsControlledStock(false);
    setErrorMsg('');
    manualSessionStartedRef.current = false;
  };

  const handleRestartSession = async () => {
    if (!window.confirm('Atenção: recomeçar a contagem perderá todos os itens bipados. Deseja continuar?')) {
      return;
    }

    resetConferenceState();
    clearLocalStockSession(userEmail || '');
    if (userEmail) {
      void SupabaseService.deleteStockConferenceSession(userEmail);
    }

    setStep('setup');
  };

  // --- Handlers: File Upload ---

  const processFile = async (file: File): Promise<any[]> => {
    const name = file.name.toLowerCase();

    if (name.endsWith('.html') || name.endsWith('.htm')) {
      const text = await file.text();
      return parseHTML(text);
    } else if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
      return parseExcel(file);
    } else {
      // Default to CSV
      const text = await file.text();
      return parseCSV(text);
    }
  };

  const handleFileUpload = async () => {
    if (!productFile || !stockFile) {
      setErrorMsg("Por favor, selecione ambos os arquivos.");
      return;
    }

    // Validate Header Info
    if (!branch.trim() || !pharmacist.trim() || !manager.trim()) {
      setErrorMsg("Por favor, preencha as informações da Filial e Responsáveis.");
      return;
    }

    // Start Loading
    setIsLoading(true);
    setErrorMsg('');
    manualSessionStartedRef.current = true;

    // Small timeout to allow UI to render the loading state before heavy processing
    setTimeout(async () => {
      try {
        // --- 1. PRODUCT FILE ---
        const pData = await processFile(productFile);
        if (!pData || pData.length === 0) throw new Error("Arquivo de Produtos vazio ou inválido.");

        const pMap = new Map<string, Product>();
        const bMap = new Map<string, string>();

        const isProdExcel = productFile.name.match(/\.(xls|xlsx)$/i);

        pData.forEach(row => {
          let reduced = '', barcode = '', desc = '';

          if (isProdExcel) {
            reduced = String(row['C'] || '').trim();
            barcode = String(row['K'] || '').trim();
            if (row['D']) desc = String(row['D']).trim();
            else if (row['B']) desc = String(row['B']).trim();
            else if (row['A']) desc = String(row['A']).trim();

            if (!/[0-9]/.test(reduced)) return;
            if (reduced.toLowerCase().includes('reduz') || reduced.toLowerCase().includes('cod')) return;

          } else {
            Object.keys(row).forEach(k => {
              const norm = normalizeHeader(k);
              const val = row[k];
              if (norm === 'reducedCode') reduced = String(val).trim();
              if (norm === 'barcode') barcode = String(val).trim();
              if (norm === 'description') desc = String(val).trim();
            });
          }

          if (reduced && reduced !== 'undefined' && reduced !== '') {
            pMap.set(reduced, { reducedCode: reduced, barcode, description: desc || 'Sem descrição' });
            if (barcode && barcode !== 'undefined' && barcode !== '') bMap.set(barcode, reduced);
          }
        });

        // --- 2. STOCK FILE ---
        const sData = await processFile(stockFile);
        if (!sData || sData.length === 0) throw new Error("Arquivo de Estoque vazio ou inválido.");

        const iMap = new Map<string, StockItem>();
        const isStockExcel = stockFile.name.match(/\.(xls|xlsx)$/i);

        sData.forEach(row => {
          let reduced = '', qty = 0, stockDesc = '';

          if (isStockExcel) {
            reduced = String(row['B'] || '').trim();
            // CONDITIONAL LOGIC FOR CONTROLLED PRODUCTS
            const val = isControlledStock ? row['L'] : row['O'];
            qty = safeParseFloat(val);

            if (row['C']) stockDesc = String(row['C']).trim();

            if (!/[0-9]/.test(reduced)) return;
            if (reduced.length > 20) return;
            if (reduced.toLowerCase().includes('cod')) return;

          } else {
            Object.keys(row).forEach(k => {
              const norm = normalizeHeader(k);
              const val = row[k];
              if (norm === 'reducedCode') reduced = String(val).trim();
              if (norm === 'qty') {
                qty = safeParseFloat(val);
              }
            });
          }

          if (reduced && reduced !== 'undefined' && reduced !== '') {
            // Update Master Product description if missing and present in stock file
            if (stockDesc && pMap.has(reduced)) {
              const prod = pMap.get(reduced)!;
              if (prod.description === 'Sem descrição' || prod.description === '') {
                prod.description = stockDesc;
                pMap.set(reduced, prod);
              }
            } else if (stockDesc && !pMap.has(reduced)) {
              pMap.set(reduced, { reducedCode: reduced, barcode: '', description: stockDesc });
            }

            const existingItem = iMap.get(reduced);
            if (existingItem) {
              existingItem.systemQty += qty;
              existingItem.systemQty = Math.round(existingItem.systemQty * 100) / 100;
            } else {
              iMap.set(reduced, {
                reducedCode: reduced,
                systemQty: qty,
                countedQty: 0,
                lastUpdated: null,
                status: 'pending'
              });
            }
          }
        });

        if (pMap.size === 0) throw new Error("Sem produtos válidos. Verifique as colunas (C=Reduzido, K=Barras).");
        if (iMap.size === 0) throw new Error("Sem estoque válido. Verifique as colunas (B=Reduzido, O=Qtd).");

        setMasterProducts(pMap);
        setBarcodeIndex(bMap);
        setInventory(iMap);
        setRecountTargets(new Set()); // Clear recount on new upload
        setStep('conference');
        await persistSession({
          step: 'conference',
          inventoryOverride: iMap,
          productOverride: pMap,
          recountOverride: new Set()
        });
      } catch (e: any) {
        console.error("Erro:", e);
        setErrorMsg(e.message || "Erro desconhecido.");
      } finally {
        setIsLoading(false);
      }
    }, 100);
  };

  // --- Handlers: Conference ---

  const findProduct = (code: string): Product | undefined => {
    if (masterProducts.has(code)) return masterProducts.get(code);
    if (barcodeIndex.has(code)) {
      const reduced = barcodeIndex.get(code);
      if (reduced) return masterProducts.get(reduced);
    }
    return undefined;
  };

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = scanInput.trim();
    if (!code) return;

    const product = findProduct(code);
    if (product) {
      // Validar se produto existe na lista de ESTOQUE
      if (!inventory.has(product.reducedCode)) {
        playSound('error');
        alert(`O produto "${product.description}" (Red: ${product.reducedCode}) não consta na lista de estoque carregada. Contagem não permitida para itens fora da lista.`);
        setScanInput('');
        return;
      }

      if (accumulationMode) {
        applyAccumulation(product);
        setActiveItem(null);
        setCountInput('');
        setScanInput('');
        setTimeout(() => inputRef.current?.focus(), 50);
        return;
      }

      setActiveItem(product);
      setScanInput('');
      setCountInput('');
      setTimeout(() => countRef.current?.focus(), 50);
    } else {
      playSound('error');
      alert("Produto não encontrado na base de cadastro!");
      setScanInput('');
    }
  };

  const applyAccumulation = async (product: Product) => {
    const currentStock = inventory.get(product.reducedCode);
    if (!currentStock) return;

    const nextQty = (currentStock.countedQty || 0) + 1;
    const status = nextQty === currentStock.systemQty ? 'matched' : 'divergent';

    const updatedItem: StockItem = {
      ...currentStock,
      countedQty: nextQty,
      status,
      lastUpdated: new Date()
    };

    const updatedInventory = new Map(inventory);
    updatedInventory.set(product.reducedCode, updatedItem);

    setInventory(updatedInventory);
    setLastScanned({ item: updatedItem, product });
    playAccumulationBeep();

    // Auto-save after accumulation
    await persistSession({ inventoryOverride: updatedInventory, step: 'conference' });
  };

  const handleQuantitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeItem) return;

    const qty = parseFloat(countInput);
    if (isNaN(qty)) return;

    const currentInv = inventory.get(activeItem.reducedCode);
    const systemQty = currentInv ? currentInv.systemQty : 0;
    const status = qty === systemQty ? 'matched' : 'divergent';

    // Play sound based on status
    playSound(status === 'matched' ? 'success' : 'error');

    const newItem: StockItem = {
      reducedCode: activeItem.reducedCode,
      systemQty: systemQty,
      countedQty: qty,
      lastUpdated: new Date(),
      status: status
    };
    const updatedInventory = new Map(inventory);
    updatedInventory.set(activeItem.reducedCode, newItem);
    setInventory(updatedInventory);
    setLastScanned({ item: newItem, product: activeItem });

    setActiveItem(null);
    setCountInput('');

    // Auto-save after each item counted
    await persistSession({ inventoryOverride: updatedInventory, step: 'conference' });

    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleZeroPending = () => {
    alert('Ação bloqueada! Não é permitido zerar a 1ª fase.');
    playSound('error');
  };

  const handleRecountAllDivergences = () => {
    // 1. Check for pending items (Rule: Cannot recount if pending items exist)
    let pendingCount = 0;
    inventory.forEach(i => { if (i.status === 'pending') pendingCount++; });

    if (pendingCount > 0) {
      playSound('error');
      alert(`Ação Bloqueada!\n\nAinda existem ${pendingCount} itens pendentes de contagem.\n\nRegra: Não é permitido iniciar recontagens sem terminar a contagem inicial de todos os produtos.\n\nSolução: Bipe os itens faltantes ou use a opção "Zerar Itens Pendentes" para encerrar a 1ª fase.`);
      return;
    }

    // 2. Identify divergent items
    const divergentKeys = new Set<string>();
    inventory.forEach((item, key) => {
      if (item.status === 'divergent') {
        divergentKeys.add(key);
      }
    });

    if (divergentKeys.size === 0) {
      alert("Não há itens divergentes para recontar.");
      return;
    }

    // 3. Reset those items in the inventory map
    const newInventory = new Map<string, StockItem>(inventory);
    divergentKeys.forEach(key => {
      const item = newInventory.get(key);
      if (item) {
        newInventory.set(key, {
          ...item,
          countedQty: 0,
          status: 'pending',
          lastUpdated: null // This ensures they show up as "pending" in stats
        });
      }
    });

    // 4. Update all states
    setInventory(newInventory);
    setRecountTargets(divergentKeys);
    setLastScanned(null); // Clear history for fresh start
    setActiveItem(null);
    setScanInput('');
    setStep('conference');
    void persistSession({ inventoryOverride: newInventory, step: 'conference', recountOverride: divergentKeys });

    // 5. Focus
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleFinalize = async () => {
    // 1. Strict Check: Phase 1 Completion (No Pending items allowed)
    // This applies to both Phase 1 (Initial) and Phase 2 (Recount) because recount resets items to pending.
    const pendingCount = Array.from(inventory.values()).filter((i: StockItem) => i.status === 'pending').length;

    if (pendingCount > 0) {
      playSound('error');
      alert(`Ação Bloqueada!\n\nExistem ${pendingCount} itens com status pendente.\n\nRegra: Não é permitido finalizar com itens não contados.\nSe estiver na Fase 1: Termine de contar ou zere os pendentes.\nSe estiver na Fase 2: Termine a recontagem de todos os itens.`);
      return;
    }

    // 2. Strict Check: Phase 2 Requirement (If Divergences exist, Recount must have been initiated)
    // We check if divergences exist AND we are NOT in recount mode (recountTargets.size == 0).
    // If stats.isRecount is true, it means we are in Phase 2 workflow (or finished it), so we rely on pending == 0 check above.
    // If stats.isRecount is false, it means we haven't started Phase 2.
    const divergentCount = Array.from(inventory.values()).filter((i: StockItem) => i.status === 'divergent').length;

    if (divergentCount > 0 && !stats.isRecount) {
      playSound('error');
      alert("Ação Bloqueada!\n\nForam encontradas divergências após a contagem inicial.\n\nRegra: É obrigatório iniciar e concluir a recontagem (2ª Fase) das divergências antes de finalizar.\n\nClique em 'Recontar Todas as Divergências' para prosseguir.");
      return;
    }

    // If passed all checks, persist to Supabase before showing final report
    const allItems = Array.from(inventory.values());
    const matched = allItems.filter(item => item.status === 'matched').length;
    const divergent = allItems.filter(item => item.status === 'divergent').length;
    const pending = allItems.filter(item => item.status === 'pending').length;
    const summary = {
      total: allItems.length,
      matched,
      divergent,
      pending,
      percent: stats.percent
    };

    const inventorySnapshot = allItems.map(item => {
      const product = masterProducts.get(item.reducedCode);
      return {
        reduced_code: item.reducedCode,
        barcode: product?.barcode || null,
        description: product?.description || null,
        system_qty: item.systemQty,
        counted_qty: item.countedQty,
        status: item.status,
        difference: item.countedQty - item.systemQty,
        last_updated: item.lastUpdated ? item.lastUpdated.toISOString() : null
      };
    });

    const payload = {
      user_email: userEmail?.trim() || 'desconhecido@empresa.com',
      user_name: userName?.trim() || 'Operador',
      branch: branch || 'Filial não informada',
      area: selectedAreaName || 'Área não informada',
      pharmacist: pharmacist || 'Farmacêutico não informado',
      manager: manager || 'Gestor não informado',
      summary,
      items: inventorySnapshot
    };

    setIsSavingStockReport(true);
    try {
      await SupabaseService.createStockConferenceReport(payload);
    } catch (error) {
      console.error('Erro ao salvar conferência de estoque:', error);
      alert('Não foi possível salvar o relatório no Supabase. O resultado será exibido localmente.');
    } finally {
      setIsSavingStockReport(false);
      manualSessionStartedRef.current = false;
      setSessionId(null);
      if (userEmail) {
        clearLocalStockSession(userEmail);
        try {
          await SupabaseService.deleteStockConferenceSession(userEmail);
        } catch (deleteError) {
          console.warn('Falha ao limpar sessão local após finalização:', deleteError);
        }
      }
      setStep('report');
    }
  };

  // Helper to determine display color for divergence
  const getDivergenceColor = (system: number, counted: number, status: string) => {
    if (status === 'matched') return 'text-green-600';
    if (counted > system) return 'text-blue-600'; // Positive
    return 'text-red-600'; // Negative
  };

  const branchOptions = useMemo(() => {
    if (!selectedCompanyId) return [];
    const company = companies.find(c => c.id === selectedCompanyId);
    if (!company || !company.areas) return [];
    const options: { branch: string; area: string }[] = [];
    company.areas.forEach(area => {
      (area.branches || []).forEach(branchName => {
        const normalized = branchName?.trim();
        if (!normalized) return;
        if (!options.some(opt => opt.branch === normalized)) {
          options.push({ branch: normalized, area: area.name });
        }
      });
    });
    return options;
  }, [companies, selectedCompanyId]);

  const handleBranchValueChange = (value: string) => {
    setBranch(value);
    const match = branchOptions.find(opt => opt.branch === value);
    setSelectedAreaName(match?.area || '');
  };

  // --- Render Helpers ---

  const renderSetup = () => (
    <div className="flex flex-col items-center justify-center min-h-full max-w-2xl mx-auto p-6 overflow-y-auto w-full">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-blue-900 mb-2">Conferência de Farmácia</h1>
        <p className="text-gray-500">Informe os dados e importe os arquivos para iniciar.</p>
      </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 w-full mb-8">
          <h3 className="font-semibold text-gray-700 mb-4 flex items-center border-b pb-2">
            <User className="w-5 h-5 mr-2 text-blue-500" />
            Responsáveis pela Conferência
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Empresa</label>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  const companyId = e.target.value;
                  setSelectedCompanyId(companyId);
                  setBranch('');
                  setSelectedAreaName('');
                }}
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring focus:ring-blue-100 outline-none bg-white text-gray-900 transition-all"
              >
                <option value="">-- Selecione uma empresa --</option>
                {companies.map(company => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Selecione a empresa para carregar as filiais cadastradas.</p>
            </div>
            {selectedCompanyId && branchOptions.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Filial</label>
                <select
                  value={branchOptions.some(opt => opt.branch === branch) ? branch : ''}
                  onChange={(e) => handleBranchValueChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring focus:ring-blue-100 outline-none bg-white text-gray-900 transition-all"
                >
                  <option value="">-- Escolha uma filial --</option>
                  {branchOptions.map(option => (
                    <option key={option.branch} value={option.branch}>
                      {option.branch}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Área</label>
              <input
                type="text"
                value={selectedAreaName}
                disabled
                placeholder="Selecione uma filial para preencher a área automaticamente"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Farmacêutico(a)</label>
                <div className="relative">
                <User className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={pharmacist}
                  onChange={(e) => setPharmacist(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring focus:ring-blue-100 outline-none bg-white text-gray-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Gestor(a)</label>
              <div className="relative">
                <User className="absolute left-3 top-3 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={manager}
                  onChange={(e) => setManager(e.target.value)}
                  placeholder="Nome completo"
                  className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring focus:ring-blue-100 outline-none bg-white text-gray-900"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
        <div className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-colors ${productFile ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
          <FileSpreadsheet className={`w-10 h-10 mb-3 ${productFile ? 'text-green-500' : 'text-gray-400'}`} />
          <h3 className="font-semibold text-gray-700 mb-1 text-sm">Arquivo de Produtos</h3>
          <p className="text-[10px] text-gray-500 text-center mb-3">Base (Excel: C=Red, K=Barra, D=Desc)</p>
          <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-xs font-bold transition">
            {productFile ? productFile.name : 'Selecionar Arquivo'}
            <input type="file" accept=".csv,.txt,.html,.htm,.xls,.xlsx" className="hidden" onChange={(e) => setProductFile(e.target.files?.[0] || null)} />
          </label>
        </div>

        <div className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-colors ${stockFile ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-blue-400'}`}>
          <FileSpreadsheet className={`w-12 h-12 mb-4 ${stockFile ? 'text-green-500' : 'text-gray-400'}`} />
          <h3 className="font-semibold text-gray-700 mb-2">Arquivo de Estoque</h3>

          <div className="flex items-center mb-4 bg-white px-3 py-2 rounded-lg border border-gray-200 shadow-sm w-full max-w-[250px] justify-center">
            <input
              type="checkbox"
              id="controlledStock"
              checked={isControlledStock}
              onChange={(e) => setIsControlledStock(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 border-gray-300 mr-2"
            />
            <label htmlFor="controlledStock" className="text-xs text-gray-600 font-medium cursor-pointer select-none flex items-center">
              <Pill className="w-3 h-3 mr-1 text-blue-500" />
              Produtos Controlados?
            </label>
          </div>

          <p className="text-xs text-gray-500 text-center mb-4">Estoque (Excel: B=Red, {isControlledStock ? 'L' : 'O'}=Qtd)</p>
          <label className="cursor-pointer bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm transition">
            {stockFile ? stockFile.name : 'Selecionar Arquivo'}
            <input type="file" accept=".csv,.txt,.html,.htm,.xls,.xlsx" className="hidden" onChange={(e) => setStockFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      </div>

      {errorMsg && (
        <div className="mb-6 p-4 bg-red-100 text-red-700 rounded-lg flex items-center w-full">
          <AlertTriangle className="w-5 h-5 mr-2 flex-shrink-0" />
          <span className="text-sm">{errorMsg}</span>
        </div>
      )}

      <button
        onClick={handleFileUpload}
        disabled={isLoading}
        className={`w-full py-4 rounded-xl text-lg font-bold shadow-lg transition transform active:scale-95 flex items-center justify-center ${isLoading
          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
          : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
      >
        {isLoading ? 'Processando...' : 'Iniciar Conferência'}
        {!isLoading && <ArrowRight className="ml-2 w-5 h-5" />}
      </button>

      <div className="mt-8 text-xs text-gray-400 text-center">
        <p>Formatos suportados: CSV, HTML, Excel (.xls, .xlsx)</p>
      </div>
    </div>
  );

  const renderConference = () => {
    // Get System Qty for active item
    const activeSystemQty = activeItem ? (inventory.get(activeItem.reducedCode)?.systemQty || 0) : 0;

    return (
      <div className="flex flex-col h-full bg-gray-100">
        {/* Header Bar */}
        <header className="bg-white shadow-sm p-4 flex justify-between items-center z-10 sticky top-0">
          <div className="flex items-center">
            <ClipboardList className="w-6 h-6 text-blue-600 mr-2" />
            <h1 className="font-bold text-gray-800 hidden md:block">Conferência</h1>
          </div>

          {/* Progress Bar Section - Enhanced */}
          <div className="flex-1 max-w-xl mx-4">
            <div className="flex justify-between text-xs text-gray-500 uppercase font-semibold mb-1">
              <span className={stats.isRecount ? "text-orange-600" : "text-blue-600"}>
                {stats.isRecount ? 'Progresso Recontagem' : 'Progresso Geral'}
              </span>
              <span className="font-mono text-gray-700">{stats.counted} / {stats.total} ({stats.percent}%)</span>
            </div>
            <div className="w-full h-4 bg-gray-200 rounded-full overflow-hidden shadow-inner border border-gray-300">
              <div
                className={`h-full transition-all duration-500 ease-out flex items-center justify-center text-[9px] font-bold text-white uppercase ${stats.isRecount ? 'bg-orange-500' : (stats.percent === 100 ? 'bg-green-500' : 'bg-blue-600')}`}
                style={{ width: `${stats.percent}%` }}
              >
                {stats.percent > 10 && `${stats.percent}%`}
              </div>
            </div>
            {/* Auto-save indicator */}
            <div className="flex items-center justify-end mt-1">
              {isSavingSession ? (
                <span className="text-[10px] text-blue-600 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Salvando...
                </span>
              ) : sessionId ? (
                <span className="text-[10px] text-green-600 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" />
                  Salvo automaticamente
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-end space-y-1">
            <div className="flex items-center space-x-2">
              <button
                onClick={handleRestartSession}
                className="bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-wide hover:bg-red-100 transition disabled:opacity-70"
              >
                Recomeçar contagem
              </button>
              <button
                onClick={() => setStep('divergence')}
                className="bg-indigo-50 text-indigo-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-100 transition border border-indigo-200 whitespace-nowrap"
              >
                Ver Conferência
              </button>
            </div>
            <p className="text-[10px] text-red-500 uppercase tracking-wide">
              Aviso: tudo que foi bipado será perdido ao reiniciar.
            </p>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto w-full flex flex-col">

          <div className="bg-white rounded-2xl shadow-lg overflow-hidden flex flex-col md:flex-row min-h-[400px]">

            {/* Left: Input Section */}
            <div className="p-8 flex-1 flex flex-col justify-center border-b md:border-b-0 md:border-r border-gray-100">

              {!activeItem ? (
                // State: Scan Product
                <div className="flex flex-col h-full justify-center">
                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="text-gray-500 text-sm font-semibold uppercase">Bipar Codigo de Barras ou Reduzido</label>
                    <div className="flex items-center gap-2">
                      {stats.isRecount && <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase border border-orange-200">Modo Recontagem</span>}
                      <button
                        type="button"
                        onClick={() => setAccumulationMode(prev => !prev)}
                        className={`text-[10px] font-bold uppercase tracking-wide px-3 py-1 rounded-full border transition focus:outline-none ${accumulationMode ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-200 hover:text-blue-600'}`}
                      >
                        {accumulationMode ? 'ACUMULO ATIVO' : 'ATIVAR ACUMULO'}
                      </button>
                    </div>
                  </div>
                  <form onSubmit={handleScanSubmit} className="relative">
                    <Barcode className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-6 h-6" />
                    <input
                      ref={inputRef}
                      autoFocus
                      type="text"
                      value={scanInput}
                      onChange={(e) => setScanInput(e.target.value)}
                      placeholder="Aguardando leitura..."
                      className={`w-full pl-12 pr-4 py-6 text-2xl font-mono border-2 rounded-xl focus:ring transition outline-none text-gray-800 placeholder-gray-300 ${stats.isRecount ? 'border-orange-200 bg-orange-50/30 focus:border-orange-500 focus:ring-orange-200' : 'border-blue-100 bg-blue-50/30 focus:border-blue-500 focus:ring-blue-200'}`}
                    />
                  </form>
                  {accumulationMode && (
                    <p className="mt-3 text-center text-xs text-emerald-600">
                      Cada bip soma 1 unidade ao produto atual automaticamente.
                    </p>
                  )}
                  <p className="mt-4 text-center text-gray-400 text-sm">
                    Pressione Enter após digitar se não estiver usando scanner.
                  </p>
                </div>
              ) : (
                // State: Enter Quantity
                <div className="flex flex-col h-full justify-center animate-fade-in">
                  <div className="mb-6">
                    <span className={`inline-block px-2 py-1 text-xs font-bold rounded mb-2 ${stats.isRecount ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                      {stats.isRecount ? 'RECONTAGEM' : 'PRODUTO IDENTIFICADO'}
                    </span>
                    <h2 className="text-2xl md:text-3xl font-bold text-gray-800 leading-tight mb-2">{activeItem.description}</h2>
                    <div className="flex flex-wrap items-center gap-2 mt-4">
                      <div className="flex items-center bg-gray-100 border border-gray-200 px-3 py-2 rounded-lg">
                        <Tag className="w-4 h-4 text-gray-500 mr-2" />
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-gray-400 font-bold leading-none">Reduzido</span>
                          <span className="font-mono font-bold text-gray-700 text-lg leading-tight">{activeItem.reducedCode}</span>
                        </div>
                      </div>
                      <div className="flex items-center bg-gray-100 border border-gray-200 px-3 py-2 rounded-lg">
                        <Barcode className="w-4 h-4 text-gray-500 mr-2" />
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-gray-400 font-bold leading-none">Cód. Barras</span>
                          <span className="font-mono font-bold text-gray-700 text-lg leading-tight">{activeItem.barcode || '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleQuantitySubmit} className="mb-4">
                    <div className="grid grid-cols-2 gap-4 mb-2">
                      <div>
                        <label className="text-gray-400 text-xs font-bold uppercase mb-1 block">Estoque Sistema</label>
                        <div className="px-4 py-4 bg-gray-100 rounded-xl text-2xl font-bold text-gray-500 text-center font-mono border border-gray-200">
                          {activeSystemQty}
                        </div>
                      </div>
                      <div>
                        <label className="text-blue-600 text-xs font-bold uppercase mb-1 block">Contagem Física</label>
                        <input
                          ref={countRef}
                          type="number"
                          step="0.01"
                          value={countInput}
                          onChange={(e) => setCountInput(e.target.value)}
                          placeholder="?"
                          className="w-full px-4 py-4 text-3xl font-bold border-2 border-blue-500 rounded-xl focus:ring focus:ring-blue-200 outline-none text-center bg-white text-blue-900 shadow-inner"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition shadow-lg mt-2 flex items-center justify-center"
                    >
                      Confirmar Contagem <CheckCircle className="ml-2 w-5 h-5" />
                    </button>
                  </form>

                  <button
                    onClick={() => { setActiveItem(null); setScanInput(''); setTimeout(() => inputRef.current?.focus(), 50); }}
                    className="text-gray-400 hover:text-red-500 text-sm underline text-center"
                  >
                    Cancelar / Escanear outro
                  </button>
                </div>
              )}
            </div>

            {/* Right: Info / History Section */}
            <div className="bg-gray-50 w-full md:w-1/3 p-6 flex flex-col border-l border-gray-100">

              {/* Conditional: Recount Queue OR History */}
              {stats.isRecount && !activeItem ? (
                <div className="flex-1 flex flex-col">
                  <h3 className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-4 flex items-center">
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Itens para Recontar ({recountPendingList.length})
                  </h3>
                  {recountPendingList.length === 0 ? (
                    <div className="text-center py-10 text-green-600">
                      <CheckCircle className="w-8 h-8 mx-auto mb-2" />
                      <p className="font-bold">Recontagem Finalizada!</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto pr-1">
                      <div className="space-y-2">
                        {recountPendingList.map(item => (
                          <div
                            key={item.code}
                            className="bg-white p-3 rounded-lg border border-orange-100 shadow-sm hover:border-orange-300 cursor-pointer transition"
                            onClick={() => {
                              const prod = masterProducts.get(item.code);
                              if (prod) {
                                setActiveItem(prod);
                                setCountInput('');
                                setTimeout(() => countRef.current?.focus(), 50);
                              }
                            }}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="bg-gray-100 text-gray-500 text-[10px] px-1.5 py-0.5 rounded font-mono border border-gray-200">Red: {item.code}</span>
                              <span className="bg-gray-100 text-gray-500 text-[10px] px-1.5 py-0.5 rounded font-mono border border-gray-200">EAN: {item.barcode}</span>
                            </div>
                            <p className="text-sm font-medium text-gray-700 line-clamp-2">{item.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-8">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Última Conferência</h3>
                  {lastScanned ? (
                    <div className={`p-4 rounded-xl border ${lastScanned.item.status === 'matched' ? 'bg-green-50 border-green-200' : (lastScanned.item.countedQty > lastScanned.item.systemQty ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200')}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div className={`p-1 rounded-full ${lastScanned.item.status === 'matched' ? 'bg-green-200 text-green-700' : (lastScanned.item.countedQty > lastScanned.item.systemQty ? 'bg-blue-200 text-blue-700' : 'bg-red-200 text-red-700')}`}>
                          {lastScanned.item.status === 'matched' ? <CheckCircle className="w-5 h-5" /> : (lastScanned.item.countedQty > lastScanned.item.systemQty ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />)}
                        </div>
                        <span className="text-xs font-mono text-gray-500">{new Date().toLocaleTimeString()}</span>
                      </div>
                      <p className="font-semibold text-gray-800 text-sm line-clamp-2 mb-2">{lastScanned.product.description}</p>
                      <div className="flex justify-between text-sm border-t border-gray-200/50 pt-2">
                        <div className="flex flex-col">
                          <span className="text-xs text-gray-500">Sistema</span>
                          <span className="font-mono font-bold">{lastScanned.item.systemQty}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-gray-500">Contagem</span>
                          <span className={`font-mono font-bold ${getDivergenceColor(lastScanned.item.systemQty, lastScanned.item.countedQty, lastScanned.item.status)}`}>
                            {lastScanned.item.countedQty}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-gray-400 text-sm italic text-center py-4">Nenhum item conferido ainda.</div>
                  )}
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-gray-200">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                    <span className="text-xs text-gray-400">Total {stats.isRecount ? 'Recontagem' : 'Itens'}</span>
                    <p className="text-xl font-bold text-gray-700">{stats.total}</p>
                  </div>
                  <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-100">
                    <span className="text-xs text-gray-400">Falta Contar</span>
                    <p className="text-xl font-bold text-orange-500">
                      {stats.total - stats.counted}
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </main>
      </div>
    );
  };

  const renderDivergence = () => {
    // Explicitly type items to prevent "unknown" errors
    const allStockItems: StockItem[] = Array.from(inventory.values());

    const divergentItems = allStockItems
      .filter(item => item.status === 'divergent')
      .map(item => ({
        item,
        product: masterProducts.get(item.reducedCode)
      }));

    const matchedItems = allStockItems
      .filter(item => item.status === 'matched')
      .map(item => ({
        item,
        product: masterProducts.get(item.reducedCode)
      }));

    const pendingItems = allStockItems.filter(i => i.status === 'pending');

    // Determine blocking state for Finalize
    const isPendingBlocking = pendingItems.length > 0;
    const isRecountBlocking = divergentItems.length > 0 && !stats.isRecount;
    const isFinalizeBlocked = isPendingBlocking || isRecountBlocking;

    const handleReturnToConference = () => {
      setStep('conference');
      setActiveItem(null);
      setScanInput('');
      setTimeout(() => inputRef.current?.focus(), 50);
    };

    return (
      <div className="flex flex-col h-full bg-gray-50">
        <header className="bg-white shadow-sm p-4">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleReturnToConference}
                  className="flex items-center gap-2 rounded-2xl px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-semibold shadow-lg hover:from-indigo-700 hover:to-blue-700 transition"
                >
                  <RotateCcw className="w-5 h-5" />
                  Voltar para Contagem
                </button>
                <h1 className="font-bold text-gray-800 text-lg">Fase 2: Divergências & Conferência</h1>
              </div>
              <p className="text-xs text-gray-500 max-w-xl">
                Este botão leva de volta à etapa de conferência para ajustar manualmente os itens com divergência antes de finalizar.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {divergentItems.length > 0 && (
                <button
                  onClick={handleRecountAllDivergences}
                  className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold transition shadow-lg ${pendingItems.length > 0
                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                    : 'bg-gradient-to-r from-amber-500 to-amber-600 text-white border-transparent hover:from-amber-600 hover:to-amber-700'
                    }`}
                  title={pendingItems.length > 0 ? "Termine os itens pendentes antes de recontar" : "Iniciar recontagem"}
                >
                  {!pendingItems.length ? <RefreshCw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                  Recontar Todas as Divergências
                </button>
              )}
              <button
                onClick={handleFinalize}
                disabled={isFinalizeBlocked || isSavingStockReport}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm flex items-center ${isFinalizeBlocked || isSavingStockReport
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed hover:bg-gray-300'
                  : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                title={isFinalizeBlocked ? "Conclua todas as pendências e recontagens para liberar" : (isSavingStockReport ? "Salvando relatório..." : "Gerar Relatório Final")}
              >
                {!isSavingStockReport && (isFinalizeBlocked ? <Lock className="w-4 h-4 mr-2" /> : <Unlock className="w-4 h-4 mr-2" />)}
                {isSavingStockReport ? 'Salvando relatório...' : 'Finalizar e Gerar Relatório'}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">

          <div className="grid grid-cols-1 gap-6">

            {/* 1. Divergences */}
            {divergentItems.length > 0 && (
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="bg-red-50 p-4 border-b border-red-100 flex justify-between items-center">
                  <h2 className="font-bold text-red-800 flex items-center">
                    <AlertTriangle className="w-5 h-5 mr-2" />
                    Itens com Divergência ({divergentItems.length})
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                      <tr>
                        <th className="p-4">Produto</th>
                        <th className="p-4 text-center">Sistema</th>
                        <th className="p-4 text-center">Contagem</th>
                        <th className="p-4 text-center">Dif</th>
                        <th className="p-4 text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {divergentItems.map(({ item, product }) => {
                        const diff = item.countedQty - item.systemQty;
                        const isPositive = diff > 0;
                        return (
                          <tr key={item.reducedCode} className="hover:bg-gray-50">
                            <td className="p-4">
                              <div className="font-semibold text-gray-800">{product?.description || 'Item Desconhecido'}</div>
                              <div className="text-xs text-gray-400 font-mono">Red: {item.reducedCode}</div>
                            </td>
                            <td className="p-4 text-center font-mono">{item.systemQty}</td>
                            <td className={`p-4 text-center font-mono font-bold ${isPositive ? 'text-blue-600' : 'text-red-600'}`}>{item.countedQty}</td>
                            <td className={`p-4 text-center font-mono ${isPositive ? 'text-blue-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : ''}{diff}
                            </td>
                            <td className="p-4 text-right">
                              <button
                                onClick={() => {
                                  // Can only allow individual recount if phase 1 complete, or just let them count?
                                  // User logic implies strictness, but individual manual fix might be ok.
                                  // Let's stick to global rule for simplicity or check pending.
                                  if (pendingItems.length > 0) {
                                    alert("Atenção: Finalize os itens pendentes antes de recontar.");
                                    return;
                                  }
                                  setActiveItem(product || null);
                                  setScanInput('');
                                  setStep('conference');
                                  setTimeout(() => countRef.current?.focus(), 100);
                                }}
                                className="text-blue-600 hover:text-blue-800 font-medium text-xs border border-blue-200 px-3 py-1 rounded hover:bg-blue-50"
                              >
                                Recontar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 2. Pending Items */}
            {pendingItems.length > 0 && (
              <div className="bg-white rounded-xl shadow overflow-hidden border border-orange-100">
                <div className="bg-orange-50 p-4 border-b border-orange-100 flex justify-between items-center">
                  <h2 className="font-bold text-orange-800 flex items-center">
                    <Package className="w-5 h-5 mr-2" />
                    Itens Pendentes ({pendingItems.length})
                  </h2>
                  <button
                    disabled
                    className="text-xs font-bold text-orange-400 bg-gray-200 border border-gray-100 px-3 py-1.5 rounded cursor-not-allowed flex items-center"
                  >
                    <Eraser className="w-3 h-3 mr-1" />
                    Zerar Pendentes (Finalizar 1ª Fase)
                  </button>
                </div>
                <div className="p-4">
                  <p className="text-sm text-gray-500 mb-4">Estes itens constam no estoque mas ainda não foram bipados. Você deve bipá-los ou zerá-los para prosseguir.</p>
                  <div className="max-h-60 overflow-y-auto border rounded bg-gray-50 p-2">
                    {pendingItems.map(item => {
                      const prod = masterProducts.get(item.reducedCode);
                      return (
                        <div key={item.reducedCode} className="flex justify-between items-center p-2 border-b border-gray-200 last:border-0 text-xs hover:bg-gray-100">
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-700">{prod?.description || item.reducedCode}</span>
                            <span className="text-gray-400 text-[10px]">{item.reducedCode}</span>
                          </div>
                          <span className="font-mono bg-gray-200 px-2 py-0.5 rounded text-gray-600">Qtd: {item.systemQty}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 3. Matched Items (New Section) */}
            {matchedItems.length > 0 && (
              <div className="bg-white rounded-xl shadow overflow-hidden border border-green-100">
                <div className="bg-green-50 p-4 border-b border-green-100 cursor-pointer" onClick={() => { }}>
                  <h2 className="font-bold text-green-800 flex items-center">
                    <ThumbsUp className="w-5 h-5 mr-2" />
                    Itens Conferidos e Corretos ({matchedItems.length})
                  </h2>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b sticky top-0">
                      <tr>
                        <th className="p-4">Produto</th>
                        <th className="p-4 text-center">Quantidade</th>
                        <th className="p-4 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {matchedItems.map(({ item, product }) => (
                        <tr key={item.reducedCode} className="hover:bg-gray-50">
                          <td className="p-3 pl-4">
                            <div className="font-medium text-gray-700">{product?.description || 'Item Desconhecido'}</div>
                            <div className="text-xs text-gray-400 font-mono">Red: {item.reducedCode}</div>
                          </td>
                          <td className="p-3 text-center font-mono text-green-700 font-bold">{item.countedQty}</td>
                          <td className="p-3 pr-4 text-right">
                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-semibold">OK</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {divergentItems.length === 0 && pendingItems.length === 0 && matchedItems.length === 0 && (
              <div className="text-center py-20">
                <p className="text-gray-400">Nenhum dado carregado.</p>
              </div>
            )}

          </div>
        </main>
      </div>
    );
  };

  const renderReport = () => {
    const allItems: StockItem[] = Array.from(inventory.values());
    const matched = allItems.filter(i => i.status === 'matched').length;
    const divergent = allItems.filter(i => i.status === 'divergent').length;
    const pending = allItems.filter(i => i.status === 'pending').length;

    const signaturesComplete = pharmSignature && managerSignature;

    const exportCSV = () => {
      const headers = "Codigo Reduzido;Descricao;Estoque Sistema;Contagem;Diferenca;Status\n";
      const rows = allItems.map((item: StockItem) => {
        const prod = masterProducts.get(item.reducedCode);
        const diff = item.countedQty - item.systemQty;
        return `${item.reducedCode};"${prod?.description || ''}";${item.systemQty};${item.countedQty};${diff};${item.status}`;
      }).join("\n");

      const blob = new Blob([headers + rows], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `conferencia_${branch.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
    };

    const exportPDF = () => {
      const jsPDF = (window as any).jspdf.jsPDF;
      if (!jsPDF) {
        alert("Erro: Biblioteca PDF não carregada.");
        return;
      }

      const doc = new jsPDF();
      const dateStr = new Date().toLocaleDateString('pt-BR');

      // Header
      doc.setFontSize(18);
      doc.text("Relatório de Conferência de Estoque", 14, 20);

      doc.setFontSize(10);
      doc.text(`Filial: ${branch}`, 14, 28);
      doc.text(`Data: ${dateStr}`, 14, 33);
      doc.text(`Farmacêutico(a): ${pharmacist}`, 14, 38);
      doc.text(`Gestor(a): ${manager}`, 14, 43);

      // Statistics
      doc.text(`Total Itens: ${allItems.length}`, 14, 53);
      doc.setTextColor(0, 128, 0);
      doc.text(`Corretos: ${matched}`, 14, 58);
      doc.setTextColor(200, 0, 0);
      doc.text(`Divergentes: ${divergent}`, 60, 58);
      doc.setTextColor(100, 100, 100);
      doc.text(`Não Contados: ${pending}`, 110, 58);
      doc.setTextColor(0, 0, 0);

      // Table Data
      const tableColumn = ["Reduzido", "Descrição", "Sistema", "Contagem", "Diferença", "Status"];
      const tableRows: any[] = [];

      // Sort: Divergent first, then pending, then matched
      const sortedItems = [...allItems].sort((a, b) => {
        const order = { divergent: 0, pending: 1, matched: 2 };
        return order[a.status] - order[b.status];
      });

      sortedItems.forEach(item => {
        const prod = masterProducts.get(item.reducedCode);
        const diff = item.countedQty - item.systemQty;
        const statusMap = {
          'matched': 'OK',
          'divergent': 'DIVERGENTE',
          'pending': 'PENDENTE'
        };

        const rowData = [
          item.reducedCode,
          prod?.description || '',
          item.systemQty.toString(),
          item.countedQty.toString(),
          diff.toString(),
          (statusMap as any)[item.status]
        ];
        tableRows.push(rowData);
      });

      (doc as any).autoTable({
        startY: 65,
        head: [tableColumn],
        body: tableRows,
        theme: 'grid',
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 133, 244] },
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            const diffVal = parseFloat(data.row.raw[4]);
            if (data.column.index === 4 || data.column.index === 5) {
              if (diffVal > 0) {
                data.cell.styles.textColor = [0, 0, 255];
                data.cell.styles.fontStyle = 'bold';
              } else if (diffVal < 0) {
                data.cell.styles.textColor = [200, 0, 0];
                data.cell.styles.fontStyle = 'bold';
              } else {
                data.cell.styles.textColor = [0, 128, 0];
              }
            }
          }
        }
      });

      // Signatures Footer
      const finalY = (doc as any).lastAutoTable.finalY + 20;

      // Page break if needed
      if (finalY > 250) {
        doc.addPage();
        doc.text("Assinaturas", 14, 20);
      }

      const sigY = finalY > 250 ? 30 : finalY;

      // Add Pharmacist Sig
      if (pharmSignature) {
        doc.addImage(pharmSignature, 'PNG', 20, sigY, 60, 30);
        doc.line(20, sigY + 30, 80, sigY + 30);
        doc.setFontSize(8);
        doc.text("Farmacêutico(a) Responsável", 20, sigY + 35);
        doc.text(pharmacist, 20, sigY + 39);
      }

      // Add Manager Sig
      if (managerSignature) {
        doc.addImage(managerSignature, 'PNG', 110, sigY, 60, 30);
        doc.line(110, sigY + 30, 170, sigY + 30);
        doc.setFontSize(8);
        doc.text("Gestor(a) Responsável", 110, sigY + 35);
        doc.text(manager, 110, sigY + 39);
      }

      doc.save(`relatorio_${branch.replace(/\s+/g, '_')}.pdf`);
    };

    return (
      <div className="flex flex-col h-full bg-white overflow-y-auto w-full">
        <div className="max-w-4xl mx-auto w-full p-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
            <FileText className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Conferência Finalizada</h1>
          <p className="text-gray-500 mb-8">Resumo da operação de estoque.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full mb-8">
            <div className="p-4 bg-green-50 rounded-xl border border-green-100 text-center">
              <span className="text-green-600 font-semibold uppercase text-xs tracking-wider">Corretos</span>
              <p className="text-3xl font-bold text-gray-800 mt-2">{matched}</p>
            </div>
            <div className="p-4 bg-red-50 rounded-xl border border-red-100 text-center">
              <span className="text-red-600 font-semibold uppercase text-xs tracking-wider">Divergentes</span>
              <p className="text-3xl font-bold text-gray-800 mt-2">{divergent}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 text-center">
              <span className="text-gray-500 font-semibold uppercase text-xs tracking-wider">Não Contados</span>
              <p className="text-3xl font-bold text-gray-800 mt-2">{pending}</p>
            </div>
          </div>

          <div className="w-full bg-gray-50 p-6 rounded-xl border border-gray-100 mb-8">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center">
              <PenTool className="w-5 h-5 mr-2" />
              Coleta de Assinaturas
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-2">Farmacêutico: {pharmacist}</p>
                {pharmSignature ? (
                  <div className="relative border rounded-lg overflow-hidden bg-white h-40 flex items-center justify-center">
                    <img src={pharmSignature} alt="Assinatura Farmacêutico" className="max-h-full" />
                    <button
                      onClick={() => setPharmSignature(null)}
                      className="absolute top-2 right-2 bg-red-100 text-red-600 p-1 rounded hover:bg-red-200"
                      title="Apagar assinatura"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <SignaturePad label="Farmacêutico(a)" onEnd={setPharmSignature} />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-600 mb-2">Gestor: {manager}</p>
                {managerSignature ? (
                  <div className="relative border rounded-lg overflow-hidden bg-white h-40 flex items-center justify-center">
                    <img src={managerSignature} alt="Assinatura Gestor" className="max-h-full" />
                    <button
                      onClick={() => setManagerSignature(null)}
                      className="absolute top-2 right-2 bg-red-100 text-red-600 p-1 rounded hover:bg-red-200"
                      title="Apagar assinatura"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <SignaturePad label="Gestor(a)" onEnd={setManagerSignature} />
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 w-full md:w-auto">
            {!signaturesComplete && (
              <div className="text-center text-red-500 font-medium mb-2 bg-red-50 p-2 rounded">
                Colete ambas as assinaturas para liberar o download.
              </div>
            )}
            <button
              onClick={exportPDF}
              disabled={!signaturesComplete}
              className={`flex items-center justify-center space-x-2 px-8 py-4 rounded-xl text-lg font-bold shadow-lg transition w-full ${signaturesComplete ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
            >
              <Printer className="w-5 h-5" />
              <span>Baixar Relatório (PDF)</span>
            </button>

            <button
              onClick={exportCSV}
              disabled={!signaturesComplete}
              className={`flex items-center justify-center space-x-2 px-8 py-4 rounded-xl text-lg font-bold shadow-lg transition w-full ${signaturesComplete ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
            >
              <Download className="w-5 h-5" />
              <span>Baixar Relatório (CSV)</span>
            </button>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="mt-6 text-gray-400 hover:text-gray-600 text-sm"
          >
            Iniciar Nova Conferência
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full">
      {step === 'setup' && renderSetup()}
      {step === 'conference' && renderConference()}
      {step === 'divergence' && renderDivergence()}
      {step === 'report' && renderReport()}
    </div>
  );
};
