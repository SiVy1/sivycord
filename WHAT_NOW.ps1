# Quick Admin Guide - Sivycord

Write-Host @"

╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║                  🛡️  GRATULACJE! JESTEŚ ADMINEM!  🛡️                 ║
║                                                                      ║
║                        Co możesz teraz zrobić?                       ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝

🎯 TWOJE UPRAWNIENIA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Jako Administrator masz uprawnienie ADMINISTRATOR (bit 1073741824), które:

  ✅ Daje pełny dostęp do wszystkich funkcji
  ✅ Pomija wszystkie sprawdzenia uprawnień
  ✅ Nie można Cię zbanować ani wyrzucić
  ✅ Możesz zarządzać wszystkim na serwerze


📚 CO MOŻESZ ZROBIĆ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 🎭 ZARZĄDZANIE ROLAMI
   • Twórz nowe role z custom uprawnieniami
   • Edytuj istniejące role (nazwa, kolor, uprawnienia)
   • Przypisuj role użytkownikom
   • Usuwaj role (oprócz domyślnych)

2. 📺 ZARZĄDZANIE KANAŁAMI
   • Twórz kanały tekstowe i głosowe
   • Edytuj nazwy i opisy kanałów
   • Usuwaj niepotrzebne kanały
   • Organizuj strukturę serwera

3. 💬 MODERACJA WIADOMOŚCI
   • Usuwaj dowolne wiadomości
   • Przeglądaj historię wszystkich kanałów
   • Zarządzaj zawartością tekstową

4. 😀 ZARZĄDZANIE EMOJI
   • Dodawaj custom emoji
   • Usuwaj emoji
   • Organizuj emoji serwera

5. 🎫 ZARZĄDZANIE ZAPROSZENIAMI
   • Twórz zaproszenia z customowymi limitami
   • Kontroluj czas ważności zaproszeń
   • Zarządzaj dostępem do serwera

6. ⚙️ KONFIGURACJA SERWERA
   • Edytuj nazwę i opis serwera
   • Ustaw ikonę serwera
   • Zarządzaj ogólnymi ustawieniami


🛠️ JAK ZACZĄĆ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPCJA 1: Interaktywny Tester (Polecane!)
   .\admin_tester.ps1

OPCJA 2: Pełna Dokumentacja
   Otwórz: ADMIN_FEATURES.md

OPCJA 3: API Documentation
   Wszystkie endpointy API z przykładami w ADMIN_FEATURES.md


📖 SZYBKI START - PRZYKŁADY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Stwórz nową rolę "VIP":
  POST http://localhost:3001/api/roles
  {
    \"name\": \"VIP\",
    \"color\": \"#FFD700\",
    \"permissions\": 66560
  }

Stwórz kanał głosowy "Music":
  POST http://localhost:3001/api/channels
  {
    \"name\": \"music\",
    \"description\": \"Muzyczny lounge\",
    \"channel_type\": \"voice\"
  }

Lista wszystkich ról:
  GET http://localhost:3001/api/roles


🔢 WARTOŚCI UPRAWNIEŃ:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Podstawowe kombinacje:

  • Member (domyślna):       66560
  • Moderator (domyślna):    523263
  • Admin (TY):              2147483647
  • VIP (custom):            16777793
  • DJ (custom):             9175041

Użyj kalkulatora uprawnień: .\admin_tester.ps1 (opcja 12)


🎨 PRZYKŁADY CUSTOM RÓL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. DJ (kontrola głosu + priorytet)
   Permissions: 9175041
   Color: #9B59B6

2. Content Creator (upload + embed)
   Permissions: 37377
   Color: #E91E63

3. Support (moderacja bez kicka)
   Permissions: 1613315
   Color: #3498DB


⚡ SZYBKIE AKCJE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Uruchom interaktywny tester:
  .\admin_tester.ps1

• Zobacz pełną listę funkcji:
  code ADMIN_FEATURES.md

• Sprawdź swoją rolę w bazie:
  cd server
  sqlite3 sivycord.db
  SELECT * FROM user_roles WHERE user_id = 'TWOJE_ID';


🔐 BEZPIECZEŃSTWO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️  WAŻNE:
  • Nie nadawaj ADMINISTRATOR nieznajomym
  • Regularnie sprawdzaj listę użytkowników z uprawnieniami
  • Twórz role z minimalnymi potrzebnymi uprawnieniami
  • Rób backup bazy przed dużymi zmianami


📞 NARZĘDZIA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • admin_tester.ps1         - Interaktywny tester API
  • ADMIN_FEATURES.md        - Pełna dokumentacja
  • ADMIN_GUIDE.md           - Jak zostać adminem
  • make_admin.ps1           - Nadaj komuś rolę admin


🎉 GOTOWY DO DZIAŁANIA!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Masz pełną kontrolę nad serwerem Sivycord!
Używaj swoich mocy mądrze i odpowiedzialnie! 🛡️

Zacznij od uruchomienia:
  .\admin_tester.ps1

"@ -ForegroundColor Cyan

Write-Host ""
Write-Host "Naciśnij dowolny klawisz aby zakończyć..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
