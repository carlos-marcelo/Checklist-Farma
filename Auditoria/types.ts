
export enum AuditStatus {
  TODO = 'pendente',
  DONE = 'concluido'
}

export interface Product {
  code: string;
  name: string;
  quantity: number;
}

export interface Category {
  id: string;
  numericId?: string;
  name: string;
  itemsCount: number;
  totalQuantity: number;
  status: AuditStatus;
  products: Product[];
}

export interface Department {
  id: string;
  numericId?: string;
  name: string;
  categories: Category[];
}

export interface Group {
  id: string;
  name: string;
  departments: Department[];
}

export interface AuditData {
  groups: Group[];
  empresa: string;
  filial: string;
  sessionId?: string; // ID do banco de dados
  auditNumber?: number; // Número sequencial da auditoria (1, 2, 3...)
}

export interface ViewState {
  level: 'groups' | 'departments' | 'categories' | 'products';
  selectedGroupId?: string;
  selectedDeptId?: string;
  selectedCatId?: string;
}
