import { supabase } from './supabaseClient';
import { ChecklistDefinition } from './types';
import { Product, PVRecord, PVSaleClassification } from './preVencidos/types';

// ==================== TYPES ====================

export interface DbUser {
  id?: string;
  email: string;
  password: string;
  name: string;
  phone: string;
  role: 'MASTER' | 'ADMINISTRATIVO' | 'USER';
  approved: boolean;
  rejected?: boolean;
  photo?: string;
  preferred_theme?: 'red' | 'green' | 'blue' | 'yellow';
  company_id?: string | null;
  area?: string | null;
  filial?: string | null;
  created_at?: string;
}

export interface CompanyArea {
  name: string;
  branches: string[];
}

export interface DbCompany {
  id?: string;
  name: string;
  cnpj?: string;
  phone?: string;
  logo?: string;
  areas?: CompanyArea[]; // JSONB column
  created_at?: string;
}

export interface DbConfig {
  id?: string;
  pharmacy_name: string;
  logo: string | null;
  updated_at?: string;
}

export interface DbReport {
  id?: string;
  user_email: string;
  user_name: string;
  pharmacy_name: string;
  score: string;
  form_data: any;
  images: any;
  signatures: any;
  ignored_checklists: any;
  created_at?: string;
}

export interface DbStockConferenceSession {
  id?: string;
  user_email: string;
  branch: string;
  area?: string | null;
  company_id?: string | null;
  pharmacist: string;
  manager: string;
  step: 'setup' | 'conference' | 'divergence' | 'report';
  products: {
    reduced_code: string;
    barcode?: string | null;
    description?: string | null;
  }[];
  inventory: {
    reduced_code: string;
    system_qty: number;
    counted_qty: number;
    status: 'pending' | 'matched' | 'divergent';
    last_updated?: string | null;
  }[];
  recount_targets?: string[];
  updated_at?: string;
}

export interface DbStockConferenceReport {
  id?: string;
  user_email: string;
  user_name: string;
  branch: string;
  area?: string | null;
  pharmacist: string;
  manager: string;
  summary: {
    total: number;
    matched: number;
    divergent: number;
    pending: number;
    percent: number;
  };
  items: {
    reduced_code: string;
    barcode?: string | null;
    description?: string | null;
    system_qty: number;
    counted_qty: number;
    status: 'pending' | 'matched' | 'divergent';
    difference: number;
    last_updated?: string | null;
  }[];
  created_at?: string;
}

export interface DbPVSessionData {
  master_products?: Product[];
  system_products?: Product[];
  dcb_products?: Product[];
  pv_records?: PVRecord[];
  confirmed_pv_sales?: Record<string, PVSaleClassification>;
  finalized_reds_by_period?: Record<string, string[]>;
  sales_period?: string;
}

export interface DbPVSession {
  id?: string;
  user_email: string;
  company_id?: string | null;
  branch?: string | null;
  area?: string | null;
  pharmacist?: string | null;
  manager?: string | null;
  session_data?: DbPVSessionData | null;
  created_at?: string;
  updated_at?: string;
}

export interface DbChecklistDefinition {
  id: string;
  definition: ChecklistDefinition;
  created_at?: string;
  updated_at?: string;
}

export async function fetchChecklistDefinitions(): Promise<DbChecklistDefinition[]> {
  try {
    const { data, error } = await supabase
      .from('checklist_definitions')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching checklist definitions:', error);
    return [];
  }
}

export async function upsertChecklistDefinition(definition: ChecklistDefinition): Promise<DbChecklistDefinition | null> {
  try {
    const { data, error } = await supabase
      .from('checklist_definitions')
      .upsert({
        id: definition.id,
        definition,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error('Error upserting checklist definition:', error);
    return null;
  }
}

export interface DbDraft {
  id?: string;
  user_email: string;
  form_data?: any;
  images?: any;
  signatures?: any;
  ignored_checklists?: any;
  updated_at?: string;
}

// ==================== USERS ====================

export async function fetchUsers(): Promise<DbUser[]> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching users:', error);
    return [];
  }
}

