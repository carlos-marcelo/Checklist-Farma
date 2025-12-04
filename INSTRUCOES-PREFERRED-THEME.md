# Como Adicionar a Coluna preferred_theme no Supabase

## Passo a Passo:

1. **Acesse o Supabase Dashboard**
   - Vá para: https://supabase.com/dashboard
   - Faça login e selecione seu projeto

2. **Abra o SQL Editor**
   - No menu lateral esquerdo, clique em **SQL Editor**
   - Ou acesse: https://supabase.com/dashboard/project/SEU_PROJECT_ID/sql

3. **Execute o SQL**
   - Clique em **+ New query**
   - Copie e cole o conteúdo do arquivo `ADD-PREFERRED-THEME-COLUMN.sql`
   - Clique em **Run** (ou pressione Ctrl+Enter)

4. **Verifique se funcionou**
   - Você deve ver uma mensagem de sucesso
   - A última query retornará informações sobre a nova coluna

## SQL a executar:

```sql
-- Adicionar coluna preferred_theme
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS preferred_theme TEXT DEFAULT 'blue';

-- Criar índice para melhorar performance (opcional)
CREATE INDEX IF NOT EXISTS idx_users_preferred_theme ON users(preferred_theme);

-- Verificar se a coluna foi adicionada
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'preferred_theme';
```

## Após executar:

1. A coluna `preferred_theme` será adicionada à tabela `users`
2. Todos os usuários existentes terão o valor padrão 'blue'
3. Novos usuários poderão escolher sua cor preferida
4. A cor será salva e carregada automaticamente

## Teste:

Depois de executar o SQL:
1. Faça login no app
2. Vá em Configurações
3. Mude a cor do tema
4. Recarregue a página (F5)
5. A cor deve permanecer a que você escolheu! 🎨
