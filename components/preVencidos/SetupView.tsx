
import { User, Shield, FileText, Check, FlaskConical, FileCode, ArrowRight, Settings, Info } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { SessionInfo } from '../../preVencidos/types';
import { DbPVSalesUpload } from '../../supabaseService';

interface SetupViewProps {
  onComplete: (info: SessionInfo) => void;
  onSystemProductsUpload: (file: File) => void;
  onDCBBaseUpload: (file: File) => void;
  productsLoaded: boolean;
  systemLoaded: boolean;
  dcbLoaded: boolean;
  companies: {
    id: string;
    name: string;
    areas?: { name: string; branches: string[] }[];
  }[];
  uploadHistory?: DbPVSalesUpload[];
}

const SetupView: React.FC<SetupViewProps> = ({
  onComplete,
  onSystemProductsUpload,
  onDCBBaseUpload,
  productsLoaded,
  systemLoaded,
  dcbLoaded,
  companies,
  uploadHistory
}) => {
  const [info, setInfo] = useState<SessionInfo>({
    company: '',
    filial: '',
    area: '',
    pharmacist: '',
    manager: '',
    companyId: undefined
  });

  const selectedCompany = companies.find(company => company.id === info.companyId);
  const branchOptions = useMemo(() => {
    if (!selectedCompany || !selectedCompany.areas) return [];
    return selectedCompany.areas.flatMap(area => {
      if (!area || !Array.isArray(area.branches)) return [];
      return area.branches.map(branch => ({
        branchName: branch,
        areaName: area.name
      }));
    });
  }, [selectedCompany]);

  const handleCompanyChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = companies.find(company => company.id === event.target.value);
    setInfo(prev => ({
      ...prev,
      companyId: event.target.value as string,
      company: selected?.name || '',
      filial: '',
      area: ''
    }));
  };

  const handleBranchChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const branchValue = event.target.value;
    const found = branchOptions.find(option => option.branchName === branchValue);
    setInfo(prev => ({
      ...prev,
      filial: branchValue,
      area: found?.areaName || prev.area
    }));
  };

  const isFormValid = !!info.companyId && info.filial && info.pharmacist && info.manager && systemLoaded && dcbLoaded;

  const RequirementItem = ({ label, met }: { label: string, met: boolean }) => (
    <div className={`flex items-center gap-2 text-xs font-bold transition-colors ${met ? 'text-green-600' : 'text-slate-300'}`}>
      <div className={`w-4 h-4 rounded-full flex items-center justify-center border ${met ? 'bg-green-100 border-green-500' : 'bg-slate-50 border-slate-200'}`}>
        {met && <Check size={10} />}
      </div>
      {label}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500">
      <div className="bg-white p-10 rounded-2xl shadow-lg border border-slate-100">
        <div className="flex justify-between items-start mb-8">
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
            <Settings className="text-blue-500" /> Configuração da Sessão
          </h2>
          <div className="flex flex-col gap-1 items-end bg-slate-50 p-3 rounded-xl border border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Checklist de Início</p>
            <RequirementItem label="Empresa/Filial" met={!!(info.company && info.filial)} />
            <RequirementItem label="Nomes dos Responsáveis" met={!!(info.pharmacist && info.manager)} />
            <RequirementItem label="Cadastro Carregado" met={systemLoaded} />
            <RequirementItem label="Relatório DCB Carregado" met={dcbLoaded} />
            <RequirementItem label="Produtos Identificados" met={productsLoaded} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">EMPRESA</label>
              <select
                value={info.companyId || ''}
                onChange={handleCompanyChange}
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all custom-select"
              >
                <option value="">Selecione...</option>
                {companies.map(company => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">FILIAL</label>
              <select
                value={info.filial}
                onChange={handleBranchChange}
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all custom-select"
                disabled={!selectedCompany || branchOptions.length === 0}
              >
                <option value="">Escolha...</option>
                {branchOptions.map(option => (
                  <option key={`${option.areaName}-${option.branchName}`} value={option.branchName}>
                    {option.branchName} {option.areaName ? `(${option.areaName})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">FARMACÊUTICO(A)</label>
              <input type="text" value={info.pharmacist} onChange={(e) => setInfo(prev => ({ ...prev, pharmacist: e.target.value }))} placeholder="Nome do Responsável" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">GESTOR(A)</label>
              <input type="text" value={info.manager} onChange={(e) => setInfo(prev => ({ ...prev, manager: e.target.value }))} placeholder="Nome do Gestor" className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className={`bg-white p-8 rounded-3xl border-2 border-dashed transition-all flex flex-col items-center text-center ${systemLoaded ? 'border-green-400 bg-green-50/10' : 'border-slate-200 hover:border-blue-300'}`}>
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${systemLoaded ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
            <FileCode size={32} />
          </div>
          <h3 className="font-bold text-slate-800">1. Cadastro do Sistema</h3>
          <p className="text-xs text-slate-400 mt-2 mb-6">Arquivo XML ou Excel (Colunas C/D/K) com os produtos cadastrados.</p>
          <label className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer transition-all shadow-sm">
            {systemLoaded ? <span className="text-green-600 flex items-center gap-2"><Check size={16} /> Carregado</span> : 'Selecionar Cadastro'}
            <input type="file" className="hidden" accept=".xml,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && onSystemProductsUpload(e.target.files[0])} />
          </label>
        </div>

        <div className={`bg-white p-8 rounded-3xl border-2 border-dashed transition-all flex flex-col items-center text-center ${dcbLoaded ? 'border-blue-400 bg-blue-50/10' : 'border-slate-200 hover:border-blue-300'}`}>
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${dcbLoaded ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
            <FlaskConical size={32} />
          </div>
          <h3 className="font-bold text-slate-800">2. Relatório DCB</h3>
          <p className="text-xs text-slate-400 mt-2 mb-6">Arquivo Excel agrupado por DCB (necessário para identificar similares).</p>
          <label className="px-6 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 cursor-pointer transition-all shadow-sm">
            {dcbLoaded ? <span className="text-blue-600 flex items-center gap-2"><Check size={16} /> Carregado</span> : 'Selecionar DCB'}
            <input type="file" className="hidden" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && onDCBBaseUpload(e.target.files[0])} />
          </label>
        </div>
      </div>

      {!systemLoaded || !dcbLoaded ? (
        <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 text-amber-700 flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 font-black uppercase text-xs tracking-widest">
            <Info size={16} /> Requisito Pendente
          </div>
          <p className="text-sm">Carregue ambos os arquivos (Cadastro + DCB) para que o botão seja liberado.</p>
        </div>
      ) : (
        <div className="bg-green-600 p-4 rounded-2xl text-white text-center animate-in zoom-in duration-300">
          <p className="font-bold flex items-center justify-center gap-2 text-sm uppercase">
            <Check size={18} /> Tudo pronto! Clique abaixo para começar.
          </p>
        </div>
      )}

      <div className="flex justify-center pt-4">
        <button
          disabled={!isFormValid}
          onClick={() => onComplete(info)}
          className={`px-16 py-5 rounded-2xl font-bold text-xl shadow-xl transition-all ${isFormValid ? 'bg-blue-600 text-white hover:bg-blue-700 hover:-translate-y-1' : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
            }`}
        >
          INICIAR CONFERÊNCIA <ArrowRight className="inline-block ml-2" />
        </button>
      </div>

      {uploadHistory && uploadHistory.length > 0 && (
        <div className="mt-12 pt-8 border-t border-slate-200">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
            <FileText size={16} /> Histórico de Uploads de Vendas (Filial)
          </h3>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                <tr>
                  <th className="px-6 py-4">Data Upload</th>
                  <th className="px-6 py-4">Período Venda</th>
                  <th className="px-6 py-4">Arquivo</th>
                  <th className="px-6 py-4">Responsável</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uploadHistory.map((upload) => (
                  <tr key={upload.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-slate-600">
                      {new Date(upload.uploaded_at || '').toLocaleString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 font-medium text-slate-800">
                      {upload.period_label}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs font-mono">
                      {upload.file_name || '-'}
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {upload.user_email?.split('@')[0]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetupView;
