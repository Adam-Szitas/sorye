import {
  ProtocolioClient,
  type ProtocolioConfig,
  type PdfTemplate,
  type GenerateResult,
  type ValidationResult,
} from '@protocolio/sdk';
import { resolveApiBaseUrl, resolveDevToken } from '../config';

const STORAGE_KEY_BASE_URL = 'protocolio_base_url';
const STORAGE_KEY_TOKEN = 'protocolio_token';

let client: ProtocolioClient | null = null;

function loadSavedConfig(): ProtocolioConfig {
  const savedUrl = localStorage.getItem(STORAGE_KEY_BASE_URL);
  const token = resolveDevToken();
  const baseUrl = savedUrl !== null && savedUrl !== '' ? savedUrl : resolveApiBaseUrl();
  return { baseUrl, token };
}

function persistConfig(config: ProtocolioConfig): void {
  localStorage.setItem(STORAGE_KEY_BASE_URL, config.baseUrl);
  localStorage.setItem(STORAGE_KEY_TOKEN, config.token);
}

// Auto-initialize on module load; persist dev token so UI sees it
const initialConfig = loadSavedConfig();
if (initialConfig.token && !localStorage.getItem(STORAGE_KEY_TOKEN)) {
  persistConfig(initialConfig);
}
client = new ProtocolioClient(initialConfig);

export function initClient(config: ProtocolioConfig): ProtocolioClient {
  persistConfig(config);
  client = new ProtocolioClient(config);
  return client;
}

export function getClient(): ProtocolioClient | null {
  return client;
}

export function hasToken(): boolean {
  return !!resolveDevToken();
}

export function getBaseUrl(): string {
  return loadSavedConfig().baseUrl;
}

export async function generate(template: PdfTemplate): Promise<GenerateResult> {
  if (!client) throw new Error('Client not initialized. Call initClient() first.');
  return client.generate(template);
}

export async function validate(template: PdfTemplate): Promise<ValidationResult> {
  if (!client) throw new Error('Client not initialized. Call initClient() first.');
  return client.validate(template);
}

export async function download(template: PdfTemplate, filename?: string): Promise<void> {
  if (!client) throw new Error('Client not initialized. Call initClient() first.');
  return client.download(template, filename);
}

export async function health(): Promise<boolean> {
  if (!client) throw new Error('Client not initialized. Call initClient() first.');
  return client.health();
}
