package settings

// VisibleHomeEntries selects homepage cards for a visitor.
// Visibility only affects card display, not access control at target routes.
func VisibleHomeEntries(entries []HomeEntry, authenticated bool) []HomeEntry {
	out := make([]HomeEntry, 0, len(entries))
	for _, entry := range entries {
		switch entry.Visibility {
		case HomeEntryAuthenticated:
			if !authenticated {
				continue
			}
		case HomeEntryGuest:
			if authenticated {
				continue
			}
		}
		out = append(out, entry)
	}
	return out
}
