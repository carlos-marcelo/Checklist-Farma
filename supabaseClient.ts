import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-key';

// Log configuration status for debugging
console.log('🔧 Supabase Config:', {
  url: supabaseUrl,
  keyPresent: supabaseAnonKey !== 'placeholder-key',
  isConfigured: !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
});

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn('⚠️ ATENÇÃO: Variáveis de ambiente do Supabase NÃO configuradas!');
  console.warn('⚠️ Configure os secrets no GitHub Actions ou crie .env.local para desenvolvimento');
}

// Create Supabase client (will use placeholder values if env vars not set)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper to check if Supabase is properly configured
export const isSupabaseConfigured = () => {
  return import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY;
};
