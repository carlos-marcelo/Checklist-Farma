
import React, { useState, useMemo } from 'react';
import { PVRecord, SalesRecord, PVSaleClassification } from '../../preVencidos/types';
import { FileSearch, Users, ShoppingCart, TrendingUp, AlertCircle, CheckCircle, FlaskConical, Repeat, Search, Package, Trophy, CheckSquare, XCircle, Save, MinusCircle, HelpCircle, Lock } from 'lucide-react';

const MONTH_NAMES_PT_BR = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const getExpiryMonthLabel = (expiryDate?: string) => {
  if (!expiryDate) return 'MÊS NÃO INFORMADO';

  const [monthPart, yearPart] = expiryDate.split('/');
  if (!monthPart || !yearPart) return 'MÊS NÃO INFORMADO';

  const monthIndex = Number(monthPart);
  if (Number.isNaN(monthIndex) || monthIndex < 1 || monthIndex > 12) return 'MÊS NÃO INFORMADO';

  const normalizedYear = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  const monthLabel = MONTH_NAMES_PT_BR[monthIndex - 1];

  return `${monthLabel}/${normalizedYear}`;
};

interface AnalysisViewProps {
  pvRecords: PVRecord[];
  salesRecords: SalesRecord[];
  confirmedPVSales: Record<string, PVSaleClassification>;
  finalizedREDSByPeriod: Record<string, string[]>;
  currentSalesPeriod: string;
  onUpdatePVSale: (saleId: string, classification: PVSaleClassification) => void;
  onFinalizeSale: (reducedCode: string, period: string) => void;
}

