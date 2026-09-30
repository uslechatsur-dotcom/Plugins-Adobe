//go:build !windows

package main

import (
	"errors"
	"log"
)

func runGUI(Env, *log.Logger, string) error {
	return errors.New("l'interface graphique n'existe que sous Windows — utilisez --silent ou --uninstall")
}

func runFallback(_ Env, l *log.Logger, _ string, err error) { l.Println(err); println(err.Error()) }

func showMessage(title, text string) { println(title + ": " + text) }
