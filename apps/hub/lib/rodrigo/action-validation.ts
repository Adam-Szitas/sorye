import { isTaskDriveFileId } from '@sorye/types';
import { z } from 'zod';
import { parseTasksBoard } from '@/lib/workspace-docs-validate';

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}
type Obj = Record<string, unknown>;
function object(v: unknown): v is Obj { return !!v && typeof v === 'object' && !Array.isArray(v); }
function exact(v: unknown, required: string[], optional: string[] = []): v is Obj {
  return object(v) && required.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => required.includes(k) || optional.includes(k));
}
function str(v: Obj, k: string, min: number, max: number) { return typeof v[k] === 'string' && (v[k] as string).length >= min && (v[k] as string).length <= max; }
function bool(v: Obj, k: string) { return typeof v[k] === 'boolean'; }
function integer(v: Obj, k: string, min: number, max: number) { return Number.isSafeInteger(v[k]) && (v[k] as number) >= min && (v[k] as number) <= max; }
function timestamp(value: unknown) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  return !!m && isCalendarDate(m[1]!) && Number(m[2]) <= 23 && Number(m[3]) <= 59 && Number(m[4]) <= 60
    && (!m[6] || m[6] === 'Z' || (Number(m[6].slice(1, 3)) <= 23 && Number(m[6].slice(4, 6)) <= 59));
}
function arrStrings(v: Obj, key: string, count: number, length: number) { return Array.isArray(v[key]) && v[key].length <= count && v[key].every((x) => typeof x === 'string' && x.length > 0 && x.length <= length); }
function siteSlug(value: unknown) { return typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value); }
function validPayload(app: string, resource: string, op: string, p: Obj, resourceId: string): boolean {
  if (op === 'delete') return ['tasks:task', 'notes:note', 'calendar:event', 'canvas:board'].includes(`${app}:${resource}`) && Object.keys(p).length === 0;
  const upd = () => timestamp(p.updatedAt);
  switch (`${app}:${resource}:${op}`) {
    case 'tasks:task:create': case 'tasks:task:update': return exact(p, ['id','title','body','statusId','createdAt','updatedAt'], ['driveFileId']) && p.id === resourceId && str(p,'title',1,500) && str(p,'body',0,20000) && str(p,'statusId',1,128) && (p.driveFileId === undefined || isTaskDriveFileId(p.driveFileId)) && timestamp(p.createdAt) && upd();
    case 'tasks:taskBoard:create': case 'tasks:taskBoard:update': {
      if (!exact(p,['statuses','tasks']) || !Array.isArray(p.statuses) || !Array.isArray(p.tasks) || p.statuses.length < 1 || p.statuses.length > 30 || p.tasks.length > 500) return false;
      const ids = new Set<string>();
      for (const s of p.statuses) {
        if (!exact(s,['id','name','color','order']) || !str(s,'id',1,128) || !str(s,'name',1,128) || !str(s,'color',1,32) || !Number.isInteger(s.order) || (s.order as number) < 0 || (s.order as number) > 1000 || ids.has(s.id as string)) return false;
        ids.add(s.id as string);
      }
      return p.tasks.every((t) => exact(t,['id','title','body','statusId','createdAt','updatedAt'], ['driveFileId']) && str(t,'id',1,160) && str(t,'title',1,500) && str(t,'body',0,20000) && typeof t.statusId === 'string' && ids.has(t.statusId) && (t.driveFileId === undefined || isTaskDriveFileId(t.driveFileId)) && timestamp(t.createdAt) && timestamp(t.updatedAt));
    }
    case 'notes:note:create': case 'notes:note:update': return exact(p,['id','title','body','updatedAt']) && p.id === resourceId && str(p,'title',0,500) && str(p,'body',0,100000) && upd();
    case 'calendar:event:create': case 'calendar:event:update': return exact(p,['id','title','kind','dates'],['startTime','endTime']) && p.id === resourceId && str(p,'title',1,500) && ['timed','allDay','multiDate'].includes(String(p.kind)) && Array.isArray(p.dates) && p.dates.length > 0 && p.dates.length <= 366 && p.dates.every((d) => typeof d === 'string' && isCalendarDate(d)) && ['startTime','endTime'].every((k) => p[k] === undefined || (typeof p[k] === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p[k] as string)));
    case 'workspace:settings:create': case 'workspace:settings:update': return exact(p,['name','locale','timezone','updatedAt']) && str(p,'name',1,120) && str(p,'locale',2,35) && str(p,'timezone',1,64) && upd();
    case 'messenger:channel:create': case 'messenger:channel:update': {
      const kind = String(p.kind);
      const members = p.memberIds;
      const memberIdsValid = members === undefined || (arrStrings(p,'memberIds',100,160) && new Set(members as string[]).size === (members as string[]).length);
      return exact(p,['id','name','kind','updatedAt'],['memberIds']) && str(p,'id',1,160) && !String(p.id).includes('|') && str(p,'name',1,120)
        && ['public','private','direct','events'].includes(kind) && memberIdsValid
        && (kind !== 'direct' || Array.isArray(members) && members.length === 2)
        && (kind !== 'private' || Array.isArray(members) && members.length > 0) && upd();
    }
    case 'messenger:message:create': case 'messenger:message:update': return exact(p,['id','channelId','body','mentionUserIds','attachmentIds','createdAt','updatedAt']) && str(p,'id',1,160) && !String(p.id).includes('|') && str(p,'channelId',1,160) && !String(p.channelId).includes('|') && str(p,'body',0,20000) && arrStrings(p,'mentionUserIds',100,160) && arrStrings(p,'attachmentIds',20,160) && timestamp(p.createdAt) && upd();
    case 'messenger:reaction:create': return exact(p,['id','messageId','emoji','createdAt']) && str(p,'id',1,160) && str(p,'messageId',1,160) && str(p,'emoji',1,32) && timestamp(p.createdAt);
    case 'files:fileMetadata:create': case 'files:fileMetadata:update': return exact(p,['id','name','mimeType','sizeBytes','blobId','version','updatedAt']) && str(p,'id',1,160) && str(p,'name',1,255) && str(p,'mimeType',1,160) && integer(p,'sizeBytes',0,67108864) && str(p,'blobId',1,160) && integer(p,'version',1,1000000) && upd();
    case 'canvas:board:create': case 'canvas:board:update': return exact(p,['id','title','document','updatedAt']) && str(p,'id',1,160) && str(p,'title',1,200) && object(p.document) && upd();
    case 'mail:account:create': case 'mail:account:update': return exact(p,['id','provider','address','secretRef','status','updatedAt']) && str(p,'id',1,160) && ['imap','gmail','outlook','sorye'].includes(String(p.provider)) && str(p,'address',3,320) && str(p,'secretRef',1,160) && ['connected','disconnected','error'].includes(String(p.status)) && upd();
    case 'mail:draft:create': case 'mail:draft:update': return exact(p,['id','accountId','to','cc','bcc','subject','body','attachmentIds','updatedAt']) && str(p,'id',1,160) && str(p,'accountId',1,160) && arrStrings(p,'to',100,320) && arrStrings(p,'cc',100,320) && arrStrings(p,'bcc',100,320) && str(p,'subject',0,998) && str(p,'body',0,100000) && arrStrings(p,'attachmentIds',20,160) && upd();
    case 'relay:config:create': case 'relay:config:update': return exact(p,['id','enabled','rules','updatedAt']) && str(p,'id',1,160) && bool(p,'enabled') && Array.isArray(p.rules) && p.rules.length <= 100 && p.rules.every((r) => exact(r,['source','destination','targetRef','enabled']) && str(r,'source',1,64) && ['messenger','webhook','email'].includes(String(r.destination)) && str(r,'targetRef',1,160) && bool(r,'enabled')) && upd();
    case 'site:page:create': case 'site:page:update': return exact(p,['id','slug','title','published','blocks','updatedAt']) && str(p,'id',1,160) && siteSlug(p.slug) && str(p,'title',1,200) && bool(p,'published') && Array.isArray(p.blocks) && p.blocks.length <= 100 && p.blocks.every((b) => exact(b,['id','kind','content']) && str(b,'id',1,160) && ['hero','about','links','shop','contact'].includes(String(b.kind)) && object(b.content)) && upd();
    case 'storefront:product:create': case 'storefront:product:update': return exact(p,['id','name','description','currency','priceMinor','active','updatedAt'],['title','summary','category','accent','priceCents']) && str(p,'id',1,160) && str(p,'name',1,200) && str(p,'description',0,8000) && str(p,'currency',3,3) && integer(p,'priceMinor',0,9000000000000) && bool(p,'active') && (p.title === undefined || (str(p,'title',1,120) && p.title === p.name)) && (p.summary === undefined || str(p,'summary',0,240)) && (p.category === undefined || str(p,'category',0,40)) && (p.accent === undefined || str(p,'accent',0,32)) && (p.priceCents === undefined || (integer(p,'priceCents',0,10000000) && p.priceCents === p.priceMinor)) && upd();
    case 'storefront:order:create': return exact(p,['id','status','customerName','customerEmail','items','note','createdAt','updatedAt']) && str(p,'id',1,160) && p.status === 'requested' && str(p,'customerName',1,200) && str(p,'customerEmail',3,320) && str(p,'note',0,2000) && Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 100 && p.items.every((i) => exact(i,['productId','quantity','unitPriceMinor']) && str(i,'productId',1,160) && integer(i,'quantity',1,10000) && integer(i,'unitPriceMinor',0,9000000000000)) && timestamp(p.createdAt) && upd();
    case 'storefront:order:update': return exact(p,['id','status','customerName','customerEmail','items','note','createdAt','updatedAt']) && str(p,'id',1,160) && ['requested','accepted','cancelled','fulfilled'].includes(String(p.status)) && str(p,'customerName',1,200) && str(p,'customerEmail',3,320) && str(p,'note',0,2000) && Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 100 && p.items.every((i) => exact(i,['productId','quantity','unitPriceMinor']) && str(i,'productId',1,160) && integer(i,'quantity',1,10000) && integer(i,'unitPriceMinor',0,9000000000000)) && timestamp(p.createdAt) && upd();
    case 'ocr:analysis:create': case 'ocr:analysis:update': return exact(p,['id','status','documentRef','pageCount','createdAt','updatedAt']) && str(p,'id',1,160) && ['queued','processing','complete','failed'].includes(String(p.status)) && str(p,'documentRef',1,160) && integer(p,'pageCount',1,10000) && timestamp(p.createdAt) && upd();
    case 'ocr:pattern:create': case 'ocr:pattern:update': return exact(p,['id','analysisId','pattern','updatedAt']) && str(p,'id',1,160) && str(p,'analysisId',1,160) && object(p.pattern) && upd();
    case 'studio:project:create': case 'studio:project:update': return exact(p,['id','name','assetRefs','state','updatedAt']) && str(p,'id',1,160) && str(p,'name',1,200) && arrStrings(p,'assetRefs',1000,160) && object(p.state) && upd();
    case 'notifications:notification:create': case 'notifications:notification:update': return exact(p,['id','kind','title','body','createdAt','readAt']) && str(p,'id',1,160) && str(p,'kind',1,64) && str(p,'title',1,200) && str(p,'body',0,2000) && timestamp(p.createdAt) && (p.readAt === null || timestamp(p.readAt));
    case 'events:event:create': return exact(p,['id','name','appId','entityId','payload','createdAt']) && str(p,'id',1,160) && str(p,'name',1,128) && str(p,'appId',1,64) && str(p,'entityId',0,160) && object(p.payload) && timestamp(p.createdAt);
    case 'embed:widget:create': case 'embed:widget:update': return exact(p,['id','name','enabled','config','updatedAt']) && str(p,'id',1,160) && str(p,'name',1,120) && bool(p,'enabled') && object(p.config) && upd();
    case 'protocolio:artifact:create': case 'protocolio:artifact:update': return exact(p,['id','kind','content','updatedAt']) && str(p,'id',1,160) && ['template','generatedPdfRef'].includes(String(p.kind)) && object(p.content) && upd();
    default: return false;
  }
}

