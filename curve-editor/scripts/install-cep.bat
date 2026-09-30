@echo off
rem Installs the CEP build for the current user (Windows) and enables unsigned extensions.
setlocal
set "HERE=%~dp0.."
if not exist "%HERE%\dist\cep" ( pushd "%HERE%" & node scripts\build.js & popd )
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.legolasplus.curveeditor"
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
xcopy /e /i /y "%HERE%\dist\cep" "%DEST%" >nul
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
echo Installed to: %DEST%
echo Restart Premiere Pro, then: Window ^> Extensions ^> Legolas+ Curves
