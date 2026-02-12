# Skrypt do automatycznego nadania uprawnień administratora
# Sivycord - Make Admin Script

$dbPath = ".\server\sivycord.db"

Write-Host "=== Sivycord - Nadawanie uprawnień administratora ===" -ForegroundColor Cyan
Write-Host ""

# Sprawdź czy baza danych istnieje
if (!(Test-Path $dbPath)) {
    Write-Host "Błąd: Nie znaleziono bazy danych: $dbPath" -ForegroundColor Red
    Write-Host "Upewnij się, że uruchamiasz skrypt z katalogu głównego projektu." -ForegroundColor Yellow
    exit 1
}

# Sprawdź czy sqlite3 jest dostępny
$sqliteCmd = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (!$sqliteCmd) {
    Write-Host "Błąd: sqlite3 nie jest zainstalowane lub nie jest w PATH" -ForegroundColor Red
    Write-Host "Zainstaluj SQLite z: https://www.sqlite.org/download.html" -ForegroundColor Yellow
    exit 1
}

Write-Host "Krok 1: Lista użytkowników w bazie danych" -ForegroundColor Green
Write-Host ""

# Pokaż użytkowników
$users = sqlite3 $dbPath "SELECT id, username, display_name FROM users;"
if ($users) {
    Write-Host "Znalezieni użytkownicy:" -ForegroundColor Yellow
    $userList = @()
    $index = 1
    foreach ($line in $users -split "`n") {
        if ($line.Trim()) {
            $parts = $line -split "\|"
            Write-Host "  $index. Username: $($parts[1]) | Display Name: $($parts[2]) | ID: $($parts[0])" -ForegroundColor White
            $userList += $parts[0]
            $index++
        }
    }
    Write-Host ""
    
    # Wybór użytkownika
    Write-Host "Wybierz numer użytkownika (1-$($userList.Count)) lub wpisz user_id ręcznie:" -ForegroundColor Cyan
    $choice = Read-Host "Wybór"
    
    $userId = $null
    if ($choice -match '^\d+$' -and [int]$choice -ge 1 -and [int]$choice -le $userList.Count) {
        $userId = $userList[[int]$choice - 1]
    } else {
        $userId = $choice
    }
    
    Write-Host ""
    Write-Host "Krok 2: Przypisywanie roli administratora użytkownikowi: $userId" -ForegroundColor Green
    
    # Przypisz rolę admin
    $query = "INSERT OR REPLACE INTO user_roles (user_id, role_id, assigned_at) VALUES ('$userId', 'admin-role', datetime('now'));"
    sqlite3 $dbPath $query
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Sukces! Użytkownik został adminem!" -ForegroundColor Green
        Write-Host ""
        
        # Sprawdź uprawnienia
        Write-Host "Aktualne role użytkownika:" -ForegroundColor Yellow
        $roles = sqlite3 $dbPath "SELECT r.name, r.permissions FROM user_roles ur INNER JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = '$userId';"
        foreach ($role in $roles -split "`n") {
            if ($role.Trim()) {
                $parts = $role -split "\|"
                Write-Host "  - $($parts[0]) (uprawnienia: $($parts[1]))" -ForegroundColor White
            }
        }
        Write-Host ""
        Write-Host "Administrator ma pełne uprawnienia (1073741824 = ADMINISTRATOR bit)" -ForegroundColor Cyan
        Write-Host "Uruchom ponownie aplikację, aby zmiany zaczęły działać." -ForegroundColor Yellow
    } else {
        Write-Host "✗ Błąd podczas przypisywania roli" -ForegroundColor Red
    }
    
} else {
    Write-Host "Nie znaleziono żadnych użytkowników w bazie danych." -ForegroundColor Yellow
    Write-Host "Najpierw utwórz konto w aplikacji." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Naciśnij dowolny klawisz aby zakończyć..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
