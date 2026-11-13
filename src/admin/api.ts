import { auth } from '../lib/firebase';
import { apiUrl } from '../lib/apiConfig';

export async function adminFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error('Authentication required. Please sign in.');
  }

  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}
