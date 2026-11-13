export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

export function wsUrl(path: string): string {
  if (API_BASE_URL) {
    return `${API_BASE_URL.replace(/^http/i, 'ws')}${path}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
