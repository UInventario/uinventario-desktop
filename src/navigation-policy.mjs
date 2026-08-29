export function isAllowedNavigation(target, allowedOrigin) {
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'https:' && parsed.origin === allowedOrigin;
  } catch {
    return false;
  }
}
