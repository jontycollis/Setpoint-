@echo off
REM Expo web dev server for the FamilyHub app (C:\Dev\familyhub).
cd /d C:\Dev\familyhub
npx expo start --web --port %PORT%
