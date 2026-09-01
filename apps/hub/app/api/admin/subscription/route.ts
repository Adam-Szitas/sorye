import { getEnv } from '@/lib/env';
import {
  adminAssignSubscription,
  listUsers,
} from '@/lib/store';
import { timingSafeEqualString } from '@/lib/security';
import type { SubscriptionTierId } from '@sorye/types';
import { NextResponse } from 'next/server';

function isAuthorized(req: Request): boolean {
  try {
    const header = req.headers.get('x-admin-secret');
    if (!header) return false;
    return timingSafeEqualString(header, getEnv().ADMIN_SECRET);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const users = await listUsers();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json()) as {
    email: string;
    subscriptionId: SubscriptionTierId;
  };

  if (!body.email || !body.subscriptionId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const workspace = await adminAssignSubscription(
    body.email,
    body.subscriptionId,
  );

  if (!workspace) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, workspace });
}
