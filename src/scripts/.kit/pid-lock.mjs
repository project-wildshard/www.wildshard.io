// A lock file that holds its owner's pid, shared by `pins.ts install` (out/.pins.lock) and the worktree reaper (which
// takes a worktree's `wildshard-land.lock`, land.mjs's format, so land can't start under it).
//
// The file appears whole: it is a hard link of a file already holding the pid, so nobody ever reads it empty. A lock
// whose owner is gone is taken over by rename, and only the contender whose rename took the dead owner's file drops
// it; anything else goes back. A lock that can't be read as a pid (a folder, garbage, no permission) is never taken
// over: the caller gets an error naming it.
import {linkSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';

const sleeper=new Int32Array(new SharedArrayBuffer(4));

/** Is `pid` a live process? A process of another user (EPERM) counts as alive. @param {number} pid */
function alive(pid){
 try{process.kill(pid,0);return true;}
 catch(error){return error instanceof Error&&'code' in error&&error.code==='EPERM';}
}

/** The owner pid in `file`, undefined if the file is gone; throws if it is not a lock this module wrote.
 * @param {string} file */
function ownerOf(file){
 let text;
 try{text=readFileSync(file,'utf8');}
 catch(error){
  if(error instanceof Error&&'code' in error&&error.code==='ENOENT')return undefined;
  throw new Error(`${file} is not a readable lock file (${error instanceof Error?error.message:String(error)}); remove it if nothing holds it`,{cause:error});
 }
 const pid=Number(text.trim());
 if(!Number.isSafeInteger(pid)||pid<=0)throw new Error(`${file} does not hold a pid; remove it if nothing holds it`);
 return pid;
}

/**
 * Take `file` for this process. Returns the release, or undefined when a live process still holds it after `waitMs`
 * (0: don't wait). The release removes the file only while it is still this process's.
 * @param {string} file @param {{waitMs?:number}} [options] @returns {(() => void)|undefined}
 */
export function pidLock(file,{waitMs=0}={}){
 const mine=`${file}.${String(process.pid)}.${Math.random().toString(36).slice(2)}`;
 writeFileSync(mine,String(process.pid));
 const started=Date.now();
 try{
  for(let attempt=0;attempt<10_000;attempt++){
   try{
    linkSync(mine,file);
    return ()=>{try{if(ownerOf(file)===process.pid)rmSync(file,{force:true});}catch{/* Gone or replaced. */}};
   }catch(error){if(!(error instanceof Error&&'code' in error&&error.code==='EEXIST'))throw error;}
   const owner=ownerOf(file);
   if(owner===undefined)continue;
   if(!alive(owner)){
    const taken=`${file}.stale.${String(process.pid)}`;
    try{renameSync(file,taken);}catch{continue;}
    let held;
    try{held=ownerOf(taken);}catch{held=undefined;}
    if(held!==owner){try{linkSync(taken,file);}catch{/* A live owner holds it again. */}}
    rmSync(taken,{force:true});
    continue;
   }
   if(Date.now()-started>=waitMs)return undefined;
   Atomics.wait(sleeper,0,0,250);
  }
  throw new Error(`${file}: no stable owner after 10,000 tries`);
 }finally{rmSync(mine,{force:true});}
}
