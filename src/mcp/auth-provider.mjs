import { Buffer } from "node:buffer";

export function buildAuthHeaders(env = process.env) {
  const provider = env.AIBASE_API_AUTH_TYPE || "none";
  switch (provider) {
    case "basic":
      return buildBasicHeaders(env);
    case "bearer":
      return buildBearerHeaders(env);
    case "header":
      return buildCustomHeader(env);
    case "none":
    case "":
      return new Headers();
    default:
      throw new Error(`Unsupported AIBASE_API_AUTH_TYPE: "${provider}"`);
  }
}

function buildBasicHeaders(env) {
  const headers = new Headers();
  const username = env.AIBASE_API_AUTH_USERNAME || env.AIBASE_API_AUTH_USER;
  const password = env.AIBASE_API_AUTH_PASSWORD || env.AIBASE_API_AUTH_PASS;
  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
  }
  return headers;
}

function buildBearerHeaders(env) {
  const headers = new Headers();
  const token = env.AIBASE_API_AUTH_TOKEN;
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

function buildCustomHeader(env) {
  const headers = new Headers();
  const headerName = env.AIBASE_API_AUTH_HEADER;
  const headerValue = env.AIBASE_API_AUTH_VALUE;
  if (headerName && headerValue) {
    headers.set(headerName, headerValue);
  }
  return headers;
}
