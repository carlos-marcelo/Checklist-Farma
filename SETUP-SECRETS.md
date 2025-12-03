# 🔧 Configurar Secrets do GitHub Actions

## ⚠️ IMPORTANTE: Sem isso, o site não conecta ao Supabase!

### Passo a Passo:

1. **Abra seu repositório no GitHub**
   - Vá para: https://github.com/carlos-marcelo/Checklist-Farma

2. **Acesse Settings (Configurações)**
   - Clique em `Settings` no topo do repositório

3. **Entre em Secrets and variables**
   - No menu esquerdo, clique em `Secrets and variables` → `Actions`

4. **Adicione os 2 secrets:**

   Clique em `New repository secret` e adicione:

   **Secret 1:**
   ```
   Name: VITE_SUPABASE_URL
   Value: https://efqkcehhtuxiccdmnzku.supabase.co
   ```

   **Secret 2:**
   ```
   Name: VITE_SUPABASE_ANON_KEY
   Value: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmcWtjZWhodHV4aWNjZG1uemt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NTk0NTUsImV4cCI6MjA4MDMzNTQ1NX0.CA5pNsOTOIgqQfvtW1FIsAV53CZoj2V_E6-CZdejAl4
   ```

5. **Dispare um novo deploy**
   - Faça qualquer commit e push, OU
   - Vá em `Actions` → `Deploy to GitHub Pages` → `Run workflow`

6. **Aguarde o build (2-3 minutos)**
   - Quando terminar, abra o site e veja o badge "Supabase: Online" ✅

---

## 🔍 Como verificar se funcionou:

Abra o site e:
- Console do browser (F12)
- Procure por mensagens:
  - ✅ "Supabase: Online" (badge no canto inferior direito)
  - ✅ Logs de "Tentando criar usuário" quando registrar

Se aparecer "Supabase: Offline", os secrets NÃO foram configurados corretamente.
