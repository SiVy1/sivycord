# Sivycord Admin API Tester
# Interaktywny skrypt do testowania funkcji administratora

Write-Host @"
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║          🛡️  SIVYCORD ADMIN API TESTER  🛡️                  ║
║                                                              ║
║            Testuj funkcje administratora łatwo!              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

Write-Host ""

# Konfiguracja
$serverHost = "localhost"
$serverPort = "3001"
$baseUrl = "http://${serverHost}:${serverPort}"

Write-Host "🔧 Konfiguracja:" -ForegroundColor Yellow
Write-Host "   Server: $baseUrl" -ForegroundColor White
Write-Host ""

# Funkcja do wysyłania requestów
function Invoke-SivycordAPI {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body = $null,
        [string]$Token = $null
    )
    
    $headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($Token) {
        $headers["Authorization"] = "Bearer $Token"
    }
    
    $params = @{
        Uri = "$baseUrl$Endpoint"
        Method = $Method
        Headers = $headers
    }
    
    if ($Body) {
        $params["Body"] = ($Body | ConvertTo-Json)
    }
    
    try {
        $response = Invoke-RestMethod @params
        return @{
            Success = $true
            Data = $response
        }
    } catch {
        return @{
            Success = $false
            Error = $_.Exception.Message
            StatusCode = $_.Exception.Response.StatusCode.value__
        }
    }
}

