# Sivycord - Prosty skrypt do nadania uprawnień administratora
# Ten skrypt pokazuje komendy do ręcznego wykonania

Write-Host @"
=================================================================
    SIVYCORD - JAK ZOSTAĆ ADMINEM NA SERWERZE
=================================================================

Masz kilka opcji:

OPCJA 1: Używając SQLite (najprostsze)
---------------------------------------
1. Zainstaluj SQLite Browser (DB Browser for SQLite):
   https://sqlitebrowser.org/dl/

2. Otwórz plik: server\sivycord.db

3. Przejdź do zakładki "Execute SQL"

4. Wykonaj następujące zapytania:

   -- Znajdź swoje user_id
   SELECT id, username, display_name FROM users;

   -- Przypisz rolę admin (zamień YOUR_USER_ID)
   INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_at)
   VALUES ('YOUR_USER_ID', 'admin-role', datetime('now'));

   -- Sprawdź czy się udało
   SELECT u.username, r.name, r.permissions 
   FROM users u 
   INNER JOIN user_roles ur ON u.id = ur.user_id 
   INNER JOIN roles r ON ur.role_id = r.id 
   WHERE u.id = 'YOUR_USER_ID';


OPCJA 2: Z linii poleceń (wymaga sqlite3)
------------------------------------------
1. Zainstaluj SQLite CLI:
   Pobierz z: https://www.sqlite.org/download.html
   Lub: choco install sqlite (z Chocolatey)

2. Uruchom komendy:
   
   cd server
   sqlite3 sivycord.db
   
   -- W sqlite3 prompt:
   SELECT id, username FROM users;
   INSERT OR REPLACE INTO user_roles VALUES ('YOUR_USER_ID', 'admin-role', datetime('now'));
   .quit


OPCJA 3: Automatyczny skrypt PowerShell
----------------------------------------
Jeśli masz zainstalowane sqlite3, uruchom:
   
   .\make_admin.ps1


UPRAWNIENIA ADMINISTRATORA
--------------------------
Rola 'admin-role' daje następujące uprawnienia:
- ADMINISTRATOR (bit 1073741824) - pełny dostęp do wszystkiego
- Zarządzanie kanałami, rolami, użytkownikami
- Moderacja wiadomości
- Wszystkie uprawnienia głosowe
- Zarządzanie serwerem

Po przypisaniu roli, zrestartuj aplikację!

=================================================================
"@

Write-Host ""
Write-Host "Naciśnij dowolny klawisz aby zakończyć..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
