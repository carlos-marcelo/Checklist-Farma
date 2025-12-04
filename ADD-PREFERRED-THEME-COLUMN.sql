-- SQL para adicionar coluna preferred_theme na tabela users
-- Execute este SQL no Supabase SQL Editor

-- Adicionar coluna preferred_theme
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS preferred_theme TEXT DEFAULT 'blue';

-- Criar índice para melhorar performance (opcional)
CREATE INDEX IF NOT EXISTS idx_users_preferred_theme ON users(preferred_theme);

-- Verificar se a coluna foi adicionada
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'preferred_theme';