# Menu główne
function Show-MainMenu {
    Write-Host ""
    Write-Host "═══════════════════ MENU GŁÓWNE ═══════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1.  📋 Lista wszystkich ról" -ForegroundColor White
    Write-Host "  2.  ➕ Stwórz nową rolę" -ForegroundColor White
    Write-Host "  3.  ✏️  Edytuj rolę" -ForegroundColor White
    Write-Host "  4.  🗑️  Usuń rolę" -ForegroundColor White
    Write-Host "  5.  👤 Przypisz rolę użytkownikowi" -ForegroundColor White
    Write-Host "  6.  ❌ Usuń rolę użytkownikowi" -ForegroundColor White
    Write-Host ""
    Write-Host "  7.  📺 Lista kanałów" -ForegroundColor White
    Write-Host "  8.  ➕ Stwórz kanał" -ForegroundColor White
    Write-Host "  9.  🗑️  Usuń kanał" -ForegroundColor White
    Write-Host ""
    Write-Host "  10. 😀 Lista emoji" -ForegroundColor White
    Write-Host "  11. 📊 Info o serwerze" -ForegroundColor White
    Write-Host "  12. 🧮 Kalkulator uprawnień" -ForegroundColor White
    Write-Host ""
    Write-Host "  0.  🚪 Wyjście" -ForegroundColor Red
    Write-Host ""
    Write-Host "═════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

# 1. Lista ról
function Get-Roles {
    Write-Host ""
    Write-Host "📋 Pobieranie listy ról..." -ForegroundColor Yellow
    
    $result = Invoke-SivycordAPI -Method "GET" -Endpoint "/api/roles"
    
    if ($result.Success) {
        Write-Host "✓ Sukces!" -ForegroundColor Green
        Write-Host ""
        
        foreach ($roleData in $result.Data) {
            $role = $roleData.role
            $count = $roleData.member_count
            
            Write-Host "  🎭 $($role.name)" -ForegroundColor Cyan
            Write-Host "     ID: $($role.id)" -ForegroundColor Gray
            Write-Host "     Kolor: $($role.color)" -ForegroundColor Gray
            Write-Host "     Pozycja: $($role.position)" -ForegroundColor Gray
            Write-Host "     Uprawnienia: $($role.permissions)" -ForegroundColor Gray
            Write-Host "     Członków: $count" -ForegroundColor Gray
            Write-Host ""
        }
    } else {
        Write-Host "✗ Błąd: $($result.Error)" -ForegroundColor Red
    }
}

# 2. Tworzenie roli
function New-Role {
    param([string]$Token)
    
    if (!$Token) {
        Write-Host "⚠️  Potrzebujesz tokenu JWT aby stworzyć rolę" -ForegroundColor Yellow
        $Token = Read-Host "Wpisz token"
    }
    
    Write-Host ""
    Write-Host "➕ Tworzenie nowej roli" -ForegroundColor Yellow
    Write-Host ""
    
    $name = Read-Host "Nazwa roli"
    $color = Read-Host "Kolor (hex, np. #FF5555)"
    $perms = Read-Host "Uprawnienia (liczba, np. 66560)"
    
    $body = @{
        name = $name
        color = $color
        permissions = [int]$perms
    }
    
    $result = Invoke-SivycordAPI -Method "POST" -Endpoint "/api/roles" -Body $body -Token $Token
    
    if ($result.Success) {
        Write-Host ""
        Write-Host "✓ Rola utworzona!" -ForegroundColor Green
        Write-Host "   ID: $($result.Data.id)" -ForegroundColor Gray
    } else {
        Write-Host ""
        Write-Host "✗ Błąd: $($result.Error)" -ForegroundColor Red
    }
}

# 7. Lista kanałów
function Get-Channels {
    Write-Host ""
    Write-Host "📺 Pobieranie listy kanałów..." -ForegroundColor Yellow
    
    $result = Invoke-SivycordAPI -Method "GET" -Endpoint "/api/channels"
    
    if ($result.Success) {
        Write-Host "✓ Sukces!" -ForegroundColor Green
        Write-Host ""
        
        foreach ($channel in $result.Data) {
            $icon = if ($channel.channel_type -eq "voice") { "🔊" } else { "💬" }
            Write-Host "  $icon $($channel.name)" -ForegroundColor Cyan
            Write-Host "     ID: $($channel.id)" -ForegroundColor Gray
            Write-Host "     Typ: $($channel.channel_type)" -ForegroundColor Gray
            if ($channel.description) {
                Write-Host "     Opis: $($channel.description)" -ForegroundColor Gray
            }
            Write-Host ""
        }
    } else {
        Write-Host "✗ Błąd: $($result.Error)" -ForegroundColor Red
    }
}

# 8. Tworzenie kanału
function New-Channel {
    param([string]$Token)
    
    if (!$Token) {
        Write-Host "⚠️  Potrzebujesz tokenu JWT aby stworzyć kanał" -ForegroundColor Yellow
        $Token = Read-Host "Wpisz token"
    }
    
    Write-Host ""
    Write-Host "➕ Tworzenie nowego kanału" -ForegroundColor Yellow
    Write-Host ""
    
    $name = Read-Host "Nazwa kanału"
    $desc = Read-Host "Opis (opcjonalnie)"
    $type = Read-Host "Typ (text/voice)"
    
    $body = @{
        name = $name
        description = $desc
        channel_type = $type
    }
    
    $result = Invoke-SivycordAPI -Method "POST" -Endpoint "/api/channels" -Body $body -Token $Token
    
    if ($result.Success) {
        Write-Host ""
        Write-Host "✓ Kanał utworzony!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "✗ Błąd: $($result.Error)" -ForegroundColor Red
    }
}

# 11. Info serwera
function Get-ServerInfo {
    Write-Host ""
    Write-Host "📊 Pobieranie informacji o serwerze..." -ForegroundColor Yellow
    
    $result = Invoke-SivycordAPI -Method "GET" -Endpoint "/api/server"
    
    if ($result.Success) {
        Write-Host "✓ Sukces!" -ForegroundColor Green
        Write-Host ""
        Write-Host "  🖥️  Nazwa: $($result.Data.name)" -ForegroundColor Cyan
        Write-Host "     Opis: $($result.Data.description)" -ForegroundColor Gray
        if ($result.Data.icon_url) {
            Write-Host "     Ikona: $($result.Data.icon_url)" -ForegroundColor Gray
        }
        Write-Host ""
    } else {
        Write-Host "✗ Błąd: $($result.Error)" -ForegroundColor Red
    }
}

# 12. Kalkulator uprawnień
function Calculate-Permissions {
    Write-Host ""
    Write-Host "🧮 Kalkulator Uprawnień" -ForegroundColor Yellow
    Write-Host ""
    
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
    
    Write-Host "Dostępne uprawnienia:" -ForegroundColor Cyan
    $permissions.Keys | Sort-Object | ForEach-Object {
        Write-Host "  - $_" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "Wpisz uprawnienia oddzielone przecinkami:" -ForegroundColor Green
    $input = Read-Host
    
    $total = 0
    $selected = $input -split "," | ForEach-Object { $_.Trim() }
    
    Write-Host ""
    Write-Host "Wybrane uprawnienia:" -ForegroundColor Yellow
    foreach ($perm in $selected) {
        if ($permissions.ContainsKey($perm)) {
            $total += $permissions[$perm]
            Write-Host "  ✓ $perm ($($permissions[$perm]))" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Nieznane: $perm" -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host "Wartość do użycia: $total" -ForegroundColor Green
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
    Write-Host ""
}

# Main loop
$token = $null

while ($true) {
    Show-MainMenu
    $choice = Read-Host "Wybierz opcję"
    
    switch ($choice) {
        "1" { Get-Roles }
        "2" { New-Role -Token $token }
        "7" { Get-Channels }
        "8" { New-Channel -Token $token }
        "11" { Get-ServerInfo }
        "12" { Calculate-Permissions }
        "0" { 
            Write-Host ""
            Write-Host "👋 Do zobaczenia!" -ForegroundColor Cyan
            exit 
        }
        default {
            Write-Host ""
            Write-Host "⚠️  Funkcja jeszcze nie zaimplementowana lub nieprawidłowy wybór" -ForegroundColor Yellow
        }
    }
    
    Write-Host ""
    Write-Host "Naciśnij Enter aby kontynuować..." -ForegroundColor Gray
    Read-Host
}
