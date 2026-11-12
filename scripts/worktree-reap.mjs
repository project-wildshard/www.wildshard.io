// DEV-SPEED DS13: `node scripts/worktree.mjs reap [--dry-run] [--grace=HOURS] [--no-remote]` removes the plan
// worktrees whose work is on main, and nothing else. Safe to run any time, from any checkout of the repo.
//
// A worktree at <canonical>/.worktrees/<slug> on plan/<slug> is reaped only when all of these hold:
//   - landed: the branch tip is on origin/main itself (`merge-base --is-ancestor`; land fast-forwards), after a fetch;
//   - clean: `git status --porcelain` is empty (tracked edits and untracked files; ignored build output doesn't count);
//   - idle: no process has its working directory inside it (orphans reparented to pid 1 are stopped first, FL30), no `land` holds its lock, no `worktree new` is running,
//     and nothing in it (index, HEAD, reflog, tip commit) changed for --grace hours (default 24: a lane between
//     landings keeps its worktree). The reaper then holds the worktree's land lock and checks HEAD, the tree, the
//     processes and setup again before it removes anything; a worktree whose folder resolves outside
//     <canonical>/.worktrees/ is skipped.
// Then: `git worktree remove` (never --force), the local branch deleted only while it still points at the checked
// commit, and `origin plan/<slug>` deleted (`git push --delete`, which the pre-push lets through without a gate)
// only if the remote branch is landed too, under a lease on the SHA it had. A worktree that fails any check is kept
// and named with the reason; an unlanded branch, local or remote, is never touched. Every run appends one receipt.
import {execFileSync,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,mkdirSync,readdirSync,readlinkSync,realpathSync,statSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';
import {pidLock} from './pid-lock.mjs';
import {WORKTREES} from './worktree-ignore.mjs';

const REAP_USAGE='usage: node scripts/worktree.mjs reap [--dry-run] [--grace=HOURS] [--no-remote]';

/** @param {string[]} argv the arguments after `reap` @returns {{dryRun:boolean,graceHours:number,remote:boolean}} */
export function parseReapArgs(argv){
 const options={dryRun:false,graceHours:24,remote:true};
 for(const arg of argv){
  const [name,value]=arg.split('=',2);
  if(arg==='--dry-run')options.dryRun=true;
  else if(arg==='--no-remote')options.remote=false;
  else if(name==='--grace'&&value!==undefined&&/^\d+(?:\.\d+)?$/u.test(value))options.graceHours=Number(value);
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
 if(listed.error!==undefined||listed.stdout==='')return undefined;
 let pid=0;
 for(const line of listed.stdout.split('\n')){
  if(line.startsWith('p'))pid=Number(line.slice(1));
  else if(line.startsWith('n')&&pid>0)found.set(pid,line.slice(1));
 }
 return found;
}

/** pid -> parent pid and command line, from `ps`. @returns {Map<number,{ppid:number,command:string}>} */
function processTable(){
 /** @type {Map<number,{ppid:number,command:string}>} */const table=new Map();
 const listed=spawnSync('ps',['-Ao','pid=,ppid=,command='],{encoding:'utf8',maxBuffer:64<<20});
 for(const line of (listed.stdout??'').split('\n')){
  const match=/^\s*(\d+)\s+(\d+)\s(.*)$/u.exec(line);
  if(match!==null)table.set(Number(match[1]),{ppid:Number(match[2]),command:match[3]??''});
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
 if(directories===undefined)return [];
 const table=processTable(),spared=new Set();
 // Without the table nothing tells land's own parents apart (J206 review): stop nothing.
 if(!table.has(process.pid))return [];
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
 return pids;
}

/** Newest change in the worktree's own Git state, in ms. @param {string} tree @param {string} gitDir */
export function lastActivity(tree,gitDir){
 let newest=Number(git(tree,['log','-1','--format=%ct','HEAD']).trim())*1000;
 for(const file of ['index','HEAD','logs/HEAD'])try{newest=Math.max(newest,statSync(join(gitDir,file)).mtimeMs);}catch{/* Not there. */}
 return newest;
}

/** Is `sha` on origin/main itself? @param {string} canonical @param {string} sha */
export const onMain=(canonical,sha)=>sha!==''&&tryGit(canonical,['merge-base','--is-ancestor',sha,'origin/main']).status===0;
/** Commits of `sha` that origin/main lacks. @param {string} canonical @param {string} sha */
const aheadOfMain=(canonical,sha)=>Number(tryGit(canonical,['rev-list','--count',`origin/main..${sha}`]).stdout.trim()||'0');

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
 const common=join(canonical,'.git');
 if(existsSync(join(common,'wildshard-worktree-setup.lock'))){say('reap STOP a worktree setup is running; retry when it finishes');return 1;}
 const fetched=tryGit(canonical,['fetch','--quiet','origin','+refs/heads/main:refs/remotes/origin/main']);
 if(fetched.status!==0){say(`reap STOP cannot fetch origin main: ${fetched.stderr.trim()}`);return 1;}
 const directories=processDirectories();
 const realRoot=realpathSync(canonical),now=Date.now();
 /** @type {string[]} */const reaped=[];
 /** @type {string[]} */const kept=[];
 /** @type {string[]} */const remotes=[];
 for(const tree of linkedWorktrees(canonical)){
  const slug=basename(tree.path),branch=`refs/heads/plan/${slug}`;
  const keep=(/** @type {string} */ why)=>{kept.push(`${slug} (${why})`);say(`kept     ${slug}: ${why}`);};
  if(resolve(tree.path)!==join(canonical,WORKTREES,slug)&&resolve(tree.path)!==join(realRoot,WORKTREES,slug)){say(`skipped  ${tree.path}: not a plan worktree of this checkout`);continue;}
  // Physically too: a linked .worktrees/ or worktree folder may point anywhere.
  let physical='';
  try{physical=realpathSync(tree.path);}catch{/* Gone: kept below. */}
  if(physical!==''&&(physical!==join(realRoot,WORKTREES,slug)||realpathSync(join(canonical,WORKTREES))!==join(realRoot,WORKTREES))){say(`skipped  ${tree.path}: resolves to ${physical}, outside ${join(realRoot,WORKTREES)}`);continue;}
  if(tree.branch!==branch){keep(`on ${tree.branch===''?'a detached HEAD':tree.branch}, not plan/${slug}`);continue;}
  if(!existsSync(tree.path)){keep('its folder is gone; `git worktree prune` clears it');continue;}
  // Landed means the tip is on main itself (land fast-forwards): \`git cherry\` would miss a merge's own changes.
  if(!onMain(canonical,tree.head)){keep(`${String(aheadOfMain(canonical,tree.head))} commit(s) not on main`);continue;}
  const dirty=git(tree.path,['--no-optional-locks','status','--porcelain','--untracked-files=all']).split('\n').filter(Boolean);
  if(dirty.length>0){keep(`${String(dirty.length)} uncommitted path(s), first ${dirty[0]?.slice(3)}`);continue;}
  const gitDir=git(tree.path,['rev-parse','--absolute-git-dir']).trim();
  const busy=(/** @type {Map<number,string>|undefined} */ seen)=>seen===undefined?'cannot list process working directories'
   :[...seen].filter(([,path])=>path===physical||path.startsWith(`${physical}${sep}`)).map(([pid])=>String(pid)).join(', ');
  // FL30: orphans (reparented to pid 1) in a landed, clean worktree are nobody's; they don't make it busy, and they
  // are stopped only once it passed the grace, under its land lock (J206 review).
  const orphans=new Set(stopWorktreeProcesses(physical,{orphansOnly:true,dryRun:true}));
  const using=busy(directories===undefined?undefined:new Map([...directories].filter(([pid])=>!orphans.has(pid))));
  if(using!==''){keep(directories===undefined?using:`in use by pid ${using}`);continue;}
  const idleHours=Math.max(0,(now-lastActivity(tree.path,gitDir))/3_600_000);
  if(options.graceHours>0&&idleHours<options.graceHours){keep(`active ${idleHours.toFixed(1)} h ago, under the ${String(options.graceHours)} h grace`);continue;}
  // Hold the worktree's land lock (land can't start under it; a running land holds it already), then check again
  // what could have changed since: HEAD, a commit, an edit, a new process inside, a worktree setup.
  /** @type {(() => void)|undefined} */let release;
  try{release=pidLock(join(gitDir,'wildshard-land.lock'));}catch(error){keep(error instanceof Error?error.message:String(error));continue;}
  if(release===undefined){keep('land is running there');continue;}
  try{
   if(orphans.size>0){
    const stopped=stopWorktreeProcesses(physical,{orphansOnly:true,dryRun:options.dryRun});
    if(stopped.length>0)say(`${options.dryRun?'would stop':'stopped '} ${slug}: orphaned pid ${stopped.join(', ')}`);
   }
   const head=tryGit(tree.path,['rev-parse','HEAD']).stdout.trim();
   const now2=git(tree.path,['--no-optional-locks','status','--porcelain','--untracked-files=all']).trim();
   const seen2=processDirectories();
   const using2=busy(seen2===undefined||!options.dryRun?seen2:new Map([...seen2].filter(([pid])=>!orphans.has(pid))));
   const why=head!==tree.head?`HEAD moved to ${head.slice(0,10)} during the check`:now2!==''?'edited during the check':using2!==''?`in use during the check (${using2})`
    :existsSync(join(common,'wildshard-worktree-setup.lock'))?'a worktree setup started during the check':!onMain(canonical,head)?'not on main during the check':'';
   if(why!==''){keep(why);continue;}
   if(options.dryRun){say(`would reap ${slug}: landed, clean, idle ${idleHours.toFixed(1)} h`);reaped.push(slug);continue;}
   const removed=tryGit(canonical,['worktree','remove',tree.path]);
   if(removed.status!==0){keep(`git worktree remove refused: ${removed.stderr.trim()}`);continue;}
  }finally{release();}
  // Only while the branch is still the commit checked above; anything newer is somebody's work.
  const deleted=tryGit(canonical,['update-ref','-d',branch,tree.head]);
  say(`reaped   ${slug}: worktree removed${deleted.status===0?', branch deleted':`, branch kept (${deleted.stderr.trim()})`}`);
  reaped.push(slug);
  if(!options.remote)continue;
  const listed=tryGit(canonical,['ls-remote','--heads','origin',branch]);
  const sha=listed.status===0?listed.stdout.trim().split(/\s+/u)[0]??'':'';
  if(sha===''){if(listed.status!==0)say(`         ${slug}: origin not reachable; its remote branch is left`);continue;}
  // The remote branch goes only if it is landed too: its commit must be here and add nothing main lacks.
  if(tryGit(canonical,['cat-file','-e',`${sha}^{commit}`]).status!==0){remotes.push(`${slug} kept (origin has ${sha.slice(0,10)}, unknown here)`);say(`         ${slug}: origin plan/${slug} is ${sha.slice(0,10)}, not fetched here; left`);continue;}
  if(!onMain(canonical,sha)){remotes.push(`${slug} kept (origin has unlanded commits)`);say(`         ${slug}: origin plan/${slug} holds commits not on main; left`);continue;}
  const pushed=tryGit(canonical,['push','--quiet',`--force-with-lease=${branch}:${sha}`,'origin','--delete',branch]);
  if(pushed.status===0){remotes.push(`${slug} deleted`);say(`         ${slug}: origin plan/${slug} deleted`);}
  else{remotes.push(`${slug} delete failed`);say(`         ${slug}: origin plan/${slug} not deleted: ${pushed.stderr.trim()}`);}
 }
 if(!options.dryRun)tryGit(canonical,['worktree','prune']);
 const lane=/^[a-z][a-z0-9_-]*$/u.test(env.WS_LANE_NAME??'')?String(env.WS_LANE_NAME):'reaper';
 const line=`${new Date().toISOString().slice(11,16)} UTC ${lane} worktree reap ${basename(canonical)}${options.dryRun?' (dry run)':''}: ${reaped.length===0?'none':`${options.dryRun?'would reap':'reaped'} ${reaped.join(', ')}`}; kept ${kept.length===0?'none':kept.join(', ')}${remotes.length===0?'':`; origin ${remotes.join(', ')}`}`;
 const file=resolve(env.WS_LANE_RECEIPTS??join(homedir(),'.cache/wildshard/lane-receipts.log'));
 try{mkdirSync(dirname(file),{recursive:true});appendFileSync(file,`${line}\n`);}catch(error){say(`reap receipt unavailable: ${String(error)}`);}
 return 0;
}
