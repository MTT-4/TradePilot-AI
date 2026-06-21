const MAX_RECENT_QUESTIONS = 6;

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadRecentQuestions(storageKey: string) {
  if (!canUseStorage()) {
    return [] as string[];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT_QUESTIONS);
  } catch {
    return [];
  }
}

export function pushRecentQuestion(storageKey: string, question: string) {
  const trimmed = question.trim();
  if (!trimmed || !canUseStorage()) {
    return [];
  }

  const current = loadRecentQuestions(storageKey).filter((item) => item !== trimmed);
  const next = [trimmed, ...current].slice(0, MAX_RECENT_QUESTIONS);

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    return next;
  }

  return next;
}

export function clearRecentQuestions(storageKey: string) {
  if (!canUseStorage()) {
    return [];
  }

  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    return [];
  }

  return [];
}
