import { getDb } from '@sorye/db';
import { sharedState } from '@sorye/db/schema';
import { and, eq } from 'drizzle-orm';

export async function readSharedState<T>(namespace: string, scope: string, fallback: () => T): Promise<T> {
  const [row] = await getDb().select({ payload: sharedState.payload }).from(sharedState)
    .where(and(eq(sharedState.namespace, namespace), eq(sharedState.scope, scope)));
  return row ? row.payload as T : fallback();
}

/** Database row locks serialize writers across processes, independently for each workspace. */
export async function updateSharedState<T, R>(
  namespace: string, scope: string, fallback: () => T, fn: (data: T) => R | Promise<R>,
): Promise<R> {
  return getDb().transaction(async (tx) => {
    await tx.insert(sharedState).values({ namespace, scope, payload: fallback() }).onConflictDoNothing();
    const predicate = and(eq(sharedState.namespace, namespace), eq(sharedState.scope, scope));
    const [row] = await tx.select().from(sharedState).where(predicate).for('update');
    if (!row) throw new Error('Shared state disappeared during update');
    const data = row.payload as T;
    const result = await fn(data);
    await tx.update(sharedState).set({ payload: data, updatedAt: new Date() }).where(predicate);
    return result;
  });
}
