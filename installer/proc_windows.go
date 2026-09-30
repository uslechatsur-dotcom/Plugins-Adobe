//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// hideWindow stops a console window from flashing when we launch Adobe's command-line installer.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