export async function createUser(user: DbUser): Promise<DbUser> {
  const { data, error } = await supabase
    .from('users')
    .insert([{
      email: user.email,
      password: user.password,
      name: user.name,
      phone: user.phone,
      role: user.role,
      approved: user.approved,
      rejected: user.rejected || false,
      photo: user.photo,
      preferred_theme: user.preferred_theme || 'blue',
      company_id: user.company_id,
      area: user.area,
      filial: user.filial
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating user:', error);
    throw error;
  }

  return data;
}

export async function updateUser(email: string, updates: Partial<DbUser>): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('users')
      .update(updates)
      .eq('email', email);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating user:', error);
    return false;
  }
}

export async function deleteUser(email: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('email', email);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting user:', error);
    return false;
  }
}

// ==================== COMPANIES ====================

export async function fetchCompanies(): Promise<DbCompany[]> {
  try {
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching companies:', error);
    return [];
  }
}

export interface DbAccessMatrix {
  level: string;
  modules: Record<string, boolean>;
  created_at?: string;
  updated_at?: string;
}

export async function fetchAccessMatrix(): Promise<DbAccessMatrix[]> {
  try {
    const { data, error } = await supabase
      .from('access_matrix')
      .select('*');

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching access matrix:', error);
    return [];
  }
}

export async function upsertAccessMatrix(level: string, modules: Record<string, boolean>): Promise<DbAccessMatrix | null> {
  try {
    const { data, error } = await supabase
      .from('access_matrix')
      .upsert({
        level,
        modules,
        updated_at: new Date().toISOString()
      }, { onConflict: 'level' })
      .select()
      .single();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error('Error upserting access matrix:', error);
    return null;
  }
}

