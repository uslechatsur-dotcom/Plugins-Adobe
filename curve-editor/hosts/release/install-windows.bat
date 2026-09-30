@echo off
rem Legolas+ Curves - installation Windows (double-clic). Copie l extension CEP pour l utilisateur courant.
setlocal
set "SRC=%~dp0extension-CEP\com.legolasplus.curveeditor"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.legolasplus.curveeditor"
if not exist "%SRC%\index.html" (
  echo Dossier extension-CEP introuvable a cote de ce script.
  pause
  exit /b 1
)
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
xcopy /e /i /y "%SRC%" "%DEST%" >nul
rem autorise les extensions non signees (CEP 9 a 12 = Premiere Pro 2019 a 2025)
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo.
echo Installe dans : %DEST%
echo Quittez puis relancez Premiere Pro, puis : Fenetre ^> Extensions ^> Legolas+ Curves
pause
