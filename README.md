# Pickale-Tauschbörse

Eine einfache Stickertauschbörse aus reinem HTML/JavaScript mit Supabase als Datenbank. Man braucht keinen Build-Schritt und keinen eigenen Server.

| Datei | Zweck |
|---|---|
| `index.html` / `app.js` | Benutzeransicht: Anmeldung per Code, Sammlung (rot/grün), Doppelte, Namen ändern |
| `share.html` / `share.js` | Öffentliche Ansicht der Doppelten eines Benutzers (ohne das eingeklebte Exemplar) |
| `admin.html` / `admin.js` | Admin: Tauschaktionen, Sticker, Benutzer, Codekarten drucken |
| `common.js`, `style.css` | Gemeinsamer Code und gemeinsames Aussehen |
| `config.js` | Supabase-URL und öffentlicher Schlüssel |
| `supabase/schema.sql` | Tabellen, Sicherheitsregeln und Funktionen |

## Einrichtung (einmalig)

### 1. Supabase-Projekt anlegen
1. Auf <https://supabase.com> registrieren und ein **New project** anlegen. Region am besten *Central EU (Frankfurt)*. Das Datenbank-Passwort sicher aufbewahren, man braucht es hier aber nicht.
2. Links auf **SQL Editor** gehen, den kompletten Inhalt von `supabase/schema.sql` einfügen und auf **Run** klicken.

### 2. Admin-Konto anlegen
1. **Authentication → Users → Add user → Create new user**: E-Mail und Passwort eingeben und „Auto Confirm User“ anhaken.
2. Im **SQL Editor** dieses Konto zum Admin machen:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'deine@email.at';
   ```
3. Empfohlen: unter **Authentication → Sign In / Providers** die Option „Allow new users to sign up“ ausschalten. Fremde Konten hätten zwar ohnehin keine Rechte, aber so entstehen gar keine.

### 3. `config.js` ausfüllen
Unter **Project Settings → API Keys** (bzw. *API*) findet man:
- die **Project URL** → `SUPABASE_URL`
- den **publishable key** (oder den älteren **anon public key**) → `SUPABASE_KEY`

> ⚠️ Niemals den *secret*- oder *service_role*-Schlüssel eintragen! Dieser Schlüssel umgeht alle Sicherheitsregeln.

Der öffentliche Schlüssel darf im Browser stehen. Die Sicherheit kommt aus den Regeln in `schema.sql`.

### 4. Lokal testen
Die Seiten verwenden JavaScript-Module. Deshalb funktionieren sie nicht per Doppelklick (`file://`), sondern brauchen einen kleinen Webserver:
```bash
python3 -m http.server 8000
```
Dann <http://localhost:8000/admin.html> öffnen.

### 5. Veröffentlichen
Es reicht jeder statische Hoster, z.B. **GitHub Pages** (Repo → Settings → Pages), **Netlify** oder **Cloudflare Pages**. Man lädt einfach alle Dateien hoch.

## Bedienung

**Admin** (`admin.html`)
- *Tauschaktionen*: Aktion anlegen und mit „Sticker“ die Sticker eingeben, eine Zeile pro Sticker, z.B. `12 Messi` oder `12;Messi`. `1-200` legt die Nummern 1 bis 200 ohne Namen an. Gibt man eine schon vorhandene Nummer erneut ein, wird ihr Name überschrieben. Nur **aktive** Aktionen sehen die Kinder.
- *Benutzer*: Name eingeben, der Code (z.B. „Tiger Banane 27“) wird automatisch erzeugt. Pro Benutzer gibt es:
  - **Login-Link**: meldet direkt an und eignet sich gut als Lesezeichen am Tablet
  - **Doppelte-Link**: die öffentliche Tauschliste
  - **Neuer Code**: falls ein Code weitergegeben wurde
  - **Codekarten drucken**: druckt alle Codes zum Ausschneiden

**Kinder** (`index.html`)
- Beim Code sind Groß-/Kleinschreibung, Leerzeichen und Bindestriche egal: `tiger banane 27` funktioniert genauso.
- Ein Tipp auf eine Karte schaltet zwischen rot (fehlt) und grün (eingeklebt) um. Mit **+ / −** zählt man die Doppelten.
- Unter „Doppelte“ sieht man die eigene Tauschliste und kann den Link teilen oder die Liste als Text kopieren (z.B. für WhatsApp).
- Mit ✏️ ändert man den Anzeigenamen.

**Tauschliste** (`share.html?t=…`): Jeder mit dem Link sieht die Doppelten (Anzahl minus 1). Ist der Betrachter selbst angemeldet, werden die Sticker **grün markiert, die ihm noch fehlen**.

## Hinweise zur Sicherheit
- Die Codes sind absichtlich einfach (ca. 260.000 Kombinationen). Jeder Fehlversuch wird um 1 Sekunde verzögert. Für eine Kinder-Tauschbörse reicht das, für sensible Daten wäre es zu schwach.
- Es werden nur Anzeigenamen gespeichert. Am besten nur Vornamen oder Spitznamen verwenden.
- Die Codes stehen im Klartext in der Datenbank, damit der Admin sie wieder anzeigen kann.
