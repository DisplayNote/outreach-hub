# Outreach Hub — Execution Plan

**Owner:** Miguel del Amor Herrera (Mike), CTO @ DisplayNote
**Version:** v1.0 (May 2026)
**Source mockup:** `PaulsOutreachHub.html` (~7,260 líneas, single-file PWA single-user)
**Objetivo:** Convertir el mockup vibe-coded de Paul en un producto hosted, multi-usuario, con IaC, CI/CD, observabilidad y cumplimiento legal.

---

## Tabla de contenidos

1. [Visión](#1-visión)
2. [Stack y decisiones cerradas](#2-stack-y-decisiones-cerradas)
3. [Roadmap a alto nivel](#3-roadmap-a-alto-nivel)
4. [Pre-vuelo (lo que Mike hace una sola vez)](#4-pre-vuelo)
5. [PHASE 0 — Bootstrap (spec ejecutable)](#5-phase-0--bootstrap-spec-ejecutable)
6. [Después de Phase 0](#6-después-de-phase-0)
7. [Apéndices](#7-apéndices)

---

## 1. Visión

El asset reutilizable de `PaulsOutreachHub.html` es el modelo de dominio (campaigns → contacts → touchpoints), la lógica de secuencias con días hábiles, el skip-list, la orquestación AMD del dialler, la normalización de teléfonos y los side-effects outcome→status. Lo que se reemplaza: hosting, persistencia, autenticación, email runner y observabilidad. La UI puede reutilizarse casi tal cual; lo que cambia es la capa de plataforma.

End-state: multi-usuario, hosted en Vercel + Supabase, IaC con Terraform, OAuth Microsoft delegated para login y envío de email vía Graph API, dialler vía Edge Functions de Supabase contra Telnyx, audit log hash-encadenado, CTPS + GDPR built-in.

---

## 2. Stack y decisiones cerradas

| Componente | Decisión |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript strict |
| Hosting frontend | Vercel (auto-deploy desde GitHub, previews por PR) |
| Backend / BaaS | Supabase (Postgres + RLS + Auth + Realtime + Edge Functions + Vault + Storage) |
| Auth | Supabase Auth con Microsoft OIDC provider; OAuth contra app multi-tenant propia |
| Email outbound | Microsoft Graph delegated (`Mail.Send`) per-user; SendGrid descartado |
| Email inbound | Microsoft Graph subscriptions (`Mail.Read`) per-user con polling fallback en dev |
| Telnyx orchestration | Supabase Edge Functions; estado en Postgres; eventos vía Realtime al frontend |
| IaC | Terraform en `/infra` (Supabase + Vercel); DNS gestionado manualmente (fuera de Terraform); Supabase CLI para migraciones y functions; integración Git de Vercel para deploy del app |
| CI/CD | GitHub Actions (`ci.yml`, `infra.yml`, `db-migrate.yml`, `functions-deploy.yml`) |
| Audit log | Trigger Postgres con hash-encadenado por organización |
| Tests | Vitest (unit) + Playwright (e2e) |
| Package manager | pnpm |
| Dev local | `supabase start` + `next dev` + Mailpit (Docker) + ngrok (o túnel equivalente) para webhooks |
| Dev tenant | E5 sandbox de Mike (admin consent self-served) |

---

## 3. Roadmap a alto nivel

| Fase | Objetivo | Estimación | Bloquea |
|---|---|---|---|
| **0. Bootstrap** | Scaffolding completo, CI verde, primer deploy en Vercel, OAuth contra sandbox funcionando, `make dev` operativo en clon limpio | 3–4 días | Phase 1+ |
| **1. Data model + Auth + Read-only** | Esquema normalizado, RLS, importer del JSON de Paul, vistas Today + Pipeline read-only | 1 semana | Phase 2 |
| **2. CRUD completo + 12 vistas** | Paridad funcional con el HTML original, todo escrito en Postgres, importer CSV Apollo | 1.5–2 semanas | Phase 3 |
| **3. Dialler Mode A (WebRTC directo)** | Click-to-call desde cualquier vista de contacto, run dialler, outcome → status | 1 semana | Phase 4 |
| **4. Dialler Mode B (AMD via Edge Function)** | Telnyx webhook → Edge Function → Postgres → Realtime al frontend; verificación HMAC; multi-usuario | 1 semana | Phase 5 |
| **5. Email runner via Graph delegated** | Cron sender + reply scanner via Graph subscriptions; eliminación de PowerShell + Outlook COM | 1.5 semanas | Phase 6 |
| **6. Compliance + audit log** | `gdpr_status` + right-to-be-forgotten + CTPS integration + call recording + audit_log encadenado | 1 semana | Phase 7 |
| **7. Hardening + observabilidad** | Sentry + synthetic monitoring + rate limits + runbook + restore tests | 3–5 días | Phase 8 |
| **8. Features avanzadas** | Reporting completo, power dialling, Zoho sync, AI calling (gated) | Abierto | — |

**Total a Phase 7 (producto multi-usuario sólido):** 8–10 semanas a tiempo completo.

---

## 4. Pre-vuelo

Estas tareas las hace Mike **antes** de lanzar Claude Code para Phase 0. Son las que requieren UI de terceros, tarjetas, OAuth handshakes interactivos o decisiones humanas. Tiempo estimado: 2–3 horas en una tarde.

### 4.1 Cuentas y servicios

- [ ] **GitHub:** repo creado vacío en `DisplayNote/outreach-hub` (o el org que prefieras). Branch default `main`. Sin contenido inicial.
- [ ] **Supabase:** cuenta creada. Crear **un solo** proyecto cloud:
  - `outreach-prod` (región: `eu-west-2` o la más cercana a London/Belfast)
  - Anotar `project_ref` y database password.
  - **Desarrollo es local** (stack de la CLI de Supabase vía `supabase start`); no se crea proyecto cloud de dev (evita pagar dos proyectos).
- [ ] **Vercel:** cuenta creada. Crear proyecto `outreach-hub` vinculado al repo de GitHub. Configurar dominio custom más adelante (Phase 5).
- [ ] **DNS (manual):** el DNS de `displaynote.com` se gestiona manualmente, fuera de Terraform. Cuando se elija el subdominio (Phase 2), crear a mano un `CNAME` `<subdominio>` → `cname.vercel-dns.com`. Los records de Mail (SPF/DKIM/DMARC) se añaden a mano en Phase 5. **No se necesita ningún token de DNS en el bootstrap.**
- [ ] **Telnyx:** verificar acceso. (No se toca en Phase 0, sólo confirmar que existe la cuenta y un número UK asignado.)

### 4.2 Microsoft App Registration

En el **tenant E5 sandbox de Mike** (donde eres Global Admin):

- [ ] App Registrations → New registration:
  - **Name:** `DisplayNote Outreach Hub`
  - **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant)*
  - **Redirect URIs:** añadir como `Web`:
    - `http://localhost:3000/auth/callback` (dev local)
    - `https://<dev-project-ref>.supabase.co/auth/v1/callback` (Supabase dev)
    - `https://<prod-project-ref>.supabase.co/auth/v1/callback` (Supabase prod)
    - El dominio Vercel se añade post-Phase 0.
- [ ] Authentication → Implicit grant: dejar ambos OFF (sólo Auth code flow + PKCE).
- [ ] Certificates & secrets → New client secret. Expiración: 24 meses. **Copiar el value inmediatamente.**
- [ ] API permissions → Microsoft Graph → Delegated:
  - `User.Read` (low impact, auto-consentable)
  - `Mail.Send` (medium impact, admin consent needed)
  - `Mail.Read` (medium impact, admin consent needed)
  - `MailboxSettings.Read` (low impact)
  - `offline_access` (low impact)
- [ ] **Grant admin consent for <sandbox tenant>** (botón verde en API permissions). Esto te autoriza a ti mismo en tu sandbox; el ticket separado para el tenant productivo de DisplayNote va aparte.
- [ ] Anotar:
  - `Application (client) ID`
  - `Directory (tenant) ID` (sandbox)
  - `Client secret value`

### 4.3 Ticket de admin consent en DisplayNote (Track B, paralelo)

- [ ] Abrir ticket con IT para admin consent del app registration anterior en el tenant de DisplayNote. Mismo client ID, mismos scopes. Argumento: la app de Anthropic con permisos mucho más amplios ya está aprobada; ésta es propiedad de DisplayNote con scopes restringidos sólo a Mail. Esperar 4–12 semanas en paralelo a Phase 0–4; no es bloqueante para nada hasta Phase 5.

### 4.4 Tokens para Terraform y CI

- [ ] **Supabase Personal Access Token:** Account → Access Tokens. Crear uno con nombre `outreach-hub-terraform`. Copiar.
- [ ] **Vercel Personal Access Token:** Account Settings → Tokens. Crear uno con nombre `outreach-hub-ci`. Copiar.

### 4.5 GitHub Actions Secrets

Configurar en el repo (Settings → Secrets and variables → Actions):

```
SUPABASE_ACCESS_TOKEN           # del 4.4
SUPABASE_PROJECT_REF            # del 4.1 (proyecto cloud único = prod)
SUPABASE_DB_PASSWORD            # del 4.1
SUPABASE_ANON_KEY               # opcional; del dashboard. Usado por ci.yml para el build (si falta, usa 'placeholder')
VERCEL_TOKEN                    # del 4.4
VERCEL_ORG_ID                   # de Vercel dashboard
VERCEL_PROJECT_ID               # de Vercel dashboard
MS_CLIENT_ID                    # del 4.2
MS_CLIENT_SECRET                # del 4.2 (sensitive)
MS_DEV_TENANT_ID                # del 4.2 (sandbox)
TF_STATE_KEY                    # generar random hex 32 chars; para cifrar TF state
```

### 4.6 Archivo `.env.bootstrap` local (para Claude Code)

Crear un archivo `.env.bootstrap` en la máquina donde correrá Claude Code. Para **dev local** sólo hacen falta los valores `MS_*` (`make bootstrap` → `.env.local`); las credenciales cloud (Supabase/Vercel) sólo se necesitan para el deploy de prod (`make bootstrap-prod` → `infra/envs/prod.tfvars`). **Este archivo no se commitea.** Plantilla:

```bash
# GitHub
GITHUB_REPO=DisplayNote/outreach-hub

# Supabase (proyecto cloud único = prod; dev es local con `supabase start`)
SUPABASE_ACCESS_TOKEN=sbp_xxx
SUPABASE_PROJECT_REF=xxx
SUPABASE_DB_PASSWORD=xxx

# Vercel
VERCEL_TOKEN=xxx
VERCEL_ORG_ID=xxx
VERCEL_PROJECT_ID=xxx

# DNS se gestiona manualmente — no se necesita token aquí.

# Microsoft (sandbox dev tenant)
MS_CLIENT_ID=xxx
MS_CLIENT_SECRET=xxx
MS_DEV_TENANT_ID=xxx

# Terraform
TF_STATE_KEY=xxx
```

---

## 5. PHASE 0 — Bootstrap (spec ejecutable)

> **A Claude Code:** este spec se ejecuta autónomamente. Sigue los tasks en orden estricto. Cada task tiene un criterio de validación que debes verificar antes de pasar al siguiente. Si encuentras una condición de la sección "Escalar en", para y reporta. No tomes decisiones de producto: la spec las cierra todas.

### 5.1 Objetivo

Repo `DisplayNote/outreach-hub` con scaffolding completo: Next.js + Supabase + Terraform + GitHub Actions + EmailDriver abstraction + Microsoft OAuth login funcionando en local contra el sandbox tenant + un `make dev` que arranca todo en una sola línea + CI verde en main + primer deploy de producción automático desde `main` (no hay preview deploys; dev es local).

### 5.2 Entradas requeridas

- Archivo `.env.bootstrap` con todos los valores de §4.6.
- Repo `DisplayNote/outreach-hub` existe y está vacío.
- Todos los secrets de §4.5 están configurados en el repo.
- Todos los servicios (Supabase, Vercel, Microsoft app) están provisionados y consentidos según §4.

### 5.3 Out-of-scope para Phase 0

No tocar nada de lo siguiente; corresponde a fases posteriores:

- Modelo de dominio (campaigns, contacts, touchpoints). Sólo se crean `organizations` y `users` para que Auth funcione.
- Lógica de negocio de outreach.
- Telnyx (ni client ni server). Sólo dependencia en `package.json` y placeholder.
- Implementación real del driver `graph-dev` o `graph-prod`. Sólo interface + mock + mailpit.
- Cualquier UI más allá de `/login` y un `/` placeholder autenticado.
- Migración de datos del HTML original.
- Audit log triggers (Phase 6).

### 5.4 Tareas (orden estricto)

#### Task 1 — Repo skeleton

Crear estructura de directorios y archivos base.

**Comandos:**
```bash
git clone https://github.com/DisplayNote/outreach-hub.git
cd outreach-hub
mkdir -p app/{login,auth/callback} components/ui lib/{supabase,email,auth} \
  tests/{unit,e2e} infra/envs supabase/{migrations,functions/_shared} \
  scripts docs .github/workflows
```

**Archivos a crear:**
- `.gitignore` (Node + Next + Supabase + Terraform standard)
- `.editorconfig`
- `README.md` (placeholder mínimo)
- `LICENSE` (UNLICENSED, propiedad de DisplayNote)
- `.nvmrc` con `20.18.0`

**Validación:** `tree -L 2` muestra la estructura esperada.

**Escalar en:** repo no vacío.

---

#### Task 2 — Next.js + TypeScript scaffold

**Comandos:**
```bash
pnpm init
pnpm add next@15 react react-dom
pnpm add -D typescript @types/node @types/react @types/react-dom \
  eslint eslint-config-next prettier
```

**Archivos:**
- `package.json` con scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`
- `tsconfig.json` con `strict: true`, `paths: { "@/*": ["./*"] }`
- `next.config.mjs` (mínimo, modo standalone si va en Vercel)
- `app/layout.tsx` (HTML root, sin estilos por ahora)
- `app/page.tsx` (componente "Hola Outreach Hub" placeholder)
- `app/globals.css` (vacío con tailwind preflight comentado para Phase 1)

**Validación:**
- `pnpm typecheck` → 0 errores
- `pnpm build` → succeeds
- `pnpm dev` → http://localhost:3000 muestra el placeholder

---

#### Task 3 — Tooling de calidad

**Comandos:**
```bash
pnpm add -D @typescript-eslint/eslint-plugin @typescript-eslint/parser \
  prettier eslint-config-prettier \
  vitest @vitest/ui happy-dom \
  @playwright/test playwright
pnpm exec playwright install --with-deps chromium
```

**Archivos:**
- `eslint.config.mjs` (flat config; reglas: no-unused-vars error, no-explicit-any warn)
- `prettier.config.mjs` (printWidth 100, singleQuote, semi)
- `vitest.config.ts` (happy-dom environment, alias `@/*`)
- `playwright.config.ts` (baseURL http://localhost:3000, webServer: pnpm dev)
- `tests/unit/sanity.test.ts` con un test trivial que pase
- `tests/e2e/sanity.spec.ts` con un test trivial que pase

**Validación:**
- `pnpm lint` → 0 errores
- `pnpm test` → 1 passing
- `pnpm test:e2e` → 1 passing

---

#### Task 4 — Supabase local stack

**Comandos:**
```bash
pnpm add -D supabase
pnpm exec supabase init
```

**Archivos:**
- Modificar `supabase/config.toml`:
  - `project_id = "outreach-hub"`
  - `api.port = 54321`
  - `db.port = 54322`
  - `auth.site_url = "http://localhost:3000"`
  - `auth.additional_redirect_urls = ["http://localhost:3000/auth/callback"]`
  - `auth.external.azure.enabled = true`
  - `auth.external.azure.client_id = "env(MS_CLIENT_ID)"`
  - `auth.external.azure.secret = "env(MS_CLIENT_SECRET)"`
  - `auth.external.azure.url = "https://login.microsoftonline.com/common/v2.0"` (multi-tenant)
  - `auth.external.azure.redirect_uri = "http://localhost:54321/auth/v1/callback"`
- `supabase/migrations/20260523000001_init.sql`:
  ```sql
  -- Phase 0: minimal schema. Real domain in Phase 1.
  create table public.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
  );

  create table public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    org_id uuid not null references public.organizations(id),
    email text not null unique,
    full_name text,
    role text not null default 'member' check (role in ('owner','admin','member')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.organizations enable row level security;
  alter table public.users enable row level security;

  -- Helper: org_id of current authenticated user
  create or replace function public.current_org_id() returns uuid
    language sql stable security definer as $$
      select org_id from public.users where id = auth.uid()
    $$;

  create policy "users see their own org" on public.organizations for select
    using (id = public.current_org_id());

  create policy "users see members of their org" on public.users for select
    using (org_id = public.current_org_id());

  create policy "users update own profile" on public.users for update
    using (id = auth.uid()) with check (id = auth.uid());

  -- Bootstrap: when a new auth.users row is inserted, auto-create a personal org
  create or replace function public.handle_new_user() returns trigger
    language plpgsql security definer as $$
    declare new_org_id uuid;
    begin
      insert into public.organizations (name)
      values (coalesce(new.raw_user_meta_data->>'org_name', new.email || '''s org'))
      returning id into new_org_id;

      insert into public.users (id, org_id, email, full_name, role)
      values (
        new.id, new_org_id, new.email,
        new.raw_user_meta_data->>'full_name', 'owner'
      );
      return new;
    end;
    $$;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
  ```
- `supabase/seed.sql` (vacío con un comentario; se rellena en Phase 1)

**Validación:**
- `supabase start` → todos los servicios up
- `supabase status` → URLs visibles
- `psql <db-url> -c "\dt public.*"` → muestra `organizations`, `users`
- `psql <db-url> -c "select * from public.users;"` → 0 rows pero query OK

**Escalar en:**
- Docker no instalado o no corriendo
- Port 54321 / 54322 ocupados

---

#### Task 5 — Supabase clients (browser + server)

**Comandos:**
```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

**Archivos:**
- `lib/env.ts`: validación Zod de variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- `lib/supabase/client.ts`: factory para client-side (browser).
- `lib/supabase/server.ts`: factory para server-side (Server Components, Route Handlers, Server Actions).
- `lib/supabase/middleware.ts`: helpers para Next.js middleware (refresh de session).
- `middleware.ts` en root: usa el helper de arriba.

**Patrones a seguir:** los del docs oficiales de `@supabase/ssr` para Next App Router. No reinventar.

**Validación:** typecheck pasa; build pasa.

---

#### Task 6 — Microsoft OAuth login

**Archivos:**
- `app/login/page.tsx`: página con botón "Sign in with Microsoft". Usa `supabase.auth.signInWithOAuth({ provider: 'azure', options: { scopes: 'email openid profile User.Read offline_access' } })`. Sólo `User.Read` en Phase 0; el resto se solicita incrementalmente en Phase 5.
- `app/auth/callback/route.ts`: GET handler que llama `supabase.auth.exchangeCodeForSession(code)` y redirige a `/`.
- `app/page.tsx`: si no hay session, redirige a `/login`. Si hay session, muestra "Hola {user.email}, esto es Outreach Hub. Phase 0 OK."
- `app/auth/signout/route.ts`: POST handler que cierra session y redirige a `/login`.

**Validación manual (Mike ejecuta una vez para verificar):**
1. `pnpm dev` y `supabase start` arriba.
2. Navegar a http://localhost:3000 → redirige a /login.
3. Click "Sign in with Microsoft" → redirige a login.microsoftonline.com.
4. Login con cuenta del sandbox E5 → consent screen (sólo `User.Read`) → click Accept.
5. Redirect a http://localhost:3000 → muestra "Hola <email>".
6. En Supabase Studio (http://localhost:54323), verificar:
   - `auth.users` tiene 1 row con el email del sandbox.
   - `public.organizations` tiene 1 row.
   - `public.users` tiene 1 row enlazado.

**Escalar en:**
- Microsoft devuelve error de consent (revisar scopes en app registration).
- Redirect URI mismatch.
- Supabase no acepta los tokens (revisar config.toml).

---

#### Task 7 — EmailDriver abstraction

**Archivos:**
- `lib/email/types.ts`: definir `OutboundMessage`, `SentRef`, `InboundMessage`, `Subscription`, `EmailDriverError`.
- `lib/email/driver.ts`: interface `EmailDriver` con métodos `send`, `fetchReplies`, `subscribeReplies?`, `name: string`.
- `lib/email/mock.ts`: implementación que mantiene un array en memoria, devuelve datos canónicos. Útil para tests.
- `lib/email/mailpit.ts`: implementación que habla SMTP contra `localhost:1025` (Mailpit). Sólo soporta `send`; `fetchReplies` lanza `NotImplementedError` (no leemos respuestas en dev local).
- `lib/email/graph.ts`: **stub**. Exporta una clase `GraphDriver` que tira `throw new NotImplementedError('GraphDriver lands in Phase 5')` en todos los métodos. Existe para que el factory pueda referenciarla y typecheck pase.
- `lib/email/index.ts`: factory que selecciona driver basándose en `process.env.EMAIL_DRIVER`:
  ```ts
  export function getEmailDriver(): EmailDriver {
    switch (process.env.EMAIL_DRIVER) {
      case 'mock': return new MockDriver();
      case 'mailpit': return new MailpitDriver();
      case 'graph-dev':
      case 'graph-prod': return new GraphDriver(process.env.EMAIL_DRIVER);
      default: throw new Error(`Unknown EMAIL_DRIVER: ${process.env.EMAIL_DRIVER}`);
    }
  }
  ```
- `tests/unit/email/mock.test.ts`: test del MockDriver.

**Validación:**
- `pnpm typecheck` pasa.
- `pnpm test` pasa.
- `EMAIL_DRIVER=mock pnpm test` pasa.

---

#### Task 8 — Terraform `/infra`

**Comandos:**
```bash
cd infra
terraform init  # se hace después de escribir backend.tf
```

**Archivos:**
- `infra/providers.tf`:
  ```hcl
  terraform {
    required_version = ">= 1.7"
    required_providers {
      supabase = { source = "supabase/supabase", version = "~> 1.9" }
      vercel   = { source = "vercel/vercel", version = "~> 2.0" }
    }
  }

  provider "supabase" { access_token = var.supabase_access_token }
  provider "vercel"   { api_token    = var.vercel_token }
  ```
- `infra/backend.tf`:
  - Para empezar: backend local con `terraform.tfstate` gitignored. Migración a remote backend (Terraform Cloud o S3) marcada como TODO en Phase 7. Es aceptable para Phase 0 con 1 dev.
  - Comentario explicando esto.
- `infra/variables.tf`: definir todas las vars que aparecen en `prod.tfvars`.
- `infra/supabase.tf`:
  - Importar proyecto existente: `resource "supabase_project" "this" { ... }` con `lifecycle.ignore_changes` apropiado.
  - `resource "supabase_settings" "auth"`: configurar site_url, redirect URLs, Azure provider.
- `infra/vercel.tf`:
  - `resource "vercel_project" "this"`: vincula al repo GitHub, configura build settings.
  - `resource "vercel_project_environment_variable"` para cada env var del runtime.
- **DNS (manual, fuera de Terraform):** no hay `infra/dns.tf`. Cuando el subdominio se fije (Phase 2), crear a mano el `CNAME` `<subdominio>` → `cname.vercel-dns.com`; los records de Mail (SPF/DKIM/DMARC) se añaden a mano en Phase 5.
- `infra/outputs.tf`: outputs útiles (URLs).
- `infra/envs/prod.tfvars.example`: plantilla commiteada con placeholders (única — no hay dev cloud).
- `infra/envs/prod.tfvars`: poblado por Claude Code desde `.env.bootstrap`. **Gitignored.**

**Validación:**
- `terraform -chdir=infra fmt -check` → 0 cambios
- `terraform -chdir=infra validate` → success
- `terraform -chdir=infra plan -var-file=envs/prod.tfvars` → plan sin errores; outputs visibles
- **No correr `terraform apply` automáticamente.** Eso lo hace el workflow `infra.yml` cuando se mergee a main, y Mike lo aprueba la primera vez manualmente.

**Escalar en:**
- Provider no encuentra el proyecto Supabase (project_ref incorrecto).
- Plan muestra cambios destructivos.

---

#### Task 9 — GitHub Actions

**Archivos:**
- `.github/workflows/ci.yml`:
  - Triggers: PR contra main, push a main
  - Steps: checkout → setup-node@v4 con pnpm → install → typecheck → lint → test → build → playwright (sólo en push a main, no en PR para ahorrar tiempo)
- `.github/workflows/infra.yml`:
  - Triggers: PR que toque `infra/**`, push a main que toque `infra/**`
  - Steps: setup terraform → fmt check → init → plan (PR) o apply (main, con `workflow_dispatch` para approval gate)
- `.github/workflows/db-migrate.yml`:
  - Trigger: `workflow_dispatch` **manual** con confirmación (no auto en push). Como sólo hay proyecto cloud de prod, las migraciones se prueban en local (`supabase db reset`/`db diff`) y se aplican a prod a mano para evitar deploys de esquema accidentales.
  - Steps: setup-supabase-cli → `supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` → `supabase db push`
- `.github/workflows/functions-deploy.yml`:
  - Triggers: push a main que toque `supabase/functions/**`
  - Steps: deploy de funciones modificadas
- `.github/CODEOWNERS`: `* @<tu-usuario-github>`
- `.github/pull_request_template.md`: checklist mínimo (typecheck, tests, migration reviewed, no plaintext secrets).

**Validación:**
- Push del primer commit a una branch `bootstrap`, abrir PR → CI dispara → workflow `ci.yml` queda verde.

**Escalar en:**
- Secrets no encontrados en el runner (verificar §4.5).
- Permisos del token insuficientes.

---

#### Task 10 — Docker compose para servicios locales

**Archivos:**
- `docker-compose.dev.yml`:
  - `mailpit` service en puerto 1025 (SMTP) / 8025 (Web UI)
  - Sin servicios duplicados de Supabase (eso lo gestiona `supabase start`)
- `scripts/dev.sh`: script bash que arranca docker compose, supabase, y ejecuta concurrently next dev + supabase functions serve.
- `scripts/dev-bootstrap.sh`: lee `.env.bootstrap` y popula `.env.local` para **dev local** (sólo requiere los valores `MS_*`; nada de Supabase cloud / Vercel). Idempotente.
- `scripts/bootstrap-prod.sh`: lee `.env.bootstrap` y popula `infra/envs/prod.tfvars` para el **deploy cloud de prod** (requiere las credenciales cloud). Idempotente. (`.ps1` equivalentes para Windows.)
- `scripts/teardown.sh`: `supabase stop` + `docker compose -f docker-compose.dev.yml down -v`.

**Validación:**
- `bash scripts/dev.sh` arranca todo en una terminal limpia.
- http://localhost:8025 muestra UI de Mailpit.
- http://localhost:3000 muestra la app.
- http://localhost:54323 muestra Supabase Studio.

---

#### Task 11 — Makefile

**Archivo:** `Makefile` con targets:

```makefile
.PHONY: help bootstrap dev dev-stop test test-e2e lint typecheck build \
        db-reset db-migration db-diff fns-serve tunnel clean

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN{FS=":.*?## "}{printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

bootstrap:  ## Bootstrap dev LOCAL (.env.local) desde .env.bootstrap — sólo requiere MS_*
	@bash scripts/dev-bootstrap.sh

bootstrap-prod:  ## Genera infra/envs/prod.tfvars desde .env.bootstrap — requiere creds cloud
	@bash scripts/bootstrap-prod.sh

dev:  ## Arranca todo el stack local
	@bash scripts/dev.sh

dev-stop:  ## Para todo el stack local
	@bash scripts/teardown.sh

test:  ## Ejecuta tests unitarios
	@pnpm test

test-e2e:  ## Ejecuta tests E2E
	@pnpm test:e2e

lint:  ## Lint
	@pnpm lint

typecheck:  ## Typecheck
	@pnpm typecheck

build:  ## Build de producción
	@pnpm build

db-reset:  ## Reset de la BD local (destruye datos)
	@supabase db reset

db-migration:  ## Crea nueva migración (usar: make db-migration name=add_contacts)
	@supabase migration new $(name)

db-diff:  ## Diff entre BD local y migrations
	@supabase db diff

fns-serve:  ## Sirve edge functions localmente
	@supabase functions serve --env-file .env.local

tunnel:  ## Abre túnel para webhooks (configurar OUTREACH_DEV_TUNNEL_URL primero)
	@ngrok http --domain=$(OUTREACH_DEV_TUNNEL_URL) 54321

clean:  ## Limpia node_modules y caches
	@rm -rf node_modules .next .turbo coverage playwright-report
```

**Validación:** `make help` muestra los targets formateados.

---

#### Task 12 — Documentación

**Archivos:**
- `README.md` que incluya:
  - One-liner: qué es esto
  - Quick start: `git clone` → `make bootstrap` → `make dev`
  - Stack overview con links a docs detallados
  - Estructura del repo
  - Cómo contribuir (PR template, conventional commits)
- `docs/development.md`:
  - Cuatro escenarios: primera vez / UI only / dialler con Telnyx real / email con Graph dev tenant
  - Comandos canónicos para cada uno
  - Troubleshooting común
- `docs/architecture.md`:
  - Diagrama ASCII del stack
  - Decisiones cerradas con su justificación (versión corta de §2)
- `docs/deployment.md`:
  - Pre-flight checklist (versión corta de §4)
  - Cómo se deploya (CI/CD)
  - Cómo rotar secretos
- `.env.example`: template commiteado con TODAS las env vars que la app espera, con valores placeholder.
- `CONTRIBUTING.md`: convenciones (TypeScript strict, conventional commits, branch naming).

**Validación:** un developer nuevo puede clonar, leer README, ejecutar quick start y llegar a `make dev` funcionando en <30 minutos.

---

### 5.5 Validación end-to-end de Phase 0

Antes de declarar Phase 0 completa, ejecutar:

1. [ ] `git status` limpio (todo commiteado).
2. [ ] `make clean && make bootstrap && make dev` arranca sin errores desde cero.
3. [ ] `make typecheck` 0 errores.
4. [ ] `make lint` 0 errores.
5. [ ] `make test` y `make test-e2e` todos verdes.
6. [ ] OAuth flow contra sandbox tenant funciona end-to-end (validación manual descrita en Task 6).
7. [ ] PR con un cambio cosmético (e.g. typo en README) abre → CI verde. (No hay preview deploys por diseño; el deploy de producción ocurre al mergear a `main`.)
8. [ ] Merge del PR a main → CI verde → Vercel production deploy → URL prod accesible.
9. [ ] `terraform -chdir=infra plan -var-file=envs/prod.tfvars` → "No changes" (idempotencia).
10. [ ] Supabase Studio (prod) muestra el primer user creado tras OAuth login en preview.

### 5.6 Escalar en (resumen consolidado)

Detener ejecución y reportar a Mike si:

- Alguna cuenta o credencial de §4 no existe o es inválida.
- Microsoft devuelve error de consent o redirect URI mismatch.
- Docker no está disponible.
- Algún puerto está ocupado (54321, 54322, 54323, 1025, 8025, 3000).
- Terraform plan muestra cambios destructivos no esperados.
- CI falla por motivos no relacionados con el código (e.g., GitHub Actions secrets faltantes).
- Un task pide una decisión de producto que no está cerrada en este spec.
- Una librería o tool no se puede instalar por motivos de versión incompatible (e.g., Node 22 vs 20).

**No escalar** por: warnings de ESLint, advertencias de deprecación, fallos transitorios de red (reintentar 3x), conflictos de pnpm-lock (regenerar).

### 5.7 Outputs esperados al final de Phase 0

- ~40–60 archivos commiteados.
- Una rama `main` con CI verde.
- Un Vercel deployment de producción funcional (URL accesible, OAuth login operativo).
- Un proyecto Supabase dev con las tablas `organizations` y `users`, RLS aplicada, el trigger `on_auth_user_created` funcionando.
- Un proyecto Supabase prod en el mismo estado (vía CI auto-migrate).
- Terraform state inicial guardado localmente (migración a remote backend en Phase 7).
- `docs/development.md` actualizado.

---

## 6. Después de Phase 0

Cada fase posterior tendrá su propio spec ejecutable siguiendo este mismo formato. Mike revisa el output de Phase N, da el OK, y se lanza Claude Code con el spec de Phase N+1. El spec de Phase 1 se preparará cuando Phase 0 esté validada — porque dependerá ligeramente de decisiones que se cierran al ver el código real, como nombres exactos de tablas o convención de naming de Server Actions.

Estimación gross para alcanzar Phase 7 (producto multi-usuario productivo): 8–10 semanas de trabajo a tiempo completo, o 14–18 semanas a media jornada con interrupciones.

---

## 7. Apéndices

### 7.1 Convenciones del repo

- **Branch model:** trunk-based. `main` es production. Branches feature cortas (`feat/X`, `fix/Y`, `chore/Z`). Merge vía squash.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `infra:`).
- **TypeScript:** strict mode, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Errores son errores, no se ignoran con `@ts-ignore` (use `@ts-expect-error` con explicación si imprescindible).
- **Imports:** alias `@/*` para todo dentro del repo. Sin imports relativos profundos (`../../../`).
- **Server vs Client:** sigue las convenciones de Next.js App Router. `'use client'` sólo cuando estrictamente necesario.

### 7.2 Por qué cada decisión del stack

| Decisión | Por qué |
|---|---|
| Next.js App Router | Server Components reducen JS al cliente; Server Actions evitan API routes innecesarias |
| Supabase | Postgres + Auth + Realtime + RLS + Vault en un único plano; multi-tenancy "casi gratis" |
| pnpm | Más rápido y eficiente en disco que npm/yarn; lockfile más predecible |
| Vitest | Compatible con la sintaxis de Jest pero mucho más rápido; integración nativa con Vite ecosystem |
| Playwright | E2E más fiable que Cypress en CI; soporte multi-browser |
| Terraform | IaC de facto, providers maduros para todos los servicios usados |
| Microsoft OAuth como auth principal | Si vamos a registrar la app de todas formas para Mail, reutilizamos el flow para login |
| EmailDriver abstraction | Permite iterar la UI sin tocar Graph durante semanas; testing trivial; switching de proveedor futuro sin refactor |

### 7.3 Costes operativos estimados (recordatorio)

| Componente | Coste/mes |
|---|---|
| Vercel Pro (1 seat) | $20 |
| Supabase Pro (PITR, branching) | $25 |
| Telnyx (calls + AMD + numbers UK) | ~£15–30 |
| Microsoft Graph API | $0 (incluido en licencias E5/E1 de los usuarios) |
| Sentry Team (Phase 7) | $26 |
| Sandbox E5 (dev) | $0 (ya tienes) |
| DNS (gestionado manualmente) | $0 |
| Terraform state local | $0 |
| **Total Phase 0–6** | **~$60–80/mes** |
| **Total Phase 7+** | **~$95–120/mes** |

---

**Fin del plan v1.0.**

Cualquier modificación que se haga durante la ejecución de Phase 0 que afecte a fases posteriores se documenta como ADR (Architecture Decision Record) en `docs/adr/NNN-titulo.md`.