const supported: Record<string, string[]> = {
  'tasks:task':['create','update','delete'], 'tasks:taskBoard':['create','update'], 'notes:note':['create','update','delete'], 'calendar:event':['create','update','delete'],
  'workspace:settings':['create','update'], 'messenger:channel':['create','update'], 'messenger:message':['create','update'], 'messenger:reaction':['create'],
  'files:fileMetadata':['create','update'], 'canvas:board':['create','update','delete'], 'mail:account':['create','update'], 'mail:draft':['create','update'],
  'relay:config':['create','update'], 'site:page':['create','update'], 'storefront:product':['create','update'], 'storefront:order':['create','update'],
  'ocr:analysis':['create','update'], 'ocr:pattern':['create','update'], 'studio:project':['create','update'], 'notifications:notification':['create','update'],
  'events:event':['create'], 'embed:widget':['create','update'], 'protocolio:artifact':['create','update'],
};
const actionSchema = z.object({
  actionId: z.string().uuid(), appId: z.enum(['tasks','notes','calendar','workspace','messenger','files','canvas','mail','relay','site','storefront','ocr','studio','notifications','events','embed','protocolio']),
  resourceType: z.enum(['task','taskBoard','note','event','settings','channel','message','reaction','fileMetadata','board','account','draft','config','page','product','order','analysis','pattern','project','notification','widget','artifact']), operation: z.enum(['create','update','delete']),
  resourceId: z.string().min(1).max(160), expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1).optional(), payloadVersion: z.literal(1), payload: z.record(z.unknown()), occurredAt: z.string().max(64).refine(timestamp),
}).strict().superRefine((value, ctx) => {
  const key = `${value.appId}:${value.resourceType}`;
  if ((value.operation === 'create') !== (value.expectedRevision === undefined)) ctx.addIssue({ code:'custom', path:['expectedRevision'], message:'create omits expectedRevision; update/delete require it' });
  if (!supported[key]?.includes(value.operation)) ctx.addIssue({ code:'custom', path:['operation'], message:'unsupported app, resource type, or operation' });
  if (!validPayload(value.appId, value.resourceType, value.operation, value.payload, value.resourceId)) ctx.addIssue({ code:'custom', path:['payload'], message:'payload does not match the typed Rodrigo v2 domain schema' });
  if (value.appId === 'tasks' && value.resourceType === 'taskBoard' && value.operation !== 'delete') {
    try {
      const parsed = parseTasksBoard(value.payload);
      if (parsed.statuses.length !== (value.payload.statuses as unknown[]).length || parsed.tasks.length !== (value.payload.tasks as unknown[]).length) throw new Error('invalid board');
    } catch { ctx.addIssue({ code:'custom', path:['payload'], message:'payload does not match the typed Tasks board schema' }); }
  }
});

export const actionBatchSchema = z.object({ actions: z.array(actionSchema).min(1).max(100) }).strict();
export function hasDuplicateActionIds(actions: ReadonlyArray<{ actionId: string }>) { return new Set(actions.map((action) => action.actionId)).size !== actions.length; }
export const RODRIGO_ACTION_BATCH_MAX_BYTES = 262144;
export async function readBoundedActionBatchJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > RODRIGO_ACTION_BATCH_MAX_BYTES) throw new Error('too_large');
  if (!req.body) throw new Error('invalid');
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > RODRIGO_ACTION_BATCH_MAX_BYTES) throw new Error('too_large'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
