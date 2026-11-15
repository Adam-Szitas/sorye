import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { boundedBodyStream,withUploadSlot,UploadLimitError } from '@/lib/bounded-upload';
import { recipientHash,publicDriveCall,publicViewSchema,shareHeaders,admitShare } from '@/lib/drive-sharing';
import { readJson,responseError } from '@/lib/rodrigo/transport';
import { uploadDriveFile,DriveUploadError } from '@/lib/rodrigo/drive-client';
import { RodrigoResponseError } from '@/lib/rodrigo/service-client';
import { resolveWorkspaceFileMime,sanitizeDisplayName,FileAccessError } from '@/lib/files-policy';

export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{operation:string}>}){
  const {operation}=await params;
  const hash=recipientHash(request);
  const reply=(error:string,status:number)=>Response.json({error},{status,headers:shareHeaders});
  if(!hash)return reply('This shared link is unavailable.',404);
  if(!admitShare(hash))return reply('Too many requests. Please retry in a minute.',429);
  if(request.headers.get('sec-fetch-site')==='cross-site')return reply('Open the original shared link to continue.',403);
  try{
    if(operation==='upload')return await withUploadSlot(async()=>{
      const name=sanitizeDisplayName(decodeURIComponent(request.headers.get('x-file-name')??''));
      const folderPath=decodeURIComponent(request.headers.get('x-folder-path')??'');
      const size=Number(request.headers.get('x-file-size'));
      if(!Number.isSafeInteger(size)||size<=0||size>64*1024*1024)return reply('Files must be between 1 byte and 64 MiB.',413);
      const view=await readJson(await publicDriveCall(hash,'resolve'),publicViewSchema,4*1024*1024);
      if(view.kind!=='folder'||view.permission!=='read_write')return reply('This link allows downloads only.',403);
      const reader=boundedBodyStream(request,size,{timeoutMs:120000}).getReader();
      try{
        const initial:Uint8Array[]=[];let length=0;
        while(length<8192){const {done,value}=await reader.read();if(done)break;initial.push(value);length+=value.length;}
        const mime=resolveWorkspaceFileMime(Buffer.concat(initial).subarray(0,8192),name);
        async function* source(){yield* initial;while(true){const {done,value}=await reader.read();if(done)return;yield value;}}
        await uploadDriveFile({userId:'rodrigo-drive-recipient',workspaceId:'rodrigo-public-drive'},{fileId:randomUUID(),displayName:name,mime,sourceAppId:'files',folderPath,size},source(),{shareHash:hash});
        return Response.json({ok:true},{headers:shareHeaders});
      }finally{await reader.cancel().catch(()=>undefined);}
    });
    const input=await new Response(boundedBodyStream(request,4096,{timeoutMs:10000})).json();
    if(operation==='resolve')return Response.json(await readJson(await publicDriveCall(hash,'resolve'),publicViewSchema,4*1024*1024),{headers:shareHeaders});
    if(operation==='folders'){
      const data=z.object({path:z.string().min(1).max(1024)}).strict().parse(input);
      await readJson(await publicDriveCall(hash,'folders',data),z.object({path:z.string()}));
      return Response.json({ok:true},{headers:shareHeaders});
    }
    if(operation==='download'){
      const {id}=z.object({id:z.string().uuid()}).strict().parse(input);
      const response=await publicDriveCall(hash,`content/${id}`);
      if(!response.ok)await responseError(response);
      return new Response(response.body,{headers:{...shareHeaders,'Content-Type':'application/octet-stream','Content-Disposition':'attachment'}});
    }
    return reply('This shared link is unavailable.',404);
  }catch(e){
    if(e instanceof FileAccessError||e instanceof UploadLimitError)return reply(e.message,e.status);
    if(e instanceof RodrigoResponseError||e instanceof DriveUploadError){
      if([401,403,404].includes(e.status))return reply('This shared link is unavailable or no longer allows this action.',e.status===403?403:404);
      return reply(e.code==='storage_target_changed'?'The storage destination changed. Ask the sender for a new link.':e.code==='quota_exceeded'||e.code==='too_many_files'?'The shared storage has reached its upload limit.':'The action could not finish. Check storage availability and try again.',e.status);
    }
    return reply('The action could not finish. Please try again.',400);
  }
}
