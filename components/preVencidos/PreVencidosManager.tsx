
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
import { Package, AlertTriangle, LogOut, Settings, Trophy, TrendingUp, MinusCircle, CheckCircle, ArrowRightLeft, Calendar, Info, X } from 'lucide-react';
import { DbCompany, DbPVSession, fetchPVSession, upsertPVSession } from '../../supabaseService';
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
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canSwitchToView = (view: AppView) => view === AppView.SETUP || hasCompletedSetup;
  const handleNavItemClick = (view: AppView) => {
    if (!canSwitchToView(view)) return;
    setCurrentView(view);
  };
  const handleReconfigure = () => {
    setHasCompletedSetup(false);
    setCurrentView(AppView.SETUP);
  };

  const applySessionFromData = useCallback((session: DbPVSession) => {
    const data = session.session_data || {};
    setPvSessionId(session.id || null);
    setSystemProducts(data.system_products || []);
    setDcbBaseProducts(data.dcb_products || []);
    setMasterProducts(data.master_products || []);
    setPvRecords(data.pv_records || []);
    setConfirmedPVSales(data.confirmed_pv_sales || {});
    setFinalizedREDSByPeriod(data.finalized_reds_by_period || {});
    setSalesPeriod(data.sales_period || '');

    const matchedCompany = companies.find(c => c.id === session.company_id);
    setSessionInfo({
      company: matchedCompany?.name || '',
      companyId: session.company_id || undefined,
      filial: session.branch || '',
      area: session.area || '',
      pharmacist: session.pharmacist || '',
      manager: session.manager || ''
    });
    setHasCompletedSetup(true);
    setCurrentView(AppView.REGISTRATION);
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

  const handleUpdatePVSale = (saleId: string, classification: PVSaleClassification) => {
    setConfirmedPVSales(prev => ({ ...prev, [saleId]: classification }));
  };

  const handleFinalizeSale = (reducedCode: string, period: string) => {
    let totalPVUnitsToDeduct = 0;
    Object.keys(confirmedPVSales).forEach(key => {
      // O ID da venda agora contém o período: `${period}-${seller}-${reducedCode}...`
      if (key.startsWith(`${period}-`) && key.includes(`-${reducedCode}-`)) {
        const item = confirmedPVSales[key];
        if (item.confirmed) totalPVUnitsToDeduct += item.qtyPV;
      }
    });

    if (totalPVUnitsToDeduct > 0) {
      setPvRecords(prev => {
        const updated = [...prev];
        const index = updated.findIndex(r => r.reducedCode === reducedCode);
        if (index !== -1) {
          const newQty = Math.max(0, updated[index].quantity - totalPVUnitsToDeduct);
          if (newQty <= 0) updated.splice(index, 1);
          else updated[index] = { ...updated[index], quantity: newQty };
        }
        return updated;
      });
      alert(`Sucesso! ${totalPVUnitsToDeduct} unidades baixadas do estoque PV.`);
    } else {
      alert("Lançamento finalizado apenas como registro histórico.");
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
        let salesData: {sales: SalesRecord[], period: string};
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
        master_products: masterProducts,
        system_products: systemProducts,
        dcb_products: dcbBaseProducts,
        pv_records: pvRecords,
        confirmed_pv_sales: confirmedPVSales,
        finalized_reds_by_period: finalizedREDSByPeriod,
        sales_period: salesPeriod
      },
      updated_at: new Date().toISOString()
    };
    saveLocalPVSession(userEmail, payload);
    setIsSavingSession(true);
    try {
      const saved = await upsertPVSession(payload);
      if (saved) setPvSessionId(saved.id || null);
    } catch (error) {
      console.error('Erro salvando sessão PV no Supabase:', error);
    } finally {
      setIsSavingSession(false);
    }
  }, [userEmail, pvSessionId, sessionInfo, masterProducts, systemProducts, dcbBaseProducts, pvRecords, confirmedPVSales, finalizedREDSByPeriod, salesPeriod]);

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

    // Métricas agregadas de TODOS os períodos salvos para esta filial
    Object.keys(confirmedPVSales).forEach(key => {
      const data = confirmedPVSales[key];
      // Key format: `${period}-${seller}-${reducedCode}-${quantity}-${idx}`
      const parts = key.split('-');
      const seller = parts[1]; 
      
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
  }, [pvRecords, confirmedPVSales]);

  const logout = () => {
    if(confirm('Encerrar sessão?')) {
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
              <button onClick={logout} className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors">
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
              onAddPV={(rec) => setPvRecords(prev => [rec, ...prev])}
              onRemovePV={(id) => setPvRecords(prev => prev.filter(r => r.id !== id))}
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
             <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recuperado PV (Filial)</p>
                    <p className="text-4xl font-black text-green-600 mt-2">{dashboardMetrics.totalRecovered}</p>
                    <p className="text-[9px] font-bold text-green-500 mt-2 uppercase flex items-center gap-1"><CheckCircle size={10}/> Positivo</p>
                  </div>
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ignorou PV (Filial)</p>
                    <p className="text-4xl font-black text-red-500 mt-2">{dashboardMetrics.totalIgnored}</p>
                    <p className="text-[9px] font-bold text-red-400 mt-2 uppercase flex items-center gap-1"><MinusCircle size={10}/> Negativo</p>
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
          )}
        </div>
      </main>
    </div>
  );
};

export default PreVencidosManager;
