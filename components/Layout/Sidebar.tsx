import React from 'react';
import {
    Clipboard,
    LayoutDashboard,
    History,
    Package,
    ClipboardList,
    Settings,
    Lock,
    MessageSquareQuote,
    LogOut,
    CheckCircle,
    Building2,
    MapPin,
    Store
} from 'lucide-react';
import { User, ChecklistDefinition, AppConfig, AccessLevelId } from '../../types';
import { Logo } from './Logo';

interface SidebarProps {
    isSidebarOpen: boolean;
    setIsSidebarOpen: (open: boolean) => void;
    currentUser: User;
    currentTheme: any;
    displayConfig: AppConfig;
    companies: any[];
    checklists: ChecklistDefinition[];
    activeChecklistId: string;
    setActiveChecklistId: (id: string) => void;
    ignoredChecklists: Set<string>;
    currentView: string;
    handleViewChange: (view: any) => void;
    handleLogout: () => void;
    isChecklistComplete: (id: string) => boolean;
    canControlChecklists: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
    isSidebarOpen,
    setIsSidebarOpen,
    currentUser,
    currentTheme,
    displayConfig,
    companies,
    checklists,
    activeChecklistId,
    setActiveChecklistId,
    ignoredChecklists,
    currentView,
    handleViewChange,
    handleLogout,
    isChecklistComplete,
    canControlChecklists
}) => {
    return (
        <aside
            className={`fixed inset-y-0 left-0 z-50 w-72 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 lg:static lg:inset-auto no-print flex flex-col border-r border-gray-100`}
        >
            <div className={`h-28 flex items-center justify-center p-4 ${currentTheme.bgGradient} relative overflow-hidden shadow-md group`}>
                <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
                <div className="relative z-10 w-full flex justify-center">
                    <Logo config={displayConfig} companies={companies} selectedCompanyId={currentUser.company_id} />
                </div>
                {/* Quick Config Button */}
                <button
                    onClick={() => handleViewChange('settings')}
                    className="absolute top-2 right-2 p-1.5 text-white/70 hover:text-white hover:bg-white/20 rounded-full transition-all"
                    title="Configurar Marca"
                >
                    <Settings size={16} />
                </button>
            </div>

            <div className="px-6 py-6 border-b border-gray-100 bg-white relative">
                <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${currentTheme.bgGradient} shadow-md border-2 border-white overflow-hidden`}>
                        {currentUser.photo ? (
                            <img src={currentUser.photo} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            currentUser.name.charAt(0)
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{currentUser.name}</p>
                        <p className="text-xs text-gray-500 truncate uppercase tracking-wider font-semibold">
                            {currentUser.role === 'MASTER' ? 'Administrador' : 'Usuário'}
                        </p>
                        {(currentUser.company_id || currentUser.area || currentUser.filial) && (
                            <div className="mt-1 flex flex-col gap-0.5 animate-fade-in">
                                {currentUser.company_id && (() => {
                                    const comp = companies.find((c: any) => c.id === currentUser.company_id);
                                    return comp ? <p className="text-[10px] text-blue-600 font-bold truncate flex items-center gap-1"><Building2 size={10} /> {comp.name}</p> : null;
                                })()}
                                {currentUser.area && <p className="text-[10px] text-gray-500 truncate flex items-center gap-1"><MapPin size={10} /> {currentUser.area}</p>}
                                {currentUser.filial && <p className="text-[10px] text-gray-500 truncate flex items-center gap-1"><Store size={10} /> {currentUser.filial}</p>}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-6 px-4 space-y-2 custom-scrollbar pb-32">
                <div className="px-3 mb-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Checklists (Rascunho)</div>
                {checklists.map(checklist => {
                    const complete = isChecklistComplete(checklist.id);
                    const ignored = ignoredChecklists.has(checklist.id);
                    const isActive = activeChecklistId === checklist.id && currentView === 'checklist';
                    return (
                        <button
                            key={checklist.id}
                            onClick={() => { setActiveChecklistId(checklist.id); handleViewChange('checklist'); }}
                            className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 relative overflow-hidden ${isActive
                                ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                        >
                            {isActive && <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${currentTheme.bg}`}></div>}
                            <Clipboard className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? '' : 'text-gray-400'}`} />
                            <div className="flex-1 text-left truncate">
                                <span className={ignored ? 'line-through opacity-50' : ''}>{checklist.title}</span>
                            </div>
                            {complete && !ignored && <CheckCircle size={18} className="text-green-500 ml-2 drop-shadow-sm" />}
                        </button>
                    );
                })}

                <div className="px-3 mt-8 mb-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Gerenciamento</div>

                {canControlChecklists && (
                    <button
                        onClick={() => handleViewChange('summary')}
                        className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'summary'
                            ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <LayoutDashboard className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'summary' ? '' : 'text-gray-400'}`} />
                        Visão Geral / Finalizar
                    </button>
                )}

                <button
                    onClick={() => handleViewChange('history')}
                    className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'history'
                        ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <History className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'history' ? '' : 'text-gray-400'}`} />
                    Histórico de Relatórios
                </button>

                <button
                    onClick={() => handleViewChange('stock')}
                    className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'stock'
                        ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <Package className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'stock' ? '' : 'text-gray-400'}`} />
                    Conferência de Estoque
                </button>

                <button
                    onClick={() => handleViewChange('pre')}
                    className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'pre'
                        ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <ClipboardList className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'pre' ? '' : 'text-gray-400'}`} />
                    Pré-Vencidos
                </button>

                <button
                    onClick={() => handleViewChange('settings')}
                    className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'settings'
                        ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <Settings className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'settings' ? '' : 'text-gray-400'}`} />
                    Configurações
                </button>

                {currentUser.role === 'MASTER' && (
                    <button
                        onClick={() => handleViewChange('access')}
                        className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'access'
                            ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                            : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <Lock className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'access' ? '' : 'text-gray-400'}`} />
                        Níveis de Acesso
                    </button>
                )}

                <button
                    onClick={() => handleViewChange('support')}
                    className={`w-full group flex items-center px-4 py-3.5 text-sm font-medium rounded-xl transition-all duration-200 ${currentView === 'support'
                        ? `${currentTheme.lightBg} ${currentTheme.text} shadow-sm`
                        : 'text-gray-600 hover:bg-gray-50'
                        }`}
                >
                    <MessageSquareQuote className={`w-5 h-5 mr-3 flex-shrink-0 transition-transform group-hover:scale-110 ${currentView === 'support' ? '' : 'text-gray-400'}`} />
                    Suporte e Melhorias
                </button>
            </nav>

            <div className="p-4 border-t border-gray-100 bg-white sticky bottom-0 left-0 right-0 z-10">
                <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-red-600 hover:bg-red-50 p-3 rounded-xl transition-colors">
                    <LogOut size={18} />
                    Sair do Sistema
                </button>
            </div>
        </aside>
    );
};
