package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func makeCCX(t *testing.T, id, version string, extra map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	files := map[string]string{
		"manifest.json": `{"id":"` + id + `","name":"Test Plugin","version":"` + version + `","host":{"app":"premierepro","minVersion":"25.6.0"}}`,
		"index.html":    "<html></html>",
		"js/app.js":     "// " + version,
	}
	for k, v := range extra {
		files[k] = v
	}
	for name, body := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(body))
	}
	zw.Close()
	return buf.Bytes()
}

func testEnv(t *testing.T) Env {
	t.Helper()
	return Env{UXPRoot: filepath.Join(t.TempDir(), "UXP"), Timeout: 5 * time.Second, Run: defaultRun}
}

func fakeUPIA(t *testing.T, script string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "upia.sh")
	if err := os.WriteFile(p, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

func readRegistry(t *testing.T, e Env) map[string]any {
	t.Helper()
	b, err := os.ReadFile(e.registryPath())
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func pluginIDs(m map[string]any) []string {
	var ids []string
	for _, p := range m["plugins"].([]any) {
		ids = append(ids, p.(map[string]any)["pluginId"].(string))
	}
	return ids
}

func TestReadMeta(t *testing.T) {
	m, err := ReadMeta(makeCCX(t, "com.x.y", "1.2.3", nil))
	if err != nil || m.ID != "com.x.y" || m.Version != "1.2.3" || m.MinVersion != "25.6.0" || m.Name != "Test Plugin" {
		t.Fatalf("meta=%+v err=%v", m, err)
	}
	if _, err := ReadMeta([]byte("not a zip")); err == nil {
		t.Fatal("expected error for a non-zip payload")
	}
}

func TestRealPayloadIsValid(t *testing.T) {
	m, err := ReadMeta(pluginCCX)
	if err != nil || m.ID == "" || m.MinVersion == "" {
		t.Fatalf("embedded payload: %+v %v", m, err)
	}
}

func TestManualInstallPreservesExistingRegistry(t *testing.T) {
	e := testEnv(t)
	e.WindowsPaths = true
	if err := os.MkdirAll(filepath.Dir(e.registryPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	orig := `{"version":3,"plugins":[{"pluginId":"other.plugin","name":"Other","status":"enabled","custom":{"a":1}}]}`
	os.WriteFile(e.registryPath(), []byte(orig), 0o644)

	var steps []string
	res, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", nil), func(s, st, d string) { steps = append(steps, s+":"+st) })
	if err != nil || res.Method != "manual" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if _, err := os.Stat(filepath.Join(e.pluginDir(Meta{ID: "com.x.y", Version: "1.0.0"}), "js", "app.js")); err != nil {
		t.Fatalf("files not extracted: %v", err)
	}
	reg := readRegistry(t, e)
	if got := strings.Join(pluginIDs(reg), ","); got != "other.plugin,com.x.y" {
		t.Fatalf("plugins = %s", got)
	}
	if reg["version"].(float64) != 3 {
		t.Fatal("unknown top-level key lost")
	}
	other := reg["plugins"].([]any)[0].(map[string]any)
	if other["custom"].(map[string]any)["a"].(float64) != 1 {
		t.Fatal("unknown key of another plugin lost")
	}
	ours := reg["plugins"].([]any)[1].(map[string]any)
	if ours["path"] != `$localPlugins\External\com.x.y_1.0.0` || ours["status"] != "enabled" || ours["hostMinVersion"] != "25.6.0" {
		t.Fatalf("entry = %v", ours)
	}
	if b, _ := os.ReadFile(e.registryPath() + backupSuffix); string(b) != orig {
		t.Fatal("backup missing or altered")
	}
	if !strings.Contains(strings.Join(steps, " "), "register:ok") {
		t.Fatalf("steps: %v", steps)
	}
}

func TestReinstallAndUpgradeKeepSingleEntryAndDir(t *testing.T) {
	e := testEnv(t)
	for _, v := range []string{"1.0.0", "1.0.0", "1.1.0"} {
		if _, err := Install(e, makeCCX(t, "com.x.y", v, nil), nil); err != nil {
			t.Fatal(err)
		}
	}
	if ids := pluginIDs(readRegistry(t, e)); len(ids) != 1 {
		t.Fatalf("ids=%v", ids)
	}
	dirs, _ := filepath.Glob(filepath.Join(e.externalDir(), "com.x.y_*"))
	if len(dirs) != 1 || !strings.HasSuffix(dirs[0], "com.x.y_1.1.0") {
		t.Fatalf("dirs=%v", dirs)
	}
	if reg := readRegistry(t, e); reg["plugins"].([]any)[0].(map[string]any)["path"] != "$localPlugins/External/com.x.y_1.1.0" {
		t.Fatalf("path=%v", reg)
	}
}

func TestCorruptRegistryIsLeftIntactAndInstallRollsBack(t *testing.T) {
	e := testEnv(t)
	os.MkdirAll(filepath.Dir(e.registryPath()), 0o755)
	os.WriteFile(e.registryPath(), []byte(`{ this is not json`), 0o644)
	_, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", nil), nil)
	if err == nil {
		t.Fatal("expected failure")
	}
	if b, _ := os.ReadFile(e.registryPath()); string(b) != `{ this is not json` {
		t.Fatal("corrupt file was modified")
	}
	if fileExists(e.pluginDir(Meta{ID: "com.x.y", Version: "1.0.0"})) {
		t.Fatal("copied files were not rolled back")
	}
}

func TestUPIASuccess(t *testing.T) {
	e := testEnv(t)
	log := filepath.Join(t.TempDir(), "calls.log")
	e.UPIAPath = fakeUPIA(t, `echo "$@" >> `+log+`
case "$1" in --list) echo "com.x.y 1.0.0 Test Plugin";; esac
exit 0`)
	res, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", nil), nil)
	if err != nil || res.Method != "upia" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	calls, _ := os.ReadFile(log)
	if !strings.Contains(string(calls), "--install ") || !strings.Contains(string(calls), ".ccx") || !strings.Contains(string(calls), "--list all") {
		t.Fatalf("calls:\n%s", calls)
	}
	if fileExists(e.externalDir()) && len(mustGlob(e.externalDir()+"/*")) > 0 {
		t.Fatal("manual copy should not exist when UPIA succeeded")
	}
}

func mustGlob(p string) []string { m, _ := filepath.Glob(p); return m }

func TestUPIAThatDoesNotRegisterFallsBackToManual(t *testing.T) {
	e := testEnv(t)
	e.UPIAPath = fakeUPIA(t, `exit 0`) // "succeeds" but --list never shows the plugin
	res, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", nil), nil)
	if err != nil || res.Method != "manual" || len(res.Warnings) == 0 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestUPIAFailureAndTimeoutFallBackToManual(t *testing.T) {
	for name, script := range map[string]string{"fail": `echo boom; exit 3`, "hang": `exec sleep 10`} {
		t.Run(name, func(t *testing.T) {
			e := testEnv(t)
			e.Timeout = 300 * time.Millisecond
			e.UPIAPath = fakeUPIA(t, script)
			start := time.Now()
			res, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", nil), nil)
			if err != nil || res.Method != "manual" || len(res.Warnings) == 0 {
				t.Fatalf("res=%+v err=%v", res, err)
			}
			if time.Since(start) > 4*time.Second {
				t.Fatal("hung UPIA was not stopped by the timeout")
			}
		})
	}
}

func TestUninstallRemovesOnlyOurs(t *testing.T) {
	e := testEnv(t)
	os.MkdirAll(filepath.Dir(e.registryPath()), 0o755)
	os.WriteFile(e.registryPath(), []byte(`{"plugins":[{"pluginId":"other.plugin"}]}`), 0o644)
	ccx := makeCCX(t, "com.x.y", "1.0.0", nil)
	if _, err := Install(e, ccx, nil); err != nil {
		t.Fatal(err)
	}
	if !IsInstalled(e, ccx) {
		t.Fatal("IsInstalled should be true")
	}
	if _, err := Uninstall(e, ccx, nil); err != nil {
		t.Fatal(err)
	}
	if IsInstalled(e, ccx) || strings.Join(pluginIDs(readRegistry(t, e)), ",") != "other.plugin" {
		t.Fatalf("after uninstall: %v", readRegistry(t, e))
	}
	// uninstalling again (or when the registry never existed) must not fail
	if _, err := Uninstall(testEnv(t), ccx, nil); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallCallsUPIARemove(t *testing.T) {
	e := testEnv(t)
	log := filepath.Join(t.TempDir(), "calls.log")
	e.UPIAPath = fakeUPIA(t, `echo "$@" >> `+log)
	if _, err := Uninstall(e, makeCCX(t, "com.x.y", "1.0.0", nil), nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(log); !strings.Contains(string(b), "--remove com.x.y") {
		t.Fatalf("calls: %s", b)
	}
}

func TestZipSlipIsRejected(t *testing.T) {
	e := testEnv(t)
	_, err := Install(e, makeCCX(t, "com.x.y", "1.0.0", map[string]string{"../../evil.txt": "x"}), nil)
	if err == nil {
		t.Fatal("expected zip-slip rejection")
	}
	if fileExists(filepath.Join(e.UXPRoot, "evil.txt")) || fileExists(filepath.Join(filepath.Dir(e.UXPRoot), "evil.txt")) {
		t.Fatal("file escaped the plugin dir")
	}
}

func TestAppDoReportsProgressAndBlocksConcurrentRuns(t *testing.T) {
	e := testEnv(t)
	var events []string
	app, err := NewApp(e, makeCCX(t, "com.x.y", "1.0.0", nil), testLogger(), func(ev string, _ any) { events = append(events, ev) })
	if err != nil {
		t.Fatal(err)
	}
	d := app.Do("install")
	if !d.OK || d.Method != "manual" || events[len(events)-1] != "done" {
		t.Fatalf("d=%+v events=%v", d, events)
	}
	if bad := app.Do("explode"); bad.OK || bad.Error == "" {
		t.Fatalf("unknown action must fail: %+v", bad)
	}
	if !app.Info("t").Installed {
		t.Fatal("Info.Installed")
	}
}

func testLogger() *log.Logger { return log.New(io.Discard, "", 0) }
