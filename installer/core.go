// Installer core: everything except the window. Platform independent so it can be unit-tested on any OS.
//
// A UXP plugin can be installed two ways; we try them in this order:
//  1. Adobe's own installer agent (UPIA) with the embedded .ccx — this is what Creative Cloud uses.
//  2. Manual: extract into <UXP root>\Plugins\External\<id>_<version> and register it in
//     <UXP root>\PluginsInfo\v1\PPRO.json (existing entries are preserved, a backup is kept).
package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Meta struct {
	ID, Name, Version, MinVersion string
}

type Env struct {
	UXPRoot      string        // %APPDATA%\Adobe\UXP
	UPIAPath     string        // ...\UnifiedPluginInstallerAgent.exe (may not exist)
	WindowsPaths bool          // use backslashes inside PPRO.json paths
	Timeout      time.Duration // per external command
	Run          func(ctx context.Context, name string, args ...string) ([]byte, error)
}

// Progress is called as steps advance. state: "run" | "ok" | "warn" | "err".
type Progress func(step, state, detail string)

type Result struct {
	Method   string // "upia" | "manual" | "removed"
	Warnings []string
	Dir      string
}

const (
	stepPrepare  = "prepare"
	stepInstall  = "install"
	stepRegister = "register"
	backupSuffix = ".legolas-curves.bak"
)

func defaultRun(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	hideWindow(cmd)
	return cmd.CombinedOutput()
}

// ---------------------------------------------------------------------------- payload

func ReadMeta(ccx []byte) (Meta, error) {
	zr, err := zip.NewReader(bytes.NewReader(ccx), int64(len(ccx)))
	if err != nil {
		return Meta{}, fmt.Errorf("paquet illisible: %w", err)
	}
	for _, f := range zr.File {
		if f.Name != "manifest.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return Meta{}, err
		}
		defer rc.Close()
		var m struct {
			ID      string `json:"id"`
			Name    string `json:"name"`
			Version string `json:"version"`
			Host    struct {
				MinVersion string `json:"minVersion"`
			} `json:"host"`
		}
		if err := json.NewDecoder(rc).Decode(&m); err != nil {
			return Meta{}, fmt.Errorf("manifest.json invalide: %w", err)
		}
		if m.ID == "" || m.Version == "" {
			return Meta{}, errors.New("manifest.json: id ou version manquant")
		}
		return Meta{ID: m.ID, Name: m.Name, Version: m.Version, MinVersion: m.Host.MinVersion}, nil
	}
	return Meta{}, errors.New("manifest.json absent du paquet")
}

