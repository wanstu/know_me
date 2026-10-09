package main

import (
	"strings"
	"testing"
)

func TestServiceCommandRejectsMissingAndExtraArguments(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
	}{
		{"missing action", []string{"service"}},
		{"extra arguments", []string{"service", "status", "--all"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := run(tc.args)
			if err == nil || !strings.Contains(err.Error(), "usage: know-me service") {
				t.Fatalf("got %v, want service usage error", err)
			}
		})
	}
}
