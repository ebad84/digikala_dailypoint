export async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    token?: string | null;
    body?: unknown;
    onUnauthorized?: () => void;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && options.onUnauthorized) {
    options.onUnauthorized();
  }

  const data = (await res.json()) as T & {ok?: boolean; error?: string; message?: string};
  if (!res.ok) {
    throw new Error(data.error || data.message || `خطای سرور (${res.status})`);
  }
  return data;
}
