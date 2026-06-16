@echo off
REM Expo web dev server. The dev CORS proxy (tools/dev-proxy.js, port 8787)
REM must already be running separately so the web bundle can reach
REM stage.api.reolli.com without browser CORS rejecting localhost. Start it
REM with:  node tools\dev-proxy.js   from C:\Dev\Reolli\app.
cd /d C:\Dev\Reolli\app
npx expo start --web --port %PORT%
