export interface Product {
  id: string;
  name: string;
  barcode: string;
  reducedCode: string;
  dcb: string;
}

export interface PVRecord {
  id: string;
  reducedCode: string;
  name: string;
  quantity: number;
  expiryDate: string;
  entryDate: string;
  dcb: string;
  userEmail?: string;
  userName?: string;
}

export interface SalesRecord {
  reducedCode: string;
  productName: string;
  quantity: number;
  salesperson: string;
  date: string;
  dcb: string;
}

export interface SalesUploadRecord {
  id?: string;
  user_email: string;
  company_id: string;
  branch: string;
  period_label: string;
  period_start?: string | null;
  period_end?: string | null;
  file_name?: string | null;
  uploaded_at?: string;
}

export interface DCBReportRecord {
  reducedCode: string;
  productName: string;
  dcb: string;
  soldQuantity: number;
}

export interface SessionInfo {
  company: string;
  filial: string;
  area: string;
  pharmacist: string;
  manager: string;
  companyId?: string;
}

export interface PVSaleClassification {
  confirmed: boolean;
  qtyPV: number;
  qtyNeutral: number;
  qtyIgnoredPV: number;
  sellerName?: string;
  reducedCode?: string;
}

export enum AppView {
  SETUP = 'setup',
  REGISTRATION = 'registration',
  ANALYSIS = 'analysis',
  DASHBOARD = 'dashboard'
}
