# 🛡️ Sivycord - Przewodnik Funkcji Administratora

Gratulacje! Masz rolę **Admin** w Sivycord! 🎉

Ten przewodnik pokazuje wszystko, co możesz robić jako administrator.

---

## 📊 Twoje Uprawnienia jako Admin

Jako administrator posiadasz uprawnienie **ADMINISTRATOR** (bit `1073741824`), które daje Ci:

✅ **Pełny dostęp do wszystkich funkcji**  
✅ **Pomija wszystkie sprawdzenia uprawnień**  
✅ **Nie można Cię zbanować ani wyrzucić**  
✅ **Widzisz wszystko i możesz wszystko edytować**

---

## 🎯 Co Możesz Zrobić Teraz?

### 1. 🎭 **Zarządzanie Rolami**

#### Dostępne API Endpointy:

**📋 Lista wszystkich ról:**

```bash
GET http://localhost:3001/api/roles
```

**➕ Tworzenie nowej roli:**

```bash
POST http://localhost:3001/api/roles
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "VIP",
  "color": "#FFD700",
  "permissions": 66560
}
```

**✏️ Edytowanie roli:**

```bash
PUT http://localhost:3001/api/roles/{role_id}
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "Super VIP",
  "color": "#FF69B4",
  "position": 40,
  "permissions": 523263
}
```

**🗑️ Usuwanie roli:**

```bash
DELETE http://localhost:3001/api/roles/{role_id}
Authorization: Bearer YOUR_JWT_TOKEN
```

⚠️ **Uwaga:** Nie możesz usunąć ról domyślnych: `admin-role`, `moderator-role`, `member-role`

**👤 Przypisanie roli użytkownikowi:**

```bash
POST http://localhost:3001/api/roles/assign
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "user_id": "USER_UUID",
  "role_id": "moderator-role"
}
```

**❌ Usunięcie roli użytkownikowi:**

```bash
DELETE http://localhost:3001/api/users/{user_id}/roles/{role_id}
Authorization: Bearer YOUR_JWT_TOKEN
```

**📝 Sprawdzenie ról użytkownika:**

```bash
GET http://localhost:3001/api/users/{user_id}/roles
```

---

### 2. 📺 **Zarządzanie Kanałami**

#### Dostępne API Endpointy:

**📋 Lista kanałów:**

```bash
GET http://localhost:3001/api/channels
```

**➕ Tworzenie kanału (tekstowego lub głosowego):**

```bash
POST http://localhost:3001/api/channels
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "vip-lounge",
  "description": "Kanał VIP",
  "channel_type": "text"
}
```

Możliwe `channel_type`:

- `"text"` - kanał tekstowy
- `"voice"` - kanał głosowy

**✏️ Edytowanie kanału:**

```bash
PUT http://localhost:3001/api/channels/{channel_id}
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "super-vip",
  "description": "Nowy opis"
}
```

**🗑️ Usuwanie kanału:**

```bash
DELETE http://localhost:3001/api/channels/{channel_id}
Authorization: Bearer YOUR_JWT_TOKEN
```

---

### 3. 💬 **Moderacja Wiadomości**

**📨 Wyświetlanie wiadomości:**

```bash
GET http://localhost:3001/api/channels/{channel_id}/messages?limit=50&before={message_id}
```

**🗑️ Usuwanie wiadomości (jako admin możesz usuwać wszystkie):**

```bash
DELETE http://localhost:3001/api/messages/{message_id}
Authorization: Bearer YOUR_JWT_TOKEN
```

**✏️ Edytowanie wiadomości (tylko własne, ale jako admin możesz przejąć):**

```bash
PUT http://localhost:3001/api/messages/{message_id}
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "content": "Edytowana wiadomość"
}
```

---

### 4. 😀 **Zarządzanie Emoji**

**📋 Lista emoji:**

```bash
GET http://localhost:3001/api/emoji
```

**➕ Dodawanie custom emoji:**

```bash
POST http://localhost:3001/api/emoji
Content-Type: multipart/form-data
Authorization: Bearer YOUR_JWT_TOKEN

file: [PLIK_OBRAZU]
name: emoji_name
```

**🗑️ Usuwanie emoji:**

```bash
DELETE http://localhost:3001/api/emoji/{emoji_id}
Authorization: Bearer YOUR_JWT_TOKEN
```

---

### 5. 🎫 **Zarządzanie Zaproszeniami**

**➕ Tworzenie zaproszenia:**

```bash
POST http://localhost:3001/api/invites
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "expires_in_seconds": 86400,
  "max_uses": 10
}
```

**📋 Lista zaproszeń (wymaga implementacji - obecnie brak endpointu):**

- To jest dobry kandydat do dodania!

---

### 6. ⚙️ **Zarządzanie Serwerem**

**📊 Informacje o serwerze:**

```bash
GET http://localhost:3001/api/server
```

**✏️ Edytowanie ustawień serwera:**

```bash
PUT http://localhost:3001/api/server
Content-Type: application/json
Authorization: Bearer YOUR_JWT_TOKEN

{
  "name": "Nowa Nazwa Serwera",
  "description": "Nowy opis",
  "icon_url": "http://example.com/icon.png"
}
```

