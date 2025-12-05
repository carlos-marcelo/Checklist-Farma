import { supabase } from './supabaseClient';

// ==================== TYPES ====================

export interface DbUser {
  id?: string;
  email: string;
  password: string;
  name: string;
  phone: string;
  role: 'MASTER' | 'USER';
  approved: boolean;
  rejected?: boolean;
  photo?: string;
  preferred_theme?: 'red' | 'green' | 'blue' | 'yellow';
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

export async function createUser(user: DbUser): Promise<DbUser | null> {
  try {
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
        preferred_theme: user.preferred_theme || 'blue'
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error creating user:', error);
    return null;
  }
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

// ==================== CONFIGS ====================

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
