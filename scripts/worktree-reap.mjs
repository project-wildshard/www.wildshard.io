// REPO-DISK J358: report plan-worktree liveness for a human audit.
// This command never removes worktrees or branches and never stops processes.
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readdirSync,readlinkSync,statSync,statfsSync} from 'node:fs';
import {basename,join,resolve,sep} from 'node:path';
import {laneLive} from './lane-live.mjs';
import {WORKTREES} from './worktree-ignore.mjs';

const REAP_USAGE='usage: node scripts/worktree.mjs reap [--dry-run] [--grace=HOURS] [--stale=HOURS] [--no-remote]';

/** @param {string[]} argv the arguments after `reap` @returns {{dryRun:boolean,graceHours:number,staleHours:number,remote:boolean}} */
export function parseReapArgs(argv){
 const options={dryRun:false,graceHours:24,staleHours:72,remote:true};
 for(const arg of argv){
  const [name,value]=arg.split('=',2);
  if(arg==='--dry-run')options.dryRun=true;
  else if(arg==='--no-remote')options.remote=false;
  else if(name==='--grace'&&value!==undefined&&/^\d+(?:\.\d+)?$/u.test(value))options.graceHours=Number(value);
  else if(name==='--stale'&&value!==undefined&&/^\d+(?:\.\d+)?$/u.test(value))options.staleHours=Number(value);
  else throw new Error(`unknown option ${arg}\n${REAP_USAGE}`);
 }
 return options;
}

/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64<<20});
/** @param {string} cwd @param {string[]} args */
const tryGit=(cwd,args)=>spawnSync('git',args,{cwd,encoding:'utf8',maxBuffer:64<<20});

/** The working directory of every process this user can see, by pid; undefined when they can't be listed (then
 * every worktree counts as busy). Linux reads /proc; elsewhere `lsof -d cwd`.
 * @returns {Map<number,string>|undefined} */
export function processDirectories(){
 /** @type {Map<number,string>} */const found=new Map();
 if(existsSync('/proc/self/cwd')){
  for(const name of readdirSync('/proc')){
   if(!/^\d+$/u.test(name))continue;
   try{found.set(Number(name),readlinkSync(`/proc/${name}/cwd`));}catch{/* Gone, or another user's. */}
  }
  return found;
 }
 // From /, so lsof itself never shows up in the folder being checked.
 const listed=spawnSync('lsof',['-a','-d','cwd','-F','pn'],{cwd:'/',encoding:'utf8',maxBuffer:64<<20});
 if(listed.error!==undefined||listed.status!==0||listed.stdout==='')return undefined;
 let pid=0;
 for(const line of listed.stdout.split('\n')){
  if(line.startsWith('p'))pid=Number(line.slice(1));
  else if(line.startsWith('n')&&pid>0)found.set(pid,line.slice(1));
 }
 return found;
}

/** pid -> parent pid and command line, from `ps`. @returns {Map<number,{ppid:number,state:string,command:string}>} */
function processTable(){
 /** @type {Map<number,{ppid:number,state:string,command:string}>} */const table=new Map();
 const listed=spawnSync('ps',['-Ao','pid=,ppid=,stat=,command='],{encoding:'utf8',maxBuffer:64<<20});
 if(listed.error!==undefined||listed.status!==0)throw new Error('process table unreadable');
 for(const line of (listed.stdout??'').split('\n')){
  const match=/^\s*(\d+)\s+(\d+)\s+(\S+)\s(.*)$/u.exec(line);
  if(match!==null)table.set(Number(match[1]),{ppid:Number(match[2]),state:match[3]??'',command:match[4]??''});
 }
 return table;
}

/** TEST-SPEED FL30: stop what still runs inside a worktree before it is removed, so nothing outlives its folder
 * holding a resource (an orphaned Vitest from a removed worktree kept its CPU broker's slots all night). Never this
 * process or its ancestors (land runs from the worktree), never a bare interactive shell, and only processes whose own
 * working directory is inside. `orphansOnly` (the reaper) takes only processes reparented to pid 1: something live
 * still keeps a worktree.
 * SIGTERM, then SIGKILL after 3 s. Returns the pids it signalled (with `dryRun`, would signal).
 * @param {string} tree the worktree's physical path @param {{orphansOnly?:boolean,dryRun?:boolean}} [options]
 * @returns {number[]} */
