# Jak zostać administratorem w Sivycord

## Szybki Start

### Opcja 1: GUI (Najprostsza - Polecana)

1. **Zainstaluj DB Browser for SQLite**

   - Pobierz z: https://sqlitebrowser.org/dl/
   - Zainstaluj na swoim komputerze

2. **Otwórz bazę danych**

   - Uruchom DB Browser for SQLite
   - Kliknij "Open Database"
   - Wybierz plik: `server/sivycord.db`

3. **Znajdź swoje User ID**

   - Kliknij zakładkę "Execute SQL"
   - Wykonaj zapytanie:

   ```sql
   SELECT id, username, display_name FROM users;
   ```

   - Skopiuj swoje `id` (UUID)

4. **Przypisz rolę administratora**

   - W tym samym oknie SQL wykonaj:

   ```sql
   INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_at)
   VALUES ('TWOJE_USER_ID', 'admin-role', datetime('now'));
   ```

   - Zamień `TWOJE_USER_ID` na skopiowane ID

5. **Zweryfikuj zmiany**

   ```sql
   SELECT u.username, r.name, r.permissions
   FROM users u
   INNER JOIN user_roles ur ON u.id = ur.user_id
   INNER JOIN roles r ON ur.role_id = r.id;
   ```

6. **Uruchom ponownie aplikację**

---

### Opcja 2: Linia poleceń (SQLite CLI)

1. **Zainstaluj SQLite CLI**

   - Windows: Pobierz z https://www.sqlite.org/download.html
   - Lub użyj Chocolatey: `choco install sqlite`

2. **Otwórz terminal w folderze projektu**

   ```powershell
   cd d:\projects\sivycord\server
   sqlite3 sivycord.db
   ```

3. **W konsoli SQLite:**

   ```sql
   -- Wyświetl użytkowników
   SELECT id, username, display_name FROM users;

   -- Przypisz rolę admin (zamień YOUR_USER_ID)
   INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_at)
   VALUES ('YOUR_USER_ID', 'admin-role', datetime('now'));

   -- Sprawdź
   SELECT * FROM user_roles WHERE user_id = 'YOUR_USER_ID';

   -- Wyjdź
   .quit
   ```

---

### Opcja 3: Automatyczny skrypt PowerShell

1. **Zainstaluj SQLite CLI** (jak wyżej)

2. **Uruchom skrypt:**

   ```powershell
   cd d:\projects\sivycord
   .\make_admin.ps1
   ```

3. **Postępuj zgodnie z instrukcjami na ekranie**

---

### Opcja 4: Ręczna edycja (dla zaawansowanych)

Jeśli znasz dokładnie swoje `user_id`, możesz bezpośrednio dodać wpis do bazy:

```powershell
.\HOW_TO_BECOME_ADMIN.ps1
```

Ten skrypt wyświetli wszystkie dostępne opcje i szczegółowe instrukcje.

---

## Dostępne role w systemie

W bazie danych istnieją 3 domyślne role:

### 1. **Admin** (`admin-role`)

- **Permissions:** `2147483647` (wszystkie uprawnienia + ADMINISTRATOR bit)
- **Kolor:** `#ff5555` (czerwony)
- **Pozycja:** 100 (najwyższa)
- **Uprawnienia:** Pełny dostęp do wszystkiego

### 2. **Moderator** (`moderator-role`)

- **Permissions:** `523263`
- **Kolor:** `#55ff55` (zielony)
- **Pozycja:** 50
- **Uprawnienia:** Zarządzanie kanałami, kickowanie, moderacja wiadomości, głos

### 3. **Member** (`member-role`)

- **Permissions:** `66560`
- **Kolor:** `#5555ff` (niebieski)
- **Pozycja:** 10 (najniższa)
- **Uprawnienia:** Podstawowe - wysyłanie wiadomości, dołączanie do głosu

---

## Szczegóły uprawnień

Uprawnienie `ADMINISTRATOR` (bit 30 = 1073741824) daje:

- Pełny dostęp do wszystkich funkcji
- Pomija wszystkie sprawdzenia uprawnień
- Może zarządzać wszystkimi rolami i użytkownikami
- Pełna kontrola nad serwerem

Inne uprawnienia są sprawdzane indywidualnie jeśli nie masz ADMINISTRATOR.

---

## Rozwiązywanie problemów

### Nie widzę zmian po dodaniu roli

- ✅ Uruchom ponownie serwer (`cd server && cargo run`)
- ✅ Uruchom ponownie aplikację kliencką
- ✅ Wyloguj się i zaloguj ponownie

### Nie mogę znaleźć swojego user_id

```sql
SELECT id, username, display_name, created_at FROM users ORDER BY created_at DESC;
```

Twoje konto powinno być na górze listy.

### Rola nie działa

Sprawdź czy rola jest prawidłowo przypisana:

```sql
SELECT
    u.username,
    r.name as role_name,
    r.permissions,
    ur.assigned_at
FROM users u
INNER JOIN user_roles ur ON u.id = ur.user_id
INNER JOIN roles r ON ur.role_id = r.id
WHERE u.username = 'TWOJA_NAZWA_UŻYTKOWNIKA';
```

---

## Bezpieczeństwo

⚠️ **WAŻNE:**

- Nadawaj uprawnienia administratora tylko zaufanym osobom
- Admin ma pełną kontrolę nad serwerem
- W środowisku produkcyjnym używaj odpowiednich mechanizmów autentykacji
- Regularnie twórz kopie zapasowe bazy danych

---

## Więcej informacji

Szczegóły implementacji systemu uprawnień:

- `server/src/models.rs` - definicje uprawnień (bitflags)
- `server/src/routes/roles.rs` - endpointy API do zarządzania rolami
- `server/migrations/008_roles_permissions.sql` - struktura bazy danych

Maksymalna wartość uprawnień Admin: `2147483647` (2^31 - 1)
