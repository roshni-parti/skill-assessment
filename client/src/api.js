async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { status: res.status });
  return data;
}

export const api = {
  config: () => call('GET', '/config'),
  otpRequest: (email) => call('POST', '/auth/otp/request', { email }),
  otpVerify: (email, code) => call('POST', '/auth/otp/verify', { email, code }),
  googleLogin: (credential) => call('POST', '/auth/google', { credential }),
  devLogin: (b) => call('POST', '/auth/dev', b),
  logout: () => call('POST', '/auth/logout', {}),
  me: () => call('GET', '/me'),
  roles: () => call('GET', '/roles'),
  adminEmployees: () => call('GET', '/admin/employees'),
  list: () => call('GET', '/assessments'),
  create: (b) => call('POST', '/assessments', b ?? {}),
  get: (id) => call('GET', `/assessments/${id}`),
  saveSelf: (id, responses, submit) => call('PUT', `/assessments/${id}/self`, { responses, submit }),
  result: (id) => call('GET', `/assessments/${id}/result`),
  reviews: () => call('GET', '/reviews'),
  review: (id) => call('GET', `/review/${id}`),
  saveReview: (id, responses, submit) => call('PUT', `/review/${id}`, { responses, submit }),
};
