import type { HomeEntryVisibility } from "./types";

export function isHomeEntryVisible(visibility: HomeEntryVisibility | undefined, loggedIn: boolean): boolean {
  switch (visibility) {
    case "disabled": return false;
    case "authenticated": return loggedIn;
    case "guest": return !loggedIn;
    default: return true;
  }
}
