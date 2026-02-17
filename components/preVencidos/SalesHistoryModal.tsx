import React from 'react';
import { X, FileText, User, Eye, Printer } from 'lucide-react';
import { DbPVSalesUpload } from '../../supabaseService';
import { AnalysisReportPayload, buildAnalysisReportHtml } from '../../preVencidos/analysisReport';

interface SalesHistoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    history: DbPVSalesUpload[];
    analysisReports?: Record<string, AnalysisReportPayload>;
}

const SalesHistoryModal: React.FC<SalesHistoryModalProps> = ({ isOpen, onClose, history, analysisReports = {} }) => {
    if (!isOpen) return null;

    const openReportWindow = (payload: AnalysisReportPayload, autoPrint = false) => {
        const html = buildAnalysisReportHtml(payload, { autoPrint });
        const win = window.open('', '_blank', 'width=1200,height=800');
        if (!win) {
            alert('Não foi possível abrir a janela. Verifique o bloqueador de pop-ups.');
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-4xl max-h-[80vh] rounded-3xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <FileText className="text-blue-600" /> Histórico de Uploads
                        </h2>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                            Registro cronológico de importações
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-0 custom-scrollbar">
                    {history.length === 0 ? (
                        <div className="p-12 text-center text-slate-400">
                            <p>Nenhum histórico de upload encontrado.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="px-6 py-4">Data Upload</th>
                                    <th className="px-6 py-4">Período Venda</th>
                                    <th className="px-6 py-4">Arquivo</th>
                                    <th className="px-6 py-4">Responsável</th>
                                    <th className="px-6 py-4">Ações</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {history.map((upload) => {
                                    const label = (upload.period_label || '').trim();
                                    const report = analysisReports[label];
                                    return (
                                    <tr key={upload.id} className="hover:bg-blue-50/50 transition-colors group">
                                        <td className="px-6 py-4 text-slate-600 font-medium group-hover:text-blue-700">
                                            {upload.uploaded_at ? new Date(upload.uploaded_at).toLocaleString('pt-BR') : '-'}
                                        </td>
                                        <td className="px-6 py-4 font-bold text-slate-800">
                                            {upload.period_label}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 text-xs font-mono group-hover:text-slate-700">
                                            {upload.file_name || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 flex items-center gap-2">
                                            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                                <User size={12} />
                                            </div>
                                            {upload.user_email?.split('@')[0]}
                                        </td>
                                        <td className="px-6 py-4">
                                            {report ? (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => openReportWindow(report, false)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:border-blue-200 transition"
                                                    >
                                                        <Eye size={12} /> Visualizar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openReportWindow(report, true)}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-blue-600 hover:border-blue-200 transition"
                                                    >
                                                        <Printer size={12} /> Imprimir
                                                    </button>
                                                </div>
                                            ) : (
                                                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Sem análise</span>
                                            )}
                                        </td>
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-3xl shrink-0 text-right">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-white border border-slate-200 shadow-sm rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"
                    >
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SalesHistoryModal;
