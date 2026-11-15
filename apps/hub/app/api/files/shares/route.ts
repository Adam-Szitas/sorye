import { ensureHubUser } from '@/lib/ensure-user';
import { boundedBodyStream } from '@/lib/bounded-upload';
import { createShareSchema,updateShareSchema,listShares,manageShare,shareHeaders,admitShare } from '@/lib/drive-sharing';
import { RodrigoResponseError } from '@/lib/rodrigo/service-client';

export async function GET(){
  const session=await ensureHubUser();
  if(!session)return Response.json({error:'Sign in required.'},{status:401,headers:shareHeaders});
  try{return Response.json(await listShares({userId:session.user.id,workspaceId:session.workspace.id}),{headers:shareHeaders});}
  catch{return Response.json({error:'Sharing is temporarily unavailable.'},{status:503,headers:shareHeaders});}
}
async function mutate(request:Request,update:boolean){
  const session=await ensureHubUser();
  if(!session)return Response.json({error:'Sign in required.'},{status:401,headers:shareHeaders});
  if(!admitShare(`owner:${session.user.id}`))return Response.json({error:'Please retry shortly.'},{status:429,headers:shareHeaders});
  try{
    const raw=await new Response(boundedBodyStream(request,8192,{timeoutMs:10000})).json();
    const parsed=(update?updateShareSchema:createShareSchema).safeParse(raw);
    if(!parsed.success)return Response.json({error:'Check target, permission and expiry (1–30 days).'},{status:400,headers:shareHeaders});
    if(parsed.data.expectedWorkspaceId!==session.workspace.id)return Response.json({error:'Workspace changed. Reopen Drive.'},{status:409,headers:shareHeaders});
    return Response.json(await manageShare({userId:session.user.id,workspaceId:session.workspace.id},parsed.data),{headers:shareHeaders});
  }catch(e){return Response.json({error:e instanceof RodrigoResponseError && e.status===409?'The link changed or the share limit was reached. Refresh and try again.':'Could not save the link. Check the target and storage availability.'},{status:e instanceof RodrigoResponseError?e.status:400,headers:shareHeaders});}
}
export const POST=(request:Request)=>mutate(request,false);
export const PATCH=(request:Request)=>mutate(request,true);
