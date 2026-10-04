/** Fired whenever the API reports that the admin session is missing or expired. */
export const unauthorizedEvent = 'admin:unauthorized';
/** Fired with the new expiry (Unix seconds) whenever the server extends the session. */
export const sessionRenewedEvent = 'admin:session-renewed';

function noteRenewal(response: Response) {
  const expiresAt = Number(response.headers.get('X-Session-Expires'));
  if (expiresAt) window.dispatchEvent(new CustomEvent(sessionRenewedEvent, { detail: expiresAt }));
}

async function errorFrom(response: Response, path: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 401 && !path.endsWith('/login')) window.dispatchEvent(new Event(unauthorizedEvent));
  return new Error(body?.error || `Request failed (${response.status})`);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  noteRenewal(response);
  if (!response.ok) throw await errorFrom(response, path);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Requests a file and saves it in the browser. Returns the response headers. */
export async function downloadFile(path: string, fallbackName: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'same-origin' });
  noteRenewal(response);
  if (!response.ok) throw await errorFrom(response, path);
  const url = URL.createObjectURL(await response.blob());
  const name = response.headers.get('X-Invoice-Number');
  const link = document.createElement('a');
  link.href = url;
  link.download = name ? `${name}.pdf` : fallbackName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers;
}
