package main

import (
	_ "embed"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed payload/plugin.ccx
var pluginCCX []byte

//go:embed ui/index.html
var uiHTML string

// set at build time: -ldflags "-X main.version=1.2.3"
var version = "dev"

func DefaultEnv() Env {
	e := Env{Timeout: 90 * time.Second, Run: defaultRun, WindowsPaths: runtime.GOOS == "windows"}
	if runtime.GOOS == "windows" {
		e.UXPRoot = filepath.Join(os.Getenv("APPDATA"), "Adobe", "UXP")
		if cf := os.Getenv("CommonProgramFiles"); cf != "" {
			e.UPIAPath = filepath.Join(cf, "Adobe", "Adobe Desktop Common", "RemoteComponents", "UPI", "UnifiedPluginInstallerAgent", "UnifiedPluginInstallerAgent.exe")
		}
	} else if dir, err := os.UserConfigDir(); err == nil {
		e.UXPRoot = filepath.Join(dir, "Adobe", "UXP")
	}
	return e
}

func openLog() (*log.Logger, string) {
	path := filepath.Join(os.TempDir(), "LegolasCurves-setup.log")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return log.New(os.Stderr, "", log.LstdFlags), ""
	}
	l := log.New(f, "", log.LstdFlags)
	l.Printf("---- setup %s (%s/%s)", version, runtime.GOOS, runtime.GOARCH)
	return l, path
}

func main() {
	var (
		silent    = flag.Bool("silent", false, "install without a window")
		uninstall = flag.Bool("uninstall", false, "remove the plugin")
		uxpRoot   = flag.String("uxp-root", "", "override the UXP data folder (testing)")
		upia      = flag.String("upia", "", "override the Adobe installer agent path (testing)")
		winPaths  = flag.Bool("windows-paths", false, "use Windows separators in PPRO.json (testing)")
	)
	// accept NSIS-style switches too
	args := make([]string, 0, len(os.Args))
	for _, a := range os.Args[1:] {
		switch strings.ToLower(a) {
		case "/s":
			a = "--silent"
		case "/uninstall":
			a = "--uninstall"
		}
		args = append(args, a)
	}
	_ = flag.CommandLine.Parse(args)

	env := DefaultEnv()
	if *uxpRoot != "" {
		env.UXPRoot = *uxpRoot
		env.UPIAPath = ""
		env.WindowsPaths = *winPaths
	}
	if *upia != "" {
		env.UPIAPath = *upia
	}
	logger, logPath := openLog()

	if *silent || *uninstall {
		app, err := NewApp(env, pluginCCX, logger, nil)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		action := "install"
		if *uninstall {
			action = "uninstall"
		}
		d := app.Do(action)
		if !*silent && runtime.GOOS == "windows" { // --uninstall alone still gets feedback
			showMessage("Legolas+ Curves", map[bool]string{true: "Désinstallation terminée.", false: "Échec : " + d.Error}[d.OK])
		}
		if !d.OK {
			fmt.Fprintln(os.Stderr, d.Error)
			os.Exit(1)
		}
		return
	}

	if err := runGUI(env, logger, logPath); err != nil {
		logger.Printf("GUI unavailable: %v", err)
		runFallback(env, logger, logPath, err)
	}
}
