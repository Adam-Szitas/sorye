import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { signedFetch, readJson } from './rodrigo/transport';
import type { RodrigoContext } from './rodrigo/service-client';

export const shareHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' };
export const shareSchema = z.object({ id: z.string().uuid(), kind:z.enum(['file','folder']), root:z.string(), permission:z.enum(['read','read_write']), target:z.enum(['sorye','drive','database']), createdAt:z.string(), expiresAt:z.string(), revoked:z.boolean(), revision:z.number().int().positive() }).strict();
export const publicViewSchema = z.object({kind:z.enum(['file','folder']),permission:z.enum(['read','read_write']),expiresAt:z.string(),files:z.array(z.object({id:z.string().uuid(),name:z.string(),path:z.string(),size:z.number()})).max(400),folders:z.array(z.string()).max(2000),maxFileBytes:z.number()}).strict();
export type PublicDriveView = z.infer<typeof publicViewSchema>;
export type DriveShare = z.infer<typeof shareSchema>;
export function tokenHash(token:string) { return createHash('sha256').update(token).digest('hex'); }
export function recipientHash(request:Request):string|null {
  const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  return token ? tokenHash(token) : null;
}
export async function listShares(context:RodrigoContext) {
  return readJson(await signedFetch({context,method:'GET',path:'/v2/files-shares',scope:'files:read',appScopes:['files']}),z.object({shares:z.array(shareSchema).max(100)}).strict(),262144);
}
export const createShareSchema=z.object({kind:z.enum(['file','folder']),root:z.string().max(1024),permission:z.enum(['read','read_write']),days:z.number().int().min(1).max(30).default(7),expectedWorkspaceId:z.string()}).strict();
export const updateShareSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().positive(),permission:z.enum(['read','read_write']),days:z.number().int().min(1).max(30).default(7),revoke:z.boolean().default(false),expectedWorkspaceId:z.string()}).strict();
export async function manageShare(context:RodrigoContext,input:z.infer<typeof createShareSchema>|z.infer<typeof updateShareSchema>) {
  const {expectedWorkspaceId,...settings}=input;
  if(expectedWorkspaceId!==context.workspaceId) throw new Error('Workspace changed');
  const token='kind' in settings ? randomBytes(32).toString('base64url') : undefined;
  const body=token?{...settings,id:randomUUID(),tokenHash:tokenHash(token)}:settings;
  await readJson(await signedFetch({context,method:'POST',path:'/v2/files-shares',scope:'files:write',appScopes:['files'],body:JSON.stringify(body)}),z.object({ok:z.literal(true)}));
  return token?{token}:{ok:true};
}
export function publicDriveCall(hash:string,operation:string,body:unknown={}) {
  return signedFetch({context:{userId:'rodrigo-drive-recipient',workspaceId:'rodrigo-public-drive'},method:'POST',path:`/v2/public-drive/${operation}`,scope:'drive-share:access',actionScopes:[`share:${hash}`],body:JSON.stringify(body),timeoutMs:30000,streamResponse:operation.startsWith('content/')});
}

// Bounded per-process admission, including random-token guessing. No raw tokens or IPs retained.
const stateKey=Symbol.for('sorye.drive.public.rates');
const globalState=globalThis as typeof globalThis & {[stateKey]?:{minute:number,total:number,counts:Map<string,number>}};
const rates=globalState[stateKey]??={minute:0,total:0,counts:new Map()};
export function admitShare(hash:string) {
  const minute=Math.floor(Date.now()/60000);
  if(rates.minute!==minute){rates.minute=minute;rates.total=0;rates.counts.clear();}
  if(++rates.total>600)return false;
  const count=(rates.counts.get(hash)??0)+1; rates.counts.set(hash,count);return count<=120;
}