export async function createCompany(company: DbCompany): Promise<DbCompany | null> {
  try {
    const { data, error } = await supabase
      .from('companies')
      .insert([{
        name: company.name,
        cnpj: company.cnpj,
        phone: company.phone,
        logo: company.logo
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating company:', error);
    return null;
  }
}

export async function deleteCompany(id: string): Promise<boolean> {
  try {
    // Verificar se existem usuários vinculados
    const { count, error: checkError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', id);

    if (checkError) throw checkError;

    if (count && count > 0) {
      alert('Não é possível excluir esta empresa pois existem usuários vinculados a ela.');
      return false;
    }

    const { error } = await supabase
      .from('companies')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting company:', error);
    return false;
  }
}

// ==================== CONFIGS ====================

export async function updateCompany(id: string, updates: Partial<DbCompany>): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('companies')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating company:', error);
    return false;
  }
}

export async function fetchConfig(): Promise<DbConfig | null> {
  try {
    const { data, error } = await supabase
      .from('configs')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
    return data;
  } catch (error) {
    console.error('Error fetching config:', error);
    return null;
  }
}

export async function saveConfig(config: DbConfig): Promise<boolean> {
  try {
    // Verificar se já existe config
    const existing = await fetchConfig();

    if (existing && existing.id) {
      // Update
      const { error } = await supabase
        .from('configs')
        .update({
          pharmacy_name: config.pharmacy_name,
          logo: config.logo,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);

      if (error) throw error;
    } else {
      // Insert
      const { error } = await supabase
        .from('configs')
        .insert([{
          pharmacy_name: config.pharmacy_name,
          logo: config.logo
        }]);

      if (error) throw error;
    }

    return true;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// ==================== REPORTS ====================

export async function fetchReports(): Promise<DbReport[]> {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching reports:', error);
    return [];
  }
}

export async function createReport(report: DbReport): Promise<DbReport | null> {
  try {
    const { data, error } = await supabase
      .from('reports')
      .insert([{
        user_email: report.user_email,
        user_name: report.user_name,
        pharmacy_name: report.pharmacy_name,
        score: report.score,
        form_data: report.form_data,
        images: report.images,
        signatures: report.signatures,
        ignored_checklists: report.ignored_checklists
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating report:', error);
    return null;
  }
}

export async function fetchStockConferenceReports(): Promise<DbStockConferenceReport[]> {
  try {
    const { data, error } = await supabase
      .from('stock_conference_reports')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
  return data || [];
  } catch (error) {
    console.error('Error fetching stock conference reports:', error);
    return [];
  }
}

export async function createStockConferenceReport(report: DbStockConferenceReport): Promise<DbStockConferenceReport | null> {
  try {
    const { data, error } = await supabase
      .from('stock_conference_reports')
      .insert([{
        user_email: report.user_email,
        user_name: report.user_name,
        branch: report.branch,
        area: report.area,
        pharmacist: report.pharmacist,
        manager: report.manager,
        summary: report.summary,
        items: report.items
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating stock conference report:', error);
    return null;
  }
}

// Check if a similar report already exists to avoid duplicates
export async function reportExists(report: DbReport): Promise<boolean> {
  try {
    // Verificar se já existe relatório do mesmo usuário/farmácia/nota nos últimos 5 minutos
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('reports')
      .select('id, score')
      .eq('user_email', report.user_email)
      .eq('pharmacy_name', report.pharmacy_name)
      .eq('score', report.score)
      .gte('created_at', fiveMinutesAgo)
      .limit(1);

    if (error) throw error;
    return !!(data && data.length > 0);
  } catch (error) {
    console.error('Error checking report existence:', error);
    return false;
  }
}

export async function deleteReport(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting report:', error);
    return false;
  }
}

export async function fetchStockConferenceSession(userEmail: string): Promise<DbStockConferenceSession | null> {
  try {
    const { data, error } = await supabase
      .from('stock_conference_sessions')
      .select('*')
      .eq('user_email', userEmail)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching stock conference session:', error);
    return null;
  }
}

export async function upsertStockConferenceSession(session: DbStockConferenceSession): Promise<DbStockConferenceSession | null> {
  try {
    // Preparar payload sem campos undefined
    const payload: any = {
      user_email: session.user_email,
      branch: session.branch,
      area: session.area,
      company_id: session.company_id,
      pharmacist: session.pharmacist,
      manager: session.manager,
      step: session.step,
      products: session.products,
      inventory: session.inventory,
      recount_targets: session.recount_targets || [],
      updated_at: session.updated_at || new Date().toISOString()
    };

    // Só adicionar ID se existir
    if (session.id) {
      payload.id = session.id;
    }

    console.log('📤 Sending to Supabase:', {
      user_email: payload.user_email,
      hasId: !!payload.id,
      productsCount: payload.products.length,
      inventoryCount: payload.inventory.length
    });

    const { data, error } = await supabase
      .from('stock_conference_sessions')
      .upsert([payload], { onConflict: 'user_email' })
      .select()
      .single();

    if (error) {
      console.error('❌ Supabase Upsert Error:', error);
      throw error;
    }

    console.log('✅ Stock session persisted to Supabase:', data?.id);
    return data;
  } catch (error) {
    console.error('❌ Error upserting stock conference session:', error);
    return null;
  }
}

export async function deleteStockConferenceSession(userEmail: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('stock_conference_sessions')
      .delete()
      .eq('user_email', userEmail);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting stock conference session:', error);
    return false;
  }
}

export async function fetchPVSession(userEmail: string): Promise<DbPVSession | null> {
  try {
    const { data, error } = await supabase
      .from('pv_sessions')
      .select('*')
      .eq('user_email', userEmail)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro ao carregar sessÆo PV do Supabase:', error);
    return null;
  }
}

export async function upsertPVSession(session: DbPVSession): Promise<DbPVSession | null> {
  try {
    const payload: any = {
      id: session.id,
      user_email: session.user_email,
      company_id: session.company_id,
      branch: session.branch,
      area: session.area,
      pharmacist: session.pharmacist,
      manager: session.manager,
      session_data: session.session_data || {},
      updated_at: session.updated_at || new Date().toISOString()
    };

    if (!session.id) {
      delete payload.id;
    }

    const { data, error } = await supabase
      .from('pv_sessions')
      .upsert([payload], { onConflict: 'user_email' })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Erro salvando sessÆo PV no Supabase:', error);
    return null;
  }
}

// ==================== DRAFTS ====================

export async function fetchDraft(userEmail: string): Promise<DbDraft | null> {
  try {
    const { data, error } = await supabase
      .from('drafts')
      .select('*')
      .eq('user_email', userEmail)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (error) {
    console.error('Error fetching draft:', error);
    return null;
  }
}

export async function saveDraft(draft: DbDraft): Promise<boolean> {
  try {
    // Use upsert to avoid race condition from fetch-before-save pattern
    const { error } = await supabase
      .from('drafts')
      .upsert({
        user_email: draft.user_email,
        form_data: draft.form_data,
        images: draft.images,
        signatures: draft.signatures,
        ignored_checklists: draft.ignored_checklists,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_email'
      });

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error saving draft:', error);
    return false;
  }
}

export async function deleteDraft(userEmail: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('drafts')
      .delete()
      .eq('user_email', userEmail);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting draft:', error);
    return false;
  }
}

// ==================== MIGRATION HELPERS ====================

export async function migrateLocalStorageToSupabase() {
  try {
    const results = {
      users: 0,
      config: false,
      reports: 0,
      drafts: 0
    };

    // Migrar usuários
    const localUsers = localStorage.getItem('APP_USERS');
    if (localUsers) {
      const users = JSON.parse(localUsers);
      for (const user of users) {
        // Try update if exists, else create
        try {
          const { data: existing } = await supabase
            .from('users')
            .select('email')
            .eq('email', user.email)
            .limit(1);
          if (existing && existing.length > 0) {
            await updateUser(user.email, user);
            results.users++;
          } else {
            const created = await createUser(user);
            if (created) results.users++;
          }
        } catch (e) {
          console.error('Error upserting user during migration:', e);
        }
      }
    }

    // Migrar configurações
    const localConfig = localStorage.getItem('APP_CONFIG');
    if (localConfig) {
      const config = JSON.parse(localConfig);
      results.config = await saveConfig(config);
    }

    // Migrar relatórios
    const localHistory = localStorage.getItem('APP_HISTORY');
    if (localHistory) {
      const reports = JSON.parse(localHistory);
      for (const report of reports) {
        const dbReport: DbReport = {
          user_email: report.userEmail,
          user_name: report.userName,
          pharmacy_name: report.pharmacyName,
          score: report.score,
          form_data: report.formData,
          images: report.images,
          signatures: report.signatures,
          ignored_checklists: report.ignoredChecklists
        };
        const exists = await reportExists(dbReport);
        if (!exists) {
          const created = await createReport(dbReport);
          if (created) results.reports++;
        }
      }
    }

    // Migrar rascunhos
    const localDrafts = localStorage.getItem('APP_DRAFTS');
    if (localDrafts) {
      const draftsObj = JSON.parse(localDrafts);
      for (const [email, draft] of Object.entries(draftsObj)) {
        const saved = await saveDraft({
          user_email: email,
          ...(draft as any)
        });
        if (saved) results.drafts++;
      }
    }

    return results;
  } catch (error) {
    console.error('Error migrating data:', error);
    return null;
  }
}

// ==================== TICKETS (SUPPORT/FEATURES) ====================

export interface DbTicket {
  id?: string;
  title: string;
  description: string;
  images?: string[]; // array of base64 strings
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'IGNORED';
  user_email: string;
  user_name: string;
  admin_response?: string;
  created_at?: string;
  updated_at?: string;
}

export async function fetchTickets(): Promise<DbTicket[]> {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return [];
  }
}

export async function createTicket(ticket: DbTicket): Promise<DbTicket | null> {
  try {
    const { data, error } = await supabase
      .from('tickets')
      .insert([{
        title: ticket.title,
        description: ticket.description,
        images: ticket.images || [],
        status: 'OPEN',
        user_email: ticket.user_email,
        user_name: ticket.user_name
      }])
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating ticket:', error);
    return null;
  }
}

export async function updateTicketStatus(id: string, status: string, response?: string): Promise<boolean> {
  try {
    const updates: any = {
      status,
      updated_at: new Date().toISOString()
    };
    if (response !== undefined) {
      updates.admin_response = response;
    }

    const { error } = await supabase
      .from('tickets')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error updating ticket:', error);
    return false;
  }
}

export function exportLocalStorageBackup() {
  const backup = {
    timestamp: new Date().toISOString(),
    users: localStorage.getItem('APP_USERS'),
    config: localStorage.getItem('APP_CONFIG'),
    history: localStorage.getItem('APP_HISTORY'),
    drafts: localStorage.getItem('APP_DRAFTS')
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup-checklist-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
