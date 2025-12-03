<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1nozC64cycw2FI5dSOe7CWFqOBlrnRG3V

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

# Checklist-Farma

Publicação via GitHub Pages (manual com domínio próprio)

1. Build
```
npm install
npm run build
```
O `postbuild` já cria `dist/404.html`.

2. Verifique `CNAME`
- `public/CNAME` contém `marcelo.far.br` e será copiado para `dist/CNAME` no build. Se faltar:
```
powershell -Command "Set-Content -Path 'dist\\CNAME' -Value 'marcelo.far.br'"
```

3. Publicar na branch `gh-pages`
- Método simples:
```
powershell -Command "git subtree push --prefix dist origin gh-pages"
```
- Alternativo:
```
git checkout --orphan gh-pages
git rm -rf .
powershell -Command "Copy-Item -Path 'dist\\*' -Destination '.' -Recurse"
git add .
git commit -m "publish: static build to gh-pages (marcelo.far.br)"
git push -u origin gh-pages
```

4. Ativar Pages
- Settings → Pages: Source "Deploy from a branch", branch `gh-pages`, folder `(root)`.
- Custom domain: `marcelo.far.br`.

5. DNS
- A: 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- AAAA (opcional): 2606:50c0:8000::153, 2606:50c0:8001::153, 2606:50c0:8002::153, 2606:50c0:8003::153

Notas
- `vite.config.ts` usa `base: '/'` para domínio próprio.
- Para publicar em `carlos-marcelo.github.io/Checklist-Farma/`, mude `base` para `'/Checklist-Farma/'`.
- App funciona offline com localStorage e sincroniza com Supabase quando online.
