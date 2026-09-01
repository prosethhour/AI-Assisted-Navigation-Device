export type VoiceCommandId =
  | "help"
  | "repeat-guidance"
  | "read-text"
  | "describe-surroundings"
  | "stop-speaking"
  | "go-home"
  | "go-back"
  | "open-places"
  | "open-audiobooks"
  | "open-favourites"
  | "open-indoor-navigation"
  | "open-outdoor-navigation"
  | "open-predictive-path"
  | "open-ask-a-friend"
  | "open-emergency";

export const VOICE_COMMAND_HELP =
  "You can say: read text, describe surroundings, repeat guidance, go home, " +
  "open places, open audiobooks, indoor navigation, outdoor navigation, " +
  "ask a friend, emergency, or stop speaking.";

function normalizeVoiceInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Matches only short, explicit app commands. Anything else returns null and
 * continues through the existing WalkBuddy chat endpoint.
 */
export function matchVoiceCommand(input: string): VoiceCommandId | null {
  const text = normalizeVoiceInput(input);
  if (!text) return null;

  if (matchesAny(text, [/^(stop speaking|stop talking|be quiet|silence)$/])) {
    return "stop-speaking";
  }

  if (matchesAny(text, [/^(repeat|repeat that|repeat guidance|say that again)$/])) {
    return "repeat-guidance";
  }

  if (matchesAny(text, [/^(help|voice help|what can i say|list commands)$/])) {
    return "help";
  }

  if (matchesAny(text, [/^(read|scan)( the)? text$/, /^read this( text)?$/])) {
    return "read-text";
  }

  if (
    matchesAny(text, [
      /^(describe|scan)( my)? surroundings$/,
      /^(what|what's|whats) (is )?(around|ahead of|in front of) me$/,
      /^what do you see$/,
    ])
  ) {
    return "describe-surroundings";
  }

  if (matchesAny(text, [/^(emergency|open emergency|i need help|get help)$/])) {
    return "open-emergency";
  }

  if (matchesAny(text, [/^(go|take me|return)( to)? home$/, /^home$/])) {
    return "go-home";
  }

  if (matchesAny(text, [/^(go back|back|previous screen)$/])) {
    return "go-back";
  }

  if (matchesAny(text, [/^(open|show|go to)( my)? places$/, /^places$/])) {
    return "open-places";
  }

  if (matchesAny(text, [/^(open|show|go to)( the)? audiobooks?$/, /^audiobooks?$/])) {
    return "open-audiobooks";
  }

  if (matchesAny(text, [/^(open|show|go to)( my)? favourites?$/, /^favourites?$/])) {
    return "open-favourites";
  }

  if (
    matchesAny(text, [
      /^(open|start|go to)( the)? indoor navigation$/,
      /^indoor navigation$/,
      /^navigate indoors$/,
    ])
  ) {
    return "open-indoor-navigation";
  }

  if (
    matchesAny(text, [
      /^(open|start|go to)( the)? outdoor navigation$/,
      /^outdoor navigation$/,
      /^navigate outdoors$/,
    ])
  ) {
    return "open-outdoor-navigation";
  }

  if (matchesAny(text, [/^(open|show|go to)( the)? predictive path$/, /^predictive path$/])) {
    return "open-predictive-path";
  }

  if (matchesAny(text, [/^(open|start|go to)( the)? ask a friend$/, /^ask a friend$/])) {
    return "open-ask-a-friend";
  }

  return null;
}
