//go:build windows

package main

import (
	"encoding/json"
	"errors"
	"log"
	"runtime"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

// WebView2 must be driven from the OS thread that created it.
func init() { runtime.LockOSThread() }

func runGUI(env Env, lg *log.Logger, logPath string) error {
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: "Legolas+ Curves — Installation", Width: 580, Height: 560, IconId: 2, Center: true,
		},
	})
	if w == nil {
		return errors.New("WebView2 (Microsoft Edge) est introuvable")
	}
	defer w.Destroy()
	w.SetSize(580, 560, webview2.HintFixed)

	send := func(event string, payload any) {
		b, _ := json.Marshal(payload)
		js := "window.__lg && window.__lg.on(" + string(mustJSON(event)) + "," + string(b) + ")"
		w.Dispatch(func() { w.Eval(js) })
	}
	app, err := NewApp(env, pluginCCX, lg, send)
	if err != nil {
		return err
	}
	// Bound functions run on the UI thread: long work goes to a goroutine and reports through send().
	_ = w.Bind("lg_info", func() Info { i := app.Info(version); return i })
	_ = w.Bind("lg_log_path", func() string { return logPath })
	_ = w.Bind("lg_install", func() { go app.Do("install") })
	_ = w.Bind("lg_uninstall", func() { go app.Do("uninstall") })
	_ = w.Bind("lg_close", func() { w.Terminate() })
	w.SetHtml(uiHTML)
	w.Run()
	return nil
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

// ---- last-resort UI when WebView2 is missing: plain Windows message boxes.

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

const (
	mbYesNo, mbIconInfo, mbIconError, idYes = 0x4, 0x40, 0x10, 6
)

func msgBox(title, text string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(title)
	x, _ := syscall.UTF16PtrFromString(text)
	r, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(x)), uintptr(unsafe.Pointer(t)), flags)
	return int(r)
}

func showMessage(title, text string) { msgBox(title, text, mbIconInfo) }

func runFallback(env Env, lg *log.Logger, logPath string, cause error) {
	app, err := NewApp(env, pluginCCX, lg, nil)
	if err != nil {
		msgBox("Legolas+ Curves", "Paquet corrompu : "+err.Error(), mbIconError)
		return
	}
	if msgBox("Legolas+ Curves "+version, "Installer Legolas+ Curves "+app.meta.Version+" pour Premiere Pro ?\n\n(Interface graphique indisponible : "+cause.Error()+")", mbYesNo|mbIconInfo) != idYes {
		return
	}
	d := app.Do("install")
	if d.OK {
		msgBox("Legolas+ Curves", "Installé.\nRedémarrez Premiere Pro, puis : Fenêtre > Plug-ins UXP > Legolas+ Curves.", mbIconInfo)
	} else {
		msgBox("Legolas+ Curves", "Échec de l'installation :\n"+d.Error+"\n\nJournal : "+logPath, mbIconError)
	}
}
