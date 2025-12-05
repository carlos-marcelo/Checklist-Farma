-- ============================================
-- CONFIGURAÇÃO COMPLETA DA TABELA DRAFTS
-- Cole este SQL no Supabase SQL Editor
-- SEM APAGAR DADOS EXISTENTES
-- ============================================

-- 1. Criar tabela drafts se não existir (NÃO apaga dados)
CREATE TABLE IF NOT EXISTS drafts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email TEXT NOT NULL UNIQUE,
  form_data JSONB DEFAULT '{}'::jsonb,
  images JSONB DEFAULT '{}'::jsonb,
  signatures JSONB DEFAULT '{}'::jsonb,
  ignored_checklists JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Criar índice para busca rápida por email (se não existir)
CREATE INDEX IF NOT EXISTS idx_drafts_user_email ON drafts(user_email);

-- 3. Habilitar RLS (Row Level Security)
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;

-- 4. Remover políticas antigas (se existirem)
DROP POLICY IF EXISTS "Permitir SELECT para todos" ON drafts;
DROP POLICY IF EXISTS "Permitir INSERT para todos" ON drafts;
DROP POLICY IF EXISTS "Permitir UPDATE para todos" ON drafts;
DROP POLICY IF EXISTS "Permitir DELETE para todos" ON drafts;

-- 5. Criar políticas PERMISSIVAS (acesso total)
CREATE POLICY "Permitir SELECT para todos"
  ON drafts FOR SELECT
  USING (true);

CREATE POLICY "Permitir INSERT para todos"
  ON drafts FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Permitir UPDATE para todos"
  ON drafts FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Permitir DELETE para todos"
  ON drafts FOR DELETE
  USING (true);

-- 6. Verificar se funcionou
SELECT 'Tabela drafts configurada com sucesso!' AS status;
SELECT COUNT(*) as total_drafts FROM drafts;
SELECT user_email, updated_at FROM drafts ORDER BY updated_at DESC LIMIT 5;
