
import React from 'react';
import { ViewState } from '../types';

interface BreadcrumbsProps {
  view: ViewState;
  onNavigate: (level: ViewState['level']) => void;
  groupName?: string;
  deptName?: string;
}

const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ view, onNavigate, groupName, deptName }) => {
  return (
    <nav className="flex items-center text-sm text-slate-500 mb-6 font-medium overflow-x-auto whitespace-nowrap pb-2">
      <button 
        onClick={() => onNavigate('groups')}
        className={`hover:text-indigo-600 transition-colors ${view.level === 'groups' ? 'text-indigo-600 font-bold' : ''}`}
      >
        <i className="fa-solid fa-layer-group mr-1"></i> Grupos de Auditoria
      </button>
      
      {view.level !== 'groups' && (
        <>
          <i className="fa-solid fa-chevron-right mx-3 text-[10px] text-slate-300"></i>
          <button 
            onClick={() => onNavigate('departments')}
            className={`hover:text-indigo-600 transition-colors ${view.level === 'departments' ? 'text-indigo-600 font-bold' : ''}`}
          >
            {groupName || 'Grupo'}
          </button>
        </>
      )}

      {(view.level === 'categories' || view.level === 'products') && (
        <>
          <i className="fa-solid fa-chevron-right mx-3 text-[10px] text-slate-300"></i>
          <button 
            onClick={() => onNavigate('categories')}
            className={`hover:text-indigo-600 transition-colors ${view.level === 'categories' ? 'text-indigo-600 font-bold' : ''}`}
          >
            {deptName || 'Departamento'}
          </button>
        </>
      )}
    </nav>
  );
};

export default Breadcrumbs;
