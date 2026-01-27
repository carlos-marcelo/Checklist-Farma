
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Product, PVRecord, SalesRecord, AppView, SessionInfo, PVSaleClassification } from '../../preVencidos/types';
import {
  parseSystemProductsXLSX,
  parseDCBProductsXLSX,
  parseSalesXLSX,
  parseSalesCSV
} from '../../preVencidos/dataService';
import PVRegistration from './PVRegistration';
import AnalysisView from './AnalysisView';
import SetupView from './SetupView';
import { NAV_ITEMS } from '../../preVencidos/constants';
import { Package, AlertTriangle, LogOut, Settings, Trophy, TrendingUp, MinusCircle, CheckCircle, Calendar, Info, Trash2, X } from 'lucide-react';
import {
  DbCompany,
  DbPVSession,
  fetchPVSession,
  upsertPVSession,
  insertPVBranchRecord,
  fetchPVBranchRecords,
  deletePVBranchRecord,
  updatePVBranchRecord,
  fetchPVSalesHistory,
  deletePVBranchSalesHistory,
  insertPVSalesHistory,
  DbPVSalesHistory
} from '../../supabaseService';
import { loadLocalPVSession, saveLocalPVSession, clearLocalPVSession } from '../../preVencidos/storage';

interface PreVencidosManagerProps {
  userEmail?: string;
  userName?: string;
  companies: DbCompany[];
}