func extract(ccx []byte, dest string) error {
	zr, err := zip.NewReader(bytes.NewReader(ccx), int64(len(ccx)))
	if err != nil {
		return err
	}
	root := filepath.Clean(dest) + string(os.PathSeparator)
	for _, f := range zr.File {
		target := filepath.Join(dest, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(target+string(os.PathSeparator), root) { // zip-slip guard
			return fmt.Errorf("chemin refusé dans le paquet: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		if cerr := out.Close(); err == nil {
			err = cerr
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------- paths

func (e Env) externalDir() string { return filepath.Join(e.UXPRoot, "Plugins", "External") }
func (e Env) pluginDir(m Meta) string {
	return filepath.Join(e.externalDir(), m.ID+"_"+m.Version)
}
func (e Env) registryPath() string {
	return filepath.Join(e.UXPRoot, "PluginsInfo", "v1", "PPRO.json")
}
func (e Env) registryPathValue(m Meta) string {
	sep := "/"
	if e.WindowsPaths {
		sep = `\`
	}
	return "$localPlugins" + sep + "External" + sep + m.ID + "_" + m.Version
}

func (e Env) run(name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), e.Timeout)
	defer cancel()
	out, err := e.Run(ctx, name, args...)
	if ctx.Err() == context.DeadlineExceeded {
		return out, fmt.Errorf("délai dépassé (%s)", e.Timeout)
	}
	return out, err
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// removeVersions deletes every installed copy of the plugin (any version) from External/.
func (e Env) removeVersions(m Meta) error {
	matches, _ := filepath.Glob(filepath.Join(e.externalDir(), m.ID+"_*"))
	for _, d := range matches {
		if err := os.RemoveAll(d); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------- PPRO.json

// updateRegistry adds/replaces (or removes) our entry, keeping every other plugin and unknown key intact.
// The original file is backed up once. If the file is not valid JSON it is left untouched and an error is returned.
func (e Env) updateRegistry(m Meta, remove bool) error {
	path := e.registryPath()
	top := map[string]json.RawMessage{}
	orig, err := os.ReadFile(path)
	switch {
	case err == nil:
		if len(bytes.TrimSpace(orig)) > 0 {
			if err := json.Unmarshal(orig, &top); err != nil {
				return fmt.Errorf("PPRO.json n'est pas un JSON valide (%v) — laissé intact", err)
			}
		}
	case os.IsNotExist(err):
		if remove {
			return nil
		}
	default:
		return err
	}

	var plugins []json.RawMessage
	if raw, ok := top["plugins"]; ok {
		if err := json.Unmarshal(raw, &plugins); err != nil {
			return fmt.Errorf("PPRO.json: \"plugins\" inattendu (%v) — laissé intact", err)
		}
	}
	kept := plugins[:0:0]
	for _, p := range plugins {
		var id struct {
			PluginID string `json:"pluginId"`
		}
		if json.Unmarshal(p, &id) == nil && id.PluginID == m.ID {
			continue
		}
		kept = append(kept, p)
	}
	if !remove {
		entry := map[string]any{
			"hostMinVersion": m.MinVersion,
			"name":           m.Name,
			"path":           e.registryPathValue(m),
			"pluginId":       m.ID,
			"status":         "enabled",
			"type":           "uxp",
			"versionString":  m.Version,
		}
		raw, _ := json.Marshal(entry)
		kept = append(kept, raw)
	}
	if remove && len(kept) == len(plugins) {
		return nil // we were not registered; nothing to write
	}
	if kept == nil {
		kept = []json.RawMessage{}
	}
	top["plugins"], _ = json.Marshal(kept)
	out, err := json.MarshalIndent(top, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if len(orig) > 0 && !fileExists(path+backupSuffix) {
		if err := os.WriteFile(path+backupSuffix, orig, 0o644); err != nil {
			return err
		}
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(out, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ---------------------------------------------------------------------------- install / uninstall

func (e Env) upiaAvailable() bool { return e.UPIAPath != "" && fileExists(e.UPIAPath) }

func (e Env) upiaListed(id string) bool {
	out, err := e.run(e.UPIAPath, "--list", "all")
	return err == nil && strings.Contains(strings.ToLower(string(out)), strings.ToLower(id))
}

func Install(e Env, ccx []byte, progress Progress) (Result, error) {
	if progress == nil {
		progress = func(string, string, string) {}
	}
	progress(stepPrepare, "run", "")
	m, err := ReadMeta(ccx)
	if err != nil {
		progress(stepPrepare, "err", err.Error())
		return Result{}, err
	}
	progress(stepPrepare, "ok", m.Name+" "+m.Version)
	res := Result{}

	// 1) Adobe installer agent
	if e.upiaAvailable() {
		progress(stepInstall, "run", "Installateur Adobe (UPIA)")
		tmp, terr := os.MkdirTemp("", "legolas-curves-*")
		if terr == nil {
			defer os.RemoveAll(tmp)
			pkg := filepath.Join(tmp, m.ID+".ccx")
			if werr := os.WriteFile(pkg, ccx, 0o644); werr == nil {
				out, rerr := e.run(e.UPIAPath, "--install", pkg)
				if rerr == nil && e.upiaListed(m.ID) {
					_ = e.removeVersions(m) // avoid a stale manual copy shadowing the managed install
					_ = e.updateRegistry(m, true)
					progress(stepInstall, "ok", "Installé via Adobe")
					progress(stepRegister, "ok", "Géré par Adobe")
					return Result{Method: "upia"}, nil
				} else {
					why := strings.TrimSpace(string(out))
					if rerr != nil {
						why = rerr.Error() + " " + why
					}
					res.Warnings = append(res.Warnings, "L'installateur Adobe n'a pas confirmé l'installation ("+truncate(why, 160)+"). Installation manuelle utilisée.")
					progress(stepInstall, "warn", "Installateur Adobe indisponible — installation manuelle")
				}
			}
		}
	} else {
		progress(stepInstall, "run", "Copie des fichiers")
	}

	// 2) manual
	dir := e.pluginDir(m)
	if err := e.removeVersions(m); err != nil {
		progress(stepInstall, "err", err.Error())
		return res, fmt.Errorf("impossible de remplacer l'ancienne version: %w", err)
	}
	if err := extract(ccx, dir); err != nil {
		_ = os.RemoveAll(dir)
		progress(stepInstall, "err", err.Error())
		return res, fmt.Errorf("copie des fichiers: %w", err)
	}
	progress(stepInstall, "ok", dir)
	progress(stepRegister, "run", "PPRO.json")
	if err := e.updateRegistry(m, false); err != nil {
		_ = os.RemoveAll(dir)
		progress(stepRegister, "err", err.Error())
		return res, fmt.Errorf("enregistrement dans Premiere: %w", err)
	}
	progress(stepRegister, "ok", "Enregistré")
	res.Method, res.Dir = "manual", dir
	return res, nil
}

func Uninstall(e Env, ccx []byte, progress Progress) (Result, error) {
	if progress == nil {
		progress = func(string, string, string) {}
	}
	m, err := ReadMeta(ccx)
	if err != nil {
		return Result{}, err
	}
	res := Result{Method: "removed"}
	progress(stepInstall, "run", "Suppression")
	if e.upiaAvailable() {
		if out, rerr := e.run(e.UPIAPath, "--remove", m.ID); rerr != nil {
			res.Warnings = append(res.Warnings, "Installateur Adobe: "+truncate(strings.TrimSpace(string(out)+" "+rerr.Error()), 160))
		}
	}
	if err := e.removeVersions(m); err != nil {
		progress(stepInstall, "err", err.Error())
		return res, err
	}
	progress(stepInstall, "ok", "Fichiers supprimés")
	progress(stepRegister, "run", "PPRO.json")
	if err := e.updateRegistry(m, true); err != nil {
		res.Warnings = append(res.Warnings, err.Error())
		progress(stepRegister, "warn", err.Error())
	} else {
		progress(stepRegister, "ok", "Retiré de Premiere")
	}
	return res, nil
}

func IsInstalled(e Env, ccx []byte) bool {
	m, err := ReadMeta(ccx)
	if err != nil {
		return false
	}
	if fileExists(e.pluginDir(m)) {
		return true
	}
	return e.upiaAvailable() && e.upiaListed(m.ID)
}

func truncate(s string, n int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}