const AnalysisView: React.FC<AnalysisViewProps> = ({
  pvRecords,
  salesRecords,
  confirmedPVSales,
  finalizedREDSByPeriod,
  currentSalesPeriod,
  onUpdatePVSale,
  onFinalizeSale
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [expanded, setExpanded] = useState<{ id: string, type: 'sku' | 'similar' } | null>(null);
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'finalized' | 'similar'>('all');

  const handleFilterClick = (filter: 'pending' | 'finalized' | 'similar') => {
    setActiveFilter(prev => (prev === filter ? 'all' : filter));
  };

  const results = useMemo(() => {
    const periodFinalizedList = finalizedREDSByPeriod[currentSalesPeriod] || [];

    const enriched = pvRecords.map(pv => {
      const isFinalized = periodFinalizedList.includes(pv.reducedCode);
      const directSales = salesRecords.filter(s => s.reducedCode === pv.reducedCode);
      const directSoldQty = directSales.reduce((acc, s) => acc + s.quantity, 0);

      const directSalesDetails = directSales.map((s, idx) => ({
        name: s.productName,
        totalSoldInReport: s.quantity,
        seller: s.salesperson,
        code: s.reducedCode,
        id: `${currentSalesPeriod}-${s.salesperson}-${s.reducedCode}-${s.quantity}-${idx}`
      }));

      const isValidDCB = (dcb?: string) => dcb && dcb.trim() !== '' && dcb.toUpperCase() !== 'N/A';
      const similarSales = isValidDCB(pv.dcb)
        ? salesRecords.filter(s => s.dcb === pv.dcb && s.reducedCode !== pv.reducedCode)
        : [];
      const similarSoldQty = similarSales.reduce((acc, s) => acc + s.quantity, 0);

      const similarSalesDetails = similarSales.map((s, idx) => ({
        name: s.productName,
        qty: s.quantity,
        seller: s.salesperson,
        code: s.reducedCode,
        id: `${currentSalesPeriod}-sim-${s.salesperson}-${s.reducedCode}-${s.quantity}-${idx}`
      }));

      let status: 'sold' | 'replaced' | 'lost' = 'lost';
      if (directSoldQty > 0) status = 'sold';
      else if (similarSoldQty > 0) status = 'replaced';

      return {
        ...pv,
        directSoldQty,
        directSalesDetails,
        similarSoldQty,
        similarSalesDetails,
        status,
        isFinalized,
        expiryMonthLabel: getExpiryMonthLabel(pv.expiryDate)
      };
    });
    // Hide "Sem Movimento" items from the analysis list.
    return enriched.filter(item => item.status !== 'lost');
  }, [pvRecords, salesRecords, finalizedREDSByPeriod, currentSalesPeriod]);

  const toggleExpand = (id: string, type: 'sku' | 'similar') => {
    if (expanded?.id === id && expanded?.type === type) setExpanded(null);
    else setExpanded({ id, type });
  };

  const filteredResults = results.filter(r => {
    const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.reducedCode.includes(searchTerm);
    if (!matchesSearch) return false;
    if (activeFilter === 'all') return true;
    if (activeFilter === 'finalized') return r.isFinalized;
    if (activeFilter === 'similar') return !r.isFinalized && r.status === 'replaced';
    return !r.isFinalized && r.status === 'sold';
  });

  const handleClassificationChange = (saleId: string, field: keyof PVSaleClassification, val: number, maxSale: number, reducedCode: string, sellerName: string) => {
    const periodFinalizedList = finalizedREDSByPeriod[currentSalesPeriod] || [];
    if (periodFinalizedList.includes(reducedCode)) return;

    const current = confirmedPVSales[saleId] || { confirmed: false, qtyPV: 0, qtyNeutral: 0, qtyIgnoredPV: 0 };
    const nextVal = Math.max(0, val);

    const pvStock = pvRecords.find(r => r.reducedCode === reducedCode)?.quantity || 0;

    // Outros vendedores no MESMO período
    const otherSellersPVInPeriod = Object.keys(confirmedPVSales)
      .filter(k => k !== saleId && k.startsWith(`${currentSalesPeriod}-`) && k.includes(`-${reducedCode}-`))
      .reduce((acc, k) => acc + confirmedPVSales[k].qtyPV + confirmedPVSales[k].qtyIgnoredPV, 0);

    const availablePVForThisSeller = Math.max(0, pvStock - otherSellersPVInPeriod);

    let updated = { ...current, [field]: nextVal };

    if (field === 'qtyPV' || field === 'qtyIgnoredPV') {
      const sellerPVRequest = updated.qtyPV + updated.qtyIgnoredPV;
      if (sellerPVRequest > Math.min(maxSale, availablePVForThisSeller)) {
        alert(`O total de PV (Vendido + Ignorado) não pode exceder ${Math.min(maxSale, availablePVForThisSeller)} un para este vendedor no período atual.`);
        return;
      }
      updated.qtyNeutral = maxSale - sellerPVRequest;
    } else if (field === 'qtyNeutral') {
      if (updated.qtyPV + updated.qtyIgnoredPV + nextVal > maxSale) {
        updated.qtyIgnoredPV = Math.max(0, maxSale - nextVal - updated.qtyPV);
      }
    }

    const isCategorized = (updated.qtyPV + updated.qtyNeutral + updated.qtyIgnoredPV) > 0;
    // Include metadata in the stored record to avoid fragile parsing later
    onUpdatePVSale(saleId, {
      ...updated,
      confirmed: isCategorized,
      sellerName: sellerName,
      reducedCode: reducedCode
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 uppercase text-[10px] tracking-widest">
              <FileSearch size={18} className="text-blue-500" /> Análise de Vendas
            </h3>
            <div className="h-4 w-[1px] bg-slate-200"></div>
            <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-tighter">
              <button
                type="button"
                onClick={() => handleFilterClick('pending')}
                aria-pressed={activeFilter === 'pending'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full border transition ${activeFilter === 'pending' ? 'text-slate-700 border-slate-300 bg-white shadow-sm' : 'text-slate-300 border-slate-100 bg-slate-50 opacity-70'}`}
              >
                <div className="w-2 h-2 rounded-full bg-blue-500"></div> Falta Lançar no Período
              </button>
              <button
                type="button"
                onClick={() => handleFilterClick('finalized')}
                aria-pressed={activeFilter === 'finalized'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full border transition ${activeFilter === 'finalized' ? 'text-slate-700 border-slate-300 bg-white shadow-sm' : 'text-slate-300 border-slate-100 bg-slate-50 opacity-70'}`}
              >
                <div className="w-2 h-2 rounded-full bg-green-500"></div> Lançamento Finalizado
              </button>
              <button
                type="button"
                onClick={() => handleFilterClick('similar')}
                aria-pressed={activeFilter === 'similar'}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-full border transition ${activeFilter === 'similar' ? 'text-slate-700 border-slate-300 bg-white shadow-sm' : 'text-slate-300 border-slate-100 bg-slate-50 opacity-70'}`}
              >
                <div className="w-2 h-2 rounded-full bg-amber-500"></div> Similar Vendido
              </button>
            </div>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text" placeholder="Buscar item..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[800px] overflow-y-auto custom-scrollbar">
          {filteredResults.map(res => (
            <div
              key={res.id}
              className={`p-5 rounded-2xl border transition-all ${res.isFinalized ? 'border-green-100 bg-green-50/20' : 'border-slate-100 bg-white hover:shadow-sm'}`}
            >
              <div className="flex flex-col md:flex-row justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {res.isFinalized ? (
                      <span className="text-[8px] font-black px-2 py-0.5 rounded uppercase tracking-tighter bg-green-600 text-white flex items-center gap-1">
                        <CheckCircle size={10} /> FINALIZADO EM {currentSalesPeriod}
                      </span>
                    ) : (
                      <span className={`text-[8px] font-black px-2 py-0.5 rounded uppercase ${res.status === 'sold' ? 'bg-blue-600 text-white animate-pulse' : res.status === 'replaced' ? 'bg-amber-500 text-white' : 'bg-slate-400 text-white'}`}>
                        {res.status === 'sold' ? 'Pendência SKU' : res.status === 'replaced' ? 'Similar Vendido' : 'Sem Movimento'}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-slate-400 font-bold">RED: {res.reducedCode}</span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 uppercase">{res.name}</h4>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 flex items-center gap-1">
                      <FlaskConical size={12} /> {res.dcb}
                    </div>
                    <div className="space-y-1">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PV EM ESTOQUE: {res.quantity}</div>
                      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">VENCIMENTO: {res.expiryMonthLabel}</div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 h-fit">
                  <button onClick={() => toggleExpand(res.id, 'sku')} className={`p-3 rounded-xl border text-center min-w-[85px] transition-all ${res.directSoldQty > 0 ? (expanded?.id === res.id && expanded?.type === 'sku' ? 'bg-blue-600 text-white shadow-lg' : 'bg-white border-blue-100 text-blue-600 hover:bg-blue-50') : 'opacity-20'}`}>
                    <p className="text-[8px] font-bold uppercase leading-none mb-1">Saída SKU</p>
                    <p className="text-xl font-black">{res.directSoldQty}</p>
                  </button>
                  <button onClick={() => toggleExpand(res.id, 'similar')} className={`p-3 rounded-xl border text-center min-w-[85px] transition-all ${res.similarSoldQty > 0 ? (expanded?.id === res.id && expanded?.type === 'similar' ? 'bg-amber-600 text-white shadow-lg' : 'bg-white border-amber-100 text-amber-600 hover:bg-amber-50') : 'opacity-20'}`}>
                    <p className="text-[8px] font-bold uppercase leading-none mb-1">Similar</p>
                    <p className="text-xl font-black">{res.similarSoldQty}</p>
                  </button>
                </div>
              </div>

              {expanded?.id === res.id && (
                <div className="mt-4 pt-4 border-t border-slate-100 animate-in slide-in-from-top-2">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                      {expanded.type === 'sku' ? <Package size={14} /> : <Repeat size={14} />} {res.isFinalized ? 'Lançamentos Confirmados' : 'Distribuição por Vendedor'}
                    </p>
                    <button onClick={() => setExpanded(null)} className="text-[10px] font-bold text-slate-300 uppercase hover:text-red-500">Fechar Detalhes</button>
                  </div>

                  <div className="space-y-3">
                    {(expanded.type === 'sku' ? res.directSalesDetails : res.similarSalesDetails).map((sale) => {
                      const data = confirmedPVSales[sale.id] || { confirmed: false, qtyPV: 0, qtyNeutral: 0, qtyIgnoredPV: 0 };
                      const max = (sale as any).totalSoldInReport || (sale as any).qty;

                      return (
                        <div key={sale.id} className={`p-4 rounded-2xl border flex flex-col md:flex-row justify-between items-center gap-4 ${res.isFinalized ? 'border-green-100 bg-white/50' : 'border-slate-50 bg-slate-50/50'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-800 uppercase truncate">{sale.name}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] text-blue-600 font-bold uppercase tracking-tight">Vendedor: {sale.seller}</span>
                              <span className="text-[10px] text-slate-400 font-mono font-bold">RED: {sale.code}</span>
                            </div>
                            <p className="text-[10px] font-black text-slate-800 mt-1 uppercase">TOTAL VENDIDO NESTA NOTA: {max}</p>
                          </div>

                          {expanded.type === 'sku' ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
                                {res.isFinalized && (
                                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                                    <Lock size={16} className="text-green-600" />
                                  </div>
                                )}
                                <div className="flex flex-col items-center">
                                  <span className="text-[7px] font-black text-green-600 uppercase mb-1">Vendeu PV (+)</span>
                                  <input
                                    type="number" min="0" max={max}
                                    value={data.qtyPV || ''}
                                    disabled={res.isFinalized}
                                    onChange={(e) => handleClassificationChange(sale.id, 'qtyPV', Number(e.target.value), max, res.reducedCode, sale.seller)}
                                    className="w-12 h-9 text-center text-xs font-black bg-green-50 text-green-700 rounded-lg outline-none border border-green-100 focus:ring-1 focus:ring-green-400"
                                  />
                                </div>
                                <div className="flex flex-col items-center">
                                  <span className="text-[7px] font-black text-red-600 uppercase mb-1">Ignorou PV (-)</span>
                                  <input
                                    type="number" min="0" max={max}
                                    value={data.qtyIgnoredPV || ''}
                                    disabled={res.isFinalized}
                                    onChange={(e) => handleClassificationChange(sale.id, 'qtyIgnoredPV', Number(e.target.value), max, res.reducedCode, sale.seller)}
                                    className="w-12 h-9 text-center text-xs font-black bg-red-50 text-red-700 rounded-lg outline-none border border-red-100 focus:ring-1 focus:ring-red-400"
                                  />
                                </div>
                                <div className="flex flex-col items-center">
                                  <span className="text-[7px] font-black text-slate-400 uppercase mb-1">Não era PV (/)</span>
                                  <input
                                    type="number" min="0" max={max}
                                    value={data.qtyNeutral || ''}
                                    disabled={res.isFinalized}
                                    onChange={(e) => handleClassificationChange(sale.id, 'qtyNeutral', Number(e.target.value), max, res.reducedCode, sale.seller)}
                                    className="w-12 h-9 text-center text-xs font-black bg-slate-100 text-slate-600 rounded-lg outline-none border border-slate-200 focus:ring-1 focus:ring-slate-400"
                                  />
                                </div>
                                <div className="h-10 w-[1px] bg-slate-100 mx-1"></div>
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${data.qtyPV + data.qtyNeutral + data.qtyIgnoredPV === max ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-50 text-slate-300 border border-slate-100'}`}>
                                  <CheckSquare size={20} />
                                </div>
                              </div>
                              <p className="text-[7px] font-black text-slate-400 uppercase text-center bg-slate-50 py-1 rounded-lg border border-slate-100">
                                PV Disponível p/ este Vendedor: {Math.max(0, res.quantity - (Object.keys(confirmedPVSales).filter(k => k !== sale.id && k.startsWith(`${currentSalesPeriod}-`) && k.includes(`-${res.reducedCode}-`)).reduce((acc, k) => acc + confirmedPVSales[k].qtyPV + confirmedPVSales[k].qtyIgnoredPV, 0)))} un
                              </p>
                            </div>
                          ) : (
                            <div className="flex items-center gap-3 px-4 py-2 bg-amber-50 rounded-xl border border-amber-100 text-amber-600 text-[10px] font-bold uppercase">
                              <Repeat size={16} /> Venda de Similar (Código RED: {sale.code})
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {expanded.type === 'sku' && !res.isFinalized && (
                    <div className="mt-8 flex justify-end">
                      <button
                        onClick={() => { onFinalizeSale(res.reducedCode, currentSalesPeriod); setExpanded(null); }}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase text-xs px-8 py-4 rounded-2xl shadow-xl shadow-blue-200 transition-all active:scale-95"
                      >
                        <Save size={18} /> SALVAR LANÇAMENTOS DO PERÍODO
                      </button>
                    </div>
                  )}

                  {res.isFinalized && (
                    <div className="mt-6 flex justify-center">
                      <div className="flex items-center gap-2 px-6 py-3 bg-green-100 text-green-700 rounded-xl border border-green-200 text-xs font-black uppercase tracking-widest">
                        <Lock size={14} /> Finalizado para o Período {currentSalesPeriod}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AnalysisView;