const PreVencidosManager: React.FC<PreVencidosManagerProps> = ({ userEmail, userName, companies = [] }) => {
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
  const [historyRecords, setHistoryRecords] = useState<DbPVSalesHistory[]>([]);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSwitchToView = (view: AppView) => view === AppView.SETUP || hasCompletedSetup;
  const handleNavItemClick = (view: AppView) => {
    if (!canSwitchToView(view)) return;
    setCurrentView(view);
  };
  const handleReconfigure = () => {
    setHasCompletedSetup(false);
    setCurrentView(AppView.SETUP);
    setSessionInfo(null);
  };

  const applySessionFromData = useCallback((session: DbPVSession) => {
    const data = session.session_data || {};
    setPvSessionId(session.id || null);
    // User requested to NOT restore reports/products on exit/enter.
    // setSystemProducts(data.system_products || []);
    // setDcbBaseProducts(data.dcb_products || []);

    // We should NOT restore manual records from the blob anymore, as they are now in the DB.
    // setPvRecords(data.pv_records || []); 

    // We can restore other session state if needed, like sales progress?
    // For now, let's keep it clean as requested "solicitados novamente".

    setConfirmedPVSales(data.confirmed_pv_sales || {});
    setFinalizedREDSByPeriod(data.finalized_reds_by_period || {});
    setSalesPeriod(data.sales_period || '');

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
      if (session.session_data?.sales_period) {
        // If we had an active sales period, go to analysis
        // But maybe they want to land on Setup or Dashboard?
        // Let's default to Setup if they haven't uploaded files, OR Analysis if they have.
        // For now, let's just restore the info. The products useEffect will determine if ready.
      }
    }

  }, [companies]);

  useEffect(() => {
    if (!userEmail) return;

    let isMounted = true;
    setIsLoadingSession(true);

    const localSession = loadLocalPVSession(userEmail);
    if (localSession) {
      applySessionFromData(localSession);
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
          dcb: dcbProd?.dcb || sysProd?.dcb || 'N/A'
        });
      });
      setMasterProducts(merged);
    }
  }, [systemProducts, dcbBaseProducts]);

  const handleRefresh = async () => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) return;

    // 1. Fetch Active Stock
    console.log('🔄 [PV] Forçando atualização da lista...');
    fetchPVBranchRecords(sessionInfo.companyId, sessionInfo.filial)
      .then(dbRecords => {
        if (dbRecords && dbRecords.length > 0) {
          setPvRecords(prev => {
            const existingIds = new Set(prev.map(r => r.id));
            const newRecords = dbRecords
              .filter(rec => !existingIds.has(rec.id || ''))
              .map(rec => ({
                id: rec.id || `db-${rec.reduced_code}-${Date.now()}`,
                reducedCode: rec.reduced_code,
                name: rec.product_name,
                quantity: rec.quantity,
                expiryDate: rec.expiry_date,
                entryDate: rec.entry_date,
                dcb: rec.dcb,
                userEmail: rec.user_email,
                userName: ''
              }));
            // Replace entirely on refresh to ensure sync, or merge? 
            // Better to merge carefully or just set if we trust DB is source of truth.
            // For persistence debugging, let's prioritize DB records + current session additions that might not be there yet?
            // Actually, if we refresh, we want to see what is in DB.
            return [...prev, ...newRecords].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);
          });
          alert('Lista atualizada com sucesso!');
        } else {
          console.log('🔍 [PV DEBUG] Refresh retornou 0 registros.');
          alert('Nenhum registro encontrado no banco de dados para esta filial.');
        }
      })
      .catch(err => {
        console.error('❌ [PV DEBUG] Erro no refresh:', err);
        alert('Erro ao atualizar lista via banco de dados.');
      });
  };

  // Load persistent branch records and history when company/branch is selected
  useEffect(() => {
    if (sessionInfo?.companyId && sessionInfo?.filial) {
      // 1. Fetch Active Stock
      fetchPVBranchRecords(sessionInfo.companyId, sessionInfo.filial)
        .then(dbRecords => {
          if (dbRecords && dbRecords.length > 0) {
            setPvRecords(prev => {
              const existingIds = new Set(prev.map(r => r.id));
              const newRecords = dbRecords
                .filter(rec => !existingIds.has(rec.id || ''))
                .map(rec => ({
                  id: rec.id || `db-${rec.reduced_code}-${Date.now()}`,
                  reducedCode: rec.reduced_code,
                  name: rec.product_name,
                  quantity: rec.quantity,
                  expiryDate: rec.expiry_date,
                  entryDate: rec.entry_date,
                  dcb: rec.dcb,
                  userEmail: rec.user_email,
                  userName: '' // Add logic to get name if possible or just use email
                }));
              return [...prev, ...newRecords];
            });
          } else {
            console.log('🔍 [PV DEBUG] fetchPVBranchRecords retornou 0 registros para', sessionInfo.companyId, sessionInfo.filial);
          }
        })
        .catch(err => console.error('❌ [PV DEBUG] Erro carregando registros da filial:', err));

      // 2. Fetch Sales History (Dashboard Persistence)
      console.log('🔍 [PV DEBUG] Buscando histórico de vendas...');
      fetchPVSalesHistory(sessionInfo.companyId, sessionInfo.filial)
        .then(history => {
          if (history) setHistoryRecords(history);
        })
        .catch(err => console.error('Erro carregando histórico de vendas:', err));
    }
  }, [sessionInfo?.companyId, sessionInfo?.filial]);

  const handleUpdatePVSale = (saleId: string, classification: PVSaleClassification) => {
    setConfirmedPVSales(prev => ({ ...prev, [saleId]: classification }));
  };

  const handleFinalizeSale = async (reducedCode: string, period: string) => {
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
        if (sessionInfo?.companyId && sessionInfo.filial && (item.qtyPV > 0 || item.qtyIgnored > 0 || item.qtyNeutral > 0 || item.qtyIgnoredPV > 0)) {
          // Extract seller and product name using logic from AnalysisView or just parsing key roughly? 
          // We need accurate data. SalesRecord has it.
          // Improved Seller Extraction using metadata if available
          const seller = item.sellerName || parts[1];
          const product = pvRecords.find(r => r.reducedCode === reducedCode);

          historyEntries.push({
            company_id: sessionInfo.companyId,
            branch: sessionInfo.filial,
            user_email: userEmail || '',
            sale_period: period,
            seller_name: seller,
            reduced_code: reducedCode,
            product_name: product?.name || 'Produto Finalizado',
            qty_sold_pv: item.qtyPV,
            qty_ignored: item.qtyIgnoredPV,
            qty_neutral: item.qtyNeutral
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
      } else {
        alert("Atenção: Houve um erro ao salvar o histórico de vendas no banco. O dashboard pode não atualizar corretamente.");
      }
    }

    setFinalizedREDSByPeriod(prev => {
      const currentPeriodFinalized = prev[period] || [];
      return {
        ...prev,
        [period]: [...new Set([...currentPeriodFinalized, reducedCode])]
      };
    });
  };

  const handleSalesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        let salesData: { sales: SalesRecord[], period: string };
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith('.csv') || fileName.endsWith('.txt')) {
          const reader = new FileReader();
          reader.onload = (event) => {
            const text = event.target?.result as string;
            const sales = parseSalesCSV(text);
            processAndSetSales(sales, "CSV-Upload-" + new Date().toLocaleDateString());
          };
          reader.readAsText(file);
        } else {
          salesData = await parseSalesXLSX(file);
          processAndSetSales(salesData.sales, salesData.period);
        }
      } catch (error) {
        alert('Erro ao processar arquivo de vendas.');
      }
    }
  };

  const handleClearDashboard = async () => {
    if (!sessionInfo?.companyId || !sessionInfo?.filial) {
      alert('Selecione a filial antes de limpar o dashboard.');
      return;
    }

    const confirmed = confirm(`Tem certeza que deseja limpar o dashboard da filial ${sessionInfo.filial}? Isso apagará todos os dados acumulados desta filial.`);
    if (!confirmed) return;

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
      alert('Dashboard limpo. As contagens foram zeradas para esta filial.');
    } finally {
      setIsClearingDashboard(false);
    }
  };

  const processAndSetSales = (sales: SalesRecord[], period: string) => {
    const enrichedSales = sales.map(s => {
      const product = masterProducts.find(p => p.reducedCode === s.reducedCode);
      return {
        ...s,
        date: period,
        dcb: product ? product.dcb : s.dcb,
        productName: product ? product.name : s.productName
      };
    });
    setSalesRecords(enrichedSales);
    setSalesPeriod(period);
    setCurrentView(AppView.ANALYSIS);
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

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }
    };
  }, []);

  const dashboardMetrics = useMemo(() => {
    const sellerStats: Record<string, { positive: number, neutral: number, negative: number }> = {};
    let totalRecovered = 0;
    let totalIgnored = 0;

    // 1. Add metrics from Persistent History (DB)
    historyRecords.forEach(rec => {
      const seller = rec.seller_name || 'Desconhecido';
      if (!sellerStats[seller]) sellerStats[seller] = { positive: 0, neutral: 0, negative: 0 };

      sellerStats[seller].positive += Number(rec.qty_sold_pv || 0);
      sellerStats[seller].neutral += Number(rec.qty_neutral || 0);
      sellerStats[seller].negative += Number(rec.qty_ignored || 0);

      totalRecovered += Number(rec.qty_sold_pv || 0);
      totalIgnored += Number(rec.qty_ignored || 0);
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

      const isFinalized = Object.keys(finalizedREDSByPeriod).some(periodKey => {
        if (key.startsWith(periodKey)) {
          const list = finalizedREDSByPeriod[periodKey];
          // Check if key contains any of the finalized codes
          return list.some(code => key.includes(`-${code}-`));
        }
        return false;
      });

      if (isFinalized) return; // Already counted in history

      // Use stored seller name if available, fallback to key parsing
      const seller = data.sellerName || parts[1];

      if (!sellerStats[seller]) sellerStats[seller] = { positive: 0, neutral: 0, negative: 0 };

      sellerStats[seller].positive += data.qtyPV;
      sellerStats[seller].neutral += data.qtyNeutral;
      sellerStats[seller].negative += data.qtyIgnoredPV;
      totalRecovered += data.qtyPV;
      totalIgnored += data.qtyIgnoredPV;
    });

    const ranking = Object.entries(sellerStats)
      .map(([name, data]) => ({
        name,
        score: data.positive - data.negative,
        positive: data.positive,
        neutral: data.neutral,
        negative: data.negative
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

    return { ranking, totalRecovered, totalIgnored, efficiency, pvInRegistry, sortedStockByMonth };
  }, [pvRecords, confirmedPVSales, historyRecords, finalizedREDSByPeriod]);

  const logout = () => {
    if (confirm('Encerrar sessão?')) {
      if (userEmail) clearLocalPVSession(userEmail);
      window.location.reload();
    }
  };

  return (
    <div className="flex h-full w-full overflow-hidden text-slate-900">
      <aside className={`w-64 bg-slate-900 text-white flex flex-col shrink-0 transition-all duration-300 ${currentView === AppView.SETUP ? '-ml-64' : ''}`}>
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900">
            <Package size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">PV Manager</h1>
            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Conferência 2.0</span>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          {NAV_ITEMS.map((item) => {
            const targetView = item.id as AppView;
            const disabled = !canSwitchToView(targetView);
            return (
              <button
                key={item.id}
                onClick={() => handleNavItemClick(targetView)}
                disabled={disabled}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${currentView === targetView ? 'bg-blue-600 text-white shadow-lg' : disabled ? 'text-slate-500/70 cursor-not-allowed bg-slate-900/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              >
                {item.icon}
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 space-y-3">
          <button onClick={handleReconfigure} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800 text-slate-400 transition-colors">
            <Settings size={20} />
            <span className="text-sm font-medium">Reconfigurar</span>
          </button>

          <label className="flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-slate-800 text-slate-400 transition-colors group">
            <TrendingUp size={20} className="group-hover:text-green-400" />
            <div className="flex-1">
              <p className="text-sm font-medium leading-none text-blue-400">Vendas (Excel/CSV)</p>
              <p className="text-[10px] mt-1 text-slate-500 font-bold">{salesRecords.length} registros</p>
            </div>
            <input type="file" className="hidden" accept=".xlsx,.xls,.csv,.txt" onChange={handleSalesUpload} />
          </label>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-amber-50 text-amber-600 p-2 rounded-lg"><AlertTriangle size={20} /></div>
            <div>
              <p className="text-sm font-bold text-slate-800 uppercase tracking-tight">SISTEMA DE ALERTA PRÉ-VENCIDOS</p>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{sessionInfo?.company || 'DROGARIA CIDADE'}</p>
            </div>
          </div>
          {sessionInfo && (
            <div className="flex items-center gap-4">
              <div className="text-right mr-4 hidden md:block">
                <p className="text-sm font-bold text-slate-800">{sessionInfo.pharmacist}</p>
                <p className="text-xs text-slate-500">Filial: {sessionInfo.filial}</p>
              </div>
              <button onClick={logout} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors" title="Sair e Limpar Sessão">
                <LogOut size={18} />
              </button>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-slate-50">
          {currentView === AppView.SETUP && (
            <SetupView
              onComplete={(info) => {
                setSessionInfo(info);
                setPvRecords([]);
                setConfirmedPVSales({});
                setFinalizedREDSByPeriod({});
                setSalesPeriod('');
                setHasCompletedSetup(true);
                setCurrentView(AppView.REGISTRATION);
              }}
              onSystemProductsUpload={async (f) => setSystemProducts(await parseSystemProductsXLSX(f))}
              onDCBBaseUpload={async (f) => setDcbBaseProducts(await parseDCBProductsXLSX(f))}
              productsLoaded={masterProducts.length > 0}
              systemLoaded={systemProducts.length > 0}
              dcbLoaded={dcbBaseProducts.length > 0}
              companies={companies}
            />
          )}
          {currentView === AppView.REGISTRATION && (
            <PVRegistration
              masterProducts={masterProducts} pvRecords={pvRecords} sessionInfo={sessionInfo}
              onRefresh={handleRefresh}
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
                      expiry_date: rec.expiryDate,
                      entry_date: rec.entryDate,
                      user_email: userEmail || ''
                    });
                    if (saved && saved.id) {
                      rec.id = saved.id;
                    } else {
                      alert("Aviso: O registro foi adicionado à lista mas NÃO foi confirmado no banco de dados. Ao sair, ele pode ser perdido. Tente novamente.");
                    }
                  } catch (e) {
                    console.error('Erro ao salvar registro de filial:', e);
                    alert("Erro ao salvar no banco de dados. Verifique a conexão.");
                  }
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
                setPvRecords(prev => prev.filter(r => r.id !== id));
                await deletePVBranchRecord(id);
              }}
            />
          )}
          {currentView === AppView.ANALYSIS && (
            <div className="space-y-4">
              {salesPeriod && (
                <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-lg flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar size={20} />
                    <span className="text-sm font-black uppercase tracking-widest">Período de Vendas Reconhecido: {salesPeriod}</span>
                  </div>
                  <span className="text-[10px] font-bold bg-white/20 px-3 py-1 rounded-full uppercase">Excel Linha 5 / Coluna I</span>
                </div>
              )}
              <AnalysisView
                pvRecords={pvRecords} salesRecords={salesRecords} confirmedPVSales={confirmedPVSales}
                finalizedREDSByPeriod={finalizedREDSByPeriod}
                currentSalesPeriod={salesPeriod}
                onUpdatePVSale={handleUpdatePVSale} onFinalizeSale={handleFinalizeSale}
              />
            </div>
          )}
          {currentView === AppView.DASHBOARD && (
            <>
              <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recuperado PV (Filial)</p>
                    <p className="text-4xl font-black text-green-600 mt-2">{dashboardMetrics.totalRecovered}</p>
                    <p className="text-[9px] font-bold text-green-500 mt-2 uppercase flex items-center gap-1"><CheckCircle size={10} /> Positivo</p>
                  </div>
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ignorou PV (Filial)</p>
                    <p className="text-4xl font-black text-red-500 mt-2">{dashboardMetrics.totalIgnored}</p>
                    <p className="text-[9px] font-bold text-red-400 mt-2 uppercase flex items-center gap-1"><MinusCircle size={10} /> Negativo</p>
                  </div>
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
                        <div key={s.name} className="flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100 hover:shadow-md transition-all">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${i === 0 ? 'bg-amber-100 text-amber-600 shadow-sm' : 'bg-white text-slate-300 border'}`}>
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
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {sessionInfo?.filial && (
                <button
                  onClick={handleClearDashboard}
                  disabled={isClearingDashboard}
                  className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-2xl border border-rose-200 bg-white/90 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-rose-600 shadow-lg shadow-rose-200 transition hover:bg-rose-50 active:scale-95 disabled:cursor-wait disabled:opacity-60"
                  title="Limpar os dados acumulados deste dashboard"
                >
                  <Trash2 size={16} />
                  <span>Limpar dashboard</span>
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default PreVencidosManager;