---

## 🔢 System Uprawnień - Wartości Bitów

Każde uprawnienie to potęga dwójki. Możesz je łączyć dodając wartości:

### **Ogólne Uprawnienia:**

```
VIEW_CHANNELS      = 1       (bit 0)
MANAGE_CHANNELS    = 2       (bit 1)
MANAGE_ROLES       = 4       (bit 2)
MANAGE_EMOJIS      = 8       (bit 3)
VIEW_AUDIT_LOG     = 16      (bit 4)
MANAGE_SERVER      = 32      (bit 5)
CREATE_INVITE      = 64      (bit 6)
KICK_MEMBERS       = 128     (bit 7)
BAN_MEMBERS        = 256     (bit 8)
```

### **Kanały Tekstowe:**

```
SEND_MESSAGES      = 512     (bit 9)
SEND_FILES         = 1024    (bit 10)
EMBED_LINKS        = 2048    (bit 11)
ADD_REACTIONS      = 4096    (bit 12)
USE_EMOJIS         = 8192    (bit 13)
MANAGE_MESSAGES    = 16384   (bit 14)
READ_HISTORY       = 32768   (bit 15)
MENTION_EVERYONE   = 65536   (bit 16)
```

### **Kanały Głosowe:**

```
CONNECT            = 131072  (bit 17)
SPEAK              = 262144  (bit 18)
VIDEO              = 524288  (bit 19)
MUTE_MEMBERS       = 1048576 (bit 20)
DEAFEN_MEMBERS     = 2097152 (bit 21)
MOVE_MEMBERS       = 4194304 (bit 22)
USE_VOICE_ACTIVITY = 8388608 (bit 23)
PRIORITY_SPEAKER   = 16777216 (bit 24)
```

### **Specjalne:**

```
ADMINISTRATOR      = 1073741824 (bit 30) ⭐ TY MASZ TO!
```

---

## 🧮 Przykłady Kombinacji Uprawnień

### **VIP User (podstawowe + dodatkowe):**

```
VIEW_CHANNELS + SEND_MESSAGES + CREATE_INVITE + PRIORITY_SPEAKER
= 1 + 512 + 64 + 16777216
= 16777793
```

### **Moderator (jak domyślna rola):**

```
523263
= VIEW_CHANNELS + MANAGE_CHANNELS + CREATE_INVITE + KICK_MEMBERS
  + SEND_MESSAGES + SEND_FILES + EMBED_LINKS + ADD_REACTIONS
  + USE_EMOJIS + MANAGE_MESSAGES + READ_HISTORY
  + CONNECT + SPEAK + VIDEO + MUTE_MEMBERS + USE_VOICE_ACTIVITY
```

### **Member (jak domyślna rola):**

```
66560
= VIEW_CHANNELS + CREATE_INVITE + SEND_MESSAGES + SEND_FILES
  + EMBED_LINKS + ADD_REACTIONS + USE_EMOJIS + READ_HISTORY
  + CONNECT + SPEAK + VIDEO + USE_VOICE_ACTIVITY
```

---

## 🛠️ Narzędzia i Skrypty

### **1. Kalkulator Uprawnień (PowerShell):**

Stwórz plik `calculate_permissions.ps1`:

```powershell
# Sivycord Permission Calculator

$permissions = @{
    "VIEW_CHANNELS"      = 1
    "MANAGE_CHANNELS"    = 2
    "MANAGE_ROLES"       = 4
    "MANAGE_EMOJIS"      = 8
    "VIEW_AUDIT_LOG"     = 16
    "MANAGE_SERVER"      = 32
    "CREATE_INVITE"      = 64
    "KICK_MEMBERS"       = 128
    "BAN_MEMBERS"        = 256
    "SEND_MESSAGES"      = 512
    "SEND_FILES"         = 1024
    "EMBED_LINKS"        = 2048
    "ADD_REACTIONS"      = 4096
    "USE_EMOJIS"         = 8192
    "MANAGE_MESSAGES"    = 16384
    "READ_HISTORY"       = 32768
    "MENTION_EVERYONE"   = 65536
    "CONNECT"            = 131072
    "SPEAK"              = 262144
    "VIDEO"              = 524288
    "MUTE_MEMBERS"       = 1048576
    "DEAFEN_MEMBERS"     = 2097152
    "MOVE_MEMBERS"       = 4194304
    "USE_VOICE_ACTIVITY" = 8388608
    "PRIORITY_SPEAKER"   = 16777216
    "ADMINISTRATOR"      = 1073741824
}

Write-Host "=== Sivycord Permission Calculator ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Available permissions:" -ForegroundColor Yellow
foreach ($perm in $permissions.Keys | Sort-Object) {
    Write-Host "  - $perm" -ForegroundColor White
}

Write-Host ""
Write-Host "Enter permissions separated by commas:" -ForegroundColor Green
$input = Read-Host

$total = 0
$selected = $input -split "," | ForEach-Object { $_.Trim() }

foreach ($perm in $selected) {
    if ($permissions.ContainsKey($perm)) {
        $total += $permissions[$perm]
        Write-Host "  ✓ $perm ($($permissions[$perm]))" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Unknown: $perm" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Total permission value: $total" -ForegroundColor Cyan
Write-Host ""
```