export function stopWorktreeProcesses(tree,options={}){
 const directories=processDirectories();
 if(directories===undefined)throw new Error('process directories unreadable');
 const table=processTable(),spared=new Set();
 // Without the table nothing tells land's own parents apart: retain the tree.
 if(!table.has(process.pid))throw new Error('process ancestry unreadable');
 for(let pid=process.pid;pid>1&&!spared.has(pid);pid=table.get(pid)?.ppid??0)spared.add(pid);
 const shell=(/** @type {string} */ command)=>/^-?(?:\S*\/)?(?:ba|z|da|fi|k|tc|c)?sh$/u.test(command.trim());
 // Only processes whose own working directory is inside: a daemon's children elsewhere are not this worktree's.
 const pids=[...directories].filter(([pid,path])=>(path===tree||path.startsWith(`${tree}${sep}`))&&!spared.has(pid)
  &&!shell(table.get(pid)?.command??'')&&(options.orphansOnly!==true||table.get(pid)?.ppid===1)).map(([pid])=>pid);
 if(options.dryRun===true||pids.length===0)return pids;
 const signal=(/** @type {number} */ pid,/** @type {NodeJS.Signals|0} */ name)=>{try{process.kill(pid,name);return true;}catch{return false;}};
 for(const pid of pids)signal(pid,'SIGTERM');
 const until=Date.now()+3000,nap=new Int32Array(new SharedArrayBuffer(4));
 while(Date.now()<until&&pids.some(pid=>signal(pid,0)))Atomics.wait(nap,0,0,50);
 for(const pid of pids)signal(pid,'SIGKILL');
 const killedUntil=Date.now()+1000;
 let remaining=pids;
 do{
  const current=processTable();
  // Exited children may remain zombies until their blocked parent reaps them.
  // They cannot write; a live or uninspectable process still retains the tree.
  remaining=pids.filter(pid=>current.has(pid)&&!current.get(pid).state.startsWith('Z'));
  if(remaining.length===0)break;
  Atomics.wait(nap,0,0,25);
 }while(Date.now()<killedUntil);
 if(remaining.length>0)throw new Error('a worktree process is still alive');
 return pids;
}

/** Newest change in the worktree's own Git state, in ms. @param {string} tree @param {string} gitDir */
export function lastActivity(tree,gitDir){
 let newest=Number(git(tree,['log','-1','--format=%ct','HEAD']).trim())*1000;
 for(const file of ['index','HEAD','logs/HEAD'])try{newest=Math.max(newest,statSync(join(gitDir,file)).mtimeMs);}catch{/* Not there. */}
 return newest;
}

/** Free bytes on the volume holding `path` (what `df` shows as available). @param {string} path */
export function freeBytes(path){
 const volume=statfsSync(path);
 return volume.bavail*volume.bsize;
}

/** Is `sha` on origin/main itself? @param {string} canonical @param {string} sha */
export const onMain=(canonical,sha)=>sha!==''&&tryGit(canonical,['merge-base','--is-ancestor',sha,'origin/main']).status===0;

/** @typedef {{path:string,head:string,branch:string}} Worktree */

/** Linked worktrees of the repo from `git worktree list --porcelain -z`. @param {string} canonical @returns {Worktree[]} */
export function linkedWorktrees(canonical){
 /** @type {Worktree[]} */const trees=[];
 /** @type {Partial<Worktree>} */let current={};
 for(const field of [...git(canonical,['worktree','list','--porcelain','-z']).split('\0'),'']){
  if(field===''){if(current.path!==undefined)trees.push({path:current.path,head:current.head??'',branch:current.branch??''});current={};continue;}
  const [key,...rest]=field.split(' '),value=rest.join(' ');
  if(key==='worktree')current.path=value;
  else if(key==='HEAD')current.head=value;
  else if(key==='branch')current.branch=value;
 }
 return trees.slice(1);
}

/**
 * Reap every landed, clean, idle plan worktree of the repo `cwd` is in. Returns the exit code.
 * @param {string} canonical the canonical checkout @param {ReturnType<typeof parseReapArgs>} options
 * @param {NodeJS.ProcessEnv} env @param {(line:string)=>void} say
 */
export function reap(canonical,options,env,say){
 // J358: this command is an inventory for a human audit. Land alone removes
 // its own just-landed worktree, after a successful keep-copy.
 const directories=processDirectories();
 const cwds=directories===undefined?null:[...directories.values()];
 for(const tree of linkedWorktrees(canonical)){
  const slug=basename(tree.path);
  if(resolve(tree.path)!==join(canonical,WORKTREES,slug)){
   say(`skipped ${tree.path}: outside plan worktrees`);continue;
  }
  const state=laneLive(tree.path,{receipts:env.WS_LANE_RECEIPTS,cwds,activeLog:env.WS_ACTIVE_HOURS_LOG});
  const landed=onMain(canonical,tree.head);
  say(`${state.state} ${slug}: ${state.reason}; ${landed?'on origin/main':'not on origin/main'}; manual audit, copy before removal`);
 }
 return 0;
}
