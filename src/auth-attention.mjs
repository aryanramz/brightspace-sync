import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './utils.mjs';

export const AUTH_ATTENTION_FILE_NAME = 'auth-attention.json';
export const AUTH_ATTENTION_EXIT_CODE = 4;

export class AuthenticationAttentionError extends Error {
  constructor(message = 'Brightspace authentication requires attention. Use Refresh Login.') {
    super(message);
    this.name = 'AuthenticationAttentionError';
    this.code = 'refresh-login-required';
  }
}

export function authenticationAttentionError(message) {
  return new AuthenticationAttentionError(message);
}

export function isAuthenticationAttentionError(error) {
  return error instanceof AuthenticationAttentionError || error?.code === 'refresh-login-required';
}

export function authAttentionFile(stateDir) {
  return path.join(stateDir, AUTH_ATTENTION_FILE_NAME);
}

export async function hasAuthAttention(stateDir, io = fs) {
  try {
    await io.stat(authAttentionFile(stateDir));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    // A private-state inspection failure must not cause another unattended
    // credential submission or browser launch.
    return true;
  }
}

export async function setAuthAttention(stateDir, io = fs) {
  await writeJsonAtomic(authAttentionFile(stateDir), {
    schemaVersion: 1,
    required: true
  });
}

export async function clearAuthAttention(stateDir, io = fs) {
  await io.rm(authAttentionFile(stateDir), { force: true });
}

export async function runAndClearAuthAttention(operation, stateDir, {
  clear = clearAuthAttention
} = {}) {
  const result = await operation();
  await clear(stateDir);
  return result;
}