**Użycie:**

```powershell
.\calculate_permissions.ps1
# Wpisz: VIEW_CHANNELS, SEND_MESSAGES, CONNECT, SPEAK
# Wynik: 131585
```

---

### **2. Lista Użytkowników z Rolami:**

```sql
-- W DB Browser lub sqlite3
SELECT
    u.id,
    u.username,
    u.display_name,
    GROUP_CONCAT(r.name, ', ') as roles,
    MAX(r.permissions) as highest_permissions
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
GROUP BY u.id
ORDER BY highest_permissions DESC;
```

---

## 🎨 Tworzenie Custom Ról - Przykłady

### **1. Rola "DJ" (kontrola muzyki):**

```bash
POST http://localhost:3001/api/roles
{
  "name": "DJ",
  "color": "#9B59B6",
  "permissions": 9175041
}
# VIEW_CHANNELS + CONNECT + SPEAK + VIDEO + PRIORITY_SPEAKER + USE_VOICE_ACTIVITY
```

### **2. Rola "Content Creator" (upload plików):**

```bash
POST http://localhost:3001/api/roles
{
  "name": "Content Creator",
  "color": "#E91E63",
  "permissions": 37377
}
# VIEW_CHANNELS + SEND_MESSAGES + SEND_FILES + EMBED_LINKS + ADD_REACTIONS + USE_EMOJIS + READ_HISTORY
```

### **3. Rola "Support" (moderacja bez kicka):**

```bash
POST http://localhost:3001/api/roles
{
  "name": "Support",
  "color": "#3498DB",
  "permissions": 1613315
}
# VIEW_CHANNELS + MANAGE_MESSAGES + MUTE_MEMBERS + CONNECT + SPEAK + wszystkie tekstowe
```

---

## 🔐 Bezpieczeństwo i Best Practices

### ✅ **DO:**

- Regularnie sprawdzaj listę użytkowników z uprawnieniami admina
- Twórz role z minimalnie potrzebnymi uprawnieniami
- Dokumentuj zmiany w rolach
- Robić backup bazy danych przed dużymi zmianami

### ❌ **DON'T:**

- Nie nadawaj `ADMINISTRATOR` osobom, którym nie ufasz w 100%
- Nie twórz zbyt wielu ról admina (max 2-3 osoby)
- Nie usuwaj domyślnych ról systemowych
- Nie modyfikuj uprawnień w gorączkowy sposób

---

## 🚀 Co Dalej? Sugestie Rozwoju

### **Funkcje do dodania (możesz to zaimplementować!):**

1. **Panel Admina w UI** - Frontend do zarządzania wszystkim
2. **Audit Log** - Historia wszystkich akcji adminów
3. **Ban/Kick System** - Usuwanie użytkowników
4. **Announcement System** - Ogłoszenia na całym serwerze
5. **Permission Overrides** - Uprawnienia per kanał
6. **Webhook System** - Integracje z zewnętrznymi serwisami
7. **Server Statistics** - Dashboard z statystykami
8. **Backup/Restore** - Automatyczne backupy

---

## 📞 Testowanie API

Możesz użyć **Postman**, **Insomnia** lub **curl** do testowania:

### **Przykład z curl:**

```bash
# Pobierz token (logowanie)
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"haslo123"}'

# Użyj tokenu
curl -X GET http://localhost:3001/api/roles \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### **Przykład z PowerShell:**

```powershell
$token = "YOUR_JWT_TOKEN"
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# Lista ról
Invoke-RestMethod -Uri "http://localhost:3001/api/roles" -Headers $headers

# Tworzenie roli
$body = @{
    name = "VIP"
    color = "#FFD700"
    permissions = 66560
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/roles" `
    -Method POST `
    -Headers $headers `
    -Body $body
```

---

## 📚 Dokumentacja Kodu

Szczegóły implementacji:

- **Backend:** `server/src/routes/roles.rs` - system ról
- **Backend:** `server/src/models.rs` - definicje uprawnień
- **Database:** `server/migrations/008_roles_permissions.sql` - struktura
- **Frontend:** `app/src/store.ts` - zarządzanie stanem
- **Frontend:** `app/src/components/` - komponenty UI

---

## 🎉 Podsumowanie

Jako **Administrator** masz pełną kontrolę nad serwerem Sivycord! Możesz:

✅ Zarządzać rolami i uprawnieniami  
✅ Tworzyć i usuwać kanały  
✅ Moderować wiadomości  
✅ Kontrolować emoji i multimedia  
✅ Zarządzać zaproszeniami  
✅ Konfigurować serwer

**Używaj tych uprawnień mądrze i odpowiedzialnie!** 🛡️

---

**Pytania? Problemy?**  
Sprawdź `ADMIN_GUIDE.md` lub zajrzyj do kodu źródłowego!
