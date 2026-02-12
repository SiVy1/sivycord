-- Script do nadania uprawnień administratora użytkownikowi
-- 
-- INSTRUKCJA:
-- 1. Znajdź swoje user_id w tabeli users
-- 2. Zamień 'TWOJE_USER_ID' poniżej na właściwe ID
-- 3. Uruchom ten skrypt na bazie danych sivycord.db

-- Krok 1: Znajdź swoje user_id (odkomentuj i uruchom)
-- SELECT id, username, display_name FROM users;

-- Krok 2: Przypisz rolę admin (zamień 'TWOJE_USER_ID' na właściwe ID)
INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_at)
VALUES ('4d45c20b-c4e3-4d40-9cf6-5c14a9601d06', 'admin-role', datetime('now'));

-- Sprawdź czy się udało
-- SELECT u.username, r.name, r.permissions 
-- FROM users u 
-- INNER JOIN user_roles ur ON u.id = ur.user_id 
-- INNER JOIN roles r ON ur.role_id = r.id 
-- WHERE u.id = 'TWOJE_USER_ID';
