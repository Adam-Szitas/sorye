'use client';
import { useEffect,useId,useRef,useState } from 'react';
import type { DriveShare } from '@/lib/drive-sharing';

const control='rounded-lg border border-white/20 bg-transparent px-3 py-2';
export function DriveSharing({workspaceId,kind,root,label}:{workspaceId:string;kind:'file'|'folder';root:string;label:string}){
  const dialog=useRef<HTMLDialogElement>(null);const titleId=useId();
  const [shares,setShares]=useState<DriveShare[]>([]);const [permission,setPermission]=useState('read');const [days,setDays]=useState(7);
  const [url,setUrl]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [revoke,setRevoke]=useState<string|null>(null);
  useEffect(()=>{dialog.current?.close();setUrl('');setShares([]);},[workspaceId,root]);
  async function refresh(){const r=await fetch('/api/files/shares',{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error);setShares(data.shares.filter((s:DriveShare)=>s.kind===kind&&s.root===root));}
  async function run(action:()=>Promise<void>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Sharing is unavailable.');}finally{setBusy(false);}}
  async function update(s:DriveShare,revoked=false){
    const r=await fetch('/api/files/shares',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:s.id,expectedRevision:s.revision,permission:revoked?s.permission:permission,days,revoke:revoked,expectedWorkspaceId:workspaceId})});
    const data=await r.json();if(!r.ok)throw new Error(data.error);setRevoke(null);setUrl('');await refresh();
  }
  return <>
    <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-muted)] transition hover:bg-white/10 hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]" aria-label={`Share ${label}`} title={`Share ${label}`} onClick={()=>{setUrl('');dialog.current?.showModal();void run(refresh);}}>
      <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4"/></svg>
    </button>
    <dialog ref={dialog} aria-labelledby={titleId} className="m-auto w-[min(94vw,640px)] max-h-[85vh] overflow-auto rounded-2xl border border-white/20 bg-[#111827] p-6 text-white shadow-2xl" onClose={()=>{setUrl('');setRevoke(null);}}>
      <div className="flex items-start justify-between gap-4"><h2 id={titleId} className="text-xl font-semibold break-all">Share {label}</h2><button type="button" className={control} onClick={()=>dialog.current?.close()}>Close</button></div>
      <p className="my-3 text-sm text-slate-300">Anyone with the link can download {kind==='file'?'this file':'this folder and its contents'}. Folder write access adds uploads and new folders only. It never replaces or deletes existing files.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();void run(async()=>{
        const r=await fetch('/api/files/shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,root,permission,days,expectedWorkspaceId:workspaceId})});const data=await r.json();if(!r.ok)throw new Error(data.error);
        setUrl(`${location.origin}/share#${data.token}`);await refresh();
      });}}>
        <label className="grid gap-1 text-sm">Permission<select className={control} value={permission} onChange={e=>setPermission(e.target.value)}><option className="bg-slate-900" value="read">Read only</option>{kind==='folder'&&<option className="bg-slate-900" value="read_write">Read + upload / create folders</option>}</select></label>
        <label className="grid gap-1 text-sm">Expires in days<input className={`${control} w-24`} type="number" required min={1} max={30} value={days} onChange={e=>setDays(Number(e.target.value))}/></label>
        <button className={`${control} bg-indigo-600`} disabled={busy}>Create link</button>
      </form>
      {url&&<div className="my-4 rounded-xl bg-indigo-500/10 p-3"><p className="text-sm">Copy this link now. It cannot be recovered after closing.</p><input className={`${control} my-2 w-full`} aria-label="New public link" readOnly value={url} onFocus={e=>e.target.select()}/><button className={control} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(url);})}>Copy link</button></div>}
      <p role="status" className="my-3 text-sm text-amber-200">{busy?'Working…':error}</p>
      <h3 className="font-medium">Your links for this {kind}</h3>
      {!shares.length&&!busy&&<p className="my-3 text-sm text-slate-400">No links yet. This resource is private until you share it.</p>}
      <ul className="divide-y divide-white/10">{shares.map(s=><li key={s.id} className="py-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{s.permission==='read'?'Read only':'Read + upload / create folders'}</strong><span>{s.revoked?'Revoked':Date.parse(s.expiresAt)<=Date.now()?'Expired':'Active'} · {s.id.slice(0,8)}</span></div>
        <p className="my-1 text-slate-400">Created {new Date(s.createdAt).toLocaleString()} · Expires {new Date(s.expiresAt).toLocaleString()}</p>
        {!s.revoked&&<div className="flex flex-wrap gap-2"><button className={control} disabled={busy} onClick={()=>void run(()=>update(s))}>Apply permission and expiry above</button>{revoke===s.id?<><span>Revoke permanently?</span><button className={control} disabled={busy} onClick={()=>void run(()=>update(s,true))}>Confirm revoke</button><button className={control} onClick={()=>setRevoke(null)}>Keep link</button></>:<button className={control} onClick={()=>setRevoke(s.id)}>Revoke</button>}</div>}
      </li>)}</ul>
    </dialog>
  </>;
}
