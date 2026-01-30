import React from 'react';
import { Menu, X, RotateCcw, FileCheck } from 'lucide-react';
import { User, AppConfig, ChecklistDefinition } from '../../types';
import { Logo } from './Logo';

interface HeaderProps {
    currentUser: User;
    currentTheme: any;
    displayConfig: AppConfig;
    companies: any[];
    isSidebarOpen: boolean;
    setIsSidebarOpen: (open: boolean) => void;
    currentView: string;
    activeChecklist: ChecklistDefinition;
    activeChecklistId: string;
    canControlChecklists: boolean;
    handleResetChecklist: () => void;
    openChecklistEditor: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
    currentUser,
    currentTheme,
    displayConfig,
    companies,
    isSidebarOpen,
    setIsSidebarOpen,
    currentView,
    activeChecklist,
    activeChecklistId,
    canControlChecklists,
    handleResetChecklist,
    openChecklistEditor
}) => {
    const getTitle = () => {
        if (currentView === 'report' || currentView === 'view_history') return 'Relatório Consolidado';
        if (currentView === 'summary') return 'Visão Geral da Avaliação';
        if (currentView === 'settings') return 'Configurações do Sistema';
        if (currentView === 'access') return 'Níveis de Acesso';
        if (currentView === 'history') return 'Histórico de Relatórios';
        if (currentView === 'pre') return 'Pré-Vencidos';
        if (currentView === 'support') return 'Suporte e Melhorias';
        return activeChecklist.title;
    };

    const title = getTitle();

    return (
        <>
            {/* Mobile Header */}
            <header className={`${currentTheme.bgGradient} shadow-md lg:hidden h-18 flex items-center px-4 justify-between no-print z-20`}>
                <Logo config={displayConfig} companies={companies} selectedCompanyId={currentUser.company_id} />
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="text-white p-2 rounded-lg hover:bg-white/10">
                    {isSidebarOpen ? <X size={24} /> : <Menu size={24} />}
                </button>
            </header>

            {/* Mobile Actions Bar: Title + Recomeçar */}
            <div className="lg:hidden no-print bg-white/90 backdrop-blur-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-18 z-20">
                <h1 className="text-base font-extrabold text-gray-800 truncate tracking-tight">
                    {title}
                </h1>
                <div className="flex items-center gap-2">
                    {currentView === 'checklist' && canControlChecklists && (
                        <button
                            onClick={handleResetChecklist}
                            className="flex items-center gap-2 text-gray-400 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors text-xs font-bold"
                            title="Limpar todos os dados do relatório atual"
                        >
                            <RotateCcw size={16} />
                            <span>Recomeçar</span>
                        </button>
                    )}
                    {currentView === 'checklist' && currentUser?.role === 'MASTER' && (
                        <button
                            onClick={() => openChecklistEditor(activeChecklistId)}
                            className="flex items-center gap-2 text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors text-xs font-bold"
                            title="Editar checklist atual"
                        >
                            <FileCheck size={16} />
                            <span>Editar</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Desktop Header */}
            <header className="hidden lg:flex items-center justify-between h-20 bg-white/80 backdrop-blur-md border-b border-gray-200 px-10 shadow-sm no-print sticky top-0 z-30">
                <h1 className="text-2xl font-extrabold text-gray-800 truncate tracking-tight">
                    {title}
                </h1>

                <div className="flex items-center gap-4">
                    <div className="mr-4 opacity-90 hover:opacity-100 transition-opacity scale-90 origin-right hidden xl:block">
                        <Logo config={displayConfig} companies={companies} selectedCompanyId={currentUser.company_id} />
                    </div>
                    <div className="flex items-center gap-3">
                        {currentView === 'checklist' && canControlChecklists && (
                            <button
                                onClick={handleResetChecklist}
                                className="flex items-center gap-2 text-gray-400 hover:text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors text-sm font-bold"
                                title="Limpar todos os dados do relatório atual"
                            >
                                <RotateCcw size={16} />
                                Recomeçar
                            </button>
                        )}
                        {currentView === 'checklist' && currentUser?.role === 'MASTER' && (
                            <button
                                onClick={() => openChecklistEditor(activeChecklistId)}
                                className="flex items-center gap-2 text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg transition-colors text-sm font-bold"
                                title="Editar checklist atual"
                            >
                                <FileCheck size={16} />
                                Editar Checklist
                            </button>
                        )}
                    </div>
                </div>
            </header>
        </>
    );
};
