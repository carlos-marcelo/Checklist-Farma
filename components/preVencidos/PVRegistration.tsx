
import React, { useState, useRef, useEffect } from 'react';
import { Product, PVRecord, SessionInfo } from '../../preVencidos/types';
import ScannerInput from './ScannerInput';
import { Trash2, Calendar, Hash, FileUp, CheckCircle2, User, Building, Search, FlaskConical, ChevronRight, Info, X } from 'lucide-react';

interface PVRegistrationProps {
  masterProducts: Product[];
  pvRecords: PVRecord[];
  sessionInfo: SessionInfo | null;
  originBranches?: string[];
  onUpdatePV?: (id: string, updates: Partial<PVRecord>) => void;
  onAddPV: (record: PVRecord) => void;
  onRemovePV: (id: string) => void;
  onRefresh?: () => void;
}

const PVRegistration: React.FC<PVRegistrationProps> = ({
  masterProducts,
  pvRecords,
  sessionInfo,
  originBranches = [],
  onUpdatePV,
  onAddPV,
  onRemovePV,
  onRefresh
}) => {
  const [scanningProduct, setScanningProduct] = useState<Product | null>(null);
  const [searchMethod, setSearchMethod] = useState<'C' | 'K' | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [originBranch, setOriginBranch] = useState<string>('');
  const [sectorResponsible, setSectorResponsible] = useState<string>('');
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, { quantity?: string; sectorResponsible?: string }>>({});
  const updateTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const qtyInputRef = useRef<HTMLInputElement>(null);
  const originInputRef = useRef<HTMLSelectElement>(null);
  const sectorInputRef = useRef<HTMLInputElement>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scanningProduct) {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }
  }, [scanningProduct]);

  useEffect(() => {
    return () => {
      Object.values(updateTimers.current).forEach(timer => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    setDrafts(prev => {
      const ids = new Set(pvRecords.map(r => r.id));
      const next: Record<string, { quantity?: string; sectorResponsible?: string }> = {};
      Object.entries(prev).forEach(([id, data]) => {
        if (ids.has(id)) next[id] = data;
      });
      return next;
    });
  }, [pvRecords]);

  useEffect(() => {
    if (!scanningProduct || originBranch) return;
    if (sessionInfo?.filial) {
      setOriginBranch(sessionInfo.filial);
    } else if (originBranches.length > 0) {
      setOriginBranch(originBranches[0]);
    }
  }, [scanningProduct, originBranch, sessionInfo?.filial, originBranches]);

  const handleScan = (code: string) => {
    const foundByBarcode = masterProducts.find(p => p.barcode === code);
    const foundByReduced = masterProducts.find(p => p.reducedCode === code);

    const found = foundByBarcode || foundByReduced;

    if (found) {
      setScanningProduct(found);
      setSearchMethod(foundByBarcode ? 'K' : 'C');
      setQuantity(1);
    } else {
      alert(`Código "${code}" não localizado. Verifique se o relatório DCB de produtos foi carregado corretamente.`);
    }
  };

  const handleExpiryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 4) val = val.substring(0, 4);
    if (val.length > 2) {
      val = val.substring(0, 2) + '/' + val.substring(2);
    }
    setExpiryDate(val);
  };

  const handleConfirm = () => {
    if (scanningProduct && quantity > 0 && expiryDate.length === 5 && originBranch && sectorResponsible.trim()) {
      const [m, a] = expiryDate.split('/');
      const month = parseInt(m);
      if (month < 1 || month > 12) {
        alert('Mês inválido (01-12)');
        return;
      }

      onAddPV({
        id: Math.random().toString(36).substr(2, 9),
        reducedCode: scanningProduct.reducedCode,
        name: scanningProduct.name,
        quantity,
        originBranch,
        sectorResponsible: sectorResponsible.trim(),
        expiryDate,
        entryDate: new Date().toISOString(),
        dcb: scanningProduct.dcb
      });
      setScanningProduct(null);
      setSearchMethod(null);
      setExpiryDate('');
      setQuantity(1);
      setSectorResponsible('');
    } else if (scanningProduct) {
      alert('Preencha a quantidade, origem, responsável e vencimento (MM/AA).');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  };

  const similarProducts = scanningProduct
    ? masterProducts.filter(p => p.dcb === scanningProduct.dcb && p.reducedCode !== scanningProduct.reducedCode).slice(0, 10)
    : [];

  const originOptions = Array.from(new Set(
    (originBranches.length > 0 ? originBranches : (sessionInfo?.filial ? [sessionInfo.filial] : []))
      .filter(Boolean)
  ));

  const setDraftField = (id: string, field: 'quantity' | 'sectorResponsible', value: string) => {
    setDrafts(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }));
  };

  const clearDraftField = (id: string, field: 'quantity' | 'sectorResponsible') => {
    setDrafts(prev => {
      const current = { ...(prev[id] || {}) };
      delete current[field];
      if (Object.keys(current).length === 0) {
        const { [id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [id]: current };
    });
  };

  const clearUpdateTimer = (key: string) => {
    const timer = updateTimers.current[key];
    if (timer) {
      clearTimeout(timer);
      delete updateTimers.current[key];
    }
  };

  const scheduleUpdate = (key: string, fn: () => void) => {
    clearUpdateTimer(key);
    updateTimers.current[key] = setTimeout(() => {
      fn();
      clearUpdateTimer(key);
    }, 400);
  };

  const commitQuantity = (id: string, raw: string, currentValue: number) => {
    if (!onUpdatePV) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      clearDraftField(id, 'quantity');
      return;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      clearDraftField(id, 'quantity');
      return;
    }
    if (parsed === currentValue) {
      clearDraftField(id, 'quantity');
      return;
    }
    onUpdatePV(id, { quantity: parsed });
    clearDraftField(id, 'quantity');
  };

  const commitSector = (id: string, raw: string, currentValue?: string) => {
    if (!onUpdatePV) return;
    const next = raw.trim();
    if ((currentValue || '') === next) {
      clearDraftField(id, 'sectorResponsible');
      return;
    }
    onUpdatePV(id, { sectorResponsible: next });
    clearDraftField(id, 'sectorResponsible');
  };

  const [filterText, setFilterText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // PDF Export
  const handleExportPDF = () => {
    const jsPDF = (window as any).jspdf?.jsPDF;
    if (!jsPDF) {
      alert('Biblioteca de PDF não carregada.');
      return;
    }

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Relatório de Pré-Vencidos', 14, 20);
    doc.setFontSize(10);
    doc.text(`Filial: ${sessionInfo?.filial || 'N/A'} - Gerado em: ${new Date().toLocaleString()}`, 14, 28);

    // Legend in PDF
    doc.setFontSize(8);
    doc.setTextColor(200, 0, 0);
    doc.text('Legenda: Vermelho = Vencido, Vinho = < 30 dias', 14, 35);
    doc.setTextColor(0, 0, 0);

    const tableColumn = ['Reduzido', 'Descrição', 'Origem', 'Resp. Setor', 'Qtd', 'Vencimento', 'Status', 'Dias', 'Resp.', 'Cadastro'];
    const tableRows: any[] = [];

    filteredRecords.forEach(rec => {
      const status = getExpiryStatus(rec.expiryDate);
      tableRows.push([
        rec.reducedCode,
        rec.name,
        rec.originBranch || '-',
        rec.sectorResponsible || '-',
        rec.quantity,
        rec.expiryDate,
        status.label,
        status.days + ' dias',
        rec.userName || rec.userEmail || '-',
        new Date(rec.entryDate).toLocaleString('pt-BR')
      ]);
    });

    (doc as any).autoTable({
      startY: 40,
      head: [tableColumn],
      body: tableRows,
      theme: 'grid',
      styles: { fontSize: 8 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 6) {
          const statusLabel = data.cell.raw;
          if (statusLabel === 'VENCIDO') data.cell.styles.textColor = [220, 38, 38]; // Red
          if (statusLabel === 'CRÍTICO') data.cell.styles.textColor = [159, 18, 57]; // Rose/Wine
          if (statusLabel === 'NO PRAZO') data.cell.styles.textColor = [37, 99, 235]; // Blue
        }
      }
    });

    doc.save(`pre_vencidos_${sessionInfo?.filial || 'geral'}_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const getExpiryStatus = (expiry: string) => {
    if (!expiry || expiry.length !== 5) return { label: '-', color: 'slate', days: 0, bg: 'bg-slate-50' };

    const [m, y] = expiry.split('/').map(Number);
    // Vencimento no último dia do mês
    const expiryDateObj = new Date(2000 + y, m, 0);
    expiryDateObj.setHours(23, 59, 59, 999);

    const now = new Date();
    const diffTime = expiryDateObj.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'VENCIDO', color: 'text-red-600', days: diffDays, bg: 'bg-red-50 border-red-100' };
    if (diffDays <= 30) return { label: 'CRÍTICO', color: 'text-rose-800', days: diffDays, bg: 'bg-rose-50 border-rose-100' };
    return { label: 'NO PRAZO', color: 'text-blue-600', days: diffDays, bg: 'bg-blue-50 border-blue-100' };
  };

  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: keyof PVRecord, direction: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: keyof PVRecord) => {
    if (sortConfig && sortConfig.key === key) {
      if (sortConfig.direction === 'asc') {
        setSortConfig({ key, direction: 'desc' });
      } else {
        setSortConfig(null);
      }
    } else {
      setSortConfig({ key, direction: 'asc' });
    }
  };

  const getSortIcon = (key: keyof PVRecord) => {
    if (!sortConfig || sortConfig.key !== key) return <div className="w-3 h-3 ml-1 text-slate-300"><ChevronRight className="rotate-90" size={12} /></div>;
    return sortConfig.direction === 'asc'
      ? <div className="w-3 h-3 ml-1 text-amber-500 ring-2 ring-amber-100 rounded-full"><ChevronRight className="-rotate-90" size={12} /></div>
      : <div className="w-3 h-3 ml-1 text-amber-500 ring-2 ring-amber-100 rounded-full"><ChevronRight className="rotate-90" size={12} /></div>;
  };

  const filteredRecords = pvRecords.filter(rec => {
    const search = filterText.toLowerCase();
    const matchText = rec.name.toLowerCase().includes(search)
      || rec.reducedCode.includes(search)
      || rec.dcb.toLowerCase().includes(search)
      || (rec.originBranch || '').toLowerCase().includes(search)
      || (rec.sectorResponsible || '').toLowerCase().includes(search);
    const matchMonth = filterMonth ? rec.expiryDate.includes(filterMonth) : true;

    let matchStatus = true;
    if (filterStatus) {
      const status = getExpiryStatus(rec.expiryDate);
      matchStatus = status.label === filterStatus;
    }

    return matchText && matchMonth && matchStatus;
  });

  // Apply Sorting
  if (sortConfig) {
    filteredRecords.sort((a, b) => {
      if (sortConfig.key === 'expiryDate') {
        const [m1, y1] = a.expiryDate.split('/').map(Number);
        const [m2, y2] = b.expiryDate.split('/').map(Number);
        // Convert to comparable value (Year * 12 + Month)
        const v1 = (y1 * 12) + m1;
        const v2 = (y2 * 12) + m2;
        return sortConfig.direction === 'asc' ? v1 - v2 : v2 - v1;
      }

      const v1 = a[sortConfig.key];
      const v2 = b[sortConfig.key];

      if (typeof v1 === 'number' && typeof v2 === 'number') {
        return sortConfig.direction === 'asc' ? v1 - v2 : v2 - v1;
      }

      const s1 = String(v1 ?? '');
      const s2 = String(v2 ?? '');
      return sortConfig.direction === 'asc'
        ? s1.localeCompare(s2)
        : s2.localeCompare(s1);
      return 0;
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Lançamento de Pré-Vencidos</h2>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
              <Building size={14} className="text-blue-500" />
              <span className="font-semibold uppercase">{sessionInfo?.company || 'Não Informado'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
              <User size={14} className="text-blue-500" />
              <span className="font-semibold uppercase">{sessionInfo?.pharmacist || 'Não Informado'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-48 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200 shadow-inner">
            <div
              className="h-full bg-blue-500 transition-all duration-500 shadow-lg shadow-blue-200"
              style={{ width: `${Math.min((pvRecords.length / 50) * 100, 100)}%` }}
            ></div>
          </div>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            LANÇADOS: {pvRecords.length}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-10 rounded-3xl shadow-md border border-slate-100 min-h-[350px] flex flex-col justify-center transition-all">
            {!scanningProduct ? (
              <ScannerInput onScan={handleScan} />
            ) : (
              <div className="animate-in zoom-in-95 fade-in duration-300">
                <div className="flex justify-between items-start mb-6 bg-slate-50 p-6 rounded-2xl border border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-tighter ${searchMethod === 'K' ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>
                        {searchMethod === 'K' ? 'BIPADO (K)' : 'DIGITADO (C)'}
                      </span>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Produto Identificado</span>
                    </div>
                    <h3 className="text-3xl font-bold text-slate-900 leading-tight">{scanningProduct.name}</h3>
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className="bg-white border border-slate-200 px-3 py-1 rounded-lg text-sm font-bold text-slate-600">Red: {scanningProduct.reducedCode}</span>
                      <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg text-sm font-bold border border-blue-100 flex items-center gap-1.5 min-w-0 max-w-full">
                        <FlaskConical size={14} className="shrink-0" /> <span className="truncate">DCB: {scanningProduct.dcb}</span>
                      </span>
                    </div>
                  </div>
                  <button onClick={() => setScanningProduct(null)} className="p-2 bg-white rounded-full text-slate-300 hover:text-red-500 hover:shadow-md transition-all shrink-0">
                    <Trash2 size={24} />
                  </button>
                </div>

                {similarProducts.length > 0 && (
                  <div className="mb-6 p-4 bg-amber-50 rounded-xl border border-amber-100">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <FlaskConical size={12} /> Similares no Grupo DCB
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {similarProducts.map(p => (
                        <span key={p.reducedCode} className="text-[10px] bg-white border border-amber-200 text-amber-700 px-2 py-1 rounded-md shadow-sm font-medium">
                          {p.name} <span className="text-amber-300">({p.reducedCode})</span>
                        </span>
                      ))}
                      {masterProducts.filter(p => p.dcb === scanningProduct.dcb).length > 10 && (
                        <span className="text-[10px] text-amber-500 font-bold">+ mais itens</span>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Quantidade</label>
                    <div className="relative">
                      <Hash className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input
                        ref={qtyInputRef}
                        type="number"
                        value={quantity}
                        min="1"
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            originInputRef.current?.focus();
                          }
                        }}
                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 outline-none text-xl font-bold text-slate-700 transition-all bg-slate-50 focus:bg-white"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Origem do Vencido</label>
                    <div className="relative">
                      <Building className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <select
                        ref={originInputRef}
                        value={originBranch}
                        onChange={(e) => setOriginBranch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            sectorInputRef.current?.focus();
                          }
                        }}
                        disabled={originOptions.length === 0}
                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 outline-none text-sm font-bold text-slate-700 transition-all bg-slate-50 focus:bg-white custom-select"
                      >
                        <option value="">{originOptions.length === 0 ? 'Sem filiais cadastradas' : 'Selecione a filial...'}</option>
                        {originOptions.map(branch => (
                          <option key={branch} value={branch}>{branch}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Responsável Setor</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input
                        ref={sectorInputRef}
                        type="text"
                        value={sectorResponsible}
                        onChange={(e) => setSectorResponsible(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            expiryInputRef.current?.focus();
                          }
                        }}
                        placeholder="Digite o responsável..."
                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 outline-none text-sm font-bold text-slate-700 transition-all bg-slate-50 focus:bg-white"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">Vencimento (MM/AA)</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={20} />
                      <input
                        ref={expiryInputRef}
                        type="text"
                        value={expiryDate}
                        onChange={handleExpiryChange}
                        onKeyDown={handleKeyDown}
                        placeholder="MM/AA"
                        maxLength={5}
                        className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 outline-none text-xl font-bold text-slate-700 transition-all bg-slate-50 focus:bg-white"
                      />
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleConfirm}
                  className="w-full bg-blue-600 text-white py-5 rounded-2xl font-bold text-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-xl shadow-blue-200 active:scale-95"
                >
                  <CheckCircle2 size={28} /> CONFIRMAR LANÇAMENTO (ENTER)
                </button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="font-bold text-slate-800">Histórico de Lançamentos</h3>
                <div className="flex gap-2">
                  <button
                    onClick={onRefresh}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-all"
                    title="Forçar Atualização"
                  >
                    <CheckCircle2 size={14} /> Atualizar
                  </button>
                  <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all"
                    title="Baixar PDF"
                  >
                    <FileUp size={14} /> PDF
                  </button>
                  <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center">
                    TOTAL: {filteredRecords.length}
                  </span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-slate-100 justify-end">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFilterStatus(filterStatus === 'NO PRAZO' ? '' : 'NO PRAZO')}
                    className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-2 ${filterStatus === 'NO PRAZO' ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${filterStatus === 'NO PRAZO' ? 'bg-white' : 'bg-blue-500'}`}></div>
                    No Prazo
                  </button>
                  <button
                    onClick={() => setFilterStatus(filterStatus === 'CRÍTICO' ? '' : 'CRÍTICO')}
                    className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-2 ${filterStatus === 'CRÍTICO' ? 'bg-rose-700 border-rose-700 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${filterStatus === 'CRÍTICO' ? 'bg-white' : 'bg-rose-700'}`}></div>
                    Crítico
                  </button>
                  <button
                    onClick={() => setFilterStatus(filterStatus === 'VENCIDO' ? '' : 'VENCIDO')}
                    className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-2 ${filterStatus === 'VENCIDO' ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200'}`}
                  >
                    <div className={`w-2 h-2 rounded-full ${filterStatus === 'VENCIDO' ? 'bg-white' : 'bg-red-600'}`}></div>
                    Vencido
                  </button>

                  {(filterText || filterMonth || filterStatus) && (
                    <button
                      onClick={() => { setFilterText(''); setFilterMonth(''); setFilterStatus(''); }}
                      className="ml-2 flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-bold uppercase hover:bg-red-100 hover:text-red-600 transition-all border border-slate-200"
                    >
                      <X size={12} /> Limpar Filtros
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-[9px] font-bold text-slate-400 uppercase tracking-tight pt-2">
                <Info size={12} />
                <span>Legenda: utilize os botões acima para filtrar por status. Você pode combinar a busca com o filtro de mês na tabela.</span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[600px] overflow-y-auto custom-scrollbar">
              <table className="w-full relative border-separate border-spacing-0">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-widest border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-4 text-left w-24 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('reducedCode')}>
                      <div className="flex items-center">
                        Reduzido (C) {getSortIcon('reducedCode')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center">
                        Descrição (D) {getSortIcon('name')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left w-40 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('originBranch')}>
                      <div className="flex items-center">
                        Origem {getSortIcon('originBranch')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left w-40 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('sectorResponsible')}>
                      <div className="flex items-center">
                        Responsável {getSortIcon('sectorResponsible')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center w-20 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('quantity')}>
                      <div className="flex items-center justify-center">
                        Qtd {getSortIcon('quantity')}
                      </div>
                    </th>
                    <th className="px-6 py-4 text-center w-32 border-l border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleSort('expiryDate')}>
                      <div className="space-y-2">
                        <div className="flex items-center justify-center">
                          Vencimento {getSortIcon('expiryDate')}
                        </div>
                        <div className="relative">
                          <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                          <input
                            type="text"
                            placeholder="Mês"
                            maxLength={5}
                            value={filterMonth}
                            onChange={(e) => {
                              let v = e.target.value.replace(/\D/g, '');
                              if (v.length > 2) v = v.substring(0, 2) + '/' + v.substring(2, 4);
                              setFilterMonth(v);
                            }}
                            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-700 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none font-medium normal-case"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      </div>
                    </th>
                    <th className="px-6 py-4 text-left">Status / Cadastro</th>
                    <th className="px-6 py-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-20 text-center text-slate-400 italic">
                        <div className="flex flex-col items-center gap-3">
                          <Search size={40} className="text-slate-200" />
                          <p className="text-sm">Nenhum item encontrado.</p>
                          {filterText || filterMonth ? <p className="text-xs text-blue-500 cursor-pointer hover:underline" onClick={() => { setFilterText(''); setFilterMonth('') }}>Limpar filtros</p> : null}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((rec) => {
                      const status = getExpiryStatus(rec.expiryDate);
                      return (
                        <tr key={rec.id} className={`hover:brightness-95 transition-all group ${status.bg}`}>
                          <td className="px-6 py-4 font-mono text-sm text-slate-500 font-bold">{rec.reducedCode}</td>
                          <td className="px-6 py-4">
                            <div className="font-semibold text-slate-800">{rec.name}</div>
                            <div className="flex items-center gap-1.5 text-[9px] text-slate-500 font-bold uppercase mt-1">
                              <FlaskConical size={10} className="shrink-0 text-blue-400" /> <span className="truncate max-w-[200px]">{rec.dcb}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={rec.originBranch || ''}
                              onChange={(e) => onUpdatePV?.(rec.id, { originBranch: e.target.value })}
                              className="w-full min-w-[140px] bg-white/80 text-slate-700 px-2 py-1.5 rounded-lg font-bold text-xs border border-slate-200 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none custom-select"
                            >
                              <option value="">-</option>
                              {(rec.originBranch && !originOptions.includes(rec.originBranch) ? [rec.originBranch, ...originOptions] : originOptions).map(branch => (
                                <option key={branch} value={branch}>{branch}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={drafts[rec.id]?.sectorResponsible ?? (rec.sectorResponsible || '')}
                              onChange={(e) => setDraftField(rec.id, 'sectorResponsible', e.target.value)}
                              onBlur={(e) => {
                                clearUpdateTimer(`${rec.id}-sector`);
                                commitSector(rec.id, e.target.value, rec.sectorResponsible);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                              onInput={(e) => {
                                const value = (e.currentTarget as HTMLInputElement).value;
                                scheduleUpdate(`${rec.id}-sector`, () => commitSector(rec.id, value, rec.sectorResponsible));
                              }}
                              placeholder="-"
                              className="w-full min-w-[140px] bg-white/80 text-slate-700 px-2 py-1.5 rounded-lg font-bold text-xs border border-slate-200 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none"
                            />
                          </td>
                          <td className="px-6 py-4 text-center">
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={drafts[rec.id]?.quantity ?? String(rec.quantity)}
                              onChange={(e) => setDraftField(rec.id, 'quantity', e.target.value)}
                              onBlur={(e) => {
                                clearUpdateTimer(`${rec.id}-qty`);
                                commitQuantity(rec.id, e.target.value, rec.quantity);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  (e.currentTarget as HTMLInputElement).blur();
                                }
                              }}
                              onInput={(e) => {
                                const value = (e.currentTarget as HTMLInputElement).value;
                                scheduleUpdate(`${rec.id}-qty`, () => commitQuantity(rec.id, value, rec.quantity));
                              }}
                              className="w-16 text-center bg-white/80 text-slate-800 px-2 py-1 rounded-lg font-bold text-sm border border-slate-200 shadow-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none"
                            />
                          </td>
                          <td className="px-6 py-4 text-center border-l border-slate-100/50">
                            <div className="text-sm font-black text-slate-700">{rec.expiryDate}</div>
                            <div className={`text-[10px] font-bold ${status.color} mt-0.5`}>{status.days} dias</div>
                          </td>
                          <td className="px-6 py-4">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-1 ${status.label === 'VENCIDO' ? 'bg-red-200 text-red-800' : status.label === 'CRÍTICO' ? 'bg-rose-200 text-rose-900' : 'bg-blue-200 text-blue-800'}`}>
                              {status.label}
                            </div>
                            <div className="text-[10px] text-slate-500 flex flex-col">
                              <span className="font-bold text-slate-600">{rec.userName?.split(' ')[0] || rec.userEmail?.split('@')[0] || 'Unknown'}</span>
                              <span className="opacity-75">{new Date(rec.entryDate).toLocaleDateString('pt-BR')} {new Date(rec.entryDate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button onClick={() => onRemovePV(rec.id)} className="text-slate-400 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-white hover:shadow-sm">
                              <Trash2 size={18} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-800 mb-4">Métricas da Sessão</h3>
            <div className="space-y-4">
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 shadow-sm">
                <p className="text-blue-600 text-[10px] font-bold uppercase tracking-widest">Itens Totais</p>
                <p className="text-4xl font-black text-blue-800 mt-1">{pvRecords.reduce((acc, r) => acc + r.quantity, 0)}</p>
              </div>
              <div className="p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">Variedade (SKUs)</p>
                <p className="text-4xl font-bold text-slate-800 mt-1">{new Set(pvRecords.map(r => r.reducedCode)).size}</p>
              </div>
            </div>
          </div>

          {/* Resumo por Validade */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
            <h3 className="font-bold text-slate-800 mb-4 text-sm uppercase tracking-wider">Resumo por Validade</h3>
            <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
              {(() => {
                const grouped = pvRecords.reduce((acc, rec) => {
                  const key = rec.expiryDate;
                  if (!acc[key]) acc[key] = { items: 0, skus: new Set<string>() };
                  acc[key].items += rec.quantity;
                  acc[key].skus.add(rec.reducedCode);
                  return acc;
                }, {} as Record<string, { items: number; skus: Set<string> }>);

                const sortedDates = Object.keys(grouped).sort((a, b) => {
                  const [m1, y1] = a.split('/').map(Number);
                  const [m2, y2] = b.split('/').map(Number);
                  return (y1 * 12 + m1) - (y2 * 12 + m2);
                });

                return sortedDates.length === 0 ? (
                  <div className="text-center py-6 text-slate-400 italic text-sm border-2 border-dashed border-slate-100 rounded-xl">
                    Nenhum item lançado.
                  </div>
                ) : (
                  sortedDates.map(date => {
                    const data = grouped[date];
                    const status = getExpiryStatus(date);
                    const isActive = filterMonth === date;

                    return (
                      <div
                        key={date}
                        onClick={() => setFilterMonth(isActive ? '' : date)}
                        className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex justify-between items-center hover:scale-[1.02] duration-200 ${isActive
                            ? 'ring-2 ring-blue-500 ring-offset-2 border-blue-500 shadow-md transform scale-[1.02]'
                            : `${status.bg} border-transparent hover:border-slate-200`
                          }`}
                      >
                        <div className="space-y-1">
                          <p className={`text-base font-black ${isActive ? 'text-blue-600' : status.color}`}>{date}</p>
                          <div className={`px-2 py-0.5 rounded-md text-[8px] font-bold uppercase inline-block ${status.label === 'VENCIDO' ? 'bg-red-100 text-red-700' :
                            status.label === 'CRÍTICO' ? 'bg-rose-100 text-rose-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                            {status.label}
                          </div>
                        </div>
                        <div className="flex gap-4">
                          <div className="text-right">
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Itens</p>
                            <p className="text-xl font-black text-slate-800 leading-none">{data.items}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">Variedade</p>
                            <p className="text-xl font-bold text-slate-700 leading-none">{data.skus.size}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                );
              })()}
            </div>
          </div>

          <div className="bg-slate-900 p-8 rounded-3xl shadow-xl text-white relative overflow-hidden group">
            <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-blue-600/10 rounded-full blur-3xl group-hover:bg-blue-600/20 transition-all duration-700"></div>
            <div className="w-14 h-14 bg-slate-800 rounded-2xl flex items-center justify-center mb-6 border border-slate-700 shadow-lg shadow-black/20">
              <FlaskConical className="text-blue-400" size={28} />
            </div>
            <h4 className="font-bold text-xl mb-3">Grupo DCB Ativo</h4>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">Ao bipar um produto, o sistema identifica automaticamente seu Princípio Ativo e sugere similares.</p>
            <div className="space-y-3">
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-[10px] font-mono text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                FILIAL: {sessionInfo?.filial || 'PADRÃO'}
              </div>
              <div className="p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 text-[10px] font-mono text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                PRODUTOS BASE: {masterProducts.length}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PVRegistration;
