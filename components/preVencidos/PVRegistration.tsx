
import React, { useState, useRef, useEffect } from 'react';
import { Product, PVRecord, SessionInfo } from '../../preVencidos/types';
import ScannerInput from './ScannerInput';
import { Trash2, Calendar, Hash, FileUp, CheckCircle2, User, Building, Search, FlaskConical, ChevronRight } from 'lucide-react';

interface PVRegistrationProps {
  masterProducts: Product[];
  pvRecords: PVRecord[];
  sessionInfo: SessionInfo | null;
  onAddPV: (record: PVRecord) => void;
  onRemovePV: (id: string) => void;
}

const PVRegistration: React.FC<PVRegistrationProps> = ({ 
  masterProducts, 
  pvRecords, 
  sessionInfo,
  onAddPV, 
  onRemovePV
}) => {
  const [scanningProduct, setScanningProduct] = useState<Product | null>(null);
  const [searchMethod, setSearchMethod] = useState<'C' | 'K' | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [expiryDate, setExpiryDate] = useState<string>(''); 
  
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const expiryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scanningProduct) {
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
    }
  }, [scanningProduct]);

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
    if (scanningProduct && quantity > 0 && expiryDate.length === 5) {
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
        expiryDate,
        entryDate: new Date().toISOString(),
        dcb: scanningProduct.dcb
      });
      setScanningProduct(null);
      setSearchMethod(null);
      setExpiryDate('');
      setQuantity(1);
    } else if (scanningProduct) {
      alert('Preencha a quantidade e o vencimento (MM/AA).');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
  };

  const similarProducts = scanningProduct 
    ? masterProducts.filter(p => p.dcb === scanningProduct.dcb && p.reducedCode !== scanningProduct.reducedCode).slice(0, 10)
    : [];

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
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
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
                          onKeyDown={(e) => e.key === 'Enter' && expiryInputRef.current?.focus()}
                          className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-blue-500 focus:ring-0 outline-none text-xl font-bold text-slate-700 transition-all bg-slate-50 focus:bg-white"
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
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-bold text-slate-800">Histórico de Lançamentos</h3>
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">
                LANÇADOS: {pvRecords.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-widest">
                  <tr>
                    <th className="px-6 py-4 text-left">Reduzido (C)</th>
                    <th className="px-6 py-4 text-left">Descrição (D)</th>
                    <th className="px-6 py-4 text-center">Qtd</th>
                    <th className="px-6 py-4 text-center border-l border-slate-100">Vencimento</th>
                    <th className="px-6 py-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pvRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center text-slate-400 italic">
                        <div className="flex flex-col items-center gap-3">
                           <Search size={40} className="text-slate-200" />
                           <p className="text-sm">Nenhum item lançado ainda. Aguardando bipagem ou digitação.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    pvRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-blue-50/30 transition-colors group">
                        <td className="px-6 py-4 font-mono text-sm text-slate-500 font-bold">{rec.reducedCode}</td>
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-800">{rec.name}</div>
                          <div className="flex items-center gap-1.5 text-[9px] text-blue-500 font-bold uppercase mt-1">
                            <FlaskConical size={10} className="shrink-0"/> <span className="truncate max-w-[200px]">{rec.dcb}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="bg-slate-100 text-slate-800 px-3 py-1 rounded-lg font-bold text-sm border border-slate-200">{rec.quantity}</span>
                        </td>
                        <td className="px-6 py-4 text-center text-xs font-bold text-slate-600 border-l border-slate-100">
                           {rec.expiryDate}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => onRemovePV(rec.id)} className="text-slate-300 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50">
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))
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
