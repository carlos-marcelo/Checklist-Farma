
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Product, PVRecord, SalesRecord, AppView, SessionInfo, PVSaleClassification, SalesUploadRecord } from '../../preVencidos/types';
import type { UserRole } from '../../types';
import {
  parseSystemProductsXLSX,
  parseDCBProductsXLSX,
  parseSalesXLSX,
  parseSalesCSV,
  parseInventoryXLSX
} from '../../preVencidos/dataService';
import PVRegistration from './PVRegistration';
import AnalysisView from './AnalysisView';
import SetupView from './SetupView';
import { NAV_ITEMS } from '../../preVencidos/constants';
import { Package, AlertTriangle, LogOut, Trophy, TrendingUp, MinusCircle, CheckCircle, Calendar, Info, Trash2, X, Clock, Building, User, UserPlus, PencilLine, Trash } from 'lucide-react';
import SalesHistoryModal from './SalesHistoryModal';
import {
  DbCompany,
  DbPVSession,
  DbPVSalesUpload,
  DbPVConfirmedSalesPayload,
  DbPVConfirmedSalesMeta,
  DbPVSalesAnalysisReport,
  DbPVDashboardReport,
  DbPVBranchRecordEvent,
  DbPVInventoryReport,
  fetchPVSession,
  upsertPVSession,
  deletePVSession,
  insertPVBranchRecord,
  fetchPVBranchRecords,
  deletePVBranchRecord,
  updatePVBranchRecord,
  fetchPVSalesHistory,
  deletePVBranchSalesHistory,
  insertPVSalesHistory,
  fetchPVSalesUploads,
  insertPVSalesUpload,
  updatePVBranchRecordDetails,
  DbPVSalesHistory,
  fetchPVReports,
  upsertPVReport,
  deletePVReports,
  fetchActiveSalesReport,
  upsertActiveSalesReport,
  fetchPVSalesAnalysisReports,
  upsertPVSalesAnalysisReport,
  fetchPVDashboardReports,
  insertPVDashboardReport,
  fetchPVBranchRecordEvents,
  insertPVBranchRecordEvent,
  insertAppEventLog,
  fetchPVInventoryReport,
  upsertPVInventoryReport,
  fetchGlobalBaseFiles
} from '../../supabaseService';
import {
  loadLocalPVSession,
  saveLocalPVSession,
  clearLocalPVSession,
  loadLocalPVReports,
  saveLocalPVReports,
  clearLocalPVReports,
  loadLastSalesUpload,
  saveLastSalesUpload,
  clearLastSalesUpload
} from '../../preVencidos/storage';
import { AnalysisReportPayload, buildAnalysisReportPayload } from '../../preVencidos/analysisReport';

interface PreVencidosManagerProps {
  userEmail?: string;
  userName?: string;
  userRole?: UserRole;
  userBranch?: string | null;
  companies: DbCompany[];
  onLogout?: () => void;
}

const CONFIRMED_META_KEY = '__pv_meta__';

type DashboardMetrics = {
  ranking: Array<{
    name: string;
    score: number;
    positive: number;
    neutral: number;
    negative: number;
    positiveCost: number;
    negativeCost: number;
  }>;
  totalRecovered: number;
  totalIgnored: number;
  totalRecoveredCost: number;
  totalIgnoredCost: number;
  efficiency: number;
  pvInRegistry: number;
};

const extractConfirmedSalesPayload = (payload?: DbPVConfirmedSalesPayload | null) => {
  const confirmed: Record<string, PVSaleClassification> = {};
  let finalized: Record<string, string[]> = {};

  if (!payload) return { confirmed, finalized };

  Object.entries(payload).forEach(([key, value]) => {
    if (key === CONFIRMED_META_KEY) {
      const meta = value as DbPVConfirmedSalesMeta | undefined;
      if (meta?.finalized_reds_by_period) {
        finalized = meta.finalized_reds_by_period;
      }
      return;
    }

    if (value && typeof value === 'object' && ('qtyPV' in value || 'qtyNeutral' in value || 'qtyIgnoredPV' in value)) {
      confirmed[key] = value as PVSaleClassification;
    }
  });

  return { confirmed, finalized };
};

const buildConfirmedSalesPayload = (
  confirmed: Record<string, PVSaleClassification>,
  finalized: Record<string, string[]>
): DbPVConfirmedSalesPayload => ({
  ...confirmed,
  [CONFIRMED_META_KEY]: { finalized_reds_by_period: finalized || {} }
});

const mergeFinalizedMaps = (base: Record<string, string[]>, extra: Record<string, string[]>) => {
  const merged: Record<string, string[]> = { ...base };
  Object.entries(extra).forEach(([period, codes]) => {
    const set = new Set([...(merged[period] || []), ...codes]);
    merged[period] = Array.from(set);
  });
  return merged;
};

const normalizeBarcode = (value?: string) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(Math.trunc(value));
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/e\+?/i.test(raw)) {
    const num = Number(raw.replace(',', '.'));
    if (Number.isFinite(num)) return String(Math.trunc(num));
  }
  return raw.replace(/\D/g, '');
};

const buildSetupDraftKey = (email: string) => `PV_SETUP_DRAFT_${(email || '').trim().toLowerCase()}`;

