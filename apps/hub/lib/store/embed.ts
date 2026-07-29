import { getStoreDriver } from '@/lib/env';
import * as jsonStore from './embed-json';
import * as postgresStore from './embed-postgres';

function activeStore() {
  return getStoreDriver() === 'postgres' ? postgresStore : jsonStore;
}

export const listEmbedWidgets = (
  ...args: Parameters<typeof jsonStore.listEmbedWidgets>
) => activeStore().listEmbedWidgets(...args);

export const createEmbedWidget = (
  ...args: Parameters<typeof jsonStore.createEmbedWidget>
) => activeStore().createEmbedWidget(...args);

export const updateEmbedWidget = (
  ...args: Parameters<typeof jsonStore.updateEmbedWidget>
) => activeStore().updateEmbedWidget(...args);

export const revokeEmbedWidget = (
  ...args: Parameters<typeof jsonStore.revokeEmbedWidget>
) => activeStore().revokeEmbedWidget(...args);

export const findEmbedWidgetByKey = (
  ...args: Parameters<typeof jsonStore.findEmbedWidgetByKey>
) => activeStore().findEmbedWidgetByKey(...args);
