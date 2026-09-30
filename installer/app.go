package main

import (
	"fmt"
	"log"
	"strings"
	"sync"
)

// App ties the installer core to a UI (or to silent mode). emit() delivers progress to whoever is listening.
type App struct {
	env  Env
	ccx  []byte
	meta Meta
	log  *log.Logger
	emit func(event string, payload any)

	mu   sync.Mutex
	busy bool
}

func NewApp(env Env, ccx []byte, lg *log.Logger, emit func(string, any)) (*App, error) {
	m, err := ReadMeta(ccx)
	if err != nil {
		return nil, err
	}
	return &App{env: env, ccx: ccx, meta: m, log: lg, emit: emit}, nil
}

type Info struct {
	Name            string `json:"name"`
	Version         string `json:"version"`
	MinVersion      string `json:"minVersion"`
	Installed       bool   `json:"installed"`
	PremiereRunning bool   `json:"premiereRunning"`
	UPIA            bool   `json:"upia"`
	Setup           string `json:"setup"`
}

func (a *App) Info(setupVersion string) Info {
	return Info{
		Name: a.meta.Name, Version: a.meta.Version, MinVersion: a.meta.MinVersion,
		Installed:       IsInstalled(a.env, a.ccx),
		PremiereRunning: a.premiereRunning(),
		UPIA:            a.env.upiaAvailable(),
		Setup:           setupVersion,
	}
}

func (a *App) premiereRunning() bool {
	if !a.env.WindowsPaths {
		return false
	}
	out, err := a.env.run("tasklist", "/FI", "IMAGENAME eq Adobe Premiere Pro.exe", "/NH")
	return err == nil && strings.Contains(strings.ToLower(string(out)), "adobe premiere pro.exe")
}

type DonePayload struct {
	OK       bool     `json:"ok"`
	Action   string   `json:"action"`
	Method   string   `json:"method,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	Error    string   `json:"error,omitempty"`
}

type stepPayload struct {
	Step   string `json:"step"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

// Do runs "install" or "uninstall" synchronously and reports through emit. Only one action at a time.
func (a *App) Do(action string) DonePayload {
	a.mu.Lock()
	if a.busy {
		a.mu.Unlock()
		return DonePayload{Action: action, Error: "Une opération est déjà en cours."}
	}
	a.busy = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.busy = false; a.mu.Unlock() }()

	progress := func(step, state, detail string) {
		a.log.Printf("[%s] %s %s", step, state, detail)
		if a.emit != nil {
			a.emit("progress", stepPayload{step, state, detail})
		}
	}
	var (
		res Result
		err error
	)
	a.log.Printf("action=%s plugin=%s %s uxpRoot=%s upia=%q", action, a.meta.ID, a.meta.Version, a.env.UXPRoot, a.env.UPIAPath)
	switch action {
	case "install":
		res, err = Install(a.env, a.ccx, progress)
	case "uninstall":
		res, err = Uninstall(a.env, a.ccx, progress)
	default:
		err = fmt.Errorf("action inconnue: %s", action)
	}
	done := DonePayload{OK: err == nil, Action: action, Method: res.Method, Warnings: res.Warnings}
	if err != nil {
		done.Error = err.Error()
		a.log.Printf("FAILED: %v", err)
	} else {
		a.log.Printf("done: method=%s warnings=%v", res.Method, res.Warnings)
	}
	if a.emit != nil {
		a.emit("done", done)
	}
	return done
}