const PreVencidosManager: React.FC<PreVencidosManagerProps> = ({
  userEmail,
  userName,
  userRole,
  userBranch,
  companies = [],
  onLogout
}) => {
  const [currentView, setCurrentView] = useState<AppView>(AppView.SETUP);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  const [systemProducts, setSystemProducts] = useState<Product[]>([]);
  const [dcbBaseProducts, setDcbBaseProducts] = useState<Product[]>([]);
  const [masterProducts, setMasterProducts] = useState<Product[]>([]);
  const [pvRecords, setPvRecords] = useState<PVRecord[]>([]);
  const [salesRecords, setSalesRecords] = useState<SalesRecord[]>([]);
  const [confirmedPVSales, setConfirmedPVSales] = useState<Record<string, PVSaleClassification>>({});
  const [finalizedREDSByPeriod, setFinalizedREDSByPeriod] = useState<Record<string, string[]>>({});
  const [salesPeriod, setSalesPeriod] = useState<string>('');
  const [showStockDetail, setShowStockDetail] = useState(false);
  const [pvSessionId, setPvSessionId] = useState<string | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isClearingDashboard, setIsClearingDashboard] = useState(false);
  const [isInitialSyncDone, setIsInitialSyncDone] = useState(false);
  const [reportsSyncStatus, setReportsSyncStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [reportsReady, setReportsReady] = useState(false);
  const [reportSyncedAt, setReportSyncedAt] = useState<{ system: string | null; dcb: string | null }>({ system: null, dcb: null });
  const [pendingReportPersist, setPendingReportPersist] = useState<{ system: boolean; dcb: boolean }>({ system: false, dcb: false });
  const [setupDraftInfo, setSetupDraftInfo] = useState<SessionInfo | null>(null);
  const [isBranchPrefetching, setIsBranchPrefetching] = useState(false);
  const [branchPrefetchReady, setBranchPrefetchReady] = useState(false);
  const [branchPrefetchError, setBranchPrefetchError] = useState<string | null>(null);
  const [isLoadingBranchSalesState, setIsLoadingBranchSalesState] = useState(false);
  const [isLoadingSalesUploads, setIsLoadingSalesUploads] = useState(false);
  const [isLoadingAnalysisReports, setIsLoadingAnalysisReports] = useState(false);
  const [isLoadingInventoryReport, setIsLoadingInventoryReport] = useState(false);
  const [hasInitialHydrationCompleted, setHasInitialHydrationCompleted] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<DbPVSalesHistory[]>([]);
  const [salesUploads, setSalesUploads] = useState<DbPVSalesUpload[]>([]);
  const [analysisReports, setAnalysisReports] = useState<Record<string, AnalysisReportPayload>>({});
  const [pvRecordEvents, setPvRecordEvents] = useState<DbPVBranchRecordEvent[]>([]);
  const [inventoryReport, setInventoryReport] = useState<DbPVInventoryReport | null>(null);
  const [inventoryCostByBarcode, setInventoryCostByBarcode] = useState<Record<string, number>>({});
  const [inventoryStockByBarcode, setInventoryStockByBarcode] = useState<Record<string, number>>({});
  const [localLastUpload, setLocalLastUpload] = useState<SalesUploadRecord | null>(null);
  const [lastDashboardReport, setLastDashboardReport] = useState<DbPVDashboardReport | null>(null);
  const [isGeneratingDashboardReport, setIsGeneratingDashboardReport] = useState(false);
  const [isRefreshingDashboard, setIsRefreshingDashboard] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [historyDetail, setHistoryDetail] = useState<{ type: 'seller' | 'recovered' | 'ignored'; seller?: string } | null>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'online' | 'offline' | 'syncing'>('online');
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const isMaster = userRole === 'MASTER';
  const filterRecentPVEvents = (events: DbPVBranchRecordEvent[]) => {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return events.filter(ev => {
      const ts = ev.created_at ? new Date(ev.created_at).getTime() : NaN;
      return Number.isFinite(ts) && ts >= since;
    });
  };

  const upsertLocalPVEvent = (event: DbPVBranchRecordEvent) => {
    setPvRecordEvents(prev => {
      const filtered = prev.filter(existing => {
        if (!event.created_at || !existing.created_at) return true;
        return !(
          existing.created_at === event.created_at &&
          existing.event_type === event.event_type &&
          existing.record_id === event.record_id &&
          existing.reduced_code === event.reduced_code
        );
      });
      return filterRecentPVEvents([event, ...filtered]);
    });
  };

  const handleSetupInfoChange = useCallback((info: SessionInfo) => {
    if (!info || (!info.companyId && !info.filial)) {
      setSetupDraftInfo(null);
      if (userEmail && typeof window !== 'undefined') {
        window.localStorage.removeItem(buildSetupDraftKey(userEmail));
      }
      return;
    }
    setSetupDraftInfo(info);
    if (userEmail && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(buildSetupDraftKey(userEmail), JSON.stringify(info));
      } catch (error) {
        console.error('Erro ao salvar rascunho da configuração PV:', error);
      }
    }
  }, [userEmail]);

  const handleSystemProductsUpload = useCallback(async (file: File) => {
    const parsed = await parseSystemProductsXLSX(file);
    setSystemProducts(parsed);
    setReportsReady(false);
    setReportsSyncStatus('loading');
    setPendingReportPersist(prev => ({ ...prev, system: true }));
  }, []);

  const handleDCBBaseUpload = useCallback(async (file: File) => {
    const parsed = await parseDCBProductsXLSX(file);
    setDcbBaseProducts(parsed);
    setReportsReady(false);
    setReportsSyncStatus('loading');
    setPendingReportPersist(prev => ({ ...prev, dcb: true }));
  }, []);

  const buildInventoryMaps = useCallback((records: { barcode: string; cost: number; stock?: number; reducedCode?: string }[]) => {
    const costMap: Record<string, number> = {};
    const stockMap: Record<string, number> = {};
    records.forEach(rec => {
      const rawBarcode = (rec.barcode || '').trim();
      const normalized = normalizeBarcode(rawBarcode);
      const noZeros = normalized.replace(/^0+/, '') || normalized;
      const barcodeKeys = Array.from(new Set([normalized, noZeros].filter(Boolean)));
      const reducedKey = rec.reducedCode ? `red:${String(rec.reducedCode).replace(/\D/g, '') || rec.reducedCode}` : '';
      if (barcodeKeys.length === 0 && !reducedKey) return;
      if (barcodeKeys.length > 0) {
        barcodeKeys.forEach(barcode => {
          costMap[barcode] = Number(rec.cost || 0);
          if (typeof rec.stock === 'number') {
            stockMap[barcode] = rec.stock;
          }
        });
      }
      if (reducedKey) {
        costMap[reducedKey] = Number(rec.cost || 0);
        if (typeof rec.stock === 'number') {
          stockMap[reducedKey] = rec.stock;
        }
      }
    });
    setInventoryCostByBarcode(costMap);
    setInventoryStockByBarcode(stockMap);
  }, []);

  const mapDbRecordsToPV = useCallback((records: any[]) => {
    return (records || []).map(rec => ({
      id: String(rec.id || `db-${rec.reduced_code}-${Date.now()}`),
      reducedCode: rec.reduced_code,
      name: rec.product_name,
      quantity: rec.quantity,
      originBranch: rec.origin_branch || '',
      sectorResponsible: rec.sector_responsible || '',
      expiryDate: rec.expiry_date,
      entryDate: rec.entry_date,
      dcb: rec.dcb,
      userEmail: rec.user_email,
      userName: ''
    }));
  }, []);

  const decodeGlobalFileToBrowserFile = useCallback((file: {
    file_data_base64?: string | null;
    file_name?: string | null;
    mime_type?: string | null;
    module_key?: string | null;
  }) => {
    const raw = String(file?.file_data_base64 || '').trim();
    if (!raw) return null;

    let mimeType = file?.mime_type || 'application/octet-stream';
    let base64 = raw;
    const dataUrlMatch = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1] || mimeType;
      base64 = dataUrlMatch[2] || '';
    }
    if (!base64) return null;

    try {
      const binary = window.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const fileName = file?.file_name || `${file?.module_key || 'base'}.xlsx`;
      return new File([bytes], fileName, { type: mimeType });
    } catch (error) {
      console.error('Erro ao decodificar arquivo global:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    setHasInitialHydrationCompleted(false);
  }, [userEmail]);

  useEffect(() => {
    if (currentView !== AppView.SETUP) return;
    if (!setupDraftInfo?.companyId || !setupDraftInfo?.filial) {
      setIsBranchPrefetching(false);
      setBranchPrefetchReady(false);
      setBranchPrefetchError(null);
      return;
    }

    let cancelled = false;
    const companyId = setupDraftInfo.companyId;
    const branch = setupDraftInfo.filial;

    const preloadBranchAssets = async () => {
      setIsBranchPrefetching(true);
      setBranchPrefetchReady(false);
      setBranchPrefetchError(null);
      setSalesUploads([]);
      setSalesRecords([]);
      setSalesPeriod('');
      setConfirmedPVSales({});
      setFinalizedREDSByPeriod({});
      setLocalLastUpload(null);
      setInventoryReport(null);
      setInventoryCostByBarcode({});
      setInventoryStockByBarcode({});

      try {
        const [inventoryRes, activeSalesRes, uploadsRes] = await Promise.allSettled([
          fetchPVInventoryReport(companyId, branch),
          fetchActiveSalesReport(companyId, branch),
          fetchPVSalesUploads(companyId, branch)
        ]);

        if (cancelled) return;

        const inventory = inventoryRes.status === 'fulfilled' ? inventoryRes.value : null;
        const activeSales = activeSalesRes.status === 'fulfilled' ? activeSalesRes.value : null;
        const uploads = uploadsRes.status === 'fulfilled' ? uploadsRes.value : [];

        if (inventory) {
          setInventoryReport(inventory);
          buildInventoryMaps(inventory.records || []);
        }

        if (activeSales) {
          if (activeSales.sales_records && activeSales.sales_records.length > 0) {
            setSalesRecords(activeSales.sales_records);
          }
          setSalesPeriod(activeSales.sales_period || '');
          const { confirmed, finalized } = extractConfirmedSalesPayload(activeSales.confirmed_sales || null);
          setConfirmedPVSales(confirmed);
          setFinalizedREDSByPeriod(finalized);

          if (activeSales.sales_period || activeSales.uploaded_at) {
            setLocalLastUpload({
              period_label: activeSales.sales_period,
              file_name: activeSales.file_name || 'Relatório Ativo',
              uploaded_at: activeSales.uploaded_at || new Date().toISOString(),
              user_email: activeSales.user_email || '',
              company_id: activeSales.company_id,
              branch: activeSales.branch,
              period_start: null,
              period_end: null
            });
          }
        }

        setSalesUploads(Array.isArray(uploads) ? uploads : []);
        setBranchPrefetchReady(true);
        const allFailed =
          inventoryRes.status === 'rejected' &&
          activeSalesRes.status === 'rejected' &&
          uploadsRes.status === 'rejected';
        if (allFailed) {
          setBranchPrefetchError('Não foi possível carregar os dados da filial.');
        } else {
          setBranchPrefetchError(null);
        }
      } catch (error) {
        console.error('Erro ao pré-carregar dados da filial:', error);
        if (!cancelled) {
          setBranchPrefetchReady(true);
          setBranchPrefetchError('Não foi possível carregar os dados da filial.');
        }
      } finally {
        if (!cancelled) setIsBranchPrefetching(false);
      }
    };

    preloadBranchAssets();

    return () => {
      cancelled = true;
    };
  }, [currentView, setupDraftInfo?.companyId, setupDraftInfo?.filial, buildInventoryMaps]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setLastDashboardReport(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const reports = await fetchPVDashboardReports(sessionInfo.companyId, sessionInfo.filial, 1);
      if (!cancelled) {
        setLastDashboardReport(reports[0] || null);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setPvRecordEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const events = await fetchPVBranchRecordEvents(sessionInfo.companyId, sessionInfo.filial);
      if (!cancelled) setPvRecordEvents(filterRecentPVEvents(events));
    })();
    return () => { cancelled = true; };
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  useEffect(() => {
    if (!userEmail) {
      setLocalLastUpload(null);
      return;
    }
    const saved = loadLastSalesUpload(userEmail);
    setLocalLastUpload(saved);
  }, [userEmail]);

  const canSwitchToView = (view: AppView) => view === AppView.SETUP || hasCompletedSetup;

  const handleNavItemClick = (view: AppView) => {
    if (!canSwitchToView(view)) return;
    setCurrentView(view);
    // Determine active view label
    let viewLabel = '';
    switch (view) {
      case AppView.DASHBOARD: viewLabel = 'dashboard'; break;
      case AppView.REGISTRATION: viewLabel = 'registration'; break;
      case AppView.ANALYSIS: viewLabel = 'analysis'; break;
      case AppView.SETUP: viewLabel = 'setup'; break;
    }
    // Update local storage directly for faster UX restoration
    if (sessionInfo) {
      const tempSession = {
        ...loadLocalPVSession(userEmail || ''),
        session_data: {
          ...(loadLocalPVSession(userEmail || '')?.session_data || {}),
          currentView: viewLabel
        }
      };
      // @ts-ignore
      saveLocalPVSession(userEmail || '', tempSession);
    }
  };

  useEffect(() => {
    if (!userEmail) return;
    let cancelled = false;

    const syncReports = async () => {
      try {
        setReportsSyncStatus('loading');
        setReportsReady(false);
        // 1. Tentar carregar localmente primeiro para velocidade
        const storedReports = await loadLocalPVReports(userEmail);
        if (cancelled) return;

        // 2. Se não houver local, ou para garantir sincronia, buscar do Supabase
        console.log('🔄 [PV Sync] Buscando relatórios do Supabase para:', userEmail);
        const reportLookupCompanyId = setupDraftInfo?.companyId || sessionInfo?.companyId || null;
        const reportLookupBranch = setupDraftInfo?.filial || sessionInfo?.filial || null;
        const dbReports = await fetchPVReports(userEmail, {
          companyId: reportLookupCompanyId,
          branch: reportLookupBranch
        });
        if (cancelled) return;

        const systemReport = dbReports.find(r => r.report_type === 'system');
        const dcbReport = dbReports.find(r => r.report_type === 'dcb');

        const localSystem = storedReports?.systemProducts || [];
        const localDcb = storedReports?.dcbProducts || [];
        let finalSystem = Array.isArray(systemReport?.products) && systemReport.products.length > 0
          ? systemReport.products
          : localSystem;
        let finalDcb = Array.isArray(dcbReport?.products) && dcbReport.products.length > 0
          ? dcbReport.products
          : localDcb;
        let loadedSystemFromGlobal = false;
        let loadedDcbFromGlobal = false;

        const dbSystemSyncedAt = systemReport?.updated_at || systemReport?.created_at || null;
        const dbDcbSyncedAt = dcbReport?.updated_at || dcbReport?.created_at || null;
        if (dbSystemSyncedAt || dbDcbSyncedAt) {
          setReportSyncedAt(prev => ({
            system: dbSystemSyncedAt || prev.system,
            dcb: dbDcbSyncedAt || prev.dcb
          }));
        }

        // Fallback global por empresa (carregado no módulo Cadastros Base) quando faltar system/dcb.
        if (
          reportLookupCompanyId &&
          (finalSystem.length === 0 || finalDcb.length === 0)
        ) {
          try {
            const globalFiles = await fetchGlobalBaseFiles(reportLookupCompanyId);
            if (!cancelled && globalFiles.length > 0) {
              const fileByKey = new Map(globalFiles.map(file => [file.module_key, file]));
              const systemGlobal = fileByKey.get('shared_cadastro_produtos');
              const dcbGlobal = fileByKey.get('pre_dcb_base');

              if (finalSystem.length === 0 && systemGlobal?.file_data_base64) {
                const file = decodeGlobalFileToBrowserFile(systemGlobal);
                if (file) {
                  const parsed = await parseSystemProductsXLSX(file);
                  if (!cancelled && parsed.length > 0) {
                    finalSystem = parsed;
                    loadedSystemFromGlobal = true;
                    setReportSyncedAt(prev => ({
                      ...prev,
                      system: systemGlobal.updated_at || systemGlobal.uploaded_at || prev.system
                    }));
                  }
                }
              }

              if (finalDcb.length === 0 && dcbGlobal?.file_data_base64) {
                const file = decodeGlobalFileToBrowserFile(dcbGlobal);
                if (file) {
                  const parsed = await parseDCBProductsXLSX(file);
                  if (!cancelled && parsed.length > 0) {
                    finalDcb = parsed;
                    loadedDcbFromGlobal = true;
                    setReportSyncedAt(prev => ({
                      ...prev,
                      dcb: dcbGlobal.updated_at || dcbGlobal.uploaded_at || prev.dcb
                    }));
                  }
                }
              }
            }
          } catch (globalError) {
            console.error('Erro ao carregar cadastros globais para PV:', globalError);
          }
        }

        if (finalSystem.length) setSystemProducts(finalSystem);
        if (finalDcb.length) setDcbBaseProducts(finalDcb);
        // Se veio da base global, não replica para pv_reports (evita escrita pesada/timeout e mantém a fonte central).
        setPendingReportPersist({
          system: false,
          dcb: false
        });

        if (dbReports.length > 0 || finalSystem.length > 0 || finalDcb.length > 0) {
          console.log(`✅ [PV Sync] Carregados do DB: ${finalSystem.length} sistem, ${finalDcb.length} dcb`);
          saveLocalPVReports(userEmail, {
            systemProducts: finalSystem,
            dcbProducts: finalDcb
          });
        }

        const hasDbSystem = dbReports.some(r => r.report_type === 'system' && Array.isArray(r.products) && r.products.length > 0);
        const hasDbDcb = dbReports.some(r => r.report_type === 'dcb' && Array.isArray(r.products) && r.products.length > 0);
        const hasEffectiveSystem = finalSystem.length > 0;
        const hasEffectiveDcb = finalDcb.length > 0;
        const ready = (hasDbSystem && hasDbDcb) || (hasEffectiveSystem && hasEffectiveDcb);
        setReportsReady(ready);
        setReportsSyncStatus(ready ? 'ready' : 'missing');
      } catch (error) {
        console.error('Erro ao sincronizar relatórios PV:', error);
        if (!cancelled) {
          setReportsReady(false);
          setReportsSyncStatus('error');
        }
      } finally {
        if (!cancelled) setIsInitialSyncDone(true);
      }
    };

    syncReports();

    return () => {
      cancelled = true;
    };
  }, [userEmail, setupDraftInfo?.companyId, setupDraftInfo?.filial, sessionInfo?.companyId, sessionInfo?.filial, decodeGlobalFileToBrowserFile]);

  const applySessionFromData = useCallback((session: DbPVSession) => {
    const data = session.session_data || {};
    setPvSessionId(session.id || null);

    setConfirmedPVSales(data.confirmed_pv_sales || {});
    setFinalizedREDSByPeriod(data.finalized_reds_by_period || {});
    setConfirmedPVSales(data.confirmed_pv_sales || {});
    setFinalizedREDSByPeriod(data.finalized_reds_by_period || {});
    setSalesPeriod(data.sales_period || '');

    // Restore base products so user doesn't need to re-upload
    if (data.system_products?.length) setSystemProducts(data.system_products);
    if (data.dcb_products?.length) setDcbBaseProducts(data.dcb_products);
    setPendingReportPersist({ system: false, dcb: false });

    // Restore Session Context (Company, Branch, etc.)
    if (session.company_id && session.branch) {
      const foundCompany = companies.find(c => c.id === session.company_id);
      setSessionInfo({
        companyId: session.company_id,
        company: foundCompany ? foundCompany.name : (session.session_data as any)?.companyName || '',
        filial: session.branch,
        area: session.area || '',
        pharmacist: session.pharmacist || '',
        manager: session.manager || ''
      });
      setHasCompletedSetup(true);

      // Restore View
      if (data.currentView) {
        switch (data.currentView) {
          case 'dashboard': setCurrentView(AppView.DASHBOARD); break;
          case 'registration': setCurrentView(AppView.REGISTRATION); break;
          case 'analysis': setCurrentView(AppView.ANALYSIS); break;
          default: setCurrentView(AppView.REGISTRATION);
        }
      } else {
        setCurrentView(AppView.REGISTRATION);
      }
    }
  }, [companies]);

  // Load Session Logic
  useEffect(() => {
    if (!userEmail) return;

    let isMounted = true;
    setIsLoadingSession(true);

    if (typeof window !== 'undefined') {
      try {
        const rawDraft = window.localStorage.getItem(buildSetupDraftKey(userEmail));
        if (rawDraft) {
          const parsedDraft = JSON.parse(rawDraft) as SessionInfo;
          if (parsedDraft && (parsedDraft.companyId || parsedDraft.filial || parsedDraft.pharmacist || parsedDraft.manager)) {
            setSetupDraftInfo(parsedDraft);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar rascunho da configuração PV:', error);
      }
    }

    const localSession = loadLocalPVSession(userEmail);
    if (localSession) {
      applySessionFromData(localSession);
      setIsLoadingSession(false); // Assume local is fast
    }

    fetchPVSession(userEmail)
      .then(session => {
        if (!isMounted || !session) return;
        applySessionFromData(session);
        saveLocalPVSession(userEmail, session);
      })
      .catch(error => {
        console.error('Erro ao carregar sessão PV do Supabase:', error);
      })
      .finally(() => {
        if (isMounted) setIsLoadingSession(false);
      });

    return () => {
      isMounted = false;
    };
  }, [userEmail, applySessionFromData]);

  // Auto-Retry Fetch Logic for PV Records
  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;

    let retries = 3;
    let isMounted = true;

    const loadRecords = async () => {
      setConnectionStatus('syncing');
      try {
        const records = await fetchPVBranchRecords(sessionInfo.companyId, sessionInfo.filial!);
        if (isMounted) {
          if (records && records.length > 0) {
            setPvRecords(mapDbRecordsToPV(records));
            setConnectionStatus('online');
          } else {
            // Maybe empty, let's just say online
            console.log('[PV AutoLoad] 0 records found via DB.');
            setConnectionStatus('online');
            setPvRecords([]);
          }
        }
      } catch (err) {
        console.error('[PV AutoLoad] Fetch error:', err);
        if (retries > 0 && isMounted) {
          retries--;
          console.log(`[PV AutoLoad] Retrying in 2s... attempts left: ${retries}`);
          setConnectionStatus('offline');
          setTimeout(loadRecords, 2000);
        } else {
          setConnectionStatus('offline');
        }
      }
    };

    loadRecords();

    return () => { isMounted = false; };
  }, [sessionInfo?.companyId, sessionInfo?.filial, mapDbRecordsToPV]); // Depend only on context changes

  useEffect(() => {
    if (systemProducts.length > 0 || dcbBaseProducts.length > 0) {
      const merged: Product[] = [];
      const allReducedCodes = new Set([
        ...systemProducts.map(p => p.reducedCode),
        ...dcbBaseProducts.map(p => p.reducedCode)
      ]);

      allReducedCodes.forEach(code => {
        if (!code) return;
        const sysProd = systemProducts.find(p => p.reducedCode === code);
        const dcbProd = dcbBaseProducts.find(p => p.reducedCode === code);
        merged.push({
          id: sysProd?.id || dcbProd?.id || `merge-${code}`,
          name: sysProd?.name || dcbProd?.name || 'Produto identificado via DCB',
          barcode: sysProd?.barcode || dcbProd?.barcode || '',
          reducedCode: code,
          dcb: dcbProd?.dcb || sysProd?.dcb || 'N/A',
          lab: sysProd?.lab || dcbProd?.lab
        });
      });
      setMasterProducts(merged);
    }
  }, [systemProducts, dcbBaseProducts]);

  // Persist Products to Session Data (Local & Remote)
  useEffect(() => {
    if (!userEmail || !isInitialSyncDone) return;

    // Salvar localmente sempre que houver mudança para restauração rápida
    if (systemProducts.length > 0 || dcbBaseProducts.length > 0) {
      saveLocalPVReports(userEmail, {
        systemProducts,
        dcbProducts: dcbBaseProducts
      }).catch(error => console.error('Erro ao salvar relatórios PV locais:', error));
    }

    // Evita escrita pesada no Supabase quando os dados vieram do próprio banco
    if (!pendingReportPersist.system && !pendingReportPersist.dcb) return;

    if (systemProducts.length === 0 && dcbBaseProducts.length === 0) {
      clearLocalPVReports(userEmail).catch(() => { });
      deletePVReports(userEmail).catch(() => { });
      setReportsReady(false);
      setReportsSyncStatus('missing');
      setReportSyncedAt({ system: null, dcb: null });
      setPendingReportPersist({ system: false, dcb: false });
      return;
    }

    const persistToDb = async () => {
      try {
        const reportCompanyId = sessionInfo?.companyId || setupDraftInfo?.companyId || null;
        const reportBranch = sessionInfo?.filial || setupDraftInfo?.filial || null;
        let savedSystem = !pendingReportPersist.system;
        let savedDcb = !pendingReportPersist.dcb;

        if (pendingReportPersist.system && systemProducts.length > 0) {
          const saved = await upsertPVReport({
            user_email: userEmail,
            company_id: reportCompanyId || undefined,
            branch: reportBranch || undefined,
            report_type: 'system',
            products: systemProducts
          });
          savedSystem = !!saved;
          if (saved?.updated_at || saved?.created_at) {
            setReportSyncedAt(prev => ({
              ...prev,
              system: saved.updated_at || saved.created_at || prev.system
            }));
          }
        }

        if (pendingReportPersist.dcb && dcbBaseProducts.length > 0) {
          const saved = await upsertPVReport({
            user_email: userEmail,
            company_id: reportCompanyId || undefined,
            branch: reportBranch || undefined,
            report_type: 'dcb',
            products: dcbBaseProducts
          });
          savedDcb = !!saved;
          if (saved?.updated_at || saved?.created_at) {
            setReportSyncedAt(prev => ({
              ...prev,
              dcb: saved.updated_at || saved.created_at || prev.dcb
            }));
          }
        }

        setPendingReportPersist({
          system: pendingReportPersist.system && !savedSystem,
          dcb: pendingReportPersist.dcb && !savedDcb
        });

        if (savedSystem && savedDcb && systemProducts.length > 0 && dcbBaseProducts.length > 0) {
          setReportsReady(true);
          setReportsSyncStatus('ready');
        } else {
          setReportsReady(false);
          setReportsSyncStatus('missing');
        }
      } catch (error) {
        console.error('Erro ao persistir relatórios no Supabase:', error);
        setReportsReady(false);
        setReportsSyncStatus('error');
      }
    };

    persistToDb();
  }, [
    systemProducts,
    dcbBaseProducts,
    userEmail,
    sessionInfo?.companyId,
    sessionInfo?.filial,
    setupDraftInfo?.companyId,
    setupDraftInfo?.filial,
    pendingReportPersist.system,
    pendingReportPersist.dcb,
    isInitialSyncDone
  ]);

  const handleRefresh = async () => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;
    setConnectionStatus('syncing');

    // 1. Fetch Active Stock
    console.log('🔄 [PV] Forçando atualização da lista...');
    fetchPVBranchRecords(sessionInfo.companyId, sessionInfo.filial)
      .then(dbRecords => {
        if (dbRecords && dbRecords.length > 0) {
          setPvRecords(mapDbRecordsToPV(dbRecords));
          alert('Lista atualizada com sucesso!');
        } else {
          console.log('🔍 [PV DEBUG] Refresh retornou 0 registros.');
          alert('Nenhum registro encontrado no banco de dados para esta filial.');
          setPvRecords([]);
        }
      })
      .catch(err => {
        console.error('❌ [PV DEBUG] Erro no refresh:', err);
        alert('Erro ao atualizar lista via banco de dados.');
      });
  };

  // Load persistent branch records and history when company/branch is selected
  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setIsLoadingBranchSalesState(false);
      return;
    }

    let cancelled = false;
    setIsLoadingBranchSalesState(true);

    const loadBranchSalesData = async () => {
      try {
        console.log('🔍 [PV DEBUG] Buscando histórico de vendas...');
        const [historyRes, activeSalesRes] = await Promise.allSettled([
          fetchPVSalesHistory(sessionInfo.companyId!, sessionInfo.filial!),
          fetchActiveSalesReport(sessionInfo.companyId!, sessionInfo.filial!)
        ]);

        if (cancelled) return;

        if (historyRes.status === 'fulfilled' && historyRes.value) {
          setHistoryRecords(historyRes.value);
        } else if (historyRes.status === 'rejected') {
          console.error('Erro carregando histórico de vendas:', historyRes.reason);
        }

        if (activeSalesRes.status === 'fulfilled') {
          const report = activeSalesRes.value;
          if (!report) return;

          if (report.sales_records && report.sales_records.length > 0) {
            console.log('✅ [PV Persistence] Relatório ativo restaurado:', report.sales_period);
            setSalesRecords(report.sales_records);
            setSalesPeriod(report.sales_period || '');
          }

          const { confirmed, finalized } = extractConfirmedSalesPayload(report.confirmed_sales || null);
          setConfirmedPVSales(confirmed);
          setFinalizedREDSByPeriod(finalized);

          if (report.sales_period || report.uploaded_at) {
            setLocalLastUpload({
              period_label: report.sales_period,
              file_name: report.file_name || 'Relatório Ativo',
              uploaded_at: report.uploaded_at || new Date().toISOString(),
              user_email: report.user_email || '',
              company_id: report.company_id,
              branch: report.branch,
              period_start: null,
              period_end: null
            });
          }
        } else {
          console.error('Erro carregando relatório de vendas ativo:', activeSalesRes.reason);
        }
      } finally {
        if (!cancelled) setIsLoadingBranchSalesState(false);
      }
    };

    loadBranchSalesData();

    return () => {
      cancelled = true;
    };
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setSalesUploads([]);
      setIsLoadingSalesUploads(false);
      return;
    }

    let cancelled = false;
    setIsLoadingSalesUploads(true);
    fetchPVSalesUploads(sessionInfo.companyId, sessionInfo.filial)
      .then(reports => {
        if (cancelled) return;
        setSalesUploads(reports);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Erro carregando histórico de relatórios de vendas:', err);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingSalesUploads(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setAnalysisReports({});
      setIsLoadingAnalysisReports(false);
      return;
    }

    let cancelled = false;
    setIsLoadingAnalysisReports(true);
    fetchPVSalesAnalysisReports(sessionInfo.companyId, sessionInfo.filial)
      .then(reports => {
        if (cancelled) return;
        const map: Record<string, AnalysisReportPayload> = {};
        reports.forEach(report => {
          const label = (report.period_label || '').trim();
          if (label && report.analysis_payload) {
            map[label] = report.analysis_payload;
          }
        });
        setAnalysisReports(map);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Erro carregando relatórios de análise de vendas:', err);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingAnalysisReports(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      setInventoryReport(null);
      setInventoryCostByBarcode({});
      setInventoryStockByBarcode({});
      setIsLoadingInventoryReport(false);
      return;
    }

    let cancelled = false;
    setIsLoadingInventoryReport(true);
    fetchPVInventoryReport(sessionInfo.companyId, sessionInfo.filial)
      .then(report => {
        if (cancelled) return;
        if (report) {
          setInventoryReport(report);
          buildInventoryMaps(report.records || []);
        } else {
          setInventoryReport(null);
          setInventoryCostByBarcode({});
          setInventoryStockByBarcode({});
        }
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Erro carregando relatório de estoque da filial:', err);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingInventoryReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionInfo?.companyId, sessionInfo?.filial, buildInventoryMaps]);

  const originBranches = useMemo(() => {
    const byId = companies.find(c => c.id === sessionInfo?.companyId);
    const fallback = byId ? null : companies.find(c => (c.name || '').toLowerCase().includes('drogaria cidade'));
    const company = byId || fallback;
    const branches = (company?.areas || []).flatMap(area => Array.isArray(area.branches) ? area.branches : []);
    const uniqueBranches = Array.from(new Set(branches.filter(Boolean)));
    if (uniqueBranches.length) return uniqueBranches;
    return sessionInfo?.filial ? [sessionInfo.filial] : [];
  }, [companies, sessionInfo?.companyId, sessionInfo?.filial]);

  const historyFinalizedByPeriod = useMemo(() => {
    const map: Record<string, string[]> = {};
    historyRecords.forEach(rec => {
      const period = (rec.sale_period || '').trim();
      const code = rec.reduced_code || '';
      if (!period || !code) return;
      if (!map[period]) map[period] = [];
      if (!map[period].includes(code)) map[period].push(code);
    });
    return map;
  }, [historyRecords]);

  const effectiveFinalizedByPeriod = useMemo(
    () => mergeFinalizedMaps(finalizedREDSByPeriod, historyFinalizedByPeriod),
    [finalizedREDSByPeriod, historyFinalizedByPeriod]
  );

  const barcodeByReduced = useMemo(() => {
    const map: Record<string, string> = {};
    masterProducts.forEach(prod => {
      if (prod.reducedCode) {
        map[prod.reducedCode] = normalizeBarcode(prod.barcode || '');
      }
    });
    pvRecords.forEach(rec => {
      if (!map[rec.reducedCode] && rec.barcode) {
        map[rec.reducedCode] = normalizeBarcode(rec.barcode || '');
      }
    });
    return map;
  }, [masterProducts, pvRecords]);

  const labByReduced = useMemo(() => {
    const map: Record<string, string> = {};
    masterProducts.forEach(prod => {
      if (prod.reducedCode && prod.lab) {
        map[prod.reducedCode] = prod.lab;
      }
    });
    pvRecords.forEach(rec => {
      if (!map[rec.reducedCode] && rec.lab) {
        map[rec.reducedCode] = rec.lab;
      }
    });
    return map;
  }, [masterProducts, pvRecords]);

  const formatCurrency = (value: number) => {
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
    } catch {
      return `R$ ${Number(value || 0).toFixed(2)}`;
    }
  };

  const formatDateOnly = (date: Date) => date.toLocaleDateString('pt-BR');

  const resolveRankingPeriodLabel = () => {
    const uploads = salesUploads
      .map(upload => ({
        ...upload,
        date: upload.uploaded_at ? new Date(upload.uploaded_at) : null
      }))
      .filter(item => item.date && !Number.isNaN(item.date.getTime())) as Array<DbPVSalesUpload & { date: Date }>;

    if (uploads.length === 0) {
      return salesPeriod || historyRecords[0]?.sale_period || 'Período atual';
    }

    const latest = uploads.reduce((acc, cur) => (cur.date > acc.date ? cur : acc));
    const month = latest.date.getMonth();
    const year = latest.date.getFullYear();

    const sameMonth = uploads.filter(item => item.date.getMonth() === month && item.date.getFullYear() === year);
    if (sameMonth.length === 0) {
      return salesPeriod || historyRecords[0]?.sale_period || 'Período atual';
    }

    const first = sameMonth.reduce((acc, cur) => (cur.date < acc.date ? cur : acc));
    const last = sameMonth.reduce((acc, cur) => (cur.date > acc.date ? cur : acc));

    return `${formatDateOnly(first.date)} a ${formatDateOnly(last.date)}`;
  };

  const getSalesUnitPrice = (seller: string, reducedCode: string, quantityHint?: number) => {
    if (!seller || !reducedCode) return 0;
    const candidates = salesRecords.filter(s => s.reducedCode === reducedCode && s.salesperson === seller);
    if (!candidates.length) return 0;
    if (quantityHint !== undefined) {
      const match = candidates.find(c => c.quantity === quantityHint);
      if (match?.unitPrice) return match.unitPrice;
    }
    const withUnit = candidates.find(c => c.unitPrice && c.unitPrice > 0);
    return withUnit?.unitPrice || 0;
  };

  const getInventoryCostUnitByReduced = (reducedCode?: string) => {
    if (!reducedCode) return 0;
    const reducedKey = `red:${String(reducedCode).replace(/\D/g, '') || reducedCode}`;
    const reducedCost = inventoryCostByBarcode[reducedKey];
    if (reducedCost !== undefined) return Number(reducedCost || 0);
    const barcode = barcodeByReduced[reducedCode] || '';
    if (!barcode) return 0;
    const normalized = barcode.replace(/\D/g, '');
    const noZeros = normalized.replace(/^0+/, '') || normalized;
    const value = inventoryCostByBarcode[normalized] ?? inventoryCostByBarcode[noZeros];
    return Number(value || 0);
  };

  type PeriodRange = {
    start: Date | null;
    end: Date | null;
  };

  const parsePeriodRange = (label?: string): PeriodRange => {
    if (!label) return { start: null, end: null };
    const regex = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
    const matches = Array.from(label.matchAll(regex));
    const toDate = (match: RegExpMatchArray) => {
      const day = Number(match[1]);
      const month = Number(match[2]) - 1;
      let year = Number(match[3]);
      if (match[3].length <= 2) {
        year += 2000;
      }
      // Set to NOON (12:00:00) to avoid Timezone/Midnight issues
      return new Date(year, month, day, 12, 0, 0);
    };
    const start = matches.length > 0 ? toDate(matches[0]) : null;
    const end = matches.length > 1 ? toDate(matches[1]) : start;
    return { start, end };
  };

  const rangesOverlap = (a: PeriodRange, b: PeriodRange) => {
    if (!a.start || !a.end || !b.start || !b.end) return false;
    return a.start.getTime() <= b.end.getTime() && b.start.getTime() <= a.end.getTime();
  };

  const parseDBDate = (dateStr?: string | null) => {
    if (!dateStr) return null;
    const cleanDate = dateStr.split('T')[0];
    const [y, m, d] = cleanDate.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  };

  const buildRecordRange = (record?: SalesUploadRecord): PeriodRange => ({
    start: parseDBDate(record?.period_start),
    end: parseDBDate(record?.period_end)
  });

  const resolveUploadMetaForPeriod = (label: string) => {
    const normalizedLabel = (label || '').trim();
    const fallbackRange = parsePeriodRange(normalizedLabel);

    const matchInHistory = salesUploads.find(report => (report.period_label || '').trim() === normalizedLabel);
    const match = matchInHistory
      || (localLastUpload && (localLastUpload.period_label || '').trim() === normalizedLabel ? localLastUpload : undefined);

    if (!match) {
      return {
        range: fallbackRange,
        fileName: undefined,
        uploadedAt: undefined
      };
    }

    const recordRange = buildRecordRange(match);
    return {
      range: {
        start: recordRange.start || fallbackRange.start,
        end: recordRange.end || fallbackRange.end
      },
      fileName: match.file_name || undefined,
      uploadedAt: match.uploaded_at || undefined
    };
  };

  const currentAnalysisReport = useMemo(() => {
    const normalizedPeriod = (salesPeriod || '').trim();
    if (!normalizedPeriod || salesRecords.length === 0 || pvRecords.length === 0) return null;
    const finalizedCodes = effectiveFinalizedByPeriod[normalizedPeriod] || [];
    const { fileName, uploadedAt, range } = resolveUploadMetaForPeriod(normalizedPeriod);

    return buildAnalysisReportPayload({
      pvRecords,
      salesRecords,
      periodLabel: normalizedPeriod,
      finalizedCodes,
      meta: {
        company: sessionInfo?.company,
        branch: sessionInfo?.filial,
        area: sessionInfo?.area,
        file_name: fileName || localLastUpload?.file_name || null,
        uploaded_at: uploadedAt || localLastUpload?.uploaded_at || null,
        period_start: range.start ? range.start.toISOString() : null,
        period_end: range.end ? range.end.toISOString() : null
      }
    });
  }, [
    salesPeriod,
    salesRecords,
    pvRecords,
    effectiveFinalizedByPeriod,
    sessionInfo?.company,
    sessionInfo?.filial,
    sessionInfo?.area,
    localLastUpload,
    salesUploads
  ]);

  const pendingLaunchCount = useMemo(() => {
    if (!currentAnalysisReport) return 0;
    const finalized = new Set(currentAnalysisReport.finalized_codes || []);
    return currentAnalysisReport.items.filter(item => item.status === 'sold' && !finalized.has(item.reducedCode)).length;
  }, [currentAnalysisReport]);

  useEffect(() => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;
    if (!currentAnalysisReport) return;
    const periodLabel = (currentAnalysisReport.period_label || '').trim();
    if (!periodLabel) return;
    if (analysisReports[periodLabel]) return;

    const { range, fileName, uploadedAt } = resolveUploadMetaForPeriod(periodLabel);
    persistAnalysisReport(salesRecords, periodLabel, range, fileName, uploadedAt)
      .catch(err => console.error('Erro ao persistir relatório de análise atual:', err));
  }, [
    currentAnalysisReport,
    analysisReports,
    salesRecords,
    sessionInfo?.companyId,
    sessionInfo?.filial
  ]);

  const persistAnalysisReport = async (
    sales: SalesRecord[],
    periodLabel: string,
    range: PeriodRange,
    fileName?: string,
    uploadedAt?: string
  ) => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;
    const normalizedPeriod = (periodLabel || '').trim() || 'Período não identificado';
    if (!sales.length || !pvRecords.length) return;
    if (!normalizedPeriod) return;
    const finalizedCodes = effectiveFinalizedByPeriod[normalizedPeriod] || [];

    const payload: AnalysisReportPayload = buildAnalysisReportPayload({
      pvRecords,
      salesRecords: sales,
      periodLabel: normalizedPeriod,
      finalizedCodes,
      meta: {
        company: sessionInfo.company,
        branch: sessionInfo.filial,
        area: sessionInfo.area,
        file_name: fileName || null,
        uploaded_at: uploadedAt || new Date().toISOString(),
        period_start: range.start ? range.start.toISOString() : null,
        period_end: range.end ? range.end.toISOString() : null
      }
    });

    setAnalysisReports(prev => ({
      ...prev,
      [normalizedPeriod]: payload
    }));

    const record: DbPVSalesAnalysisReport = {
      company_id: sessionInfo.companyId,
      branch: sessionInfo.filial,
      period_label: normalizedPeriod,
      period_start: payload.meta?.period_start ?? null,
      period_end: payload.meta?.period_end ?? null,
      file_name: payload.meta?.file_name ?? null,
      uploaded_at: payload.meta?.uploaded_at ?? null,
      analysis_payload: payload
    };

    await upsertPVSalesAnalysisReport(record);
  };

  const handleUpdatePVSale = (saleId: string, classification: PVSaleClassification) => {
    setConfirmedPVSales(prev => {
      const newState = { ...prev, [saleId]: classification };

      // Persist immediate change
      if (sessionInfo?.companyId && sessionInfo?.filial) {
        upsertActiveSalesReport({
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          sales_records: salesRecords,
          sales_period: salesPeriod,
          confirmed_sales: buildConfirmedSalesPayload(newState, effectiveFinalizedByPeriod),
          user_email: userEmail || '',
          status: 'processed'
        }).catch(err => console.error('Erro ao salvar classificação:', err));
      }

      return newState;
    });
  };

  const handleUpdatePVRecord = async (id: string, updates: Partial<PVRecord>) => {
    if (!id) return;

    const existing = pvRecords.find(rec => rec.id === id);
    setPvRecords(prev => prev.map(rec => (rec.id === id ? { ...rec, ...updates } : rec)));

    if (id.startsWith('db-')) return;

    const payload: { quantity?: number; origin_branch?: string | null; sector_responsible?: string | null } = {};
    if (updates.quantity !== undefined) payload.quantity = updates.quantity;
    if (updates.originBranch !== undefined) payload.origin_branch = updates.originBranch ? updates.originBranch : null;
    if (updates.sectorResponsible !== undefined) payload.sector_responsible = updates.sectorResponsible ? updates.sectorResponsible : null;

    if (Object.keys(payload).length === 0) return;

    const ok = await updatePVBranchRecordDetails(id, payload);
    if (!ok) {
      console.error('Falha ao atualizar PV no banco:', { id, payload });
    }

    if (
      updates.quantity !== undefined &&
      sessionInfo?.companyId &&
      sessionInfo?.filial &&
      existing &&
      updates.quantity !== existing.quantity
    ) {
      const localEvent: DbPVBranchRecordEvent = {
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        record_id: existing.id,
        reduced_code: existing.reducedCode,
        event_type: 'UPDATED',
        previous_quantity: existing.quantity,
        new_quantity: updates.quantity,
        user_email: userEmail || null,
        created_at: new Date().toISOString()
      };
      upsertLocalPVEvent(localEvent);
      const saved = await insertPVBranchRecordEvent(localEvent);
      if (saved) {
        upsertLocalPVEvent(saved);
      }
      insertAppEventLog({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        area: sessionInfo.area || null,
        user_email: userEmail || null,
        user_name: userName || null,
        app: 'pre_vencidos',
        event_type: 'pv_updated',
        entity_type: 'pv_record',
        entity_id: existing.id,
        status: 'success',
        success: true,
        source: 'web',
        event_meta: {
          reduced_code: existing.reducedCode,
          previous_quantity: existing.quantity,
          new_quantity: updates.quantity
        }
      }).catch(() => { });
    }
  };

  const refreshDashboardHistory = useCallback(async () => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;
    setIsRefreshingDashboard(true);
    try {
      const history = await fetchPVSalesHistory(sessionInfo.companyId, sessionInfo.filial);
      if (history) setHistoryRecords(history);
    } catch (error) {
      console.error('Erro ao atualizar dashboard:', error);
      alert('Erro ao atualizar dashboard.');
    } finally {
      setIsRefreshingDashboard(false);
    }
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  const handleFinalizeSale = async (reducedCode: string, period: string) => {
    const normalizedPeriod = (period || salesPeriod || '').trim() || 'Período não identificado';
    let totalPVUnitsToDeduct = 0;

    // Prepare records for history
    const historyEntries: DbPVSalesHistory[] = [];

    Object.keys(confirmedPVSales).forEach(key => {
      // Key: `${period}-${seller}-${reducedCode}-${quantity}-${idx}`
      if (key.startsWith(`${period}-`) && key.includes(`-${reducedCode}-`)) {
        const item = confirmedPVSales[key];
        const parts = key.split('-');
        // parts[0] = period
        // parts[1] = seller
        // parts[2] = reducedCode (can be split if code has dashes, careful)
        // Better to recover seller from parts or just look at data if possible. 
        // Structure is standard so: currentSalesPeriod + '-' + seller + '-' + code + ...

        // Let's rely on the iteration to sum up stuff.
        if (item.confirmed) totalPVUnitsToDeduct += item.qtyPV;

        // Create history record
        if (sessionInfo?.companyId && sessionInfo.filial && (item.qtyPV > 0 || item.qtyNeutral > 0 || item.qtyIgnoredPV > 0)) {
          // Extract seller and product name using logic from AnalysisView or just parsing key roughly? 
          // We need accurate data. SalesRecord has it.
          // Improved Seller Extraction using metadata if available
          const seller = item.sellerName || parts[1];
          const product = pvRecords.find(r => r.reducedCode === reducedCode);
          const quantityHint = Number(parts[parts.length - 2]);
          const unitPrice = getSalesUnitPrice(seller, reducedCode, Number.isFinite(quantityHint) ? quantityHint : undefined);
          const soldValue = unitPrice * item.qtyPV;
          const ignoredValue = unitPrice * item.qtyIgnoredPV;

          historyEntries.push({
            company_id: sessionInfo.companyId,
            branch: sessionInfo.filial,
            user_email: userEmail || '',
            sale_period: normalizedPeriod,
            seller_name: seller,
            reduced_code: reducedCode,
            product_name: product?.name || 'Produto Finalizado',
            qty_sold_pv: item.qtyPV,
            qty_ignored: item.qtyIgnoredPV,
            qty_neutral: item.qtyNeutral,
            unit_price: unitPrice || 0,
            value_sold_pv: soldValue || 0,
            value_ignored: ignoredValue || 0,
            finalized_at: new Date().toISOString()
          });
        }
      }
    });

    if (totalPVUnitsToDeduct > 0) {
      setPvRecords(prev => {
        const updated = [...prev];
        const index = updated.findIndex(r => r.reducedCode === reducedCode);
        if (index !== -1) {
          const targetRecord = updated[index];
          const newQty = Math.max(0, targetRecord.quantity - totalPVUnitsToDeduct);

          if (newQty <= 0) {
            updated.splice(index, 1);
            // Sync with DB: Delete if empty
            if (targetRecord.id) deletePVBranchRecord(targetRecord.id);
          } else {
            updated[index] = { ...targetRecord, quantity: newQty };
            // Sync with DB: Update quantity
            if (targetRecord.id) updatePVBranchRecord(targetRecord.id, newQty);
          }
        }
        return updated;
      });
      alert(`Sucesso! ${totalPVUnitsToDeduct} unidades baixadas do estoque PV.`);
    } else {
      alert("Lançamento finalizado. Registro salvo no histórico.");
    }

    // Persist History to DB
    if (historyEntries.length > 0) {
      const success = await insertPVSalesHistory(historyEntries);
      if (success) {
        setHistoryRecords(prev => [...prev, ...historyEntries]);
        refreshDashboardHistory();

        // Ensure active report is refreshed with any state changes if needed? 
        // Actually, finalized state is stored in finalizedREDSByPeriod? 
        // If we need that persisted, we should add it to the table too.
        // For now, let's assume classification (dots) is the main "launched" visual.
      } else {
        alert("Atenção: Houve um erro ao salvar o histórico de vendas no banco. O dashboard pode não atualizar corretamente.");
      }
    }

    const currentPeriodFinalized = finalizedREDSByPeriod[normalizedPeriod] || [];
    const nextFinalized = {
      ...finalizedREDSByPeriod,
      [normalizedPeriod]: [...new Set([...currentPeriodFinalized, reducedCode])]
    };

    setFinalizedREDSByPeriod(nextFinalized);

    if (sessionInfo?.companyId && sessionInfo?.filial) {
      const finalizedForPersist = mergeFinalizedMaps(nextFinalized, historyFinalizedByPeriod);
      upsertActiveSalesReport({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        sales_records: salesRecords,
        sales_period: normalizedPeriod,
        confirmed_sales: buildConfirmedSalesPayload(confirmedPVSales, finalizedForPersist),
        user_email: userEmail || '',
        status: 'processed'
      }).catch(err => console.error('Erro ao persistir finalização:', err));
    }
    const existingReport = analysisReports[normalizedPeriod];
    const updatedFinalizedCodes = nextFinalized[normalizedPeriod] || [];

    if (existingReport) {
      const updatedPayload: AnalysisReportPayload = {
        ...existingReport,
        finalized_codes: updatedFinalizedCodes
      };
      setAnalysisReports(prev => ({
        ...prev,
        [normalizedPeriod]: updatedPayload
      }));
      if (sessionInfo?.companyId && sessionInfo?.filial) {
        upsertPVSalesAnalysisReport({
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          period_label: normalizedPeriod,
          period_start: existingReport.meta?.period_start ?? null,
          period_end: existingReport.meta?.period_end ?? null,
          file_name: existingReport.meta?.file_name ?? null,
          uploaded_at: existingReport.meta?.uploaded_at ?? null,
          analysis_payload: updatedPayload
        }).catch(err => console.error('Erro ao atualizar relatório de análise:', err));
      }
    } else if (salesRecords.length > 0 && sessionInfo?.companyId && sessionInfo?.filial) {
      const fallbackPayload = buildAnalysisReportPayload({
        pvRecords,
        salesRecords,
        periodLabel: normalizedPeriod,
        finalizedCodes: updatedFinalizedCodes,
        meta: {
          company: sessionInfo.company,
          branch: sessionInfo.filial,
          area: sessionInfo.area,
          file_name: localLastUpload?.file_name || null,
          uploaded_at: localLastUpload?.uploaded_at || new Date().toISOString()
        }
      });
      setAnalysisReports(prev => ({
        ...prev,
        [normalizedPeriod]: fallbackPayload
      }));
      upsertPVSalesAnalysisReport({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        period_label: normalizedPeriod,
        period_start: fallbackPayload.meta?.period_start ?? null,
        period_end: fallbackPayload.meta?.period_end ?? null,
        file_name: fallbackPayload.meta?.file_name ?? null,
        uploaded_at: fallbackPayload.meta?.uploaded_at ?? null,
        analysis_payload: fallbackPayload
      }).catch(err => console.error('Erro ao salvar relatório de análise (fallback):', err));
    }
  };

  const matchesContext = (record?: SalesUploadRecord) => {
    if (!record || !sessionInfo?.companyId || !sessionInfo?.filial) return false;
    return record.company_id === sessionInfo.companyId && record.branch === sessionInfo.filial;
  };

  const evaluateConflict = (record?: SalesUploadRecord, label?: string, currentRange?: PeriodRange) => {
    if (!record || !label) return undefined;
    if (!matchesContext(record)) return undefined;

    // 1. Exact Label Match
    if (record.period_label === label) return record;

    // 2. Date Range Overlap
    const existingRange = buildRecordRange(record);
    if (currentRange && currentRange.start && currentRange.end && existingRange.start && existingRange.end) {
      if (rangesOverlap(currentRange, existingRange)) {
        return record;
      }
    }
    return undefined;
  };

  const findConflictingUpload = (range: PeriodRange, label: string) => {
    // Check history (DB)
    for (const report of salesUploads) {
      const conflict = evaluateConflict(report, label, range);
      if (conflict) return conflict;
    }

    // Check active local report (if not in history list yet)
    if (localLastUpload) {
      const conflict = evaluateConflict(localLastUpload, label, range);
      if (conflict) return conflict;
    }

    return undefined;
  };

  const formatUploadTimestamp = (value?: string) => {
    if (!value) return 'momento anterior';
    try {
      const date = new Date(value);
      const datePart = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(date);
      const timePart = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(date);
      return `${datePart}, ${timePart}`;
    } catch {
      return value;
    }
  };

  const persistSalesUploadRecord = async (label: string, range: PeriodRange, fileName: string, uploadedAt?: string) => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;
    const timestamp = uploadedAt || new Date().toISOString();
    const baseRecord: SalesUploadRecord = {
      user_email: userEmail || '',
      company_id: sessionInfo.companyId,
      branch: sessionInfo.filial,
      period_label: label,
      period_start: range.start ? range.start.toISOString() : null,
      period_end: range.end ? range.end.toISOString() : null,
      file_name: fileName || null,
      uploaded_at: timestamp
    };

    const addUploadRecord = (record: SalesUploadRecord) => {
      setSalesUploads(prev => {
        const filtered = prev.filter(r => r.period_label !== record.period_label);
        return [record, ...filtered];
      });
    };

    addUploadRecord(baseRecord);
    if (userEmail) {
      saveLastSalesUpload(userEmail, baseRecord);
    }
    setLocalLastUpload(baseRecord);

    try {
      const saved = await insertPVSalesUpload(baseRecord);
      if (saved) {
        addUploadRecord(saved);
        if (userEmail) {
          saveLastSalesUpload(userEmail, saved);
        }
        setLocalLastUpload(saved);
      }
    } catch (error) {
      console.error('Erro registrando relatório de vendas carregado:', error);
    }
  };

  const processAndSetSales = (sales: SalesRecord[], period: string, fileName?: string, range?: PeriodRange, uploadedAt?: string) => {
    const cleanedPeriod = (period || '').trim() || 'Período não identificado';
    const enrichedSales = sales.map(s => {
      const product = masterProducts.find(p => p.reducedCode === s.reducedCode);
      return {
        ...s,
        date: cleanedPeriod,
        dcb: product ? product.dcb : s.dcb,
        productName: product ? product.name : s.productName,
        lab: product?.lab || s.lab
      };
    });
    setSalesRecords(enrichedSales);
    setSalesPeriod(cleanedPeriod);
    setCurrentView(AppView.ANALYSIS);

    // Update localLastUpload immediately for UI feedback
    if (sessionInfo?.companyId && sessionInfo?.filial) {
      setLocalLastUpload({
        period_label: cleanedPeriod,
        file_name: fileName || 'Upload Manual',
        uploaded_at: uploadedAt || new Date().toISOString(),
        user_email: userEmail || '',
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        period_start: null,
        period_end: null
      });
    }

    // Persist to DB
    if (sessionInfo?.companyId && sessionInfo?.filial) {
      upsertActiveSalesReport({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        sales_records: enrichedSales,
        sales_period: cleanedPeriod,
        confirmed_sales: buildConfirmedSalesPayload({}, {}), // Reset confirmed sales + metadata on new report
        user_email: userEmail || '',
        file_name: fileName,
        status: 'processed'
      }).then(ok => {
        if (ok) console.log('✅ [PV Persistence] Relatório de vendas salvo no banco.');
      });
    }

    if (range) {
      persistAnalysisReport(enrichedSales, cleanedPeriod, range, fileName, uploadedAt)
        .catch(err => console.error('Erro ao salvar relatório de análise:', err));
    }
  };

  const handleParsedSales = async (sales: SalesRecord[], rawPeriodLabel: string | undefined, fileName: string) => {
    if (pendingLaunchCount > 0) {
      alert(`Ainda existem ${pendingLaunchCount} itens com "Falta Lançar no Período".\n\nFinalize todos os lançamentos pendentes antes de carregar um novo arquivo de vendas.`);
      return;
    }
    const normalizedLabel = (rawPeriodLabel || '').trim() || 'Período não identificado';
    const parsedRange = parsePeriodRange(normalizedLabel);
    const conflict = findConflictingUpload(parsedRange, normalizedLabel);

    // Check against currently loaded/active report (Already handled by findConflictingUpload if localLastUpload is checked there, but keeping strict label check for clarity)
    if (localLastUpload && localLastUpload.period_label === normalizedLabel) {
      alert(`Já existe um relatório ativo para este período: "${normalizedLabel}".\n\nArquivo atual: ${fileName}\nArquivo ativo: ${localLastUpload.file_name}\n\nNão é permitido carregar novamente o mesmo período de venda.`);
      return;
    }

    if (conflict) {
      const friendlyTimestamp = formatUploadTimestamp(conflict.uploaded_at);
      const fileHint = conflict.file_name ? `Arquivo original: ${conflict.file_name}` : 'Arquivo anterior';
      const type = conflict.period_label === normalizedLabel ? 'PERÍODO DUPLICADO' : 'CHOQUE DE DATAS';

      alert(
        `⛔ BLOQUEADO: ${type}\n\n` +
        `O período que você está tentando carregar (${normalizedLabel}) entra em conflito com um relatório já processado.\n\n` +
        `Detalhes do conflito:\n` +
        `Relatório Existente: ${conflict.period_label}\n` +
        `${fileHint}\n` +
        `Carregado em: ${friendlyTimestamp}\n\n` +
        `Para manter a integridade do histórico, não é permitido carregar períodos sobrepostos.`
      );
      return;
    }

    const uploadedAt = new Date().toISOString();
    processAndSetSales(sales, normalizedLabel, fileName, parsedRange, uploadedAt);
    await persistSalesUploadRecord(normalizedLabel, parsedRange, fileName, uploadedAt);
    if (sessionInfo?.companyId && sessionInfo?.filial) {
      insertAppEventLog({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        area: sessionInfo.area || null,
        user_email: userEmail || null,
        user_name: userName || null,
        app: 'pre_vencidos',
        event_type: 'pv_sales_upload_success',
        entity_type: 'sales_upload',
        entity_id: normalizedLabel,
        status: 'success',
        success: true,
        source: 'web',
        event_meta: {
          period_label: normalizedLabel,
          file_name: fileName,
          total_sales: sales.length
        }
      }).catch(() => { });
    }
  };

  const handleSalesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (pendingLaunchCount > 0) {
      alert(`Ainda existem ${pendingLaunchCount} itens com "Falta Lançar no Período".\n\nFinalize todos os lançamentos pendentes antes de carregar um novo arquivo de vendas.`);
      e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = file.name;
    const fileNameLower = fileName.toLowerCase();

    const formatSalesUploadError = (err?: unknown) => {
      const message = err instanceof Error ? err.message : String(err || '');
      const lower = message.toLowerCase();
      if (lower.includes('nenhuma venda encontrada')) {
        return 'Erro ao processar arquivo de vendas. Nenhuma venda foi localizada na planilha. Verifique se as colunas de Código, Quantidade e Valor de Vendas estão presentes.';
      }
      if (lower.includes('includes') || lower.includes('undefined')) {
        return 'Erro ao processar arquivo de vendas. O arquivo não contém o cabeçalho ou as colunas esperadas.';
      }
      if (lower.includes('sheet') || lower.includes('workbook')) {
        return 'Erro ao processar arquivo de vendas. Não foi possível ler a planilha.';
      }
      if (lower.includes('csv') || lower.includes('parse')) {
        return 'Erro ao processar arquivo de vendas. O arquivo CSV está inválido ou fora do padrão.';
      }
      return 'Erro ao processar arquivo de vendas. Verifique se o arquivo está no formato correto (código, descrição, laboratório, quantidade e valor).';
    };
    const notifyError = (err?: unknown) => {
      if (sessionInfo?.companyId && sessionInfo?.filial) {
        const message = err instanceof Error ? err.message : String(err || '');
        insertAppEventLog({
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          area: sessionInfo.area || null,
          user_email: userEmail || null,
          user_name: userName || null,
          app: 'pre_vencidos',
          event_type: 'pv_sales_upload_error',
          entity_type: 'sales_upload',
          entity_id: fileName || null,
          status: 'error',
          success: false,
          source: 'web',
          error_code: message || null,
          event_meta: { file_name: fileName || null }
        }).catch(() => { });
      }
      alert(formatSalesUploadError(err));
    };

    if (fileNameLower.endsWith('.csv') || fileNameLower.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const text = event.target?.result as string;
          const sales = parseSalesCSV(text);
          await handleParsedSales(sales, `CSV-Upload-${new Date().toLocaleDateString()}`, fileName);
        } catch (err) {
          console.error('Erro ao ler CSV de vendas:', err);
          notifyError(err);
        }
      };
      reader.onerror = () => notifyError();
      reader.readAsText(file);
    } else {
      (async () => {
        try {
          const salesData = await parseSalesXLSX(file);
          await handleParsedSales(salesData.sales, salesData.period, fileName);
        } catch (error) {
          console.error('Erro ao ler XLSX de vendas:', error);
          notifyError(error);
        }
      })();
    }

    e.target.value = '';
  };

  const handleInventoryUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isMaster) {
      alert('Apenas usuário master pode carregar o estoque.');
      e.target.value = '';
      return;
    }
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      alert('Selecione a filial antes de carregar o estoque.');
      e.target.value = '';
      return;
    }

    const file = e.target.files?.[0];
    if (!file) return;

    const fileName = file.name;
    (async () => {
      try {
        const records = await parseInventoryXLSX(file);
        const uploadedAt = new Date().toISOString();

        buildInventoryMaps(records);

        const report: DbPVInventoryReport = {
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          file_name: fileName,
          uploaded_at: uploadedAt,
          records
        };

        const saved = await upsertPVInventoryReport(report);
        if (saved) {
          setInventoryReport(saved);
          alert(`Estoque atualizado! ${records.length} itens carregados.`);
          insertAppEventLog({
            company_id: sessionInfo.companyId,
            branch: sessionInfo.filial,
            area: sessionInfo.area || null,
            user_email: userEmail || null,
            user_name: userName || null,
            app: 'pre_vencidos',
            event_type: 'pv_inventory_upload_success',
            entity_type: 'inventory_upload',
            entity_id: fileName,
            status: 'success',
            success: true,
            source: 'web',
            event_meta: { file_name: fileName, total_records: records.length }
          }).catch(() => { });
        } else {
          setInventoryReport(report);
          alert('Estoque carregado, mas não foi possível confirmar o salvamento no banco.');
          insertAppEventLog({
            company_id: sessionInfo.companyId,
            branch: sessionInfo.filial,
            area: sessionInfo.area || null,
            user_email: userEmail || null,
            user_name: userName || null,
            app: 'pre_vencidos',
            event_type: 'pv_inventory_upload_error',
            entity_type: 'inventory_upload',
            entity_id: fileName,
            status: 'error',
            success: false,
            source: 'web',
            event_meta: { file_name: fileName, reason: 'save_failed' }
          }).catch(() => { });
        }
      } catch (error) {
        console.error('Erro ao carregar estoque:', error);
        const details = error instanceof Error ? error.message : String(error || '');
        alert(details ? `Erro ao carregar estoque:\n${details}` : 'Erro ao carregar estoque.');
        insertAppEventLog({
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          area: sessionInfo.area || null,
          user_email: userEmail || null,
          user_name: userName || null,
          app: 'pre_vencidos',
          event_type: 'pv_inventory_upload_error',
          entity_type: 'inventory_upload',
          entity_id: fileName,
          status: 'error',
          success: false,
          source: 'web',
          error_code: details || null,
          event_meta: { file_name: fileName }
        }).catch(() => { });
      }
    })();

    e.target.value = '';
  };

  const blobToBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64 || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  const base64ToBlob = (base64: string) => {
    const byteChars = atob(base64 || '');
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i += 1) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    return new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
  };

  const openPdfPreview = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    setPdfPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return { url, fileName };
    });
  };

  const closePdfPreview = () => {
    if (pdfPreview?.url) URL.revokeObjectURL(pdfPreview.url);
    setPdfPreview(null);
  };

  const openPdfBlob = (blob: Blob, fileName: string, mode: 'download' | 'preview') => {
    if (mode === 'preview') {
      openPdfPreview(blob, fileName);
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const buildDashboardReportFileName = (prefix: string) => {
    const safeBranch = (sessionInfo?.filial || 'filial').replace(/\s+/g, '_').replace(/[^\w-]/g, '');
    const dateStamp = new Date().toISOString().slice(0, 10);
    return `${prefix}_pv_${safeBranch}_${dateStamp}.pdf`;
  };

  const drawSummaryCard = (doc: any, x: number, y: number, w: number, h: number, title: string, value: string, subtitle: string, accent: [number, number, number]) => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, w, h, 10, 10, 'FD');
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(title, x + 14, y + 18);
    doc.setFontSize(20);
    doc.setTextColor(...accent);
    doc.text(value, x + 14, y + 40);
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitle, x + 14, y + 58);
  };

  const buildClosingReportPDF = async (records: DbPVSalesHistory[], metrics: DashboardMetrics, prefix: 'final' | 'preview', periodLabel: string) => {
    const jsPDF = (window as any).jspdf?.jsPDF;
    if (!jsPDF) {
      alert('Biblioteca de PDF não carregada. O relatório não pôde ser gerado.');
      return null;
    }

    try {
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 32;
      const headerHeight = 62;

      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, pageWidth, headerHeight, 'F');
      doc.setFontSize(18);
      doc.setTextColor(255, 255, 255);
      doc.text('RANKING MENSAL - PRÉ-VENCIDOS', margin, 38);
      doc.setFontSize(9);
      doc.setTextColor(219, 234, 254);
      doc.text(`Filial: ${sessionInfo?.filial || 'N/A'} • Período: ${periodLabel}`, margin, 54);

      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text(`Gerado em ${new Date().toLocaleString()}`, pageWidth - margin - 160, 54);

      const cardWidth = (pageWidth - margin * 2 - 16) / 2;
      const cardHeight = 78;
      const cardStartY = headerHeight + 18;
      const rowGap = 12;

      drawSummaryCard(
        doc,
        margin,
        cardStartY,
        cardWidth,
        cardHeight,
        'RECUPERADO PV (FILIAL)',
        String(metrics.totalRecovered),
        formatCurrency(metrics.totalRecoveredCost || 0),
        [22, 163, 74]
      );

      drawSummaryCard(
        doc,
        margin + cardWidth + 16,
        cardStartY,
        cardWidth,
        cardHeight,
        'IGNOROU PV (FILIAL)',
        String(metrics.totalIgnored),
        formatCurrency(metrics.totalIgnoredCost || 0),
        [239, 68, 68]
      );

      drawSummaryCard(
        doc,
        margin,
        cardStartY + cardHeight + rowGap,
        cardWidth,
        cardHeight,
        'EFICIÊNCIA GERAL',
        `${metrics.efficiency.toFixed(1)}%`,
        'Meta de conversão',
        [15, 23, 42]
      );

      drawSummaryCard(
        doc,
        margin + cardWidth + 16,
        cardStartY + cardHeight + rowGap,
        cardWidth,
        cardHeight,
        'ESTOQUE RESTANTE PV',
        String(metrics.pvInRegistry),
        'Produtos cadastrados',
        [30, 64, 175]
      );

      const rankingStartY = cardStartY + (cardHeight * 2) + rowGap + 20;
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text('RANKING DE EFICIÊNCIA POR VENDEDOR', margin, rankingStartY);

      const rankingRows = metrics.ranking.slice(0, 10).map((item, idx) => ([
        `${idx + 1}º`,
        item.name,
        `+${item.positive} PV`,
        `${item.neutral} N`,
        `-${item.negative} IGNOROU`,
        `Custo: ${formatCurrency(item.positiveCost || 0)} / ${formatCurrency(item.negativeCost || 0)}`
      ]));

      (doc as any).autoTable({
        startY: rankingStartY + 12,
        head: [['Pos.', 'Vendedor', '+PV', 'N', 'Ignorou', 'Custo (+/-)']],
        body: rankingRows,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
        headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.row.index === 0) {
            data.cell.styles.fillColor = [252, 211, 77]; // ouro
            data.cell.styles.textColor = [120, 53, 15];
          }
          if (data.section === 'body' && data.row.index === 1) {
            data.cell.styles.fillColor = [226, 232, 240]; // prata
            data.cell.styles.textColor = [71, 85, 105];
          }
          if (data.section === 'body' && data.row.index === 2) {
            data.cell.styles.fillColor = [253, 186, 116]; // bronze
            data.cell.styles.textColor = [124, 45, 18];
          }
        }
      });

      const fileName = buildDashboardReportFileName(prefix === 'final' ? 'ranking_final' : 'ranking_simulacao');
      const blob = doc.output('blob');
      const base64 = await blobToBase64(blob);

      return { blob, base64, fileName };
    } catch (e) {
      console.error('Erro gerando PDF de fechamento:', e);
      return null;
    }
  };

  const handleClearDashboard = async () => {
    if (!isMaster) {
      alert('Apenas usuário master pode limpar o dashboard.');
      return;
    }
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      alert('Selecione a filial antes de limpar o dashboard.');
      return;
    }

    if (historyRecords.length > 0) {
      const confirmed = confirm(`Tem certeza que deseja limpar o dashboard da filial ${sessionInfo.filial}? \n\nUm relatório PDF será gerado automaticamente com os dados atuais antes da limpeza.`);
      if (!confirmed) return;
    } else {
      if (!confirm('O dashboard já está vazio. Deseja limpá-lo mesmo assim?')) return;
    }

    // Generate PDF Report BEFORE clearing
    if (historyRecords.length > 0) {
      setIsGeneratingDashboardReport(true);
      const rankingPeriod = resolveRankingPeriodLabel();
      const pdfData = await buildClosingReportPDF(historyRecords, dashboardMetrics, 'final', rankingPeriod);
      setIsGeneratingDashboardReport(false);
      if (!pdfData) {
        if (!confirm('Falha ao gerar o relatório PDF. Deseja continuar com a limpeza mesmo assim? (Os dados serão perdidos)')) return;
      } else {
        const periodLabel = rankingPeriod || null;
        const reportPayload: DbPVDashboardReport = {
          company_id: sessionInfo.companyId,
          branch: sessionInfo.filial,
          report_type: 'FINAL',
          period_label: periodLabel,
          user_email: userEmail || null,
          file_name: pdfData.fileName,
          pdf_base64: pdfData.base64
        };
        const saved = await insertPVDashboardReport(reportPayload);
        if (saved) {
          setLastDashboardReport(saved);
          insertAppEventLog({
            company_id: sessionInfo.companyId,
            branch: sessionInfo.filial,
            area: sessionInfo.area || null,
            user_email: userEmail || null,
            user_name: userName || null,
            app: 'pre_vencidos',
            event_type: 'pv_dashboard_finalized',
            entity_type: 'dashboard_report',
            entity_id: saved.id,
            status: 'success',
            success: true,
            source: 'web',
            event_meta: { period_label: periodLabel, file_name: pdfData.fileName }
          }).catch(() => { });
        } else {
          alert('Relatório gerado, mas não foi possível salvar no banco.');
        }
        openPdfBlob(pdfData.blob, pdfData.fileName, 'preview');
      }
    }

    setIsClearingDashboard(true);
    try {
      const cleared = await deletePVBranchSalesHistory(sessionInfo.companyId, sessionInfo.filial);
      if (!cleared) {
        alert('Não foi possível limpar o dashboard agora. Tente novamente em alguns instantes.');
        return;
      }

      setHistoryRecords([]);
      setConfirmedPVSales({});
      setFinalizedREDSByPeriod({});
      setSalesPeriod('');
      setShowStockDetail(false);
      alert('Dashboard limpo com sucesso! Os registros de vendas foram arquivados (PDF) e removidos da visualização.');
      insertAppEventLog({
        company_id: sessionInfo.companyId,
        branch: sessionInfo.filial,
        area: sessionInfo.area || null,
        user_email: userEmail || null,
        user_name: userName || null,
        app: 'pre_vencidos',
        event_type: 'pv_dashboard_cleared',
        entity_type: 'dashboard',
        entity_id: sessionInfo.filial,
        status: 'success',
        success: true,
        source: 'web'
      }).catch(() => { });
    } finally {
      setIsClearingDashboard(false);
    }
  };

  const handleSimulateDashboard = async () => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      alert('Selecione a filial antes de simular o ranking.');
      return;
    }
    if (isGeneratingDashboardReport) return;

    if (historyRecords.length === 0) {
      if (lastDashboardReport?.pdf_base64) {
        const blob = base64ToBlob(lastDashboardReport.pdf_base64);
        openPdfBlob(blob, lastDashboardReport.file_name || 'ranking_mensal.pdf', 'preview');
        return;
      }
      alert('Não há dados para simular o ranking mensal.');
      return;
    }

    setIsGeneratingDashboardReport(true);
    const rankingPeriod = resolveRankingPeriodLabel();
    const pdfData = await buildClosingReportPDF(historyRecords, dashboardMetrics, 'preview', rankingPeriod);
    setIsGeneratingDashboardReport(false);
    if (!pdfData) {
      alert('Não foi possível gerar o PDF de simulação.');
      return;
    }

    const periodLabel = rankingPeriod || null;
    const reportPayload: DbPVDashboardReport = {
      company_id: sessionInfo.companyId,
      branch: sessionInfo.filial,
      report_type: 'PREVIEW',
      period_label: periodLabel,
      user_email: userEmail || null,
      file_name: pdfData.fileName,
      pdf_base64: pdfData.base64
    };
    const saved = await insertPVDashboardReport(reportPayload);
    if (saved) {
      setLastDashboardReport(saved);
    }

    openPdfBlob(pdfData.blob, pdfData.fileName, 'preview');
    insertAppEventLog({
      company_id: sessionInfo.companyId,
      branch: sessionInfo.filial,
      area: sessionInfo.area || null,
      user_email: userEmail || null,
      user_name: userName || null,
      app: 'pre_vencidos',
      event_type: 'pv_dashboard_preview',
      entity_type: 'dashboard_report',
      entity_id: saved?.id || null,
      status: 'success',
      success: true,
      source: 'web',
      event_meta: { period_label: periodLabel, file_name: pdfData.fileName }
    }).catch(() => { });
  };

  const persistPVSession = useCallback(async () => {
    if (!userEmail) return;
    const payload: DbPVSession = {
      id: pvSessionId || undefined,
      user_email: userEmail,
      company_id: sessionInfo?.companyId || null,
      branch: sessionInfo?.filial || '',
      area: sessionInfo?.area || '',
      pharmacist: sessionInfo?.pharmacist || '',
      manager: sessionInfo?.manager || '',
      session_data: {
        // We do NOT save the big product lists to session anymore to keep it light 
        // and force re-upload as requested.
        // master_products: masterProducts, 
        // system_products: systemProducts,
        // dcb_products: dcbBaseProducts,

        // PV Records are now in DB (pv_branch_records), do not duplicate in blob
        // pv_records: pvRecords, 

        confirmed_pv_sales: confirmedPVSales,
        finalized_reds_by_period: finalizedREDSByPeriod,
        sales_period: salesPeriod
      },
      updated_at: new Date().toISOString()
    };
    saveLocalPVSession(userEmail, payload);
    setIsSavingSession(true);
    try {
      // Upserting session mainly for metadata now
      const saved = await upsertPVSession(payload);
      if (saved) setPvSessionId(saved.id || null);
    } catch (error) {
      console.error('Erro salvando sessão PV no Supabase:', error);
    } finally {
      setIsSavingSession(false);
    }
  }, [userEmail, pvSessionId, sessionInfo, confirmedPVSales, finalizedREDSByPeriod, salesPeriod]);


  const schedulePersist = useCallback(() => {
    if (persistTimeoutRef.current) clearTimeout(persistTimeoutRef.current);
    if (!userEmail) return;
    persistTimeoutRef.current = setTimeout(() => {
      persistPVSession();
      persistTimeoutRef.current = null;
    }, 2500);
  }, [persistPVSession, userEmail]);

  useEffect(() => {
    schedulePersist();
  }, [masterProducts, systemProducts, dcbBaseProducts, pvRecords, confirmedPVSales, finalizedREDSByPeriod, salesPeriod, sessionInfo, userEmail, schedulePersist]);

  const handleRefreshDashboard = () => {
    refreshDashboardHistory();
  };

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
      if (pdfPreview?.url) {
        URL.revokeObjectURL(pdfPreview.url);
      }
    };
  }, [pdfPreview]);

  const dashboardMetrics = useMemo(() => {
    const sellerStats: Record<string, { positive: number, neutral: number, negative: number, positiveCost: number, negativeCost: number }> = {};
    let totalRecovered = 0;
    let totalIgnored = 0;
    let totalRecoveredCost = 0;
    let totalIgnoredCost = 0;

    // 1. Add metrics from Persistent History (DB)
    historyRecords.forEach(rec => {
      const seller = rec.seller_name || 'Desconhecido';
      if (!sellerStats[seller]) sellerStats[seller] = { positive: 0, neutral: 0, negative: 0, positiveCost: 0, negativeCost: 0 };

      const soldQty = Number(rec.qty_sold_pv || 0);
      const ignoredQty = Number(rec.qty_ignored || 0);
      const neutralQty = Number(rec.qty_neutral || 0);

      sellerStats[seller].positive += soldQty > 0 ? soldQty : 0;
      if (neutralQty > 0) {
        sellerStats[seller].neutral += neutralQty;
      }
      sellerStats[seller].negative += ignoredQty > 0 ? ignoredQty : 0;

      const unitCost = getInventoryCostUnitByReduced(rec.reduced_code);
      const soldCost = soldQty > 0 ? soldQty * unitCost : 0;
      const ignoredCost = ignoredQty > 0 ? ignoredQty * unitCost : 0;
      sellerStats[seller].positiveCost += soldCost;
      sellerStats[seller].negativeCost += ignoredCost;

      totalRecovered += soldQty > 0 ? soldQty : 0;
      totalIgnored += ignoredQty > 0 ? ignoredQty : 0;
      totalRecoveredCost += soldCost;
      totalIgnoredCost += ignoredCost;
    });

    // 2. Add metrics from Current Session (InMemory), skipping those already finalized/saved
    Object.keys(confirmedPVSales).forEach(key => {
      const data = confirmedPVSales[key];
      // key format: `${period}-${seller}-${reducedCode}-...`
      const parts = key.split('-');

      // Basic check: if this ReducedCode is already marked as finalized for this period, 
      // assume it's in historyRecords now (or added optimistically), so skip to avoid duplicate.
      // key structure is tricky, let's look for reducedCode.
      // Actually, we can just check if we added it to history. 
      // But let's use the 'finalizedREDSByPeriod' map.
      // We need to parse reducedCode from key. 
      // Safe bet: The logic in handleFinalizeSale adds to history AND adds to finalizedREDSByPeriod.
      // So if it's in finalizedREDSByPeriod, we SKIP it here.

      // Re-extract params. 
      // "PERIOD-SELLER-CODE-QTY-IDX"
      // If Period has dashes (e.g. "JAN-26"), this split is fragile.
      // But let's try to assume the code is at index 2 if period and seller are simple?
      // Better: we know 'finalizedREDSByPeriod' keys are Periods.
      // We can check if any finalized array contains a code that matches this key.

      const isFinalized = Object.keys(effectiveFinalizedByPeriod).some(periodKey => {
        if (key.startsWith(periodKey)) {
          const list = effectiveFinalizedByPeriod[periodKey];
          // Check if key contains any of the finalized codes
          return list.some(code => key.includes(`-${code}-`));
        }
        return false;
      });

      if (isFinalized) return; // Already counted in history

      // Use stored seller name if available, fallback to key parsing
      const seller = data.sellerName || parts[1];
      if (!sellerStats[seller]) sellerStats[seller] = { positive: 0, neutral: 0, negative: 0, positiveCost: 0, negativeCost: 0 };

      let reducedCode = data.reducedCode;
      if (!reducedCode) {
        const candidate = parts[parts.length - 3];
        if (candidate && /^\d+$/.test(candidate)) {
          reducedCode = candidate;
        }
      }
      const unitCost = getInventoryCostUnitByReduced(reducedCode);
      const soldCost = data.qtyPV > 0 ? data.qtyPV * unitCost : 0;
      const ignoredCost = data.qtyIgnoredPV > 0 ? data.qtyIgnoredPV * unitCost : 0;

      sellerStats[seller].positive += data.qtyPV > 0 ? data.qtyPV : 0;
      if (data.qtyNeutral > 0) {
        sellerStats[seller].neutral += data.qtyNeutral;
      }
      sellerStats[seller].negative += data.qtyIgnoredPV > 0 ? data.qtyIgnoredPV : 0;
      sellerStats[seller].positiveCost += soldCost;
      sellerStats[seller].negativeCost += ignoredCost;
      totalRecovered += data.qtyPV > 0 ? data.qtyPV : 0;
      totalIgnored += data.qtyIgnoredPV > 0 ? data.qtyIgnoredPV : 0;
      totalRecoveredCost += soldCost;
      totalIgnoredCost += ignoredCost;
    });

    const ranking = Object.entries(sellerStats)
      .map(([name, data]) => ({
        name,
        score: data.positive - data.negative,
        positive: data.positive,
        neutral: data.neutral,
        negative: data.negative,
        positiveCost: data.positiveCost,
        negativeCost: data.negativeCost
      }))
      .sort((a, b) => b.score - a.score || b.positive - a.positive);

    const pvInRegistry = pvRecords.reduce((acc, r) => acc + r.quantity, 0);

    const stockByMonth: Record<string, number> = {};
    pvRecords.forEach(r => {
      stockByMonth[r.expiryDate] = (stockByMonth[r.expiryDate] || 0) + r.quantity;
    });
    const sortedStockByMonth = Object.entries(stockByMonth)
      .sort((a, b) => {
        const [m1, y1] = a[0].split('/').map(Number);
        const [m2, y2] = b[0].split('/').map(Number);
        return (y1 * 12 + m1) - (y2 * 12 + m2);
      });

    const totalPotentialSales = totalRecovered + totalIgnored;
    const efficiency = totalPotentialSales > 0 ? (totalRecovered / totalPotentialSales) * 100 : 0;

    return { ranking, totalRecovered, totalIgnored, totalRecoveredCost, totalIgnoredCost, efficiency, pvInRegistry, sortedStockByMonth };
  }, [pvRecords, confirmedPVSales, historyRecords, effectiveFinalizedByPeriod, inventoryCostByBarcode, barcodeByReduced]);

  const historyDetailItems = useMemo(() => {
    if (!historyDetail) return [];
    let filtered = [...historyRecords];
    if (historyDetail.type === 'seller') {
      const target = historyDetail.seller || '';
      filtered = filtered.filter(r => (r.seller_name || 'Desconhecido') === target);
    } else if (historyDetail.type === 'recovered') {
      filtered = filtered.filter(r => Number(r.qty_sold_pv || 0) > 0);
    } else if (historyDetail.type === 'ignored') {
      filtered = filtered.filter(r => Number(r.qty_ignored || 0) > 0);
    }
    filtered.sort((a, b) => {
      const da = a.finalized_at ? new Date(a.finalized_at).getTime() : 0;
      const db = b.finalized_at ? new Date(b.finalized_at).getTime() : 0;
      return db - da;
    });
    return filtered;
  }, [historyDetail, historyRecords]);

  const formatHistoryDate = (val?: string) => {
    if (!val) return '-';
    const date = new Date(val);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.toLocaleDateString('pt-BR')} ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  const logout = async () => {
    if (!confirm('Encerrar sessão?')) return;

    if (userEmail) {
      clearLocalPVSession(userEmail);
      clearLastSalesUpload(userEmail);
      await clearLocalPVReports(userEmail).catch(() => { });
      await deletePVReports(userEmail).catch(() => { });
      await deletePVSession(userEmail);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(buildSetupDraftKey(userEmail));
      }
    }

    setHasCompletedSetup(false);
    setCurrentView(AppView.SETUP);
    setSessionInfo(null);
    setSystemProducts([]);
    setDcbBaseProducts([]);
    setMasterProducts([]);
    setPvRecords([]);
    setSalesRecords([]);
    setConfirmedPVSales({});
    setFinalizedREDSByPeriod({});
    setSalesPeriod('');
    setHistoryRecords([]);
    setPvSessionId(null);
    setSalesUploads([]);
    setAnalysisReports({});
    setInventoryReport(null);
    setInventoryCostByBarcode({});
    setInventoryStockByBarcode({});
    setLocalLastUpload(null);
    setLastDashboardReport(null);
    setPvRecordEvents([]);
    setReportSyncedAt({ system: null, dcb: null });
    setPdfPreview(null);
  };

  const canSimulateDashboard = historyRecords.length > 0 || !!lastDashboardReport;

  const getRankBadgeClasses = (index: number) => {
    if (index === 0) return 'bg-yellow-200 text-amber-700 shadow-sm';
    if (index === 1) return 'bg-slate-200 text-slate-600 shadow-sm';
    if (index === 2) return 'bg-orange-200 text-orange-700 shadow-sm';
    return 'bg-white text-slate-300 border';
  };

  const pvEventSummary = useMemo(() => {
    if (!pvRecordEvents.length) {
      return { edited: 0, deleted: 0, lastUpdatedAt: null as string | null };
    }
    const edited = pvRecordEvents.filter(e => e.event_type === 'UPDATED').length;
    const deleted = pvRecordEvents.filter(e => e.event_type === 'DELETED').length;
    const last = pvRecordEvents
      .map(e => e.created_at)
      .filter(Boolean)
      .map(date => new Date(date as string))
      .filter(d => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      edited,
      deleted,
      lastUpdatedAt: last ? last.toISOString() : null
    };
  }, [pvRecordEvents]);

  const parseExpiryPeriod = (value: string | undefined) => {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/(\d{1,2})\s*[\/\-]\s*(\d{2,4})/);
    if (!match) return null;
    const month = Number(match[1]);
    let year = Number(match[2]);
    if (Number.isNaN(month) || Number.isNaN(year)) return null;
    if (year < 100) year += 2000;
    if (month < 1 || month > 12) return null;
    return { month, year };
  };

  const expiryAlert = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    let expired = 0;
    let current = 0;
    let future = 0;
    let unknown = 0;

    pvRecords.forEach(rec => {
      const parsed = parseExpiryPeriod(rec.expiryDate);
      const qty = Number(rec.quantity || 0);
      if (!parsed) {
        unknown += qty;
        return;
      }
      if (parsed.year < currentYear || (parsed.year === currentYear && parsed.month < currentMonth)) {
        expired += qty;
      } else if (parsed.year === currentYear && parsed.month === currentMonth) {
        current += qty;
      } else {
        future += qty;
      }
    });

    const status = expired > 0 ? 'expired' : current > 0 ? 'due' : 'ok';
    const periodLabel = `${String(currentMonth).padStart(2, '0')}/${String(currentYear).slice(-2)}`;

    return { expired, current, future, unknown, status, periodLabel };
  }, [pvRecords]);

  const lastEventByType = useMemo(() => {
    const pickLatest = (type: string) => {
      const events = pvRecordEvents
        .filter(e => e.event_type === type)
        .map(e => ({
          ...e,
          ts: e.created_at ? new Date(e.created_at as string).getTime() : NaN
        }))
        .filter(e => !Number.isNaN(e.ts))
        .sort((a, b) => b.ts - a.ts);
      return events[0] || null;
    };
    return {
      created: pickLatest('CREATED'),
      updated: pickLatest('UPDATED'),
      deleted: pickLatest('DELETED')
    };
  }, [pvRecordEvents]);

  const formatEventLabel = (event: DbPVBranchRecordEvent | null) => {
    if (!event?.created_at) return 'Sem registro';
    const date = new Date(event.created_at as string);
    if (Number.isNaN(date.getTime())) return 'Sem registro';
    return date.toLocaleString('pt-BR', { hour12: false });
  };

  const expiryTooltip = useMemo(() => {
    const { expired, current, periodLabel } = expiryAlert;
    if (expired > 0) {
      return `Vermelho: ${expired.toLocaleString('pt-BR')} produto(s) com vencimento anterior a ${periodLabel}.`;
    }
    if (current > 0) {
      return `Amarelo: ${current.toLocaleString('pt-BR')} produto(s) vencendo em ${periodLabel}.`;
    }
    return `Verde: sem produtos vencendo em ${periodLabel}.`;
  }, [expiryAlert]);

  const lastCreatedLabel = formatEventLabel(lastEventByType.created);
  const lastUpdatedLabel = formatEventLabel(lastEventByType.updated);
  const lastDeletedLabel = formatEventLabel(lastEventByType.deleted);

  const lastCreatedTooltip = lastEventByType.created
    ? `Último cadastro: ${lastCreatedLabel} • Usuário: ${lastEventByType.created.user_email || 'N/D'}`
    : 'Sem registros de cadastro';
  const lastUpdatedTooltip = lastEventByType.updated
    ? `Última edição: ${lastUpdatedLabel} • Usuário: ${lastEventByType.updated.user_email || 'N/D'}`
    : 'Sem registros de edição';
  const lastDeletedTooltip = lastEventByType.deleted
    ? `Última exclusão: ${lastDeletedLabel} • Usuário: ${lastEventByType.deleted.user_email || 'N/D'}`
    : 'Sem registros de exclusão';

  const alertStyle =
    expiryAlert.status === 'expired'
      ? 'bg-red-100 text-red-700 border-red-200 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.25)]'
      : expiryAlert.status === 'due'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-emerald-100 text-emerald-700 border-emerald-200';
  const alertLabel =
    expiryAlert.status === 'expired'
      ? `${expiryAlert.expired.toLocaleString('pt-BR')} vencido(s)`
      : expiryAlert.status === 'due'
        ? `${expiryAlert.current.toLocaleString('pt-BR')} vence(m) ${expiryAlert.periodLabel}`
        : `Sem vencimentos ${expiryAlert.periodLabel}`;
  const headerInfo = sessionInfo || setupDraftInfo;
  const hasBranchContext = !!(sessionInfo?.companyId && sessionInfo?.filial);
  const shouldWaitSetupPrefetch = currentView === AppView.SETUP && !!(setupDraftInfo?.companyId && setupDraftInfo?.filial);
  const initialHydrationReady = useMemo(() => {
    if (!userEmail) return true;
    if (isLoadingSession) return false;
    if (!isInitialSyncDone || reportsSyncStatus === 'loading') return false;
    if (shouldWaitSetupPrefetch && isBranchPrefetching) return false;
    if (!hasBranchContext) return true;
    return !isLoadingBranchSalesState
      && !isLoadingSalesUploads
      && !isLoadingAnalysisReports
      && !isLoadingInventoryReport;
  }, [
    userEmail,
    isLoadingSession,
    isInitialSyncDone,
    reportsSyncStatus,
    shouldWaitSetupPrefetch,
    isBranchPrefetching,
    hasBranchContext,
    isLoadingBranchSalesState,
    isLoadingSalesUploads,
    isLoadingAnalysisReports,
    isLoadingInventoryReport
  ]);

  useEffect(() => {
    if (hasInitialHydrationCompleted) return;
    if (initialHydrationReady) {
      setHasInitialHydrationCompleted(true);
    }
  }, [hasInitialHydrationCompleted, initialHydrationReady]);

  if (!hasInitialHydrationCompleted) {
    return (
      <div className="h-full w-full bg-slate-50 flex items-center justify-center">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-8 py-6 flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-blue-500 rounded-full animate-spin"></div>
          <p className="text-sm font-black text-slate-700 uppercase tracking-wider">Sincronizando Pré-Vencidos</p>
          <p className="text-xs text-slate-500 font-semibold">Aguardando carregamento completo dos dados do Supabase...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden text-slate-900">
      {/* NOVO HEADER DARK SUPERIOR (SUBSTITUI SIDEBAR) */}
      <header className="bg-slate-900 text-white shadow-2xl z-30 shrink-0">
        <div className="max-w-[1920px] mx-auto flex items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-8">
            {/* Logo Section */}
            <div className="flex items-center gap-3 pr-6 border-r border-slate-800">
              <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/40">
                <Package size={20} className="text-white" />
              </div>
              <div>
                <h1 className="font-black text-sm leading-none tracking-tight">PV MANAGER</h1>
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold">Conferência 2.0</span>
              </div>
            </div>

            {/* Navigation Section */}
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const targetView = item.id as AppView;
                const disabled = !canSwitchToView(targetView);
                const active = currentView === targetView;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavItemClick(targetView)}
                    disabled={disabled}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-xs font-bold uppercase tracking-wide
                      ${active
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                        : disabled
                          ? 'text-slate-600 cursor-not-allowed opacity-50'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                  >
                    {React.cloneElement(item.icon as React.ReactElement<any>, { size: 16 })}
                    <span className="hidden lg:inline">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Tools & Actions Section */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
              {isMaster ? (
                <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-700 text-slate-300 transition-colors group">
                  <Package size={16} className="text-amber-400" />
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-tighter">Estoque</span>
                    {inventoryReport?.uploaded_at && <span className="text-[7px] text-slate-500 font-bold -mt-0.5">{formatUploadTimestamp(inventoryReport.uploaded_at)}</span>}
                  </div>
                  <input type="file" className="hidden" accept=".xlsx,.xls" onChange={handleInventoryUpload} />
                </label>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-slate-600 cursor-not-allowed" title="Somente Master">
                  <Package size={16} />
                  <span className="text-[9px] font-black uppercase tracking-tighter">Estoque</span>
                </div>
              )}

              <div className="w-px h-6 bg-slate-700 mx-1"></div>

              <label className="flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-slate-700 text-slate-300 transition-colors group">
                <TrendingUp size={16} className="text-emerald-400" />
                <div className="flex flex-col">
                  <span className="text-[9px] font-black uppercase tracking-tighter">Vendas</span>
                  <span className="text-[7px] text-slate-500 font-bold -mt-0.5">{salesRecords.length} reg.</span>
                </div>
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv,.txt" onChange={handleSalesUpload} />
              </label>

              <div className="w-px h-6 bg-slate-700 mx-1"></div>

              <button
                onClick={() => setShowHistoryModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-700 text-slate-300 transition-colors"
                title="Histórico de Uploads"
              >
                <Clock size={16} className="text-blue-400" />
                <span className="text-[9px] font-black uppercase tracking-tighter">Uploads</span>
              </button>
            </div>

            <button onClick={logout} className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 hover:bg-red-600 hover:text-white hover:border-red-500 transition-all shadow-lg" title="Sair">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* HEADER COMPACTO DE SESSÃO */}
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-20 shadow-sm shadow-slate-200/50">
          <div className="flex items-center gap-6 flex-wrap">
            <div className="flex items-center gap-2 text-blue-600">
              <Building size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">{headerInfo?.company || 'DROGARIA CIDADE'}</span>
            </div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-2 text-slate-600 flex-wrap">
              <User size={16} className="text-blue-500" />
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Farmacêutico</span>
              <span className="text-[10px] font-bold uppercase text-slate-700">{headerInfo?.pharmacist || 'Convidado'}</span>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-2">Gestor</span>
              <span className="text-[10px] font-bold uppercase text-slate-700">{headerInfo?.manager || '-'}</span>
              <span className="text-[10px] text-white font-black bg-gradient-to-r from-blue-600 to-indigo-500 px-2.5 py-1 rounded-full shadow-lg shadow-blue-500/30 ring-1 ring-blue-300/60 whitespace-nowrap">
                Filial: {headerInfo?.filial || '-'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap justify-end">
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-50 rounded-full border border-slate-100" title={`Status: ${connectionStatus}`}>
              <div className={`w-2 h-2 rounded-full ${connectionStatus === 'online' ? 'bg-emerald-500 animate-pulse-slow shadow-[0_0_8px_rgba(16,185,129,0.3)]' : connectionStatus === 'syncing' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`}></div>
              <span className={`text-[9px] font-black ${connectionStatus === 'online' ? 'text-emerald-700' : 'text-amber-700'}`}>
                {connectionStatus === 'online' ? 'SISTEMA ONLINE' : 'SINCRONIZANDO'}
              </span>
            </div>

            <div className={`px-3 py-1 rounded-full border flex items-center gap-2 ${alertStyle}`} title={expiryTooltip}>
              <AlertTriangle size={12} />
              <span className="text-[9px] font-black uppercase tracking-tight">Perecíveis</span>
              <span className="text-[9px] font-black">{alertLabel}</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-slate-100 bg-white text-slate-600" title={lastCreatedTooltip}>
                <UserPlus size={12} className="text-emerald-500" />
                <span className="text-[8px] font-black uppercase tracking-tight">Cadastro</span>
                <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">{lastCreatedLabel}</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-slate-100 bg-white text-slate-600" title={lastUpdatedTooltip}>
                <PencilLine size={12} className="text-amber-500" />
                <span className="text-[8px] font-black uppercase tracking-tight">Edição</span>
                <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">{lastUpdatedLabel}</span>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border border-slate-100 bg-white text-slate-600" title={lastDeletedTooltip}>
                <Trash size={12} className="text-red-500" />
                <span className="text-[8px] font-black uppercase tracking-tight">Exclusão</span>
                <span className="text-[8px] font-bold text-slate-500 whitespace-nowrap">{lastDeletedLabel}</span>
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-slate-50/50">
          {currentView === AppView.SETUP && (
            <SetupView
              onComplete={(info) => {
                if (userEmail) {
                  const snapshot: DbPVSession = {
                    id: pvSessionId || undefined,
                    user_email: userEmail,
                    company_id: info.companyId || null,
                    branch: info.filial || '',
                    area: info.area || '',
                    pharmacist: info.pharmacist || '',
                    manager: info.manager || '',
                    session_data: {
                      confirmed_pv_sales: confirmedPVSales,
                      finalized_reds_by_period: finalizedREDSByPeriod,
                      sales_period: salesPeriod,
                      currentView: 'registration'
                    },
                    updated_at: new Date().toISOString()
                  };
                  saveLocalPVSession(userEmail, snapshot);
                  upsertPVSession(snapshot).then(saved => {
                    if (saved?.id) setPvSessionId(saved.id);
                  }).catch(err => console.error('Erro ao salvar snapshot inicial da sessão PV:', err));
                  if (typeof window !== 'undefined') {
                    window.localStorage.removeItem(buildSetupDraftKey(userEmail));
                  }
                }
                setSessionInfo(info);
                // Only clear PV records as we are starting a fresh registration session
                setPvRecords([]);

                // Keep sales records if they were uploaded during setup
                // If not, clear the classifications
                if (salesRecords.length === 0) {
                  setConfirmedPVSales({});
                  setFinalizedREDSByPeriod({});
                  setSalesPeriod('');
                } else {
                  // If we already have sales, persist them to the new branch/company
                  if (info.companyId && info.filial) {
                    console.log('📤 [PV Persistence] Persistindo relatório carregado em memória para a nova filial...');
                    upsertActiveSalesReport({
                      company_id: info.companyId,
                      branch: info.filial,
                      sales_records: salesRecords,
                      sales_period: salesPeriod,
                      confirmed_sales: buildConfirmedSalesPayload(confirmedPVSales, finalizedREDSByPeriod),
                      user_email: userEmail || '',
                      file_name: localLastUpload?.file_name || 'Upload via Setup',
                      status: 'processed'
                    }).then(ok => {
                      if (ok) console.log('✅ [PV Persistence] Relatório de vendas persistido com sucesso.');
                    }).catch(err => console.error('❌ [PV Persistence] Erro ao persistir vendas no setup:', err));
                  }
                }

                setHasCompletedSetup(true);
                setCurrentView(AppView.REGISTRATION);
              }}
              onSystemProductsUpload={handleSystemProductsUpload}
              onDCBBaseUpload={handleDCBBaseUpload}
              productsLoaded={masterProducts.length > 0}
              systemLoaded={systemProducts.length > 0}
              dcbLoaded={dcbBaseProducts.length > 0}
              reportsReady={reportsReady}
              reportsStatus={reportsSyncStatus}
              isBranchPrefetching={isBranchPrefetching}
              branchPrefetchReady={branchPrefetchReady}
              branchPrefetchError={branchPrefetchError}
              onInfoChange={handleSetupInfoChange}
              initialInfo={setupDraftInfo}
              userBranch={userBranch}
              companies={companies as any}
              uploadHistory={salesUploads}
              inventoryReport={inventoryReport}
              systemReportSyncedAt={reportSyncedAt.system}
              dcbReportSyncedAt={reportSyncedAt.dcb}
            />
          )}
          {currentView === AppView.REGISTRATION && (
            <PVRegistration
              masterProducts={masterProducts} pvRecords={pvRecords} sessionInfo={sessionInfo}
              pvEventSummary={pvEventSummary}
              barcodeByReduced={barcodeByReduced}
              inventoryCostByBarcode={inventoryCostByBarcode}
              originBranches={originBranches}
              userEmail={userEmail}
              userName={userName}
              onRefresh={handleRefresh}
              onUpdatePV={handleUpdatePVRecord}
              onAddPV={async (rec) => {
                // Save to Supabase (pv_branch_records)
                if (sessionInfo && sessionInfo.companyId) {
                  try {
                    const saved = await insertPVBranchRecord({
                      company_id: sessionInfo.companyId,
                      branch: sessionInfo.filial,
                      reduced_code: rec.reducedCode,
                      product_name: rec.name,
                      dcb: rec.dcb,
                      quantity: rec.quantity,
                      origin_branch: rec.originBranch || null,
                      sector_responsible: rec.sectorResponsible || null,
                      expiry_date: rec.expiryDate,
                      entry_date: rec.entryDate,
                      user_email: userEmail || ''
                    });
                    if (saved && saved.id) {
                      rec.id = String(saved.id);
                    } else {
                      alert("Aviso: O registro foi adicionado à lista mas NÃO foi confirmado no banco de dados. Ao sair, ele pode ser perdido. Tente novamente.");
                    }
                  } catch (e) {
                    console.error('Erro ao salvar registro de filial:', e);
                    alert("Erro ao salvar no banco de dados. Verifique a conexão.");
                  }
                }

                if (sessionInfo?.companyId && sessionInfo?.filial) {
                  const localEvent: DbPVBranchRecordEvent = {
                    company_id: sessionInfo.companyId,
                    branch: sessionInfo.filial,
                    record_id: rec.id,
                    reduced_code: rec.reducedCode,
                    event_type: 'CREATED',
                    previous_quantity: null,
                    new_quantity: rec.quantity,
                    user_email: userEmail || null,
                    created_at: new Date().toISOString()
                  };
                  upsertLocalPVEvent(localEvent);
                  const savedEvent = await insertPVBranchRecordEvent(localEvent);
                  if (savedEvent) {
                    upsertLocalPVEvent(savedEvent);
                  }
                  insertAppEventLog({
                    company_id: sessionInfo.companyId,
                    branch: sessionInfo.filial,
                    area: sessionInfo.area || null,
                    user_email: userEmail || null,
                    user_name: userName || null,
                    app: 'pre_vencidos',
                    event_type: 'pv_created',
                    entity_type: 'pv_record',
                    entity_id: rec.id,
                    status: 'success',
                    success: true,
                    source: 'web',
                    event_meta: {
                      reduced_code: rec.reducedCode,
                      quantity: rec.quantity,
                      expiry_date: rec.expiryDate
                    }
                  }).catch(() => { });
                }

                // Adiciona infos do usuário localmente para exibição imediata
                const recordWithUser = {
                  ...rec,
                  userEmail: userEmail || '',
                  userName: userName || ''
                };
                setPvRecords(prev => [recordWithUser, ...prev]);
              }}
              onRemovePV={async (id) => {
                const target = pvRecords.find(r => r.id === id);
                setPvRecords(prev => prev.filter(r => r.id !== id));
                await deletePVBranchRecord(id);
                if (target && sessionInfo?.companyId && sessionInfo?.filial) {
                  const localEvent: DbPVBranchRecordEvent = {
                    company_id: sessionInfo.companyId,
                    branch: sessionInfo.filial,
                    record_id: target.id,
                    reduced_code: target.reducedCode,
                    event_type: 'DELETED',
                    previous_quantity: target.quantity,
                    new_quantity: null,
                    user_email: userEmail || null,
                    created_at: new Date().toISOString()
                  };
                  upsertLocalPVEvent(localEvent);
                  const saved = await insertPVBranchRecordEvent(localEvent);
                  if (saved) {
                    upsertLocalPVEvent(saved);
                  }
                  insertAppEventLog({
                    company_id: sessionInfo.companyId,
                    branch: sessionInfo.filial,
                    area: sessionInfo.area || null,
                    user_email: userEmail || null,
                    user_name: userName || null,
                    app: 'pre_vencidos',
                    event_type: 'pv_deleted',
                    entity_type: 'pv_record',
                    entity_id: target.id,
                    status: 'success',
                    success: true,
                    source: 'web',
                    event_meta: {
                      reduced_code: target.reducedCode,
                      previous_quantity: target.quantity
                    }
                  }).catch(() => { });
                }
              }}
            />
          )}
          {currentView === AppView.ANALYSIS && (
            <div className="space-y-4">
              {salesPeriod && (
                <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <Calendar size={20} />
                    <span className="text-sm font-black uppercase tracking-widest">Período de Vendas Reconhecido: {salesPeriod}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold bg-white/20 px-3 py-1 rounded-full uppercase">Excel Linha 5 / Coluna I</span>
                    {localLastUpload && localLastUpload.company_id === sessionInfo?.companyId && localLastUpload.branch === sessionInfo?.filial && (
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/80">
                        Último carregamento: {formatUploadTimestamp(localLastUpload.uploaded_at)} · {localLastUpload.file_name || 'arquivo sem nome'}
                        <span className="ml-2 text-white/60">Período: {localLastUpload.period_label || 'sem período'}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}
              <AnalysisView
                pvRecords={pvRecords} salesRecords={salesRecords} confirmedPVSales={confirmedPVSales}
                finalizedREDSByPeriod={effectiveFinalizedByPeriod}
                currentSalesPeriod={salesPeriod}
                sessionInfo={sessionInfo}
                lastUpload={localLastUpload}
                barcodeByReduced={barcodeByReduced}
                inventoryCostByBarcode={inventoryCostByBarcode}
                inventoryStockByBarcode={inventoryStockByBarcode}
                labByReduced={labByReduced}
                userEmail={userEmail}
                userName={userName}
                onUpdatePVSale={handleUpdatePVSale} onFinalizeSale={handleFinalizeSale}
              />
            </div>
          )}
          {currentView === AppView.DASHBOARD && (
            <>
              <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-slate-800 uppercase tracking-widest">Dashboard</h2>
                  <button
                    onClick={handleRefreshDashboard}
                    disabled={isRefreshingDashboard}
                    className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isRefreshingDashboard ? 'Atualizando...' : 'Atualizar dashboard'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <button
                    onClick={() => setHistoryDetail({ type: 'recovered' })}
                    className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 text-left hover:shadow-md transition-all active:scale-95"
                  >
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recuperado PV (Filial)</p>
                    <p className="text-4xl font-black text-green-600 mt-2">{dashboardMetrics.totalRecovered}</p>
                    <p className="text-[9px] font-bold text-green-600 mt-2 uppercase tracking-widest">
                      {formatCurrency(dashboardMetrics.totalRecoveredCost || 0)}
                    </p>
                    <p className="text-[9px] font-bold text-green-500 mt-2 uppercase flex items-center gap-1"><CheckCircle size={10} /> Positivo</p>
                  </button>
                  <button
                    onClick={() => setHistoryDetail({ type: 'ignored' })}
                    className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 text-left hover:shadow-md transition-all active:scale-95"
                  >
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ignorou PV (Filial)</p>
                    <p className="text-4xl font-black text-red-500 mt-2">{dashboardMetrics.totalIgnored}</p>
                    <p className="text-[9px] font-bold text-red-500 mt-2 uppercase tracking-widest">
                      {formatCurrency(dashboardMetrics.totalIgnoredCost || 0)}
                    </p>
                    <p className="text-[9px] font-bold text-red-400 mt-2 uppercase flex items-center gap-1"><MinusCircle size={10} /> Negativo</p>
                  </button>
                  <div className="bg-slate-900 p-6 rounded-3xl shadow-xl text-white">
                    <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Eficiência Geral Acumulada</p>
                    <p className="text-4xl font-black mt-2">{dashboardMetrics.efficiency.toFixed(1)}%</p>
                    <div className="mt-4 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${dashboardMetrics.efficiency}%` }}></div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowStockDetail(true)}
                    className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 text-left hover:shadow-md transition-all active:scale-95 group"
                  >
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Estoque Restante PV</p>
                    <p className="text-4xl font-black text-slate-800 mt-2 group-hover:text-blue-600 transition-colors">{dashboardMetrics.pvInRegistry}</p>
                    <p className="text-[9px] font-bold text-slate-400 mt-2 uppercase flex items-center gap-1">
                      <Info size={10} /> Clique para detalhar
                    </p>
                  </button>
                </div>

                {showStockDetail && (
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2 uppercase text-xs tracking-widest">
                          <Calendar size={18} className="text-blue-500" /> Detalhamento por Vencimento
                        </h3>
                        <button onClick={() => setShowStockDetail(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <X size={20} />
                        </button>
                      </div>
                      <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                        <div className="space-y-3">
                          {dashboardMetrics.sortedStockByMonth.length === 0 ? (
                            <p className="text-center py-10 text-slate-400 text-sm italic">Nenhum estoque PV cadastrado.</p>
                          ) : (
                            dashboardMetrics.sortedStockByMonth.map(([month, qty]) => (
                              <div key={month} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200">
                                    <Calendar size={16} className="text-blue-500" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-black text-slate-800 uppercase">{month}</p>
                                    <p className="text-[10px] text-slate-400 font-bold">Mês de Vencimento</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-xl font-black text-blue-600">{qty}</p>
                                  <p className="text-[9px] font-black text-slate-400 uppercase">UNIDADES</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-slate-400 uppercase">Total Geral</span>
                        <span className="text-xl font-black text-slate-800">{dashboardMetrics.pvInRegistry}</span>
                      </div>
                    </div>
                  </div>
                )}

                {historyDetail && (
                  <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
                      <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <h3 className="font-bold text-slate-800 flex items-center gap-2 uppercase text-xs tracking-widest">
                          <TrendingUp size={18} className="text-blue-500" />
                          {historyDetail.type === 'seller'
                            ? `Detalhes do Vendedor: ${historyDetail.seller}`
                            : historyDetail.type === 'recovered'
                              ? 'Itens Recuperados (PV)'
                              : 'Itens Ignorados (PV)'}
                        </h3>
                        <button onClick={() => setHistoryDetail(null)} className="text-slate-400 hover:text-red-500 transition-colors">
                          <X size={20} />
                        </button>
                      </div>
                      <div className="p-6 max-h-[65vh] overflow-y-auto custom-scrollbar">
                        {historyDetailItems.length === 0 ? (
                          <p className="text-center py-10 text-slate-400 text-sm italic">Nenhum registro encontrado.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="text-slate-400 uppercase tracking-widest">
                                <tr className="text-left border-b border-slate-100">
                                  {historyDetail.type !== 'seller' && <th className="py-2 pr-4">Vendedor</th>}
                                  <th className="py-2 pr-4">Produto</th>
                                  <th className="py-2 pr-4 text-center">Vendido</th>
                                  <th className="py-2 pr-4 text-center">Ignorado</th>
                                  <th className="py-2 pr-4 text-center">Valor Unit.</th>
                                  <th className="py-2 pr-4 text-center">Total</th>
                                  <th className="py-2 pr-4">Quando</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {historyDetailItems.map((rec, idx) => (
                                  <tr key={`${rec.reduced_code}-${rec.seller_name}-${idx}`} className="text-slate-700">
                                    {historyDetail.type !== 'seller' && (
                                      <td className="py-3 pr-4 font-bold uppercase text-[10px]">{rec.seller_name || '-'}</td>
                                    )}
                                    <td className="py-3 pr-4">
                                      <div className="font-semibold">{rec.product_name || '-'}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">RED: {rec.reduced_code}</div>
                                    </td>
                                    <td className="py-3 pr-4 text-center">
                                      <span className="inline-flex min-w-[32px] justify-center bg-green-50 text-green-700 px-2 py-0.5 rounded-md font-black text-[10px]">
                                        {Number(rec.qty_sold_pv || 0)}
                                      </span>
                                    </td>
                                    <td className="py-3 pr-4 text-center">
                                      <span className="inline-flex min-w-[32px] justify-center bg-red-50 text-red-700 px-2 py-0.5 rounded-md font-black text-[10px]">
                                        {Number(rec.qty_ignored || 0)}
                                      </span>
                                    </td>
                                    <td className="py-3 pr-4 text-center text-[10px] font-bold text-slate-600">
                                      {formatCurrency(getInventoryCostUnitByReduced(rec.reduced_code))}
                                    </td>
                                    <td className="py-3 pr-4 text-center text-[10px] font-bold text-slate-600">
                                      {formatCurrency(getInventoryCostUnitByReduced(rec.reduced_code) * Number(rec.qty_sold_pv || 0))}
                                    </td>
                                    <td className="py-3 pr-4 text-[11px] text-slate-500">{formatHistoryDate(rec.finalized_at)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                      <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center text-xs font-bold uppercase text-slate-400">
                        <span>Registros</span>
                        <span className="text-slate-700">{historyDetailItems.length}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                  <h3 className="text-lg font-bold flex items-center gap-3 mb-8 uppercase tracking-tight">
                    <Trophy className="text-amber-500" /> Ranking de Eficiência por Vendedor
                  </h3>
                  {dashboardMetrics.ranking.length === 0 ? (
                    <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed text-sm">
                      Sem dados de classificação para exibir no ranking.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {dashboardMetrics.ranking.map((s, i) => (
                        <button
                          key={s.name}
                          onClick={() => setHistoryDetail({ type: 'seller', seller: s.name })}
                          className="flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-md transition-all text-left active:scale-[0.99]"
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${getRankBadgeClasses(i)}`}>
                            {i + 1}º
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-800 uppercase text-xs truncate">{s.name}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <span className="text-[8px] font-black text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-100">+{s.positive} PV</span>
                              <span className="text-[8px] font-black text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">{s.neutral} N</span>
                              <span className="text-[8px] font-black text-red-500 bg-red-50 px-1.5 py-0.5 rounded border border-red-100">-{s.negative} ERR</span>
                            </div>
                            <p className="text-[9px] font-bold text-blue-600 mt-2 uppercase tracking-widest">Saldo: {s.score}</p>
                            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                              Custo: {formatCurrency(s.positiveCost || 0)} / {formatCurrency(s.negativeCost || 0)}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {sessionInfo?.filial && (
                <div className="fixed bottom-6 right-6 z-40 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    onClick={handleSimulateDashboard}
                    disabled={!canSimulateDashboard || isGeneratingDashboardReport}
                    className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-600 shadow-lg transition hover:bg-slate-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    title={canSimulateDashboard ? 'Simular o fechamento do ranking mensal' : 'Sem dados para simular'}
                  >
                    <Info size={16} />
                    <span>Simular finalizar ranking mensal</span>
                  </button>
                  <button
                    onClick={handleClearDashboard}
                    disabled={!isMaster || isClearingDashboard}
                    className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/90 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-rose-600 shadow-lg shadow-rose-200 transition hover:bg-rose-50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                    title={isMaster ? 'Limpar os dados acumulados deste dashboard' : 'Somente usuário master pode usar'}
                  >
                    <Trash2 size={16} />
                    <span>Limpar dashboard</span>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <SalesHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        history={salesUploads}
        analysisReports={{
          ...analysisReports,
          ...(currentAnalysisReport && currentAnalysisReport.period_label
            ? { [currentAnalysisReport.period_label.trim()]: currentAnalysisReport }
            : {})
        }}
      />
      {pdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="text-sm font-bold text-slate-800">Pré-visualização do PDF</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const frame = document.getElementById('pdf-preview-frame') as HTMLIFrameElement | null;
                    try {
                      frame?.contentWindow?.focus();
                      frame?.contentWindow?.print();
                    } catch {
                      window.print();
                    }
                    if (sessionInfo?.companyId && sessionInfo?.filial) {
                      insertAppEventLog({
                        company_id: sessionInfo.companyId,
                        branch: sessionInfo.filial,
                        area: sessionInfo.area || null,
                        user_email: userEmail || null,
                        user_name: userName || null,
                        app: 'pre_vencidos',
                        event_type: 'pv_dashboard_printed',
                        entity_type: 'dashboard_report',
                        entity_id: pdfPreview.fileName,
                        status: 'success',
                        success: true,
                        source: 'web'
                      }).catch(() => { });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700"
                >
                  Imprimir PDF
                </button>
                <a
                  href={pdfPreview.url}
                  download={pdfPreview.fileName}
                  onClick={() => {
                    if (sessionInfo?.companyId && sessionInfo?.filial) {
                      insertAppEventLog({
                        company_id: sessionInfo.companyId,
                        branch: sessionInfo.filial,
                        area: sessionInfo.area || null,
                        user_email: userEmail || null,
                        user_name: userName || null,
                        app: 'pre_vencidos',
                        event_type: 'pv_dashboard_downloaded',
                        entity_type: 'dashboard_report',
                        entity_id: pdfPreview.fileName,
                        status: 'success',
                        success: true,
                        source: 'web'
                      }).catch(() => { });
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-200"
                >
                  Baixar PDF
                </a>
                <button
                  onClick={closePdfPreview}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </div>
            <iframe
              id="pdf-preview-frame"
              src={pdfPreview.url}
              className="flex-1 w-full rounded-b-2xl"
              title="Pré-visualização PDF"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PreVencidosManager;
