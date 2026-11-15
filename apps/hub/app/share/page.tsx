import type { Metadata } from 'next';
import { PublicDrive } from './public-drive';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Shared files · Sorye',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function SharePage(){return <PublicDrive/>;}
