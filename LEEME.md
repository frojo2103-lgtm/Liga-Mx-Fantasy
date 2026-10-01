# Fantasy Liga MX — cómo publicarla

Tu liga fantasy funciona como app propia, sin depender de Claude:

- **Supabase** guarda los datos y maneja el inicio de sesión con Google. Todas las ventas, pujas y cláusulas se validan en el servidor.
- **Vercel** publica la página en internet.
- Todo es **gratis** y no pide tarjeta.

Súbelo en este orden y tarda unos **30–40 minutos**, casi todo copiar y pegar.

---

## 1. Crear la base de datos (Supabase)

1. Entra a **https://supabase.com** → **Start your project** → inicia sesión con **GitHub**.
2. **New project**:
   - Name: `fantasy-ligamx`
   - Database password: inventa una y guárdala (casi no la vas a usar).
   - Region: la más cercana (por ejemplo *East US* o *West US*).
   - Clic en **Create new project** y espera unos 2 minutos.
3. En el menú izquierdo abre **SQL Editor** → **New query**.
4. Abre el archivo **`supabase/schema.sql`** de esta carpeta, copia **todo**, pégalo y pulsa **Run**. Debe decir *Success*.

## 2. Activar "Entrar con Google"

1. En Supabase: **Authentication → Sign In / Providers → Google**. Deja esa pestaña abierta y copia la **Callback URL** que aparece. Termina en `/auth/v1/callback`.
2. En otra pestaña entra a **https://console.cloud.google.com** con tu cuenta de Google.
3. Arriba: **Select a project → New project** → nombre `Fantasy Liga MX` → **Create**.
4. Menú **APIs & Services → OAuth consent screen**:
   - Configúrala como **External**.
   - App name: `Fantasy Liga MX`
   - Support email y developer email: tu correo.
   - Guarda.
   - Después, en **Audience** (o *Publishing status*), pulsa **Publish app**. Si no la publicas, solo podrían entrar los correos que agregues como *test users*.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URIs** → **Add URI** → pega la Callback URL de Supabase.
   - Clic en **Create** y copia el **Client ID** y el **Client secret**.
6. De vuelta en Supabase (Google provider):
   - Activa **Enable Sign in with Google**.
   - Pega el Client ID y el Client secret.
   - Clic en **Save**.

## 3. Conectar la app con tu base de datos

1. En Supabase: **Project Settings → API** (o *Data API*). Copia:
   - **Project URL** (ejemplo: `https://abcd1234.supabase.co`)
   - **anon public key**, una clave larga que empieza con `eyJ...`. También puede llamarse *Publishable key*.
2. Abre **`config.js`** con cualquier editor de texto (TextEdit sirve) y reemplaza los dos valores:

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...tu-clave...';
```

Esta clave es pública a propósito: la seguridad la ponen las reglas de la base de datos. **Nunca** pongas aquí la clave `service_role`.

## 4. Subir el código a GitHub

1. En **https://github.com** → **New repository** → nombre `fantasy-ligamx` → **Private** → **Create repository**.
2. En la página del repositorio vacío, clic en **uploading an existing file**.
3. Arrastra **todo el contenido** de esta carpeta, incluidas las carpetas `icons`, `seed` y `supabase`, y pulsa **Commit changes**.

## 5. Publicar (Vercel)

1. Entra a **https://vercel.com** → **Sign up** con **GitHub**.
2. **Add New… → Project** → junto a `fantasy-ligamx` pulsa **Import**.
3. En Framework Preset elige **Other**. No cambies nada más y pulsa **Deploy**.
4. Al terminar tendrás tu link, algo como **`https://fantasy-ligamx.vercel.app`**.
5. Regresa a Supabase: **Authentication → URL Configuration**:
   - **Site URL**: pega tu link de Vercel.
   - **Redirect URLs** → **Add URL** → pega el mismo link.
   - Guarda.

## 6. Primer uso (importante: entra tú primero)

1. Abre tu link y pulsa **Entrar con Google**. **La primera persona que entra queda como administrador**, así que entra tú antes de pasar el link.
2. Ve a **Admin → Liga y mercado → Importar jugadores y fotos**. Carga los 463 jugadores con sus valores y 441 fotos (tarda alrededor de un minuto).
3. Ve a **Mi equipo**, ponle nombre a tu equipo y entra a la liga.
4. Manda el link a tus amigos. Cuando entren con Google, te aparecen en **Admin → Solicitudes** para que los apruebes.

## 7. Instalarla como app en el celular

- **iPhone:** abre el link en **Safari** → botón **Compartir** → **Agregar a pantalla de inicio**.
- **Android:** abre el link en **Chrome** → menú **⋮** → **Instalar app** (o *Agregar a la pantalla principal*).

Se abre a pantalla completa, con su propio ícono, como cualquier app.

---

## Cambios futuros

Para actualizar la app edita los archivos en GitHub (o súbelos de nuevo). Vercel publica la nueva versión solo, en un minuto.

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | La app |
| `config.js` | Tus claves de Supabase (paso 3) |
| `supabase/schema.sql` | Tablas, reglas de seguridad y lógica del juego (paso 1) |
| `seed/players.json`, `seed/photos.json` | Jugadores, valores y fotos para el botón de importar |
| `manifest.webmanifest`, `sw.js`, `icons/` | Hacen que se pueda instalar como app |
| `vercel.json` | Evita que los celulares se queden con una versión vieja |
